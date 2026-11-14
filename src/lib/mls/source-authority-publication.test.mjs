import assert from "node:assert/strict";
import test from "node:test";
import { authorityValues, reconcileSourceAuthority } from "./source-authority-publication.mjs";
const record = (fields = {}, raw = {}) => ({
  fields,
  raw,
  agencyPropertyNo: "A000001",
  dealType: "sale",
  sourceStatus: "active",
  sourceUrl: "https://www.28hse.com/buy/apartment/property-4000001",
});
test("observed 28Hse facts replace legacy values without claiming missing fields", () => {
  const values = authorityValues(
    record({ title: "Current title", price: "9000000", bedrooms: null, floor: "高層" }),
    { district_slug: "tsuen-wan" },
    {},
  );
  assert.equal(values.title_zh, "Current title");
  assert.equal(values.price, "9000000");
  assert.equal(values.floor, "高層");
  assert.equal(values.source_authority, "28hse");
  for (const field of [
    "bedrooms",
    "address",
    "features",
    "images",
    "video_url",
    "floorplan_url",
    "agent_id",
    "estate_id",
  ])
    assert.ok(!Object.hasOwn(values, field), field);
  assert.equal(values.source_updated_at, null);
  assert.equal(values.status, "active");
});
test("a visible but unmapped estate cannot retain a conflicting legacy estate", () => {
  const values = authorityValues(
    record({ estate: "村屋" }),
    { district_slug: "yuen-long", estate_id: "old" },
    { district_slug: "yuen-long", estate_id: null },
  );
  assert.equal(values.estate_id, null);
});
test("only the matching deal amount and nonempty publication description are supplied", () => {
  const r = {
    ...record(
      { price: "8000000", rent: "16000", description: "fallback" },
      { publication: { description: "Visible description" } },
    ),
    dealType: "rent",
  };
  const values = authorityValues(r, { district_slug: "tuen-mun" }, {});
  assert.equal(values.rent, "16000");
  assert.ok(!Object.hasOwn(values, "price"));
  assert.equal(values.description, "Visible description");
});
test("schema precision and unmapped new district fail before mutation", () => {
  assert.throws(
    () => authorityValues(record({ bedrooms: 2.5 }), { district_slug: "tuen-mun" }, {}),
    /PRECISION/,
  );
  assert.throws(() => authorityValues(record({ title: "New" }), null, {}), /DISTRICT_UNRESOLVED/);
});
test("a source withdrawal stays inactive rather than borrowing legacy active status", () => {
  const values = authorityValues(
    { ...record(), sourceStatus: "delisted" },
    { district_slug: "tuen-mun", status: "active" },
    {},
  );
  assert.equal(values.status, "inactive");
});
test("unapproved authority returns control without parsing inputs or mutating the database", async () => {
  const sql = [];
  const client = {
    query: async (query) => {
      sql.push(query);
      return { rows: [] };
    },
  };
  assert.equal(await reconcileSourceAuthority(client, null), null);
  assert.equal(sql.length, 1);
  assert.match(sql[0], /^SELECT/);
});
