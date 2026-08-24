import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  classifyFetchFailure,
  classifyRobotsResponse,
  createPolicyFetch,
  defaultSleep,
  MAX_HTML_BYTES,
  parseRobots,
} from "./access-policy.mjs";
import { build28HseAgentUrl } from "./parse-28hse.mjs";
import { parseListingDetail, parseListingIndex } from "./parse-old-site.mjs";
import { create28HseAgentSourceAdapter } from "./sources/28hse-agent.mjs";
import { createOldSiteSourceAdapter } from "./sources/old-site.mjs";

const seedUrl = "https://www.earnestproperty.com/property/c1";
const detailUrl = "https://www.earnestproperty.com/property-detail/6709182.html";
const oldRobotsUrl = "https://www.earnestproperty.com/robots.txt";
const hseRobotsUrl = "https://www.28hse.com/robots.txt";

function fixture(name) {
  return readFileSync(
    new URL(`../../../scripts/old-site-migration/__fixtures__/${name}`, import.meta.url),
    "utf8",
  );
}

function sourceFixture(source, name) {
  return readFileSync(new URL(`./__fixtures__/${source}/${name}`, import.meta.url), "utf8");
}

function withOldRobots(fetchImpl, robotsName = "robots-allow.txt") {
  return async (url, options) =>
    url === oldRobotsUrl
      ? new Response(sourceFixture("old-site", robotsName), { status: 200 })
      : fetchImpl(url, options);
}

function hseFixtureResponses() {
  const saleDetail = sourceFixture("28hse", "detail-sale-3972991.html");
  return new Map([
    [hseRobotsUrl, sourceFixture("28hse", "robots-allow.txt")],
    [build28HseAgentUrl("sale", 1), sourceFixture("28hse", "agent-sale-page-1.html")],
    [build28HseAgentUrl("sale", 2), sourceFixture("28hse", "agent-sale-page-2.html")],
    [build28HseAgentUrl("rent", 1), sourceFixture("28hse", "agent-rent-page-1.html")],
    ["https://www.28hse.com/buy/apartment/property-3972991", saleDetail],
    [
      "https://www.28hse.com/buy/apartment/property-3973002",
      saleDetail.replace("C003097", "C003002"),
    ],
    [
      "https://www.28hse.com/buy/apartment/property-3973003",
      saleDetail.replace("C003097", "C003003"),
    ],
    [
      "https://www.28hse.com/rent/apartment/property-3976155",
      sourceFixture("28hse", "detail-rent-3976155.html"),
    ],
  ]);
}

function fakeFixtureFetch(requested, overrides = new Map()) {
  const responses = hseFixtureResponses();
  for (const [url, value] of overrides) responses.set(url, value);
  return async (url) => {
    requested.push(String(url));
    if (!responses.has(String(url))) throw new Error(`Unexpected fixture URL: ${url}`);
    const value = responses.get(String(url));
    if (value instanceof Response) return value;
    if (value instanceof Error) throw value;
    return new Response(value, { status: 200 });
  };
}

function createHseHarness(fetchImpl, sleeps = []) {
  return create28HseAgentSourceAdapter({
    fetchImpl,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    random: () => 0.5,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });
}

function repeatedPageAdapter() {
  const requested = [];
  return createHseHarness(
    fakeFixtureFetch(
      requested,
      new Map([[build28HseAgentUrl("sale", 2), sourceFixture("28hse", "agent-sale-page-1.html")]]),
    ),
  );
}

function oldSitePolicyHarness(robotsName) {
  const indexHtml = oneLinkIndexFromFixture();
  return createOldSiteSourceAdapter({
    fetchImpl: withOldRobots(async (url) => {
      if (url === seedUrl) return new Response(indexHtml, { status: 200 });
      if (url === detailUrl)
        return new Response(fixture("property-detail-6709182.html"), { status: 200 });
      throw new Error(`Unexpected fixture URL: ${url}`);
    }, robotsName),
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });
}

function runCancellation(controller) {
  const error = new Error("run cancelled with a custom reason");
  controller.abort(error);
  return error;
}

