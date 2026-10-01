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
import { batch } from "./ingestion-test-fixtures.mjs";
function publicationFixture(count = 25) {
  const rows = Array.from({ length: count }, (_, i) => ({
    ...raw,
    property_id: String(4000001 + i),
    agency_property_no: "A" + String(123456 + i),
    source_url: `https://www.28hse.com/rent/apartment/property-${4000001 + i}`,
    title: "Test",
    estate: "Test",
    district: "Test",
  }));
  const payload = batch(rows, "2026-10-01T01:00:00Z");
  let attempts = 0;
  const client = {
    query: async (sql, params) => {
      if (sql.includes("SELECT r.id FROM mls_ingestion_receipts"))
        return { rows: [{ id: "receipt" }] };
      if (sql.startsWith("SELECT p.*")) {
        const row = rows.find((x) => x.property_id === params[0]);
        return {
          rows: [
            {
              ...target,
              id: row.property_id,
              observation_id: row.property_id,
              canonical_property_no: row.agency_property_no,
              external_listing_id: row.property_id,
              created_at: "2026-09-28T00:00:00Z",
              public_listing_no: row.agency_property_no,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  return {
    payload,
    client,
    prepare: async () => {
      attempts++;
      return { publishable: false };
    },
    attempts: () => attempts,
  };
}
test("twenty failed media attempts consume budget and still report full eligible backlog", async () => {
  const f = publicationFixture();
  const result = await publishDaily({
    ...f,
    apply: true,
    now: () => Date.parse("2026-10-01T02:00:00Z"),
  });
  assert.equal(f.attempts(), 20);
  assert.equal(result.published.length, 0);
  assert.equal(result.attempted, 20);
  assert.equal(result.eligibleBacklog, 25);
  assert.equal(result.oldestWaitingAt, "2026-09-28T00:00:00.000Z");
  assert.equal(result.held.filter((x) => x.reason === "daily_publication_limit").length, 5);
});
test("freshness and current full receipt are checked before any media attempt", async () => {
  const f = publicationFixture(1);
  await assert.rejects(
    publishDaily({ ...f, apply: true, now: () => Date.parse("2026-10-03T02:00:00Z") }),
    /STALE_PUBLICATION/,
  );
  await assert.rejects(
    publishDaily({
      ...f,
      client: { query: async () => ({ rows: [] }) },
      apply: true,
      now: () => Date.parse("2026-10-01T02:00:00Z"),
    }),
    /ACCEPTED_CURRENT/,
  );
  assert.equal(f.attempts(), 0);
});
