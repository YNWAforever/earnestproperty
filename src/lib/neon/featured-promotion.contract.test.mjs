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
  assert.doesNotMatch(text, /28hse_agent_540/);
  assert.doesNotMatch(text, /source = 'propertyhk'/);
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
    CREATE TABLE mls_source_state(property_id text, first_seen_at timestamp, source_status text, last_accepted_at timestamp, source text, external_listing_id text, deal_type text);
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
      ('old-gold','28hse','4','sale','active','2026-10-01','2026-10-01'),
      ('old-gold','28hse','proposed','sale','proposed','2026-10-03','2026-10-03'),
      ('old-gold','28hse','rejected','sale','rejected','2026-10-04','2026-10-04');
    INSERT INTO mls_source_state VALUES
      ('old-gold','2026-08-01','active','2026-10-01','28hse','1','sale'),
      ('new-ad','2026-09-29','active','2026-10-01','28hse','2','sale'),
      ('relisted','2026-09-30','active','2026-10-01','28hse','3','sale'),
      ('old-gold','2026-10-01','delisted','2026-10-01','28hse','4','sale'),
      ('old-gold','2026-10-01','active','2026-10-01','28hse','unverified','sale');`);
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
    await db.query("UPDATE properties SET last_seen_at='2026-10-03',updated_at='2026-10-03'");
    await db.query("UPDATE property_source_links SET last_seen_at='2026-10-03'");
    const again = await server.fetchFeaturedProperties({ limit: 2, order: "newest" });
    assert.deepEqual(
      again.map((row) => row.listing_no),
      ["RELIST", "NEW"],
      "routine re-scrape must not make old adverts new",
    );
    await db.exec(`INSERT INTO properties(id,listing_no,created_at) VALUES
      ('fallback-1','F1','2026-08-10'),('fallback-2','F2','2026-08-11'),
      ('fallback-3','F3','2026-08-12'),('fallback-4','F4','2026-08-13'),
      ('new-ad-twin','TWIN','2026-09-28');
      INSERT INTO property_public_members VALUES ('fallback-1','F1'),('fallback-2','F2'),
      ('fallback-3','F3'),('fallback-4','F4'),('new-ad-twin','P2');`);
    const six = await server.fetchFeaturedProperties({ limit: 6, order: "newest" });
    assert.equal(six.length, 6, "six unique canonical cards, duplicates do not consume slots");
    assert.equal(new Set(six.map((x) => x.public_listing_no)).size, 6);
    assert.deepEqual(
      six.slice(0, 2).map((x) => x.listing_no),
      ["RELIST", "NEW"],
    );
    assert.ok(!six.some((x) => ["TWIN", "W1", "W2"].includes(x.listing_no)));
  } finally {
    await db.close();
  }
});

test("黃金必走盤 keeps only active 28hse gold and pinned placements", async () => {
  const { text, params } = await captureFeaturedQuery({ limit: 6, selection: "28hse-paid" });
  assert.match(text, /psl\.source = '28hse_agent_540'/);
  assert.match(text, /t\.promotion_tier IN \('gold', 'pinned'\)/);
  assert.match(text, /psl\.status = 'active'/);
  assert.match(text, /JOIN mls_source_promotion_tiers t/);
  assert.match(text, /WHEN 'gold' THEN 0/);
  assert.match(text, /WHEN 'pinned' THEN 1/);
  assert.doesNotMatch(text, /source = 'propertyhk'/);
  const orderIndex = text.indexOf("ORDER BY COALESCE(promotion.rank, 3) ASC");
  const limitIndex = text.lastIndexOf("LIMIT");
  assert.ok(orderIndex > -1, "gold sorts ahead of pinned");
  assert.ok(limitIndex > orderIndex, "LIMIT must come after the grade order");
  assert.ok(params.includes(6));
});

test("黃金必走盤 is empty until the promotion table exists", async () => {
  const calls = [];
  const server = await loadPublicDataServer(async (text) => {
    if (text.includes("to_regclass('mls_source_promotion_tiers')")) return [{ available: false }];
    calls.push(text);
    return [];
  });
  assert.deepEqual(await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" }), []);
  assert.equal(calls.length, 0, "ordinary listings must not fill a 黃金必走盤 heading");
});

test("荀盤推介 is active Property.hk inventory and omits 28hse paid placements", async () => {
  const { text } = await captureFeaturedQuery({ limit: 6, selection: "propertyhk" });
  assert.match(text, /psl\.source = 'propertyhk'/);
  assert.match(text, /psl\.status = 'active'/);
  assert.match(text, /AND NOT EXISTS \(/);
  assert.match(text, /psl\.source = '28hse_agent_540'/);
  assert.match(text, /t\.promotion_tier IN \('gold', 'pinned'\)/);
  assert.match(text, /SELECT max\(fresh\.first_seen_at\)/);
  assert.doesNotMatch(text, /promotion\.rank/);
});

test("荀盤推介 does not reference promotion tiers before that table exists", async () => {
  const { text } = await captureFeaturedQuery(
    { limit: 6, selection: "propertyhk" },
    { tableAvailable: false },
  );
  assert.match(text, /psl\.source = 'propertyhk'/);
  assert.match(text, /psl\.status = 'active'/);
  assert.doesNotMatch(text, /mls_source_promotion_tiers/);
  assert.doesNotMatch(text, /28hse_agent_540/);
});

test("an unknown homepage selection never reaches SQL", async () => {
  const calls = [];
  const server = await loadPublicDataServer(async (text) => {
    calls.push(text);
    return [];
  });
  await assert.rejects(
    server.fetchFeaturedProperties({ limit: 6, selection: "all" }),
    /INVALID_PUBLIC_SCOPE/,
  );
  assert.equal(calls.length, 0);
});

test("homepage bands select gold then pinned, and 宅谷 without repeating paid 28hse", async () => {
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
    CREATE TABLE mls_source_state(property_id text, first_seen_at timestamp, source_status text, last_accepted_at timestamp, source text, external_listing_id text, deal_type text);
    CREATE TABLE mls_source_promotion_tiers(source text, external_listing_id text, deal_type text, promotion_tier text);
    INSERT INTO properties(id,listing_no,created_at,status) VALUES
      ('gold-new','GOLD-NEW','2026-10-01','active'),
      ('gold-old','GOLD-OLD','2026-08-01','active'),
      ('pinned','PINNED','2026-09-01','active'),
      ('normal-28','NORMAL','2026-09-20','active'),
      ('hk-new','HK-NEW','2026-09-25','active'),
      ('hk-old','HK-OLD','2026-07-01','active'),
      ('hk-normal','HK-NORMAL','2026-09-28','active'),
      ('hk-inactive','HK-OFF','2026-10-02','inactive'),
      ('hk-proposed','HK-PROP','2026-10-03','active'),
      ('gold-dead-link','GOLD-DEAD','2026-10-04','active');
    INSERT INTO property_public_members VALUES
      ('gold-new','P-GOLD-NEW'),('gold-old','P-GOLD-OLD'),('pinned','P-PINNED'),
      ('normal-28','P-NORMAL'),('hk-new','P-HK-NEW'),('hk-old','P-HK-OLD'),
      ('hk-normal','P-HK-NORMAL'),('hk-inactive','P-HK-OFF'),('hk-proposed','P-HK-PROP'),
      ('gold-dead-link','P-GOLD-DEAD');
    INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,status) VALUES
      ('gold-new','28hse_agent_540','g1','sale','active'),
      ('gold-old','28hse_agent_540','g2','sale','active'),
      ('gold-old','propertyhk','g2','sale','active'),
      ('pinned','28hse_agent_540','p1','sale','active'),
      ('normal-28','28hse_agent_540','n1','sale','active'),
      ('hk-new','propertyhk','h1','sale','active'),
      ('hk-old','propertyhk','h2','sale','active'),
      ('hk-normal','propertyhk','h3','sale','active'),
      ('hk-normal','28hse_agent_540','n2','sale','active'),
      ('hk-inactive','propertyhk','h4','sale','active'),
      ('hk-proposed','propertyhk','h5','sale','proposed'),
      ('gold-dead-link','28hse_agent_540','g3','sale','rejected');
    INSERT INTO mls_source_promotion_tiers(source,external_listing_id,deal_type,promotion_tier) VALUES
      ('28hse_agent_540','g1','sale','gold'),
      ('28hse_agent_540','g2','sale','gold'),
      ('28hse_agent_540','p1','sale','pinned'),
      ('28hse_agent_540','n1','sale','normal'),
      ('28hse_agent_540','n2','sale','normal'),
      ('28hse_agent_540','g3','sale','gold');`);
    const server = await loadPublicDataServer(async (text, params) => {
      return (await db.query(text, params)).rows;
    });
    const paid = await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" });
    assert.deepEqual(
      paid.map((row) => row.listing_no),
      ["GOLD-NEW", "GOLD-OLD", "PINNED"],
      "gold before pinned; ordinary, 宅谷-only, inactive and dead links stay out",
    );
    const zaakGu = await server.fetchFeaturedProperties({ limit: 6, selection: "propertyhk" });
    assert.deepEqual(
      zaakGu.map((row) => row.listing_no),
      ["HK-NORMAL", "HK-NEW", "HK-OLD"],
      "宅谷 newest first, without the gold listing that also has a Property.hk link",
    );
    const capped = await server.fetchFeaturedProperties({ limit: 2, selection: "propertyhk" });
    assert.deepEqual(
      capped.map((row) => row.listing_no),
      ["HK-NORMAL", "HK-NEW"],
    );
  } finally {
    await db.close();
  }
});