function oneLinkIndexFromFixture() {
  const original = fixture("property-index-c1.html");
  const selectedLink = original.match(
    /<a\s+href=['"]\/property-detail\/6709182\.html['"][^>]*>/i,
  )?.[0];
  assert.ok(selectedLink, "the existing index fixture includes the selected real detail link");
  return `<html><body>${selectedLink}</body></html>`;
}

function twoPageIndexFromFixture() {
  return `${oneLinkIndexFromFixture()}<script>findForm_submit('page', 2)</script>`;
}

test("old-site adapter returns an immutable observation for a discovered sale detail", async () => {
  const indexHtml = oneLinkIndexFromFixture();
  assert.deepEqual(parseListingIndex(indexHtml, seedUrl), [detailUrl]);
  const responses = new Map([
    [seedUrl, indexHtml],
    [detailUrl, fixture("property-detail-6709182.html")],
  ]);
  const fakeResponseFetch = withOldRobots(async (url) => {
    const body = responses.get(url);
    return new Response(body ?? "", { status: body === undefined ? 404 : 200 });
  });

  const adapter = createOldSiteSourceAdapter({
    fetchImpl: fakeResponseFetch,
    sleep: async () => {},
    random: () => 0,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });
  const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });

  assert.equal(result.source, "old_site");
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].externalId, "6709182");
  assert.equal(result.observations[0].dealType, "sale");
  assert.equal(result.observations[0].matchKey, "sale:B054805");
  assert.equal(result.paginationComplete, true);
});

test("old-site adapter retains a quarantined stub when a discovered detail fails", async () => {
  const indexHtml = oneLinkIndexFromFixture();
  const fakeResponseFetch = withOldRobots(async (url) =>
    url === seedUrl
      ? new Response(indexHtml, { status: 200 })
      : new Response("temporarily unavailable", { status: 503, headers: { "retry-after": "60" } }),
  );
  const adapter = createOldSiteSourceAdapter({
    fetchImpl: fakeResponseFetch,
    sleep: async () => {},
    random: () => 0,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });

  const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });

  assert.equal(result.discovered, 1);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].validationState, "quarantined");
  assert.deepEqual(result.observations[0].quarantineReasons, [
    "detail_fetch_or_parse_failed",
    "missing_or_invalid_property_number",
    "missing_or_invalid_sale_price",
  ]);
  assert.equal(
    result.diagnostics.find((entry) => entry.sourceUrl === detailUrl)?.responseStatus,
    503,
  );
});

test("old-site adapter preserves parser warnings without quarantining the observation", async () => {
  const indexHtml = oneLinkIndexFromFixture();
  const adapter = createOldSiteSourceAdapter({
    fetchImpl: withOldRobots(
      async (url) =>
        new Response(url === seedUrl ? indexHtml : fixture("property-detail-6709182.html"), {
          status: 200,
        }),
    ),
    parseDetail: (html, url) => ({
      ...parseListingDetail(html, url),
      parseWarnings: ["fixture_parser_notice"],
    }),
    sleep: async () => {},
    random: () => 0,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });

  const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });

  assert.deepEqual(result.observations[0].parseWarnings, ["fixture_parser_notice"]);
  assert.equal(result.observations[0].validationState, "valid");
  assert.deepEqual(result.observations[0].quarantineReasons, []);
});

test("old-site adapter records a page-two failure against the page URL", async () => {
  const pageTwoUrl = `${seedUrl}?page=2`;
  const adapter = createOldSiteSourceAdapter({
    fetchImpl: withOldRobots(async (url) => {
      if (url === seedUrl) return new Response(twoPageIndexFromFixture(), { status: 200 });
      return new Response("temporarily unavailable", { status: 503 });
    }),
    sleep: async () => {},
    random: () => 0,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });

  const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });

  assert.equal(result.paginationComplete, false);
  const firstPageDiagnostic = result.diagnostics.find((entry) => entry.sourceUrl === seedUrl);
  assert.equal(firstPageDiagnostic?.responseStatus, 200);
  assert.equal(firstPageDiagnostic?.attempts, 1);
  assert.match(firstPageDiagnostic?.templateFingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(firstPageDiagnostic?.selectorCounts, { listings: 1 });
  assert.equal(firstPageDiagnostic?.failureCode, null);
  assert.deepEqual(
    result.diagnostics.find((entry) => entry.sourceUrl === pageTwoUrl),
    {
      sourceUrl: pageTwoUrl,
      responseStatus: 503,
      attempts: 3,
      templateFingerprint: null,
      selectorCounts: {},
      failureCode: "index_fetch_failed",
    },
  );
  assert.equal(result.discovered, 1);
  assert.equal(result.observations.length, 1);
  assert.ok(result.observations[0].quarantineReasons.includes("index_fetch_failed"));
});

