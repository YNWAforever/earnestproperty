import {
  CRAWLER_USER_AGENT,
  MAX_HTML_BYTES,
  PAGE_TIMEOUT_MS,
  PolicyFetchError,
  abortableDelay,
  createPolicyFetch,
  defaultSleep,
  loadRobotsPolicy,
  rethrowIfRunCancelled,
} from "../access-policy.mjs";
import {
  build28HseAgentUrl,
  detect28HseChallenge,
  is28HseAgentCompanyName,
  parse28HseAgentIndex,
  parse28HseDetail,
} from "../parse-28hse.mjs";
import { SOURCE_28HSE, createObservation } from "../source-contract.mjs";

const ORIGIN = "https://www.28hse.com";
const ROBOTS_URL = `${ORIGIN}/robots.txt`;
const AGENT_LICENCE = "C-018613";
const DEAL_TYPES = Object.freeze(["sale", "rent"]);

function isoNow(now) {
  return now().toISOString();
}

function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== ORIGIN) {
    throw new PolicyFetchError("URL leaves the approved 28Hse HTTPS origin", {
      code: "terminal_access",
      sourceUrl: url.toString(),
    });
  }
  return url;
}

function diagnostic(
  sourceUrl,
  fetched = {},
  failureCode = null,
  templateFingerprint = null,
  count = 0,
) {
  return {
    sourceUrl,
    responseStatus: Number.isInteger(fetched.status) ? fetched.status : null,
    attempts: Number.isInteger(fetched.attempts) ? fetched.attempts : 1,
    templateFingerprint,
    selectorCounts: count ? { listings: count } : {},
    failureCode,
  };
}

function boundedFailureDetail(code) {
  const details = {
    robots_prohibited: "Robots policy prohibits the requested source path",
    robots_unreachable: "Robots policy could not be reached safely",
    robots_terminal_access: "Robots request was denied by an access-control response",
    robots_malformed: "Robots policy requires operator review",
    crawl_delay_exceeds_run_budget: "Declared crawl delay exceeds the 30-second request budget",
    terminal_access: "Source request was denied by an access-control response",
    challenge_detected: "Source returned a challenge, CAPTCHA, or login page",
    identity_mismatch: "Source agent identity did not match the configured licence and company",
    pagination_loop: "A listing page repeated before the advertised count was reached",
    pagination_stalled: "A listing page added no new IDs before the advertised count was reached",
    pagination_ceiling: "Pagination exceeded the configured page ceiling",
    advertised_count_mismatch: "Discovered IDs conflict with the advertised count",
    duplicate_id_conflict: "A duplicate external ID resolved to conflicting listing metadata",
    index_fetch_failed: "An index request failed after the bounded retry policy",
    unexpected_template: "The response body exceeded the safe parsing limit",
    unexpected_index_template: "The index template could not be safely interpreted",
    detail_fetch_or_parse_failed: "The detail response could not be safely parsed",
    source_aborted: "Detail was not fetched because the source run aborted",
  };
  return details[code] ?? "Source request failed";
}

function pushFailure(failures, code, externalId) {
  failures.push({
    ...(externalId ? { externalId } : {}),
    code,
    detail: boundedFailureDetail(code),
  });
}

function stubObservation(record, fetchedAt, reason = "detail_fetch_or_parse_failed") {
  return createObservation({
    source: SOURCE_28HSE,
    externalId: record.externalId,
    dealType: record.dealType,
    sourceUrl: record.sourceUrl,
    propertyNoRaw: null,
    fields: {},
    rawFields: {},
    mediaCandidates: [],
    discoveredAt: record.discoveredAt,
    fetchedAt,
    quarantineReasons: [reason],
    parseWarnings: [boundedFailureDetail(reason)],
  });
}

function robotsFailureCode(classification) {
  if (classification === "terminal_access") return "robots_terminal_access";
  if (classification === "malformed") return "robots_malformed";
  return "robots_unreachable";
}

