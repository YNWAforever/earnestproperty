// The 市場註冊成交 search schema is shared by the estate route (validation) and
// the module component (filter links), so a bad or hostile query string must
// degrade to the unfiltered view instead of throwing or leaking into SQL.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ESTATE_MARKET_SEARCH_DEFAULTS,
  estateMarketSearchSchema,
  hasEstateMarketFilters,
} from "./estate-market-search.ts";

test("an empty search parses to page 1 with no filters", () => {
  assert.deepEqual(estateMarketSearchSchema.parse({}), ESTATE_MARKET_SEARCH_DEFAULTS);
});

test("accepts a filtered view and keeps the page number", () => {
  assert.deepEqual(
    estateMarketSearchSchema.parse({ mtYear: 2026, mtNature: "臨時合約", mtPage: 3 }),
    {
      mtYear: 2026,
      mtNature: "臨時合約",
      mtPage: 3,
    },
  );
});

test("invalid years, pages and over-long labels fall back instead of throwing", () => {
  const parsed = estateMarketSearchSchema.parse({
    mtYear: 1500,
    mtNature: "x".repeat(40),
    mtPage: 0,
  });
  assert.equal(parsed.mtYear, undefined);
  assert.equal(parsed.mtNature, undefined);
  assert.equal(parsed.mtPage, 1);
});

test("a non-numeric page cannot page past the guard rail", () => {
  assert.equal(estateMarketSearchSchema.parse({ mtPage: "abc" }).mtPage, 1);
  assert.equal(estateMarketSearchSchema.parse({ mtPage: 99_999 }).mtPage, 1);
});

test("pagination alone is not a filter", () => {
  assert.equal(hasEstateMarketFilters({ mtPage: 4 }), false);
  assert.equal(hasEstateMarketFilters({ mtPage: 1, mtYear: 2026 }), true);
  assert.equal(hasEstateMarketFilters({ mtPage: 1, mtNature: "買賣合約" }), true);
  assert.equal(hasEstateMarketFilters({ mtPage: 1, mtPhase: "滿庭" }), true);
  assert.equal(hasEstateMarketFilters({ mtPage: 1, mtNature: "" }), false);
});
