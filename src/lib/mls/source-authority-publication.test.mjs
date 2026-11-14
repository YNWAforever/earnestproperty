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
test("verified orientation removes only conflicting standalone direction features", () => {
  const target = {
    district_slug: "tuen-mun",
    features: ["西南", "海景", "南", "全新裝修", "座向：西南", "SW"],
  };
  const before = structuredClone(target);
  const values = authorityValues(record({ orientation: "南" }), target, {});
  assert.equal(values.orientation, "南");
  assert.deepEqual(values.features, ["海景", "南", "全新裝修"]);
  assert.deepEqual(target, before);
  assert.equal(
    Object.hasOwn(
      authorityValues(record({ orientation: "南" }), { ...target, features: values.features }, {}),
      "features",
    ),
    false,
  );
});

for (const [chinese, alias] of [
  ["北", "N"],
  ["東北", "NE"],
  ["東", "E"],
  ["東南", "SE"],
  ["南", "S"],
  ["西南", "SW"],
  ["西", "W"],
  ["西北", "NW"],
]) {
  test(`exact ${chinese}/${alias} direction aliases agree without rewriting retained tags`, () => {
    const matching = [chinese, alias, ` 座向： ${alias.toLowerCase()} `, "海景"];
    const conflicting = chinese === "南" ? "北" : "南";
    const values = authorityValues(
      record({ orientation: alias.toLowerCase() }),
      { district_slug: "tuen-mun", features: [conflicting, ...matching] },
      {},
    );
    assert.deepEqual(values.features, matching);
    const unchanged = authorityValues(
      record({ orientation: `座向: ${chinese}` }),
      { district_slug: "tuen-mun", features: matching },
      {},
    );
    assert.equal(Object.hasOwn(unchanged, "features"), false);
  });
}

test("absent or unknown source orientation never claims legacy features", () => {
  for (const orientation of [undefined, null, "", "  ", "不詳", "西南偏南", "南／西南", "海景"]) {
    const target = { district_slug: "tuen-mun", features: ["西南", "南", "SW", "海景"] };
    assert.equal(
      Object.hasOwn(authorityValues(record({ orientation }), target, {}), "features"),
      false,
    );
    assert.deepEqual(target.features, ["西南", "南", "SW", "海景"]);
  }
});

test("narrative and unrecognized direction-like features survive exact-tag cleanup", () => {
  const retained = [
    "西南海景",
    "向西南望開揚",
    "東南向高層",
    "座向：西南，開揚",
    "南偏西",
    "朝向西南",
    "西南 / 南",
    "座向景觀：西南",
    "SW balcony",
    "South-facing balcony",
    "南",
    "S",
  ];
  const values = authorityValues(
    record({ orientation: "南" }),
    { district_slug: "tuen-mun", features: ["西南", ...retained] },
    {},
  );
  assert.deepEqual(values.features, retained);
});

test("all conflicting standalone direction tags may be removed without inventing replacement features", () => {
  const values = authorityValues(
    record({ orientation: "南" }),
    { district_slug: "tuen-mun", features: ["西南", "SW", " 座向：西南 "] },
    {},
  );
  assert.deepEqual(values.features, []);
});

test("missing, empty or unrecognized feature containers are left unclaimed", () => {
  for (const features of [undefined, null, [], "西南"]) {
    const values = authorityValues(
      record({ orientation: "南" }),
      { district_slug: "tuen-mun", features },
      {},
    );
    assert.equal(Object.hasOwn(values, "features"), false);
  }
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