export function create28HseAgentSourceAdapter({
  fetchImpl,
  sleep = defaultSleep,
  random = Math.random,
  now = () => new Date(),
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof sleep !== "function") throw new TypeError("sleep is required");
  if (typeof random !== "function") throw new TypeError("random is required");
  if (typeof now !== "function") throw new TypeError("now is required");

  return {
    async collect({ maxPages = 100 } = {}) {
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
        throw new TypeError("maxPages must be an integer from 1 to 100");
      }
      const failures = [];
      const diagnosticsByUrl = new Map();
      const discoveredByIdentity = new Map();
      const advertisedCounts = { sale: 0, rent: 0 };
      const pageCounts = { sale: 0, rent: 0 };
      const conflictingDuplicateIds = new Set();
      let identityValid = true;
      let robotsAllowed = true;
      let paginationComplete = true;
      let challengeDetected = false;
      let aborted = false;
      let abortReason = null;

      const policyFetch = createPolicyFetch({ fetchImpl, sleep, random, signal, maxAttempts: 3 });
      const robots = await loadRobotsPolicy({
        policyFetch,
        robotsUrl: ROBOTS_URL,
        userAgent: CRAWLER_USER_AGENT,
        signal,
      });
      diagnosticsByUrl.set(
        ROBOTS_URL,
        diagnostic(
          ROBOTS_URL,
          robots,
          robots.allowed ? null : robotsFailureCode(robots.classification),
        ),
      );
      if (!robots.allowed) {
        robotsAllowed = false;
        pushFailure(failures, robotsFailureCode(robots.classification));
        return {
          source: SOURCE_28HSE,
          identityValid,
          robotsAllowed,
          paginationComplete: false,
          challengeDetected,
          advertisedCounts,
          pageCounts,
          discovered: 0,
          observations: [],
          failures,
          diagnostics: [...diagnosticsByUrl.values()],
          conflictingDuplicateIds: [],
        };
      }

      const crawlDelayMs = Number.isFinite(robots.policy?.crawlDelaySeconds)
        ? Math.ceil(robots.policy.crawlDelaySeconds * 1000)
        : 0;
      if (crawlDelayMs > PAGE_TIMEOUT_MS) {
        pushFailure(failures, "crawl_delay_exceeds_run_budget");
        return {
          source: SOURCE_28HSE,
          identityValid,
          robotsAllowed,
          paginationComplete: false,
          challengeDetected,
          advertisedCounts,
          pageCounts,
          discovered: 0,
          observations: [],
          failures,
          diagnostics: [...diagnosticsByUrl.values()],
          conflictingDuplicateIds: [],
        };
      }

      async function fetchPage(sourceUrl, { detailIndex = null } = {}) {
        const url = safeUrl(sourceUrl);
        if (!robots.policy.isAllowed(`${url.pathname}${url.search}`)) {
          throw new PolicyFetchError("Robots policy prohibits this path", {
            code: "robots_prohibited",
            sourceUrl: url.toString(),
          });
        }
        let delay = crawlDelayMs;
        if (detailIndex !== null && detailIndex > 0) {
          delay = Math.max(delay, 2000 + Math.floor(random() * 1001));
        }
        await abortableDelay(sleep, delay, signal);
        return policyFetch(url.toString(), {
          timeoutMs: PAGE_TIMEOUT_MS,
          maxBytes: MAX_HTML_BYTES,
          allowedOrigin: ORIGIN,
          maxRedirects: 5,
        });
      }

      discovery: for (const dealType of DEAL_TYPES) {
        const seenFingerprints = new Set();
        const idsForDeal = new Set();
        let expectedCount = null;
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          const pageUrl = build28HseAgentUrl(dealType, pageNumber);
          let fetched;
          try {
            fetched = await fetchPage(pageUrl);
          } catch (error) {
            rethrowIfRunCancelled(error, signal);
            const code =
              error?.code === "terminal_access"
                ? "terminal_access"
                : error?.code === "robots_prohibited"
                  ? "robots_prohibited"
                  : error?.code === "unexpected_template"
                    ? "unexpected_template"
                    : "index_fetch_failed";
            diagnosticsByUrl.set(pageUrl, diagnostic(pageUrl, error, code));
            pushFailure(failures, code);
            paginationComplete = false;
            abortReason = code;
            if (code === "terminal_access" || code === "robots_prohibited") robotsAllowed = false;
            aborted = true;
            break discovery;
          }

          if (detect28HseChallenge(fetched.text)) {
            challengeDetected = true;
            paginationComplete = false;
            abortReason = "challenge_detected";
            pushFailure(failures, "challenge_detected");
            diagnosticsByUrl.set(pageUrl, diagnostic(pageUrl, fetched, "challenge_detected"));
            aborted = true;
            break discovery;
          }

          let parsed;
          try {
            parsed = parse28HseAgentIndex(fetched.text, { dealType, pageUrl });
          } catch (error) {
            rethrowIfRunCancelled(error, signal);
            const identityFailure = /licence|company|identity|source url|deal type/i.test(
              String(error?.message ?? ""),
            );
            const code = identityFailure ? "identity_mismatch" : "unexpected_index_template";
            if (identityFailure) identityValid = false;
            paginationComplete = false;
            abortReason = code;
            pushFailure(failures, code);
            diagnosticsByUrl.set(pageUrl, diagnostic(pageUrl, fetched, code));
            aborted = true;
            break discovery;
          }

          pageCounts[dealType] += 1;
          diagnosticsByUrl.set(
            pageUrl,
            diagnostic(pageUrl, fetched, null, parsed.pageFingerprint, parsed.links.length),
          );
          if (
            parsed.companyLicence !== AGENT_LICENCE ||
            !is28HseAgentCompanyName(parsed.companyName)
          ) {
            identityValid = false;
            paginationComplete = false;
            abortReason = "identity_mismatch";
            pushFailure(failures, "identity_mismatch");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostic(
                pageUrl,
                fetched,
                "identity_mismatch",
                parsed.pageFingerprint,
                parsed.links.length,
              ),
            );
            aborted = true;
            break discovery;
          }
          if (expectedCount === null) {
            expectedCount = parsed.advertisedCount;
            advertisedCounts[dealType] = expectedCount;
          } else if (parsed.advertisedCount !== expectedCount) {
            paginationComplete = false;
            abortReason = "advertised_count_mismatch";
            pushFailure(failures, "advertised_count_mismatch");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostic(
                pageUrl,
                fetched,
                "advertised_count_mismatch",
                parsed.pageFingerprint,
                parsed.links.length,
              ),
            );
            aborted = true;
            break discovery;
          }
          if (seenFingerprints.has(parsed.pageFingerprint)) {
            paginationComplete = false;
            abortReason = "pagination_loop";
            pushFailure(failures, "pagination_loop");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostic(
                pageUrl,
                fetched,
                "pagination_loop",
                parsed.pageFingerprint,
                parsed.links.length,
              ),
            );
            aborted = true;
            break discovery;
          }
          seenFingerprints.add(parsed.pageFingerprint);

          let newIds = 0;
          for (const link of parsed.links) {
            const sourceUrl = safeUrl(link.url).toString();
            const identity = `${dealType}:${link.externalId}`;
            const existing = discoveredByIdentity.get(identity);
            if (existing) {
              if (!existing.candidates.has(sourceUrl)) {
                existing.candidates.set(sourceUrl, {
                  sourceUrl,
                  summaryTitle: link.summaryTitle,
                });
              }
              continue;
            }
            const record = {
              externalId: link.externalId,
              dealType,
              sourceUrl,
              summaryTitle: link.summaryTitle,
              discoveredAt: isoNow(now),
              candidates: new Map([[sourceUrl, { sourceUrl, summaryTitle: link.summaryTitle }]]),
            };
            discoveredByIdentity.set(identity, record);
            idsForDeal.add(link.externalId);
            newIds += 1;
          }
          if (aborted) break discovery;
          if (idsForDeal.size > expectedCount) {
            paginationComplete = false;
            abortReason = "advertised_count_mismatch";
            pushFailure(failures, "advertised_count_mismatch");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostic(
                pageUrl,
                fetched,
                "advertised_count_mismatch",
                parsed.pageFingerprint,
                parsed.links.length,
              ),
            );
            aborted = true;
            break discovery;
          }
          if (idsForDeal.size === expectedCount) break;
          if (newIds === 0) {
            paginationComplete = false;
            abortReason = "pagination_stalled";
            pushFailure(failures, "pagination_stalled");
            diagnosticsByUrl.set(
              pageUrl,
              diagnostic(
                pageUrl,
                fetched,
                "pagination_stalled",
                parsed.pageFingerprint,
                parsed.links.length,
              ),
            );
            aborted = true;
            break discovery;
          }
          if (pageNumber === maxPages) {
            paginationComplete = false;
            abortReason = "pagination_ceiling";
            pushFailure(failures, "pagination_ceiling");
            aborted = true;
            break discovery;
          }
        }
      }

      const observations = [];
      const records = [...discoveredByIdentity.values()];
      if (aborted && records.length) {
        for (const record of records) {
          observations.push(stubObservation(record, isoNow(now), abortReason ?? "source_aborted"));
        }
      }
      if (!aborted && paginationComplete && identityValid && robotsAllowed) {
        let detailRequestIndex = 0;
        details: for (let detailIndex = 0; detailIndex < records.length; detailIndex += 1) {
          const record = records[detailIndex];
          const parsedCandidates = [];
          let lastFailureCode = null;
          for (const candidate of record.candidates.values()) {
            const fetchedAt = isoNow(now);
            let fetched;
            try {
              const pacingIndex = detailRequestIndex;
              detailRequestIndex += 1;
              fetched = await fetchPage(candidate.sourceUrl, { detailIndex: pacingIndex });
            } catch (error) {
              rethrowIfRunCancelled(error, signal);
              const isAccess =
                error?.code === "terminal_access" || error?.code === "robots_prohibited";
              const code = isAccess
                ? error.code
                : error?.code === "unexpected_template"
                  ? "unexpected_template"
                  : "detail_fetch_or_parse_failed";
              lastFailureCode = code;
              pushFailure(failures, code, record.externalId);
              diagnosticsByUrl.set(
                candidate.sourceUrl,
                diagnostic(candidate.sourceUrl, error, code),
              );
              if (isAccess) {
                robotsAllowed = false;
                aborted = true;
                observations.push(stubObservation(record, fetchedAt, code));
                for (const remaining of records.slice(detailIndex + 1)) {
                  observations.push(stubObservation(remaining, isoNow(now), code));
                }
                break details;
              }
              continue;
            }

            if (detect28HseChallenge(fetched.text)) {
              challengeDetected = true;
              pushFailure(failures, "challenge_detected", record.externalId);
              diagnosticsByUrl.set(
                candidate.sourceUrl,
                diagnostic(candidate.sourceUrl, fetched, "challenge_detected"),
              );
              observations.push(stubObservation(record, fetchedAt, "challenge_detected"));
              aborted = true;
              for (const remaining of records.slice(detailIndex + 1)) {
                observations.push(stubObservation(remaining, isoNow(now), "challenge_detected"));
              }
              break details;
            }

            try {
              parsedCandidates.push(
                parse28HseDetail(fetched.text, {
                  dealType: record.dealType,
                  sourceUrl: candidate.sourceUrl,
                  summaryTitle: candidate.summaryTitle,
                  discoveredAt: record.discoveredAt,
                  fetchedAt,
                }),
              );
              diagnosticsByUrl.set(candidate.sourceUrl, diagnostic(candidate.sourceUrl, fetched));
            } catch (error) {
              rethrowIfRunCancelled(error, signal);
              lastFailureCode = "detail_fetch_or_parse_failed";
              pushFailure(failures, lastFailureCode, record.externalId);
              diagnosticsByUrl.set(
                candidate.sourceUrl,
                diagnostic(candidate.sourceUrl, fetched, lastFailureCode),
              );
            }
          }

          const propertyNumbers = new Set(
            parsedCandidates.map((observation) => observation.propertyNoNormalized),
          );
          if (lastFailureCode) {
            observations.push(stubObservation(record, isoNow(now), lastFailureCode));
          } else if (propertyNumbers.size > 1) {
            conflictingDuplicateIds.add(record.externalId);
            pushFailure(failures, "duplicate_id_conflict", record.externalId);
            observations.push(stubObservation(record, isoNow(now), "duplicate_id_conflict"));
          } else if (parsedCandidates.length) {
            observations.push(parsedCandidates[0]);
          } else {
            observations.push(stubObservation(record, isoNow(now)));
          }
        }
      }

      return {
        source: SOURCE_28HSE,
        identityValid,
        robotsAllowed,
        paginationComplete,
        challengeDetected,
        advertisedCounts,
        pageCounts,
        discovered: discoveredByIdentity.size,
        observations,
        failures,
        diagnostics: [...diagnosticsByUrl.values()],
        conflictingDuplicateIds: [...conflictingDuplicateIds].sort(),
      };
    },
  };
}
