import assert from "node:assert/strict";
import test from "node:test";
import { createNeonMlsDb } from "./neon-db.mjs";

test("legacy MLS upsert persists canonical identity for insert and correction", async () => {
  const calls = [];
  const db = createNeonMlsDb({ query: async (statement, params) => (calls.push({ statement, params }), []) });
  await db.upsertProperties([{
    listing_no: "B054645-new-S", canonical_property_no: "B054645", title_zh: "fixture",
    title_en: null, deal_type: "sale", estate_id: null, district_slug: "sham-tseng",
    address: null, price: 8000000, rent: null, saleable_area: 515, gross_area: 650,
    bedrooms: 2, bathrooms: null, floor: "中", orientation: null, features: [],
    description: null, images: [], status: "active", featured: false,
    legacy_detail_id: "fixture", legacy_property_no: "B054645", legacy_url: null,
    legacy_source_indexes: [], source_site: "old_site", source_url: "https://example.test",
    source_updated_at: "2026-09-06", last_seen_at: "2026-09-06", last_scraped_at: "2026-09-06",
  }]);
  assert.match(calls[0].statement, /last_scraped_at, canonical_property_no/);
  assert.match(calls[0].statement, /canonical_property_no = EXCLUDED\.canonical_property_no/);
  assert.equal(calls[0].params[29], "B054645");
});