test("old-site empty and login shells fail closed as challenges", async () => {
  for (const body of [
    "   \n\t",
    "<html><body><form action='/login'><h1>Sign in</h1></form></body></html>",
    "<html><body><h1>登入</h1></body></html>",
  ]) {
    const adapter = createOldSiteSourceAdapter({
      fetchImpl: withOldRobots(async (url) => {
        if (url === seedUrl) return new Response(body, { status: 200 });
        throw new Error(`Unexpected fixture URL: ${url}`);
      }),
      now: () => new Date("2026-08-17T02:00:00.000Z"),
      signal: new AbortController().signal,
    });
    const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });
    assert.equal(result.challengeDetected, true);
    assert.equal(result.paginationComplete, false);
    assert.ok(result.failures.some((failure) => failure.code === "challenge_detected"));
  }
});

test("old-site constructor remains valid when sleep and random are omitted", async () => {
  const indexHtml = oneLinkIndexFromFixture();
  const adapter = createOldSiteSourceAdapter({
    fetchImpl: withOldRobots(async (url) => {
      if (url === seedUrl) return new Response(indexHtml, { status: 200 });
      if (url === detailUrl) {
        return new Response(fixture("property-detail-6709182.html"), { status: 200 });
      }
      throw new Error(`Unexpected fixture URL: ${url}`);
    }),
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });
  const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });
  assert.equal(result.observations.length, 1);
});

test("run cancellation during robots fetch propagates from both adapters", async () => {
  for (const createAdapter of [create28HseAgentSourceAdapter, createOldSiteSourceAdapter]) {
    const controller = new AbortController();
    const adapter = createAdapter({
      fetchImpl: async () => {
        throw runCancellation(controller);
      },
      sleep: async () => {},
      random: () => 0.5,
      signal: controller.signal,
    });
    await assert.rejects(
      () => adapter.collect(),
      (error) => error === controller.signal.reason,
    );
  }
});

test("the shared default sleeper waits until completion or exact-reason cancellation", async () => {
  let completed = false;
  const shortSleep = defaultSleep(10).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  await shortSleep;
  assert.equal(completed, true);

  const controller = new AbortController();
  const reason = new Error("stop the default timer");
  let settled = false;
  const pending = defaultSleep(10_000, { signal: controller.signal });
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  await Promise.resolve();
  assert.equal(settled, false);
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
});

test("a pre-aborted run stops before any source request", async () => {
  for (const createAdapter of [create28HseAgentSourceAdapter, createOldSiteSourceAdapter]) {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled before collection", "AbortError"));
    let requests = 0;
    const adapter = createAdapter({
      fetchImpl: async () => {
        requests += 1;
        return new Response("", { status: 200 });
      },
      signal: controller.signal,
    });
    await assert.rejects(() => adapter.collect(), { name: "AbortError" });
    assert.equal(requests, 0);
  }
});

