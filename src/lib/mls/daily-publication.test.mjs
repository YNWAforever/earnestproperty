import test from "node:test";
import assert from "node:assert/strict";
import { publicationDecision, publishDaily } from "./daily-publication.mjs";
const raw = {
  agency_property_no: "A123456",
  deal_type: "rent",
  property_id: "4000001",
  source_url: "https://www.28hse.com/rent/apartment/property-4000001",
  source_status: "active",
  rent: "18000",
  saleable_area: "500",
  publication: {
    description: "測試屋苑，實用面積 500 平方呎。",
    images: ["https://i1.28hse.com/a.jpg"],
  },
};
const target = {
  id: "p",
  status: "draft",
  ingestion_owner: "no-hermes-v2",
  canonical_property_no: "A123456",
  deal_type: "rent",
  rent: "18000",
  price: null,
  saleable_area: 500,
  estate_id: "e",
  source_status: "active",
  external_listing_id: "4000001",
  blocked: false,
  source_count: 1,
  images: [],
  description: null,
  source_url: null,
};
test("complete verified draft is eligible", () =>
  assert.equal(publicationDecision(raw, target), null));
for (const [label, patch] of Object.entries({
  staff: { blocked: true },
  terminal: { source_status: "delisted" },
  price: { rent: "19000" },
  identity: { canonical_property_no: "B123456" },
  published: { status: "active" },
  media: { images: ["owned"] },
  ambiguous: { source_count: 2 },
  area: { saleable_area: null },
}))
  test("hold " + label, () => assert.ok(publicationDecision(raw, { ...target, ...patch })));
test("missing photo or description is held", () => {
  for (const publication of [
    { description: "", images: raw.publication.images },
    { description: "x", images: [] },
  ])
    assert.ok(publicationDecision({ ...raw, publication }, target));
});
test("untrusted photo host is held", () =>
  assert.ok(
    publicationDecision(
      { ...raw, publication: { ...raw.publication, images: ["https://evil.example/a.jpg"] } },
      target,
    ),
  ));
test("publication requires accepted full current receipt before media writes", async () => {
  let writes = 0;
  await assert.rejects(
    publishDaily({
      payload: {},
      client: { query: async () => ({ rows: [] }) },
      prepare: async () => writes++,
    }),
  );
  assert.equal(writes, 0);
});
