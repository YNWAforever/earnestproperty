export const PAGE_TIMEOUT_MS = 30_000;
export const ROBOTS_TIMEOUT_MS = 15_000;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_ROBOTS_BYTES = 512 * 1024;
export const CRAWLER_USER_AGENT = "EarnestPropertyBot";

const ACCESS_STATUSES = new Set([401, 403, 429]);
const RETRYABLE_STATUSES = new Set([408]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class PolicyFetchError extends Error {
  constructor(message, { code, status = null, attempts = 1, sourceUrl = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PolicyFetchError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
    this.sourceUrl = sourceUrl;
  }
}

function normalizedStatus(status) {
  return Number.isInteger(status) ? status : null;
}

export function classifyFetchFailure({ status, networkError = false } = {}) {
  const value = normalizedStatus(status);
  if (ACCESS_STATUSES.has(value)) return "terminal_access";
  if (networkError || RETRYABLE_STATUSES.has(value) || (value >= 500 && value <= 599)) {
    return "retryable";
  }
  return "terminal_response";
}

export function classifyRobotsResponse({ status, networkError = false, timeout = false } = {}) {
  const value = normalizedStatus(status);
  if (networkError || timeout || RETRYABLE_STATUSES.has(value) || (value >= 500 && value <= 599)) {
    return "disallow_unreachable";
  }
  if (ACCESS_STATUSES.has(value)) return "terminal_access";
  if (value === 404 || value === 410) return "allow_unavailable";
  if (value >= 200 && value <= 299) return "parse";
  if (REDIRECT_STATUSES.has(value)) return "redirect";
  return "terminal_response";
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function compileRobotsPattern(pattern) {
  const anchored = pattern.endsWith("$");
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const expression = raw.split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`);
}

function ruleSpecificity(pattern) {
  return pattern.replace(/\*/g, "").replace(/\$$/, "").length;
}

function applicableGroups(groups, userAgent) {
  const product = String(userAgent ?? "")
    .trim()
    .toLowerCase();
  const matches = groups
    .map((group) => ({
      group,
      specificity: Math.max(
        ...group.agents.map((agent) => {
          const token = agent.toLowerCase();
          if (token === "*") return 0;
          return product.includes(token) ? token.length : -1;
        }),
      ),
    }))
    .filter(({ specificity }) => specificity >= 0);
  if (!matches.length) return [];
  const longest = Math.max(...matches.map(({ specificity }) => specificity));
  return matches.filter(({ specificity }) => specificity === longest).map(({ group }) => group);
}

export function parseRobots(text, userAgent) {
  const groups = [];
  let current = null;
  let malformedOutsideGroup = false;

  for (const rawLine of String(text ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      current = null;
      continue;
    }
    const directive = line.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i);
    if (!directive) {
      if (current) current.malformed = true;
      else malformedOutsideGroup = true;
      continue;
    }
    const name = directive[1].toLowerCase();
    const value = directive[2].trim();

    if (name === "user-agent") {
      if (!value) {
        malformedOutsideGroup = true;
        current = null;
        continue;
      }
      if (!current || current.hasDirectives) {
        current = {
          agents: [],
          rules: [],
          crawlDelays: [],
          hasDirectives: false,
          malformed: false,
        };
        groups.push(current);
      }
      current.agents.push(value);
      continue;
    }

    if (!current) {
      if (name !== "sitemap") malformedOutsideGroup = true;
      continue;
    }
    if (name === "allow" || name === "disallow") {
      current.hasDirectives = true;
      if (!value) continue;
      if (!value.startsWith("/") && !value.startsWith("*")) {
        current.malformed = true;
        continue;
      }
      current.rules.push({
        allow: name === "allow",
        pattern: value,
        matcher: compileRobotsPattern(value),
        specificity: ruleSpecificity(value),
      });
      continue;
    }
    if (name === "crawl-delay") {
      current.hasDirectives = true;
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0) current.malformed = true;
      else current.crawlDelays.push(seconds);
    }
  }

  const applicable = applicableGroups(groups, userAgent);
  const malformed = applicable.some((group) => group.malformed);
  const safelyInterpretable = !malformed && !(malformedOutsideGroup && groups.length === 0);
  const rules = applicable.flatMap((group) => group.rules);
  const delays = applicable.flatMap((group) => group.crawlDelays);
  const crawlDelaySeconds = delays.length ? Math.max(...delays) : null;

  return Object.freeze({
    crawlDelaySeconds,
    safelyInterpretable,
    isAllowed(target) {
      if (!safelyInterpretable) return false;
      let path;
      try {
        const url = new URL(String(target), "https://robots.invalid");
        path = `${url.pathname}${url.search}`;
      } catch {
        return false;
      }
      const matches = rules.filter((rule) => rule.matcher.test(path));
      if (!matches.length) return true;
      const longest = Math.max(...matches.map((rule) => rule.specificity));
      return matches.some((rule) => rule.specificity === longest && rule.allow);
    },
  });
}

function crawlerUserAgent() {
  const rawContact = String(process.env.MLS_CRAWLER_CONTACT_URL ?? "").trim();
  if (!rawContact) return `${CRAWLER_USER_AGENT}/1.0`;
  try {
    const contact = new URL(rawContact);
    if (contact.protocol !== "https:" && contact.protocol !== "http:") {
      return `${CRAWLER_USER_AGENT}/1.0`;
    }
    return `${CRAWLER_USER_AGENT}/1.0 (+${contact.toString()})`;
  } catch {
    return `${CRAWLER_USER_AGENT}/1.0`;
  }
}

function abortError(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

export async function abortableDelay(sleep, milliseconds, signal) {
  if (!(milliseconds > 0)) return;
  if (signal?.aborted) throw abortError(signal);
  let removeAbortListener = () => {};
  const aborted = new Promise((_, reject) => {
    if (!signal) return;
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    await Promise.race([Promise.resolve().then(() => sleep(milliseconds, { signal })), aborted]);
  } finally {
    removeAbortListener();
  }
}

async function boundedText(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PolicyFetchError("Response body exceeds configured limit", {
      code: "unexpected_template",
      status: response.status,
    });
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new PolicyFetchError("Response body exceeds configured limit", {
        code: "unexpected_template",
        status: response.status,
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new PolicyFetchError("Response body exceeds configured limit", {
        code: "unexpected_template",
        status: response.status,
      });
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function checkedUrl(value, allowedOrigin) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PolicyFetchError("Request URL is invalid", { code: "terminal_access" });
  }
  if (url.protocol !== "https:" || (allowedOrigin && url.origin !== allowedOrigin)) {
    throw new PolicyFetchError("Request URL leaves the approved HTTPS origin", {
      code: "terminal_access",
      sourceUrl: url.toString(),
    });
  }
  return url;
}

function requestSignal(runSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    signal: runSignal ? AbortSignal.any([runSignal, timeoutSignal]) : timeoutSignal,
    timeoutSignal,
  };
}

export function createPolicyFetch({
  fetchImpl,
  sleep = async () => {},
  random = Math.random,
  signal: runSignal,
  maxAttempts = 3,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (typeof sleep !== "function") throw new TypeError("sleep is required");
  if (typeof random !== "function") throw new TypeError("random is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new TypeError("maxAttempts must be between one and three");
  }

  return async function policyFetch(
    sourceUrl,
    {
      timeoutMs = PAGE_TIMEOUT_MS,
      maxBytes = MAX_HTML_BYTES,
      allowedOrigin = new URL(sourceUrl).origin,
      maxRedirects = 5,
      responseKind = "page",
    } = {},
  ) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let activeUrl = checkedUrl(sourceUrl, allowedOrigin);
      const { signal, timeoutSignal } = requestSignal(runSignal, timeoutMs);
      try {
        for (let redirects = 0; ; redirects += 1) {
          const response = await fetchImpl(activeUrl.toString(), {
            signal,
            redirect: "manual",
            headers: {
              accept: responseKind === "robots" ? "text/plain,*/*;q=0.1" : "text/html,*/*;q=0.1",
              "user-agent": crawlerUserAgent(),
            },
          });
          if (!response || typeof response.text !== "function") {
            throw new PolicyFetchError("Fetch returned an invalid response", {
              code: "terminal_response",
              attempts: attempt,
              sourceUrl: activeUrl.toString(),
            });
          }
          const status = normalizedStatus(response.status);
          const classification =
            responseKind === "robots"
              ? classifyRobotsResponse({ status })
              : response.ok
                ? "success"
                : classifyFetchFailure({ status });

          if (classification === "redirect") {
            if (redirects >= maxRedirects) {
              throw new PolicyFetchError("Redirect limit exceeded", {
                code: "terminal_access",
                status,
                attempts: attempt,
                sourceUrl: activeUrl.toString(),
              });
            }
            const location = response.headers?.get?.("location");
            if (!location) {
              throw new PolicyFetchError("Redirect response has no location", {
                code: "terminal_response",
                status,
                attempts: attempt,
                sourceUrl: activeUrl.toString(),
              });
            }
            activeUrl = checkedUrl(new URL(location, activeUrl).toString(), allowedOrigin);
            continue;
          }
          if (classification === "success" || classification === "parse") {
            const text = await boundedText(response, maxBytes);
            return { text, status, attempts: attempt, sourceUrl: activeUrl.toString() };
          }
          if (classification === "allow_unavailable") {
            return { text: "", status, attempts: attempt, sourceUrl: activeUrl.toString() };
          }

          const retryable =
            classification === "retryable" || classification === "disallow_unreachable";
          const error = new PolicyFetchError(`Fetch failed with status ${status ?? "unknown"}`, {
            code: classification,
            status,
            attempts: attempt,
            sourceUrl: activeUrl.toString(),
          });
          if (!retryable || attempt === maxAttempts) throw error;
          lastError = error;
          break;
        }
      } catch (error) {
        if (runSignal?.aborted) throw abortError(runSignal);
        if (
          error instanceof PolicyFetchError &&
          error.code !== "retryable" &&
          error.code !== "disallow_unreachable"
        ) {
          error.attempts = attempt;
          throw error;
        }
        const timedOut = timeoutSignal.aborted;
        const normalized =
          error instanceof PolicyFetchError
            ? error
            : new PolicyFetchError(timedOut ? "Request timed out" : "Network request failed", {
                code: responseKind === "robots" ? "disallow_unreachable" : "retryable",
                attempts: attempt,
                sourceUrl: activeUrl.toString(),
                cause: error,
              });
        lastError = normalized;
        if (attempt === maxAttempts) throw normalized;
      }

      const delay = 2000 + Math.floor(random() * 1001);
      await abortableDelay(sleep, delay, runSignal);
    }
    throw lastError;
  };
}

export async function loadRobotsPolicy({ policyFetch, robotsUrl, userAgent = CRAWLER_USER_AGENT }) {
  try {
    const fetched = await policyFetch(robotsUrl, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      maxBytes: MAX_ROBOTS_BYTES,
      allowedOrigin: new URL(robotsUrl).origin,
      maxRedirects: 5,
      responseKind: "robots",
    });
    const classification = classifyRobotsResponse({ status: fetched.status });
    if (classification === "allow_unavailable") {
      return {
        allowed: true,
        classification,
        policy: parseRobots("", userAgent),
        ...fetched,
      };
    }
    const policy = parseRobots(fetched.text, userAgent);
    return {
      allowed: policy.safelyInterpretable,
      classification: policy.safelyInterpretable ? "parsed" : "malformed",
      policy,
      ...fetched,
    };
  } catch (error) {
    return {
      allowed: false,
      classification: error?.code ?? "disallow_unreachable",
      policy: null,
      text: "",
      status: normalizedStatus(error?.status),
      attempts: Number.isInteger(error?.attempts) ? error.attempts : 1,
      sourceUrl: error?.sourceUrl ?? robotsUrl,
      error,
    };
  }
}