test("run cancellation during index and detail fetch propagates from both adapters", async () => {
  const indexController = new AbortController();
  const hseIndexRun = create28HseAgentSourceAdapter({
    fetchImpl: async (url) => {
      if (url === hseRobotsUrl) {
        return new Response(sourceFixture("28hse", "robots-allow.txt"), { status: 200 });
      }
      throw runCancellation(indexController);
    },
    sleep: async () => {},
    random: () => 0.5,
    signal: indexController.signal,
  });
  await assert.rejects(
    () => hseIndexRun.collect(),
    (error) => error === indexController.signal.reason,
  );

  const oldIndexController = new AbortController();
  const oldIndexRun = createOldSiteSourceAdapter({
    fetchImpl: async (url) => {
      if (url === oldRobotsUrl) {
        return new Response(sourceFixture("old-site", "robots-allow.txt"), { status: 200 });
      }
      throw runCancellation(oldIndexController);
    },
    sleep: async () => {},
    random: () => 0.5,
    signal: oldIndexController.signal,
  });
  await assert.rejects(
    () => oldIndexRun.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] }),
    (error) => error === oldIndexController.signal.reason,
  );

  const hseDetailController = new AbortController();
  const hseRequested = [];
  const hseBaseFetch = fakeFixtureFetch(hseRequested);
  const hseDetailRun = create28HseAgentSourceAdapter({
    fetchImpl: async (url, options) => {
      if (url === "https://www.28hse.com/buy/apartment/property-3972991") {
        throw runCancellation(hseDetailController);
      }
      return hseBaseFetch(url, options);
    },
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: hseDetailController.signal,
  });
  await assert.rejects(
    () => hseDetailRun.collect(),
    (error) => error === hseDetailController.signal.reason,
  );

  const oldDetailController = new AbortController();
  const indexHtml = oneLinkIndexFromFixture();
  const oldDetailRun = createOldSiteSourceAdapter({
    fetchImpl: async (url) => {
      if (url === oldRobotsUrl) {
        return new Response(sourceFixture("old-site", "robots-allow.txt"), { status: 200 });
      }
      if (url === seedUrl) return new Response(indexHtml, { status: 200 });
      throw runCancellation(oldDetailController);
    },
    sleep: async () => {},
    random: () => 0.5,
    signal: oldDetailController.signal,
  });
  await assert.rejects(
    () => oldDetailRun.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] }),
    (error) => error === oldDetailController.signal.reason,
  );
});

test("run cancellation during crawl pacing sleep propagates", async () => {
  const controller = new AbortController();
  const requested = [];
  const adapter = create28HseAgentSourceAdapter({
    fetchImpl: fakeFixtureFetch(requested),
    sleep: async () => {
      throw runCancellation(controller);
    },
    random: () => 0.5,
    signal: controller.signal,
  });
  await assert.rejects(
    () => adapter.collect(),
    (error) => error === controller.signal.reason,
  );
});

test("robots evaluator uses the most-specific matching rule and Allow wins ties", () => {
  const policy = parseRobots(sourceFixture("28hse", "robots-allow.txt"), "EarnestPropertyBot");
  assert.equal(policy.isAllowed("/agent/540"), true);
  assert.equal(policy.isAllowed("/private/export"), false);
  assert.equal(policy.crawlDelaySeconds, 2.5);
});

test("robots merges repeated exact product-token groups case-insensitively", () => {
  const policy = parseRobots(
    `User-agent: EarnestPropertyBot
Disallow: /first

User-agent: EARNESTPROPERTYBOT
Disallow: /second`,
    "earnestpropertybot",
  );
  assert.equal(policy.isAllowed("/first"), false);
  assert.equal(policy.isAllowed("/second"), false);
});

test("robots ignores shorter product tokens and merges wildcard fallback groups", () => {
  const policy = parseRobots(
    `User-agent: EarnestProperty
Disallow: /short-token

User-agent: *
Disallow: /wild-one

User-agent: *
Disallow: /wild-two`,
    "EarnestPropertyBot",
  );
  assert.equal(policy.isAllowed("/short-token"), true);
  assert.equal(policy.isAllowed("/wild-one"), false);
  assert.equal(policy.isAllowed("/wild-two"), false);
});

test("robots normalizes percent-encoded unreserved and Unicode octets", () => {
  const policy = parseRobots(
    `User-agent: EarnestPropertyBot
Disallow: /foo/%62ar
Disallow: /café`,
    "EarnestPropertyBot",
  );
  assert.equal(policy.isAllowed("/foo/bar"), false);
  assert.equal(policy.isAllowed("/foo/%62ar"), false);
  assert.equal(policy.isAllowed("/café"), false);
  assert.equal(policy.isAllowed("/caf%C3%A9"), false);
});

test("robots preserves encoded reserved octets and encoded special characters", () => {
  const policy = parseRobots(
    `User-agent: EarnestPropertyBot
Disallow: /a%2Fb
Disallow: /literal/%2A
Disallow: /literal/%24`,
    "EarnestPropertyBot",
  );
  assert.equal(policy.isAllowed("/a%2fb"), false);
  assert.equal(policy.isAllowed("/a/b"), true);
  assert.equal(policy.isAllowed("/literal/*"), false);
  assert.equal(policy.isAllowed("/literal/$"), false);
});

