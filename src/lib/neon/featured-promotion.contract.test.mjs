import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

import { promotionTierRank } from "../mls/promotion-tier.mjs";

/**
 * Historical promotion mode retains 黃金 > 置頂 > 普通.
 * Homepage now explicitly requests newest; its executable DB regression is below.
 *
 * The load-bearing property is that ordering happens BEFORE the row limit.
 * The previous implementation fetched a fixed 24 rows ordered by freshness and
 * then filtered/sorted/sliced in JS, so a gold listing at row 25 could never
 * appear however it ranked. These tests exercise the real, unmodified
 * fetchFeaturedProperties with getSql() stubbed, and assert on the SQL it
 * actually issues -- the same harness corridor-scope.contract.test.mjs uses.
 */

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

function inlineRelativeImports(source, dir) {
  return source.replace(/from "\.\/([\w.-]+?)(?:\.js)?"/g, (match, name) => {
    for (const candidate of [`${name}.ts`, `${name}.js`]) {
      const path = join(root, dir, candidate);
      if (!existsSync(path)) continue;
      const code = readFileSync(path, "utf8");
      return `from "${dataUrl(candidate.endsWith(".ts") ? transpile(code) : code)}"`;
    }
    return match;
  });
}

let moduleInstance = 0;

async function loadPublicDataServer(query) {
  globalThis.__featuredPromotionQuery = query;
  // fetchFeaturedProperties caches its "does mls_source_promotion_tiers exist"
  // probe in module scope, so each test needs its own module instance rather
  // than the ESM cache's shared one -- otherwise the first test's answer
  // decides every later test's.
  moduleInstance += 1;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__featuredPromotionQuery(...args) });" +
      "export const addParam = (params, value) => { params.push(value); return `$${params.length}`; };",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/public-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );
  return import(
    dataUrl(`${executable}
// instance ${moduleInstance}`)
  );
}

function listingRow(over) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    listing_no: "L1",
    canonical_property_no: null,
    public_listing_no: "P1",
    listing_aliases: [],
    offerings: [],
    title_zh: "測試放盤",
    deal_type: "sale",
    district_slug: "sham-tseng",
    address: null,
    price: 1,
    rent: null,
    saleable_area: null,
    bedrooms: null,
    bathrooms: null,
    floor: null,
    features: null,
    images: null,
    video_url: null,
    created_at: null,
    updated_at: null,
    last_seen_at: null,
    source_site: "28hse",
    estates: null,
    ...over,
  };
}

async function captureFeaturedQuery(input, { tableAvailable = true } = {}) {
  const calls = [];
  const server = await loadPublicDataServer(async (text, params) => {
    if (text.includes("to_regclass('mls_source_promotion_tiers')")) {
      return [{ available: tableAvailable }];
    }
    calls.push({ text, params });
    return [listingRow({})];
  });
  await server.fetchFeaturedProperties(input);
  assert.equal(calls.length, 1, "the feed must be one listing round trip, not a fan-out");
  return calls[0];
}

test("the feed ranks by the client's tier order in SQL", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6 });

  // The client's exact order, as ranks the ORDER BY sorts ascending.
  assert.match(text, /WHEN 'gold' THEN 0/);
  assert.match(text, /WHEN 'pinned' THEN 1/);
  assert.match(text, /WHEN 'normal' THEN 2/);
  assert.match(text, /ELSE 3/);
  // The SQL ranks must agree with the JS model both surfaces read from.
  assert.equal(promotionTierRank("gold"), 0);
  assert.equal(promotionTierRank("pinned"), 1);
  assert.equal(promotionTierRank("normal"), 2);
  assert.equal(promotionTierRank("unknown"), 3);
});

test("ordering is applied before the row limit, not after a fixed over-fetch", async () => {
  const { text, params } = await captureFeaturedQuery({ limit: 6 });

  const orderIndex = text.indexOf("ORDER BY COALESCE(promotion.rank, 3) ASC");
  const limitIndex = text.lastIndexOf("LIMIT");
  assert.ok(orderIndex > -1, "the tier rank must lead the ORDER BY");
  assert.ok(limitIndex > orderIndex, "LIMIT must come after the ranked ORDER BY");

  // The old shape asked for 24 rows and sliced to 6 in JS. Anything the
  // database discards now has already lost on rank, not on arrival order.
  assert.ok(!params.includes(24), "the fixed 24-row over-fetch window must be gone");
  assert.ok(params.includes(6), "the limit handed to SQL is the display limit");
});

test("an unobserved listing falls back to unpromoted, and is never claimed as paid", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6 });
  // COALESCE, not an INNER JOIN: a listing with no tier row still appears, it
  // just sorts last. An INNER JOIN would silently hide every unclassified and
  // Property.hk listing from the homepage.
  assert.match(text, /COALESCE\(promotion\.rank, 3\)/);
  assert.match(text, /LEFT JOIN LATERAL/);
  assert.doesNotMatch(text, /INNER JOIN mls_source_promotion_tiers/);
});

test("only an active source link may contribute a tier", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6 });
  // A delisted source row must not keep pinning a listing to the top.
  assert.match(text, /psl\.status = 'active'/);
  assert.match(text, /property_source_links psl/);
  // Deterministic when a canonical listing has several verified linked
  // observations: strongest grade wins, without changing source selection.
  assert.match(text, /SELECT min\(/);
});

test("deduplication still happens before the limit counts rows", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6 });
  // canonicalListingCte collapses each public_listing_no to one row inside the
  // query, so LIMIT counts unique listings rather than source rows.
  assert.match(text, /WITH ranked_offerings AS/);
  assert.match(text, /PARTITION BY ppm\.public_listing_no, p\.deal_type/);
  assert.match(text, /JOIN canonical c ON c\.id=p\.id/);
});

