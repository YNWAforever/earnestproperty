import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

import { promotionTierRank } from "../mls/promotion-tier.mjs";
import { normalizeHomepageInventory, saveHomepageInventory } from "../mls/homepage-inventory.mjs";

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

test("黃金必走盤 uses the newest complete agent540 sale snapshot and paid grades", async () => {
  const { text, params } = await captureFeaturedQuery({ limit: 6, selection: "28hse-paid" });
  assert.match(text, /o\.source = '28hse_agent_540'/);
  assert.match(text, /i\.promotion_tier IN \('gold', 'pinned'\)/);
  assert.match(text, /p\.status = 'active'/);
  assert.match(text, /p\.deal_type = 'sale'/);
  assert.match(text, /owner-homepage-inventory-v1/);
  assert.match(
    text,
    /homepage_inventory_run AS \([\s\S]*?ORDER BY \(counts->>'captured_at'\)::timestamptz DESC, id DESC\s+LIMIT 1\s*\), homepage_inventory AS \(/,
  );
  assert.match(text, /r\.captured_at <= now\(\) \+ interval '5 minutes'/);
  assert.doesNotMatch(
    text,
    /interval '36 hours'/,
    "a newest snapshot older than 36 hours remains the membership boundary",
  );
  assert.match(text, /t\.observation_id = o\.id/);
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
  assert.match(text, /o\.source = '28hse_agent_540'/);
  assert.match(text, /i\.promotion_tier IN \('gold', 'pinned'\)/);
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

test("homepage uses complete sale inventory membership and source order before LIMIT", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TYPE deal_type AS ENUM ('sale','rent');
    CREATE TABLE properties (
      id text PRIMARY KEY, listing_no text, canonical_property_no text, title_zh text,
      deal_type deal_type NOT NULL DEFAULT 'sale', source_updated_at timestamp,
      last_seen_at timestamp, updated_at timestamp, created_at timestamp NOT NULL,
      status text NOT NULL DEFAULT 'active', featured boolean NOT NULL DEFAULT false,
      estate_id text, district_slug text, address text, price numeric, rent numeric,
      saleable_area numeric, bedrooms numeric, bathrooms numeric, features text[],
      images text[], video_url text, source_site text
    );
    CREATE TABLE property_public_members(property_id text, public_listing_no text);
    CREATE TABLE estates(id text, name_zh text, slug text, district_slug text);
    CREATE TABLE property_source_links(property_id text, source text, external_listing_id text,
      deal_type deal_type, status text, first_seen_at timestamp, last_seen_at timestamp);
    CREATE TABLE mls_source_state(property_id text, first_seen_at timestamp, source_status text, last_accepted_at timestamp, source text, external_listing_id text, deal_type deal_type);
    CREATE TABLE mls_source_promotion_tiers(source text, external_listing_id text, deal_type deal_type,
      promotion_tier text, observation_id text, observed_at timestamptz, snapshot_complete boolean,
      promotion_tier_raw text, updated_at timestamptz, PRIMARY KEY(source,external_listing_id,deal_type));
    CREATE TABLE listing_sync_runs(id text, parser_version text, status text, mode text, counts jsonb,
      started_at timestamptz DEFAULT now(), scheduled_for date, finished_at timestamptz);
    CREATE TABLE listing_source_observations(id text, run_id text, source text, external_listing_id text,
      deal_type deal_type, property_no_normalized text, payload jsonb, fetched_at timestamptz,
      source_url text, property_no_raw text, content_hash text, validation_state text, discovered_at timestamptz);
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
      ('28hse_agent_540','g3','sale','gold');
    UPDATE properties SET canonical_property_no=CASE id
      WHEN 'gold-new' THEN 'A000001' WHEN 'gold-old' THEN 'A000002'
      WHEN 'pinned' THEN 'A000003' WHEN 'normal-28' THEN 'A000004'
      WHEN 'hk-normal' THEN 'A000005' END;
    INSERT INTO listing_sync_runs(id,parser_version,status,mode,counts) VALUES ('current','owner-homepage-inventory-v1','healthy','publish',
      jsonb_build_object('homepage_inventory',true,'full_snapshot',true,'scope','agent:540',
        'source','28hse_agent_540','deal_type','sale','captured_at',now(),'advertised_count',4));
    INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,property_no_normalized,payload,fetched_at) VALUES
      ('o1','current','28hse_agent_540','homepage-inventory-g1','sale','A000001','{"homepage_inventory":{"position":3}}',now()),
      ('o2','current','28hse_agent_540','homepage-inventory-p1','sale','A000003','{"homepage_inventory":{"position":1}}',now()),
      ('o3','current','28hse_agent_540','homepage-inventory-n1','sale','A000004','{"homepage_inventory":{"position":2}}',now()),
      ('o4','current','28hse_agent_540','homepage-inventory-n2','sale','A000005','{"homepage_inventory":{"position":4}}',now());
    INSERT INTO mls_source_promotion_tiers(source,external_listing_id,deal_type,promotion_tier,observation_id,observed_at,snapshot_complete) VALUES
      ('28hse_agent_540','homepage-inventory-g1','sale','gold','o1',now(),true),
      ('28hse_agent_540','homepage-inventory-p1','sale','pinned','o2',now(),true),
      ('28hse_agent_540','homepage-inventory-n1','sale','gold','o3',now(),true),
      ('28hse_agent_540','homepage-inventory-n2','sale','normal','o4',now(),true);`);
    const server = await loadPublicDataServer(async (text, params) => {
      return (await db.query(text, params)).rows;
    });
    const paid = await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" });
    assert.deepEqual(
      paid.map((row) => row.listing_no),
      ["NORMAL", "GOLD-NEW", "PINNED"],
      "current gold before pinned in source order; historic paid links absent from this capture stay out",
    );
    const zaakGu = await server.fetchFeaturedProperties({ limit: 6, selection: "propertyhk" });
    assert.deepEqual(
      zaakGu.map((row) => row.listing_no),
      ["HK-NORMAL", "HK-NEW", "GOLD-OLD", "HK-OLD"],
      "only current paid sale inventory is excluded from 宅谷",
    );
    const capped = await server.fetchFeaturedProperties({ limit: 2, selection: "propertyhk" });
    assert.deepEqual(
      capped.map((row) => row.listing_no),
      ["HK-NORMAL", "HK-NEW"],
    );
    const cappedPaid = await server.fetchFeaturedProperties({ limit: 1, selection: "28hse-paid" });
    assert.deepEqual(
      cappedPaid.map((row) => row.listing_no),
      ["NORMAL"],
    );
    // All fixtures below are in this in-memory PGlite instance. A paid company
    // ref in the current capture must not qualify an unrelated source row.
    const ineligibleLinks = [
      { ref: "A052972", source: "propertyhk", status: "active", deal: "sale" },
      { ref: "A000007", source: null, status: null, deal: "sale" },
      { ref: "A000008", source: "28hse_agent_540", status: "inactive", deal: "sale" },
      { ref: "A000009", source: "28hse_agent_540", status: "rejected", deal: "sale" },
      { ref: "A000010", source: "28hse_agent_540", status: "proposed", deal: "sale" },
      { ref: "A000011", source: "28hse_agent_540", status: "active", deal: "rent" },
      { ref: "A000012", source: "28hse_agent_541", status: "active", deal: "sale" },
    ];
    for (const { ref, source, status, deal } of ineligibleLinks) {
      await db.query(
        `INSERT INTO properties(id,listing_no,canonical_property_no,created_at,source_site,images)
         VALUES ($1,$1,$1,now(),$2,ARRAY['https://imgs.property.hk/test.jpg'])`,
        [ref, source === "propertyhk" ? "old-site" : "28hse"],
      );
      await db.query(`INSERT INTO property_public_members VALUES ($1,$1)`, [ref]);
      if (source) {
        await db.query(
          `INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,status)
           VALUES ($1,$2,$1,$3,$4)`,
          [ref, source, deal, status],
        );
      }
      await db.query(
        `INSERT INTO listing_source_observations(id,run_id,source,external_listing_id,deal_type,
           property_no_normalized,payload,fetched_at)
         SELECT $1,id,'28hse_agent_540',$1,'sale',$1,
           '{"homepage_inventory":{"position":0}}',(counts->>'captured_at')::timestamptz
         FROM listing_sync_runs WHERE id='current'`,
        [ref],
      );
      await db.query(
        `INSERT INTO mls_source_promotion_tiers(source,external_listing_id,deal_type,promotion_tier,
           observation_id,observed_at,snapshot_complete)
         SELECT source,external_listing_id,deal_type,'gold',id,fetched_at,true
         FROM listing_source_observations WHERE id=$1`,
        [ref],
      );
    }
    await db.exec(`UPDATE listing_sync_runs SET counts=counts || jsonb_build_object(
      'advertised_count',(SELECT count(*) FROM listing_source_observations WHERE run_id='current'))
      WHERE id='current'`);
    for (const { ref, source, status, deal } of ineligibleLinks) {
      await t.test(
        `paid ref ${ref} excludes ${source ?? "source_site-only"}/${status}/${deal}`,
        async () => {
          const rows = await server.fetchFeaturedProperties({
            limit: 100,
            selection: "28hse-paid",
          });
          assert.ok(
            !rows.some((row) => row.listing_no === ref),
            `${ref} has no eligible 28hse sale link`,
          );
        },
      );
    }
    await t.test(
      "ineligible paid refs do not consume the limit or hide Property.hk-only cards",
      async () => {
        assert.deepEqual(
          (await server.fetchFeaturedProperties({ limit: 1, selection: "28hse-paid" })).map(
            (row) => row.listing_no,
          ),
          ["NORMAL"],
        );
        const rows = await server.fetchFeaturedProperties({ limit: 100, selection: "propertyhk" });
        assert.ok(rows.some((row) => row.listing_no === "A052972"));
      },
    );
    await t.test(
      "an active same-deal 28hse link admits a dual-source card without an image-host filter",
      async () => {
        await db.exec(`INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,status)
        VALUES ('A052972','28hse_agent_540','different-advert-id','sale','active')`);
        const rows = await server.fetchFeaturedProperties({ limit: 1, selection: "28hse-paid" });
        assert.deepEqual(
          rows.map((row) => row.listing_no),
          ["A052972"],
        );
        assert.deepEqual(rows[0].images, ["https://imgs.property.hk/test.jpg"]);
        assert.ok(
          !(await server.fetchFeaturedProperties({ limit: 100, selection: "propertyhk" })).some(
            (row) => row.listing_no === "A052972",
          ),
        );
      },
    );
    // Moving only the run clock leaves the observation clocks behind, so this
    // capture no longer qualifies. A newest snapshot whose clocks all age past
    // 36 hours is covered separately and still serves.
    await db.exec(`UPDATE listing_sync_runs SET counts=counts ||
      jsonb_build_object('captured_at',now()-interval '2 days')`);
    assert.deepEqual(
      await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" }),
      [],
    );
    // Exercise the real offline writer and the real public query together.
    const capture = (entries, offset = 0) =>
      normalizeHomepageInventory({
        schema_version: 1,
        source: "28hse_agent_540",
        scope: "agent:540",
        deal_type: "sale",
        complete: true,
        captured_at: new Date(Date.now() + offset).toISOString(),
        advertised_count: entries.length,
        entries,
      });
    const client = { query: (sql, params) => db.query(sql, params) };
    const approved = { inputSha256: "a".repeat(64) };
    await saveHomepageInventory(
      client,
      capture([
        { source_id: "9001", agent_listing_ref: "A000004", promotion_tier_raw: "置頂" },
        { source_id: "9002", agent_listing_ref: "A000004", promotion_tier_raw: "黃金置頂盤" },
        { source_id: "9003", agent_listing_ref: "A000001", promotion_tier_raw: "黃金" },
      ]),
      approved,
    );
    assert.deepEqual(
      (await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" })).map(
        (p) => p.listing_no,
      ),
      ["NORMAL", "GOLD-NEW"],
      "one company ref, strongest grade and its own position",
    );
    await db.exec(`INSERT INTO properties(id,listing_no,canonical_property_no,deal_type,created_at,status)
      VALUES ('duplicate','GOLD-DUPLICATE','A000001','sale',now(),'active'),
      ('rental','RENTAL','A000004','rent',now(),'active');
      INSERT INTO property_public_members VALUES ('duplicate','P-DUPLICATE'),('rental','P-NORMAL');
      INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,status)
      VALUES ('duplicate','propertyhk','duplicate','sale','active');`);
    assert.deepEqual(
      (await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" })).map(
        (p) => p.listing_no,
      ),
      ["NORMAL", "GOLD-NEW"],
      "company ref is unique across public groups before LIMIT; 28hse outranks a newer Property.hk row and rent stays out",
    );
    await saveHomepageInventory(
      client,
      capture(
        [
          { source_id: "9003", agent_listing_ref: "A000005", promotion_tier_raw: "黃金" },
          { source_id: "9002", agent_listing_ref: "A000004", promotion_tier_raw: "置頂" },
        ],
        1000,
      ),
      approved,
    );
    assert.deepEqual(
      (await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" })).map(
        (p) => p.listing_no,
      ),
      ["HK-NORMAL", "NORMAL"],
      "reused advert ID cannot keep the old company's gold membership",
    );
    await db.exec(`UPDATE properties SET status='inactive' WHERE id='hk-normal'`);
    assert.deepEqual(
      (await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" })).map(
        (p) => p.listing_no,
      ),
      ["NORMAL"],
      "index evidence never overrides staff withdrawal",
    );
    await saveHomepageInventory(client, capture([], 2000), approved);
    assert.deepEqual(
      await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" }),
      [],
      "verified empty snapshot has no historical fallback",
    );
  } finally {
    await db.close();
  }
});

function capturedAtSql(interval, future = false) {
  if (!/^\d+ (hours|minutes)$/.test(interval)) throw new Error(`bad interval ${interval}`);
  return `date_trunc('second', now() ${future ? "+" : "-"} interval '${interval}')`;
}

async function insertHomepageInventoryRun(db, { id, capturedSql, entries }) {
  await db.query(
    `WITH stamp AS (SELECT ${capturedSql} AS captured_at)
     INSERT INTO listing_sync_runs(id, parser_version, status, mode, counts)
     SELECT $1, 'owner-homepage-inventory-v1', 'healthy', 'publish',
       jsonb_build_object(
         'homepage_inventory', true,
         'full_snapshot', true,
         'scope', 'agent:540',
         'source', '28hse_agent_540',
         'deal_type', 'sale',
         'captured_at', to_char(stamp.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'advertised_count', $2::int
       )
     FROM stamp`,
    [id, entries.length],
  );
  for (const [index, entry] of entries.entries()) {
    const observationId = `${id}-o${index}`;
    await db.query(
      `WITH stamp AS (
         SELECT (counts->>'captured_at')::timestamptz AS captured_at
         FROM listing_sync_runs WHERE id = $1
       )
       INSERT INTO listing_source_observations(
         id, run_id, source, external_listing_id, deal_type,
         property_no_normalized, payload, fetched_at
       )
       SELECT $2, $1, '28hse_agent_540', $3, 'sale', $4,
         jsonb_build_object('homepage_inventory', jsonb_build_object('position', $5::int)),
         stamp.captured_at
       FROM stamp`,
      [id, observationId, `${id}-ext-${index}`, entry.ref, entry.position],
    );
    await db.query(
      `INSERT INTO mls_source_promotion_tiers(
         source, external_listing_id, deal_type, promotion_tier,
         observation_id, observed_at, snapshot_complete
       )
       SELECT source, external_listing_id, deal_type, $2, id, fetched_at, true
       FROM listing_source_observations WHERE id = $1`,
      [observationId, entry.tier],
    );
  }
}

async function ageHomepageInventoryRun(db, id, capturedSql) {
  await db.query(
    `WITH stamp AS (SELECT ${capturedSql} AS captured_at),
     updated_run AS (
       UPDATE listing_sync_runs
       SET counts = counts || jsonb_build_object(
         'captured_at', to_char(stamp.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       )
       FROM stamp
       WHERE listing_sync_runs.id = $1
       RETURNING listing_sync_runs.id
     ),
     updated_obs AS (
       UPDATE listing_source_observations
       SET fetched_at = stamp.captured_at
       FROM stamp
       WHERE listing_source_observations.run_id = $1
       RETURNING listing_source_observations.id
     )
     UPDATE mls_source_promotion_tiers AS tier
     SET observed_at = stamp.captured_at
     FROM stamp, updated_obs
     WHERE tier.observation_id = updated_obs.id`,
    [id],
  );
}

test("黃金必走盤 soft-serves the newest healthy snapshot after 36 hours", async (t) => {
  const db = new PGlite();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args);
  };
  const paid = async (server) =>
    (await server.fetchFeaturedProperties({ limit: 6, selection: "28hse-paid" })).map(
      (row) => row.listing_no,
    );
  const propertyHk = async (server) =>
    (await server.fetchFeaturedProperties({ limit: 6, selection: "propertyhk" }))
      .map((row) => row.listing_no)
      .sort();
  try {
    await db.exec(`CREATE TYPE deal_type AS ENUM ('sale','rent');
    CREATE TABLE properties (
      id text PRIMARY KEY, listing_no text, canonical_property_no text, title_zh text,
      deal_type deal_type NOT NULL DEFAULT 'sale', source_updated_at timestamp,
      last_seen_at timestamp, updated_at timestamp, created_at timestamp NOT NULL,
      status text NOT NULL DEFAULT 'active', featured boolean NOT NULL DEFAULT false,
      estate_id text, district_slug text, address text, price numeric, rent numeric,
      saleable_area numeric, bedrooms numeric, bathrooms numeric, features text[],
      images text[], video_url text, source_site text
    );
    CREATE TABLE property_public_members(property_id text, public_listing_no text);
    CREATE TABLE estates(id text, name_zh text, slug text, district_slug text);
    CREATE TABLE property_source_links(property_id text, source text, external_listing_id text,
      deal_type deal_type, status text, first_seen_at timestamp, last_seen_at timestamp);
    CREATE TABLE mls_source_state(property_id text, first_seen_at timestamp, source_status text,
      last_accepted_at timestamp, source text, external_listing_id text, deal_type deal_type);
    CREATE TABLE mls_source_promotion_tiers(source text, external_listing_id text, deal_type deal_type,
      promotion_tier text, observation_id text, observed_at timestamptz, snapshot_complete boolean,
      promotion_tier_raw text, updated_at timestamptz, PRIMARY KEY(source,external_listing_id,deal_type));
    CREATE TABLE listing_sync_runs(id text, parser_version text, status text, mode text, counts jsonb,
      started_at timestamptz DEFAULT now(), scheduled_for date, finished_at timestamptz);
    CREATE TABLE listing_source_observations(id text, run_id text, source text, external_listing_id text,
      deal_type deal_type, property_no_normalized text, payload jsonb, fetched_at timestamptz,
      source_url text, property_no_raw text, content_hash text, validation_state text, discovered_at timestamptz);
    INSERT INTO properties(id,listing_no,canonical_property_no,created_at,status,source_site) VALUES
      ('fresh-gold','FRESH-GOLD','A100001','2026-10-02','active','28hse'),
      ('fresh-pinned','FRESH-PINNED','A100002','2026-10-03','active','28hse'),
      ('fresh-normal','FRESH-NORMAL','A100003','2026-10-04','active','28hse'),
      ('older-gold','OLDER-GOLD','A100004','2026-09-01','active','28hse'),
      ('future-gold','FUTURE-GOLD','A100005','2026-10-05','active','28hse'),
      ('hk-only','HK-ONLY','A100006','2026-10-06','active','propertyhk');
    INSERT INTO property_public_members VALUES
      ('fresh-gold','P-FRESH-GOLD'),('fresh-pinned','P-FRESH-PINNED'),
      ('fresh-normal','P-FRESH-NORMAL'),('older-gold','P-OLDER-GOLD'),
      ('future-gold','P-FUTURE-GOLD'),('hk-only','P-HK-ONLY');
    INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,status) VALUES
      ('fresh-gold','28hse_agent_540','g-fresh','sale','active'),
      ('fresh-gold','propertyhk','h-fresh','sale','active'),
      ('fresh-pinned','28hse_agent_540','p-fresh','sale','active'),
      ('fresh-normal','28hse_agent_540','n-fresh','sale','active'),
      ('older-gold','28hse_agent_540','g-older','sale','active'),
      ('future-gold','28hse_agent_540','g-future','sale','active'),
      ('hk-only','propertyhk','h-only','sale','active');`);
    await insertHomepageInventoryRun(db, {
      id: "older",
      capturedSql: capturedAtSql("50 hours"),
      entries: [{ ref: "A100004", position: 1, tier: "gold" }],
    });
    await insertHomepageInventoryRun(db, {
      id: "newest",
      capturedSql: capturedAtSql("2 hours"),
      entries: [
        { ref: "A100002", position: 1, tier: "pinned" },
        { ref: "A100001", position: 2, tier: "gold" },
        { ref: "A100003", position: 3, tier: "normal" },
      ],
    });
    const server = await loadPublicDataServer(async (text, params) => {
      return (await db.query(text, params)).rows;
    });

    await t.test("newest within 36 hours returns that snapshot's gold then pinned", async () => {
      assert.deepEqual(await paid(server), ["FRESH-GOLD", "FRESH-PINNED"]);
      assert.deepEqual(await propertyHk(server), ["HK-ONLY"]);
      assert.equal(warnings.filter((args) => args[0] === "HOMEPAGE_INVENTORY_STALE").length, 0);
    });

    await ageHomepageInventoryRun(db, "newest", capturedAtSql("48 hours"));

    await t.test("newest past 36 hours still returns that snapshot, not an older one", async () => {
      assert.deepEqual(await paid(server), ["FRESH-GOLD", "FRESH-PINNED"]);
      assert.deepEqual(
        await propertyHk(server),
        ["HK-ONLY"],
        "stale gold remains the paid membership boundary for 宅谷",
      );
      const staleLogs = warnings.filter((args) => args[0] === "HOMEPAGE_INVENTORY_STALE");
      assert.equal(staleLogs.length, 1, "stale inventory is logged once per snapshot");
      assert.equal(typeof staleLogs[0][1].capturedAt, "string");
      assert.ok(staleLogs[0][1].ageHours >= 36);
    });

    await t.test("a newer snapshot still wins over older paid inventory", async () => {
      await insertHomepageInventoryRun(db, {
        id: "future",
        capturedSql: capturedAtSql("1 hours", true),
        entries: [{ ref: "A100005", position: 1, tier: "gold" }],
      });
      assert.deepEqual(
        await paid(server),
        [],
        "a future newest snapshot is unused and does not reveal older gold",
      );
      await db.exec(`DELETE FROM mls_source_promotion_tiers
        WHERE observation_id IN (SELECT id FROM listing_source_observations WHERE run_id = 'future');
        DELETE FROM listing_source_observations WHERE run_id = 'future';
        DELETE FROM listing_sync_runs WHERE id = 'future';`);
      await insertHomepageInventoryRun(db, {
        id: "empty-newest",
        capturedSql: capturedAtSql("1 minutes"),
        entries: [],
      });
      assert.deepEqual(await paid(server), [], "a newer empty snapshot has no historical fallback");
      assert.deepEqual(await propertyHk(server), ["FRESH-GOLD", "HK-ONLY"]);
    });
  } finally {
    console.warn = originalWarn;
    await db.close();
  }
});