test("robots ranks matching rules by normalized octets and Allow wins equivalent ties", () => {
  const octetPolicy = parseRobots(
    `User-agent: EarnestPropertyBot
Disallow: /*éé
Allow: /abc*`,
    "EarnestPropertyBot",
  );
  assert.equal(octetPolicy.isAllowed("/abcéé"), false);

  const tiePolicy = parseRobots(
    `User-agent: EarnestPropertyBot
Disallow: /%62ar
Allow: /bar`,
    "EarnestPropertyBot",
  );
  assert.equal(tiePolicy.isAllowed("/bar"), true);
});

test("robots fails closed on malformed percent encodings", () => {
  const malformedRule = parseRobots(
    `User-agent: EarnestPropertyBot
Disallow: /private/%GG`,
    "EarnestPropertyBot",
  );
  assert.equal(malformedRule.safelyInterpretable, false);
  assert.equal(malformedRule.isAllowed("/public"), false);

  const validPolicy = parseRobots("User-agent: *\nAllow: /", "EarnestPropertyBot");
  assert.equal(validPolicy.isAllowed("/public/%GG"), false);
});

test("403 and 429 are terminal but network, 408, and 5xx are retryable", () => {
  assert.equal(classifyFetchFailure({ status: 403 }), "terminal_access");
  assert.equal(classifyFetchFailure({ status: 429 }), "terminal_access");
  assert.equal(classifyFetchFailure({ status: 503 }), "retryable");
  assert.equal(classifyFetchFailure({ status: 408 }), "retryable");
  assert.equal(classifyFetchFailure({ networkError: true }), "retryable");
});

test("robots status handling distinguishes unavailable from unreachable", () => {
  assert.equal(classifyRobotsResponse({ status: 404 }), "allow_unavailable");
  assert.equal(classifyRobotsResponse({ status: 410 }), "allow_unavailable");
  assert.equal(classifyRobotsResponse({ status: 403 }), "terminal_access");
  assert.equal(classifyRobotsResponse({ status: 429 }), "terminal_access");
  assert.equal(classifyRobotsResponse({ status: 503 }), "disallow_unreachable");
  assert.equal(classifyRobotsResponse({ networkError: true }), "disallow_unreachable");
});