test("publication and delisting rules are unchanged", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6 });
  assert.match(text, /p\.status = 'active'/);
});

test("the region scope is applied in the same query, including the exclusion list", async () => {
  const { text, params } = await captureFeaturedQuery({
    limit: 6,
    districtSlugs: ["sham-tseng"],
    estateSlugs: ["wong-gam-hoi-ngon"],
    textAliases: ["深井"],
    outOfScopeTextAliases: ["屯門"],
  });
  assert.match(text, /p\.district_slug = ANY/);
  assert.match(text, /e\.slug = ANY/);
  assert.match(text, /AND NOT EXISTS/);
  assert.ok(params.some((value) => Array.isArray(value) && value.includes("sham-tseng")));
  assert.ok(params.some((value) => Array.isArray(value) && value.includes("wong-gam-hoi-ngon")));
  assert.ok(params.some((value) => Array.isArray(value) && value.includes("屯門")));
});

test("with no scope terms the feed stays exactly as broad as before", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6 });
  assert.doesNotMatch(text, /p\.district_slug = ANY/);
  assert.match(text, /WHERE p\.status = 'active'/);
});

test("the feed degrades to its previous order until the migration is applied", async () => {
  // Postgres rejects a query naming a missing relation at parse time, so a
  // deploy that lands before 20260909120000_source_promotion_tiers.sql must
  // not 500 the homepage for every visitor.
  const { text } = await captureFeaturedQuery({ limit: 6 }, { tableAvailable: false });
  assert.doesNotMatch(text, /mls_source_promotion_tiers/);
  assert.doesNotMatch(text, /promotion\.rank/);
  assert.match(text, /ORDER BY p\.created_at DESC/, "it falls back to the existing order");
});

test("homepage newest feed ranks new source adverts before old promoted inventory and preserves withdrawal", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE properties (
      id text PRIMARY KEY, listing_no text, canonical_property_no text, title_zh text,
      deal_type text NOT NULL DEFAULT 'sale', source_updated_at timestamp,
      last_seen_at timestamp, updated_at timestamp, created_at timestamp NOT NULL,
      status text NOT NULL DEFAULT 'active', featured boolean NOT NULL DEFAULT false,
      estate_id text, district_slug text, address text, price numeric, rent numeric,
      saleable_area numeric, bedrooms numeric, bathrooms numeric, features text[],
      images text[], video_url text, source_site text
    );
    CREATE TABLE property_public_members(property_id text, public_listing_no text);
    CREATE TABLE estates(id text, name_zh text, slug text, district_slug text);
    CREATE TABLE property_source_links(property_id text, source text, external_listing_id text,
      deal_type text, status text, first_seen_at timestamp, last_seen_at timestamp);
    CREATE TABLE mls_source_state(property_id text, first_seen_at timestamp, source_status text, last_accepted_at timestamp);
    CREATE TABLE mls_source_promotion_tiers(source text, external_listing_id text, deal_type text, promotion_tier text);
    INSERT INTO mls_source_promotion_tiers VALUES ('28hse','1','sale','gold'),('28hse','2','sale','normal');
    INSERT INTO properties(id,listing_no,created_at,source_updated_at,status) VALUES
      ('old-gold','OLD','2026-08-01','2026-08-01','active'),
      ('new-ad','NEW','2026-09-29','2026-09-29','active'),
      ('relisted','RELIST','2026-07-01','2026-09-30','active'),
      ('withdrawn-old','W1','2026-08-01','2026-08-01','active'),
      ('withdrawn-new','W2','2026-10-01','2026-10-01','inactive'),
      ('rent','RENT','2026-09-28','2026-09-28','active');
    UPDATE properties SET deal_type='rent' WHERE id='rent';
    INSERT INTO property_public_members VALUES
      ('old-gold','P1'),('new-ad','P2'),('relisted','P3'),
      ('withdrawn-old','P4'),('withdrawn-new','P4'),('rent','P2');
    INSERT INTO property_source_links VALUES
      ('old-gold','28hse','1','sale','active','2026-08-01','2026-10-01'),
      ('new-ad','28hse','2','sale','active','2026-09-29','2026-10-01'),
      ('relisted','28hse','3','sale','active','2026-09-30','2026-10-01'),
      ('old-gold','28hse','4','sale','active','2026-10-01','2026-10-01');
    INSERT INTO mls_source_state VALUES
      ('old-gold','2026-08-01','active','2026-10-01'),
      ('new-ad','2026-09-29','active','2026-10-01'),
      ('relisted','2026-09-30','active','2026-10-01'),
      ('old-gold','2026-10-01','delisted','2026-10-01');`);
    const calls = [];
    const server = await loadPublicDataServer(async (text, params) => {
      calls.push(text);
      return (await db.query(text, params)).rows;
    });
    const rows = await server.fetchFeaturedProperties({ limit: 2, order: "newest" });
    assert.deepEqual(
      rows.map((row) => row.listing_no),
      ["RELIST", "NEW"],
    );
    assert.equal(calls.length, 1, "newest feed needs no promotion capability probe");
    const all = await server.fetchFeaturedProperties({ limit: 6, order: "newest" });
    assert.deepEqual(
      all.map((row) => row.listing_no),
      ["RELIST", "NEW", "OLD"],
    );
    await db.query("UPDATE mls_source_state SET last_accepted_at='2026-10-02'");
    const again = await server.fetchFeaturedProperties({ limit: 2, order: "newest" });
    assert.deepEqual(
      again.map((row) => row.listing_no),
      ["RELIST", "NEW"],
      "routine re-scrape must not make old adverts new",
    );
  } finally {
    await db.close();
  }
});
