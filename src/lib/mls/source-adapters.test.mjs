import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseListingDetail, parseListingIndex } from "./parse-old-site.mjs";
import { createOldSiteSourceAdapter } from "./sources/old-site.mjs";

const seedUrl = "https://www.earnestproperty.com/property/c1";
const detailUrl = "https://www.earnestproperty.com/property-detail/6709182.html";

function fixture(name) {
  return readFileSync(
    new URL(`../../../scripts/old-site-migration/__fixtures__/${name}`, import.meta.url),
    "utf8",
  );
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
  const fakeResponseFetch = async (url) => {
    const body = responses.get(url);
    return new Response(body ?? "", { status: body === undefined ? 404 : 200 });
  };

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
  const fakeResponseFetch = async (url) =>
    url === seedUrl
      ? new Response(indexHtml, { status: 200 })
      : new Response("temporarily unavailable", { status: 503, headers: { "retry-after": "60" } });
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
    fetchImpl: async (url) =>
      new Response(url === seedUrl ? indexHtml : fixture("property-detail-6709182.html"), {
        status: 200,
      }),
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
    fetchImpl: async (url) => {
      if (url === seedUrl) return new Response(twoPageIndexFromFixture(), { status: 200 });
      return new Response("temporarily unavailable", { status: 503 });
    },
    sleep: async () => {},
    random: () => 0,
    now: () => new Date("2026-08-17T02:00:00.000Z"),
    signal: new AbortController().signal,
  });

  const result = await adapter.collect({ seedUrls: [{ url: seedUrl, dealType: "sale" }] });

  assert.equal(result.paginationComplete, false);
  assert.deepEqual(
    result.diagnostics.find((entry) => entry.sourceUrl === seedUrl),
    {
      sourceUrl: seedUrl,
      responseStatus: 200,
      attempts: 1,
      templateFingerprint: null,
      selectorCounts: {},
      failureCode: null,
    },
  );
  assert.deepEqual(
    result.diagnostics.find((entry) => entry.sourceUrl === pageTwoUrl),
    {
      sourceUrl: pageTwoUrl,
      responseStatus: 503,
      attempts: 1,
      templateFingerprint: null,
      selectorCounts: {},
      failureCode: "index_fetch_failed",
    },
  );
});