test("policy fetch retries retryable responses at most three total attempts", async () => {
  let attempts = 0;
  const sleeps = [];
  const policyFetch = createPolicyFetch({
    fetchImpl: async () => {
      attempts += 1;
      return attempts < 3
        ? new Response("temporary", { status: 503 })
        : new Response("ready", { status: 200 });
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    random: () => 0.5,
    signal: new AbortController().signal,
  });

  const result = await policyFetch("https://example.test/page", { maxBytes: 128 });
  assert.equal(result.text, "ready");
  assert.equal(result.attempts, 3);
  assert.deepEqual(sleeps, [2500, 2500]);
});

test("28Hse adapter rejects maxPages above 100 before any fetch", async () => {
  let requests = 0;
  const adapter = create28HseAgentSourceAdapter({
    fetchImpl: async () => {
      requests += 1;
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(() => adapter.collect({ maxPages: 101 }), /maxPages/i);
  assert.equal(requests, 0);
});

test("28Hse adapter preserves the active deal filter across pagination", async () => {
  const requested = [];
  const sleeps = [];
  const adapter = createHseHarness(fakeFixtureFetch(requested), sleeps);
  const result = await adapter.collect();

  assert.ok(requested.some((url) => url.includes("buyRent=buy&page=2")));
  assert.ok(requested.some((url) => url.includes("buyRent=rent&page=1")));
  assert.equal(
    requested.some((url) => /page-2/.test(url)),
    false,
  );
  assert.equal(result.identityValid, true);
  assert.equal(result.paginationComplete, true);
  assert.equal(result.observations.length, result.discovered);
  assert.ok(sleeps.length >= 3);
  assert.ok(sleeps.every((value) => value === 2500));
});

test("repeated pages and access challenges fail closed", async () => {
  const loopResult = await repeatedPageAdapter().collect();
  assert.equal(loopResult.paginationComplete, false);
  assert.ok(loopResult.failures.some((failure) => failure.code === "pagination_loop"));
  assert.equal(loopResult.discovered, 2);
  assert.equal(loopResult.observations.length, 2);
  assert.ok(
    loopResult.observations.every((observation) =>
      observation.quarantineReasons.includes("pagination_loop"),
    ),
  );

  const requested = [];
  const challenge = createHseHarness(
    fakeFixtureFetch(
      requested,
      new Map([[build28HseAgentUrl("sale", 2), sourceFixture("28hse", "challenge.html")]]),
    ),
  );
  const challengeResult = await challenge.collect();
  assert.equal(challengeResult.challengeDetected, true);
  assert.equal(challengeResult.paginationComplete, false);
  assert.equal(challengeResult.discovered, 2);
  assert.equal(challengeResult.observations.length, 2);
  assert.ok(
    challengeResult.observations.every((observation) =>
      observation.quarantineReasons.includes("challenge_detected"),
    ),
  );
});

test("access denial after discovery preserves stubs and stops further requests", async () => {
  const requested = [];
  const deniedPage = build28HseAgentUrl("sale", 2);
  const adapter = createHseHarness(
    fakeFixtureFetch(requested, new Map([[deniedPage, new Response("denied", { status: 403 })]])),
  );

  const result = await adapter.collect();
  assert.equal(result.robotsAllowed, false);
  assert.equal(result.discovered, 2);
  assert.equal(result.observations.length, 2);
  assert.ok(
    result.observations.every((observation) =>
      observation.quarantineReasons.includes("terminal_access"),
    ),
  );
  assert.equal(
    requested.some((url) => url.includes("buyRent=rent")),
    false,
  );
  assert.equal(
    requested.some((url) => url.includes("/property-")),
    false,
  );
});

test("advertised-count overflow marks the affected page diagnostic", async () => {
  const requested = [];
  const pageUrl = build28HseAgentUrl("sale", 2);
  const overflowPage = sourceFixture("28hse", "agent-sale-page-2.html").replaceAll(
    "3973002",
    "3973004",
  );
  const adapter = createHseHarness(fakeFixtureFetch(requested, new Map([[pageUrl, overflowPage]])));

  const result = await adapter.collect();
  assert.equal(result.paginationComplete, false);
  assert.ok(result.failures.some((failure) => failure.code === "advertised_count_mismatch"));
  assert.equal(
    result.diagnostics.find((entry) => entry.sourceUrl === pageUrl)?.failureCode,
    "advertised_count_mismatch",
  );
});

test("duplicate candidates with conflicting parsed property numbers are quarantined", async () => {
  const requested = [];
  const alternateUrl = "https://www.28hse.com/buy/house/property-3973002";
  const conflictingPage = sourceFixture("28hse", "agent-sale-page-2.html").replace(
    "/buy/apartment/property-3973002",
    "/buy/house/property-3973002",
  );
  const conflictingDetail = sourceFixture("28hse", "detail-sale-3972991.html").replace(
    "C003097",
    "CONFLICT-3002",
  );
  const adapter = createHseHarness(
    fakeFixtureFetch(
      requested,
      new Map([
        [build28HseAgentUrl("sale", 2), conflictingPage],
        [alternateUrl, conflictingDetail],
      ]),
    ),
  );

  const result = await adapter.collect();
  assert.deepEqual(result.conflictingDuplicateIds, ["3973002"]);
  assert.ok(result.failures.some((failure) => failure.code === "duplicate_id_conflict"));
  assert.equal(result.discovered, 4);
  assert.equal(result.observations.length, 4);
  const conflicted = result.observations.find((entry) => entry.externalId === "3973002");
  assert.ok(conflicted.quarantineReasons.includes("duplicate_id_conflict"));
  assert.equal(requested.filter((url) => url === alternateUrl).length, 1);
  assert.equal(
    requested.filter((url) => url === "https://www.28hse.com/buy/apartment/property-3973002")
      .length,
    1,
  );
});

test("duplicate candidate URLs with the same property number collapse without repeated fetches", async () => {
  const requested = [];
  const alternateUrl = "https://www.28hse.com/buy/house/property-3973002";
  const duplicatePage = sourceFixture("28hse", "agent-sale-page-2.html").replace(
    "/buy/apartment/property-3973002",
    "/buy/house/property-3973002",
  );
  const samePropertyDetail = sourceFixture("28hse", "detail-sale-3972991.html").replace(
    "C003097",
    "C003002",
  );
  const adapter = createHseHarness(
    fakeFixtureFetch(
      requested,
      new Map([
        [build28HseAgentUrl("sale", 2), duplicatePage],
        [alternateUrl, samePropertyDetail],
      ]),
    ),
  );

  const result = await adapter.collect();
  assert.deepEqual(result.conflictingDuplicateIds, []);
  assert.equal(result.observations.length, 4);
  assert.equal(result.observations.filter((entry) => entry.externalId === "3973002").length, 1);
  assert.equal(requested.filter((url) => url === alternateUrl).length, 1);
  assert.equal(
    requested.filter((url) => url === "https://www.28hse.com/buy/apartment/property-3973002")
      .length,
    1,
  );
});

test("one failed duplicate candidate quarantines an otherwise successful identity", async () => {
  const requested = [];
  const primaryUrl = "https://www.28hse.com/buy/apartment/property-3973002";
  const alternateUrl = "https://www.28hse.com/buy/house/property-3973002";
  const duplicatePage = sourceFixture("28hse", "agent-sale-page-2.html").replace(
    "/buy/apartment/property-3973002",
    "/buy/house/property-3973002",
  );
  const adapter = createHseHarness(
    fakeFixtureFetch(
      requested,
      new Map([
        [build28HseAgentUrl("sale", 2), duplicatePage],
        [alternateUrl, "<html><body>changed detail template</body></html>"],
      ]),
    ),
  );

  const result = await adapter.collect();
  const duplicate = result.observations.find((entry) => entry.externalId === "3973002");
  assert.equal(result.observations.length, result.discovered);
  assert.ok(duplicate.quarantineReasons.includes("detail_fetch_or_parse_failed"));
  assert.equal(duplicate.validationState, "quarantined");
  assert.equal(requested.filter((url) => url === primaryUrl).length, 1);
  assert.equal(requested.filter((url) => url === alternateUrl).length, 1);
});

test("oversized index bodies fail as an unexpected template without retrying", async () => {
  const requested = [];
  const pageUrl = build28HseAgentUrl("sale", 1);
  const adapter = createHseHarness(
    fakeFixtureFetch(
      requested,
      new Map([[pageUrl, new Response(new Uint8Array(MAX_HTML_BYTES + 1), { status: 200 })]]),
    ),
  );

  const result = await adapter.collect();
  assert.equal(requested.filter((url) => url === pageUrl).length, 1);
  assert.ok(result.failures.some((failure) => failure.code === "unexpected_template"));
  assert.equal(
    result.diagnostics.find((entry) => entry.sourceUrl === pageUrl)?.failureCode,
    "unexpected_template",
  );
});

test("old-site adapter also checks robots, retries safely, and reports page loops", async () => {
  const allowed = await oldSitePolicyHarness("robots-allow.txt").collect({
    seedUrls: [{ url: seedUrl, dealType: "sale" }],
  });
  const denied = await oldSitePolicyHarness("robots-disallow.txt").collect({
    seedUrls: [{ url: seedUrl, dealType: "sale" }],
  });
  assert.equal(allowed.robotsAllowed, true);
  assert.equal(denied.robotsAllowed, false);
  assert.equal(denied.observations.length, 0);

  const htmlRobots = await oldSitePolicyHarness("robots-homepage.html").collect({
    seedUrls: [{ url: seedUrl, dealType: "sale" }],
  });

  assert.equal(htmlRobots.robotsAllowed, false);
  assert.equal(htmlRobots.observations.length, 0);
  assert.ok(
    htmlRobots.failures.some(({ code }) => code === "robots_malformed"),
  );

  const repeated = createOldSiteSourceAdapter({
    fetchImpl: withOldRobots(async (url) => {
      if (url === seedUrl) return new Response(twoPageIndexFromFixture(), { status: 200 });
      if (url === `${seedUrl}?page=2`)
        return new Response(oneLinkIndexFromFixture(), { status: 200 });
      throw new Error(`Unexpected fixture URL: ${url}`);
    }),
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });
  const loop = await repeated.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });
  assert.equal(loop.paginationComplete, false);
  assert.ok(loop.failures.some((failure) => failure.code === "pagination_loop"));
  assert.equal(loop.discovered, 1);
  assert.equal(loop.observations.length, 1);
  assert.ok(loop.observations[0].quarantineReasons.includes("pagination_loop"));
});
