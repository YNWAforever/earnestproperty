import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

// Same harness as agent-profiles.contract.test.mjs: public-data.server.ts is
// loaded as a data: URL module with getSql() stubbed to a recorder, so these
// tests exercise the REAL exported searchListings() -- and therefore the real
// SQL string and param array listingWhere builds -- without a live Neon
// connection or exporting listingWhere itself as new public surface.

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

async function importPublicDataServerWithInjectedQuery(query) {
  globalThis.__listingSearchContractQuery = query;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__listingSearchContractQuery(...args) });",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/public-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );

  return import(dataUrl(executable));
}

/** Records every statement searchListings issues; returns shapes the mapper accepts. */
function recorder() {
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params: params ?? [] });
    return /count\(\*\)/.test(text) ? [{ total: 0 }] : [];
  };
  return { calls, query };
}

async function runSearch(input) {
  const { calls, query } = recorder();
  const server = await importPublicDataServerWithInjectedQuery(query);
  await server.searchListings(input);
  assert.equal(calls.length, 2, "searchListings issues one count query and one row query");
  const [count, rows] = calls;
  assert.match(count.text, /count\(\*\)/);
  return { count, rows };
}

// fetchFeaturedProperties shares the same harness -- it lives in the same
// module and the audit's 精選筍盤 finding (1 of 398 listings shown) is the same
// class of bug as the price/keyword issues above: a filter that only ever
// matched hand-flagged rows, which normalize-old-site.mjs never sets.
test("featured properties sorts featured-first instead of filtering on it, so the section always backfills", async () => {
  const { calls, query } = recorder();
  const server = await importPublicDataServerWithInjectedQuery(query);
  await server.fetchFeaturedProperties(6);

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.doesNotMatch(
    call.text,
    /featured = true/,
    "must not filter out every listing nobody has hand-flagged as featured",
  );
  assert.match(call.text, /ORDER BY p\.featured DESC, p\.last_seen_at DESC NULLS LAST/);
  assert.deepEqual(call.params, [6]);
});

test("keyword becomes one bound, escaped LIKE predicate on both queries", async () => {
  const { count, rows } = await runSearch({
    deal: "all",
    keyword: "碧堤半島",
    page: 1,
    pageSize: 12,
  });

  for (const call of [count, rows]) {
    assert.match(call.text, /LIKE '%' \|\| lower\(\$1\) \|\| '%' ESCAPE/);
    assert.equal(call.params[0], "碧堤半島");
    assert.doesNotMatch(call.text, /碧堤半島/, "the term must never be interpolated into SQL");
  }
  assert.deepEqual(rows.params, ["碧堤半島", 12, 0]);
});

test("the keyword haystack covers the identifying columns and excludes free prose", async () => {
  const { rows } = await runSearch({ deal: "all", keyword: "海韻", page: 1, pageSize: 12 });
  const haystack = rows.text.match(/concat_ws\(' ',[\s\S]*?\)/)?.[0] ?? "";

  for (const column of [
    "p.title_zh",
    "p.title_en",
    "p.address",
    "p.listing_no",
    "p.district_slug",
    "e.name_zh",
    "e.name_en",
    "e.slug",
  ]) {
    assert.ok(haystack.includes(column), `keyword must search ${column}`);
  }
  // description is the old site's meta description and name-drops
  // neighbouring estates; including it would make a search for one estate
  // return a different one.
  assert.doesNotMatch(haystack, /p\.description|p\.features/);
});

test("LIKE metacharacters in the keyword are escaped, not treated as wildcards", async () => {
  const { rows } = await runSearch({ deal: "all", keyword: "50%_off", page: 1, pageSize: 12 });
  assert.equal(rows.params[0], "50\\%\\_off");
});

test("a blank or whitespace-only keyword adds no predicate", async () => {
  for (const keyword of ["", "   ", undefined]) {
    const { rows } = await runSearch({ deal: "all", keyword, page: 1, pageSize: 12 });
    assert.doesNotMatch(rows.text, /LIKE/);
    assert.deepEqual(rows.params, [12, 0]);
  }
});

test("an overlong keyword is clamped rather than scanned in full", async () => {
  const { rows } = await runSearch({
    deal: "all",
    keyword: "深".repeat(500),
    page: 1,
    pageSize: 12,
  });
  assert.equal(rows.params[0].length, 80);
});

test("deal=all drops price bounds instead of comparing across price scales", async () => {
  const { rows } = await runSearch({
    deal: "all",
    minPrice: 3_000_000,
    maxPrice: 8_000_000,
    page: 1,
    pageSize: 12,
  });

  assert.doesNotMatch(
    rows.text,
    /COALESCE\(p\.price, p\.rent\)/,
    "a sale budget must not be compared against rents",
  );
  assert.doesNotMatch(rows.text, />=|<=/);
  assert.deepEqual(rows.params, [12, 0]);
});

test("sale and rent scope the price bound to their own column", async () => {
  const sale = await runSearch({
    deal: "sale",
    minPrice: 3_000_000,
    maxPrice: 8_000_000,
    page: 2,
    pageSize: 12,
  });
  assert.match(sale.rows.text, /p\.price >= \$2/);
  assert.match(sale.rows.text, /p\.price <= \$3/);
  assert.deepEqual(sale.rows.params, ["sale", 3_000_000, 8_000_000, 12, 12]);

  const rent = await runSearch({ deal: "rent", maxPrice: 25_000, page: 1, pageSize: 12 });
  assert.match(rent.rows.text, /p\.rent <= \$2/);
  assert.deepEqual(rent.rows.params, ["rent", 25_000, 12, 0]);
});

test("bedrooms 0 filters for studios and 4 filters for four-or-more", async () => {
  const studio = await runSearch({ deal: "all", bedrooms: 0, page: 1, pageSize: 12 });
  assert.match(studio.rows.text, /p\.bedrooms = \$1/);
  assert.equal(studio.rows.params[0], 0);

  const large = await runSearch({ deal: "all", bedrooms: 4, page: 1, pageSize: 12 });
  assert.match(large.rows.text, /p\.bedrooms >= \$1/);
  assert.equal(large.rows.params[0], 4);
});

test("page size is clamped and offset derived from the page", async () => {
  const { rows } = await runSearch({ deal: "all", page: 3, pageSize: 1000 });
  assert.deepEqual(rows.params, [100, 200]);
});

test("agentId scopes results to one agent's listings, for the agent-profile linked-listings section", async () => {
  const { rows } = await runSearch({
    deal: "all",
    agentId: "agent-123",
    page: 1,
    pageSize: 6,
  });
  assert.match(rows.text, /p\.agent_id = \$1/);
  assert.deepEqual(rows.params, ["agent-123", 6, 0]);
});

test("every public listing filter stays a bound parameter", async () => {
  const { rows } = await runSearch({
    deal: "sale",
    keyword: "bellagio' OR 1=1 --",
    districtSlug: "sham-tseng",
    estateSlug: "bellagio",
    page: 1,
    pageSize: 12,
  });
  assert.doesNotMatch(rows.text, /OR 1=1/);
  assert.ok(rows.params.includes("bellagio' OR 1=1 --"));
});

test("the listings route forwards the keyword it already validates", () => {
  const route = read("src/routes/listings.tsx");

  // The zod schema accepted `keyword` all along, but the loader never passed
  // it to searchListings(), so the homepage hero search silently ignored it.
  assert.match(
    route,
    /searchListings\(\{[\s\S]*?keyword: deps\.keyword\?\.trim\(\) \|\| undefined/,
  );
  assert.match(route, /id="listing-keyword"/);
  assert.match(route, /const \[keyword, setKeyword\] = useState\(initial\.keyword \?\? ""\)/);
  assert.match(route, /keyword: keyword\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(
    route,
    /keyword: initial\.keyword,/,
    "apply() must send the panel's own keyword state so the user can edit or clear it",
  );
  assert.match(
    route,
    /setKeyword\(initial\.keyword \?\? ""\)/,
    "the resync effect must restore keyword too",
  );

  // Price is meaningless without a deal type (sale prices are in millions,
  // rents in thousands), so the inputs must be unavailable, not just ignored.
  assert.match(route, /const isAllDeals = deal === "all"/);
  assert.equal((route.match(/disabled=\{isAllDeals\}/g) ?? []).length, 2);
  assert.match(route, /minPrice: !isAllDeals && minPrice \?/);
  assert.match(route, /maxPrice: !isAllDeals && maxPrice \?/);
});

test("the keyword type is threaded through every layer of the query chain", () => {
  assert.match(
    read("src/lib/neon/public-data.types.ts"),
    /NeonListingFiltersInput = \{[\s\S]*?keyword\?: string;/,
  );
  assert.match(read("src/lib/queries.ts"), /ListingFilters = \{[\s\S]*?keyword\?: string;/);
});

test("estate options are deduped by canonical slug", () => {
  const queries = read("src/lib/queries.ts");
  assert.match(queries, /byCanonicalSlug/);
  assert.match(queries, /isAlreadyCanonical/);
});

test("listings.tsx sanitizes title_zh before it reaches JSON-LD and card render (DR-4)", () => {
  const route = read("src/routes/listings.tsx");

  assert.match(
    route,
    /import \{[\s\S]*?sanitizeListingText[\s\S]*?\} from "@\/lib\/format"/,
  );
  // JSON-LD item name.
  assert.match(
    route,
    /name: sanitizeListingText\(row\.title_zh\) \?\? row\.title_zh/,
  );
  // Card alt/heading -- a small local helper so the raw fallback (never a
  // blank title) is computed once per card.
  assert.match(route, /sanitizeListingText\(p\.title_zh\) \?\? p\.title_zh/);
});

test("the listing search index migration exists and is idempotent", () => {
  const path = "neon/migrations/20260802090000_listing_search_indexes.sql";
  assert.ok(existsSync(join(root, path)), "listing index migration must exist");
  const sql = read(path);

  assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_properties_active_sort/);
  assert.match(sql, /WHERE status = 'active'/);
  assert.match(sql, /last_seen_at DESC NULLS LAST/);
  assert.doesNotMatch(sql, /CREATE INDEX(?! IF NOT EXISTS)/);
});

// DR-3 coverage: the MLS import pipeline (src/lib/mls/match.mjs,
// reconcile.mjs) already establishes canonical_property_no as the stable
// per-unit identity at write time, but every listing-read path selected only
// listing_no -- a re-scraped row under a second listing_no had no way to be
// recognised as the same unit. listingColumns (shared by searchListings,
// fetchListingsForEstate, fetchSimilarListings and the corridor path) must
// select the column so dedupeListings() below has something to key on.
test("canonical_property_no is selected alongside listing_no in the shared listing columns", async () => {
  const { rows } = await runSearch({ deal: "all", page: 1, pageSize: 12 });
  assert.match(rows.text, /p\.canonical_property_no/);
});

// Every function that returns rows drawn from the shared listingColumns /
// mapListingRow pipeline must dedupe them -- fetchFeaturedProperties (the
// homepage 精選筍盤 section) and fetchListingsForAgent (agent-profile listing
// pages) draw from that same pipeline but were left out of the original DR-3
// fix's four call sites, leaving them exposed to the same duplicate-render
// bug. Source-scanned rather than executed because both wrap createServerFn
// server functions the .mjs harness above can't easily stub.
test("fetchFeaturedProperties and fetchListingsForAgent also dedupe their rows", () => {
  const queries = read("src/lib/queries.ts");

  const featured = queries.slice(
    queries.indexOf("export async function fetchFeaturedProperties"),
    queries.indexOf("export type DistrictTransaction"),
  );
  assert.match(featured, /dedupeListings\(/);

  const forAgent = queries.slice(
    queries.indexOf("export async function fetchListingsForAgent"),
    queries.indexOf("export async function fetchPropertyByLegacyDetailId"),
  );
  assert.match(forAgent, /dedupeListings\(/);
});

// dedupeListings is a pure array helper in src/lib/queries.ts with no
// dependency on either of that module's two aliased imports
// (@/lib/neon/public-data, @/content/castle-peak-road) -- unlike
// corridor-scope.contract.test.mjs's loader (which wires a real
// fetchCorridorInventory through its stub), these stub exports only need to
// exist to satisfy ESM's static linking at load time; none of them are ever
// called by dedupeListings itself.
const QUERIES_STUB_PUBLIC_DATA_EXPORTS = [
  "fetchNeonArticleBySlug",
  "fetchNeonCmsVideos",
  "fetchNeonCorridorInventory",
  "fetchNeonDistrictTransactions",
  "fetchNeonEstateBySlug",
  "fetchNeonEstateOptions",
  "fetchNeonEstateTransactions",
  "fetchNeonEstates",
  "fetchNeonFaqs",
  "fetchNeonFeaturedProperties",
  "fetchNeonListingCountsByEstate",
  "fetchNeonListingsForAgent",
  "fetchNeonListingsForEstate",
  "fetchNeonPropertyByLegacyDetailId",
  "fetchNeonPropertyByListingNo",
  "fetchNeonPublishedArticles",
  "fetchNeonSimilarListings",
  "searchNeonListings",
];

async function loadQueriesForDedupeTests() {
  const publicDataStubSource = QUERIES_STUB_PUBLIC_DATA_EXPORTS.map(
    (name) => `export async function ${name}() {
      throw new Error(${JSON.stringify(`${name} is not exercised by the dedupeListings tests`)});
    }`,
  ).join("\n");

  const castlePeakRoadStubSource = `
    export const corridorRegionScope = { outOfScopeTextAliases: [] };
    export function isWithinCorridorRegion() { return true; }
  `;

  const queriesSource = transpile(read("src/lib/queries.ts"))
    .replace('from "@/lib/neon/public-data"', `from "${dataUrl(publicDataStubSource)}"`)
    .replace('from "@/content/castle-peak-road"', `from "${dataUrl(castlePeakRoadStubSource)}"`);

  return import(dataUrl(queriesSource));
}

// deal_type defaults to "sale" so every existing fixture in this file shares
// it implicitly (the real DR-3 duplicate case: same physical unit AND same
// deal type, re-scraped under a second listing_no) -- tests that need to
// prove the sale+rent pair is preserved pass deal_type explicitly per row.
function dedupeFixture(overrides) {
  return {
    id: overrides.id ?? overrides.listing_no,
    listing_no: overrides.listing_no,
    canonical_property_no: overrides.canonical_property_no ?? null,
    deal_type: overrides.deal_type ?? "sale",
  };
}

test("dedupeListings keeps only the first row when canonical_property_no and deal_type both match", async () => {
  const { dedupeListings } = await loadQueriesForDedupeTests();
  const rows = [
    dedupeFixture({
      listing_no: "A1",
      canonical_property_no: "C001",
      deal_type: "sale",
    }),
    dedupeFixture({
      listing_no: "A2",
      canonical_property_no: "C001",
      deal_type: "sale",
    }),
  ];
  const result = dedupeListings(rows);
  assert.deepEqual(
    result.map((r) => r.listing_no),
    ["A1"],
  );
});

// The critical DR-3 regression this compound key exists to prevent: a unit
// with both an active sale row and an active rent row sharing one
// canonical_property_no (exactly what normalizeListingDetail emits for a
// dual-priced listing, per src/lib/mls/mls-fixtures.test.mjs) must NOT be
// collapsed to one row by a canonical_property_no-only key. Collapsing this
// pair silently drops a real, active listing from /listings' 全部 tab,
// /videos, and every /estate/$slug listings section -- deal:"all" queries
// never add a deal_type predicate (see listingWhere in
// public-data.server.ts), so both rows flow through the same result set.
test("dedupeListings keeps both rows of a sale+rent pair sharing one canonical_property_no", async () => {
  const { dedupeListings } = await loadQueriesForDedupeTests();
  const rows = [
    dedupeFixture({
      listing_no: "F1",
      canonical_property_no: "C500",
      deal_type: "sale",
    }),
    dedupeFixture({
      listing_no: "F2",
      canonical_property_no: "C500",
      deal_type: "rent",
    }),
  ];
  const result = dedupeListings(rows);
  assert.deepEqual(
    result.map((r) => r.listing_no),
    ["F1", "F2"],
  );
});

test("dedupeListings does not merge two null-canonical rows with different listing_no", async () => {
  const { dedupeListings } = await loadQueriesForDedupeTests();
  const rows = [
    dedupeFixture({ listing_no: "B1", canonical_property_no: null }),
    dedupeFixture({ listing_no: "B2", canonical_property_no: null }),
  ];
  const result = dedupeListings(rows);
  assert.deepEqual(
    result.map((r) => r.listing_no),
    ["B1", "B2"],
  );
});

test("dedupeListings falls back to listing_no and dedupes two null-canonical rows sharing it", async () => {
  const { dedupeListings } = await loadQueriesForDedupeTests();
  const rows = [
    dedupeFixture({ listing_no: "C1", canonical_property_no: null }),
    dedupeFixture({ listing_no: "C1", canonical_property_no: null }),
  ];
  const result = dedupeListings(rows);
  assert.deepEqual(
    result.map((r) => r.listing_no),
    ["C1"],
  );
  assert.equal(result.length, 1);
});

test("dedupeListings treats an empty-string canonical_property_no the same as null, not as its own identity", async () => {
  const { dedupeListings } = await loadQueriesForDedupeTests();
  const rows = [
    dedupeFixture({ listing_no: "D1", canonical_property_no: "" }),
    dedupeFixture({ listing_no: "D2", canonical_property_no: "" }),
  ];
  const result = dedupeListings(rows);
  // Two rows with an empty-string canonical number are not known to be the
  // same physical unit any more than two null-canonical rows are -- an empty
  // string must fall back to the listing_no key, not become a shared "" key
  // that would wrongly collapse unrelated listings together.
  assert.deepEqual(
    result.map((r) => r.listing_no),
    ["D1", "D2"],
  );
});

test("dedupeListings dedupes a mixed array of canonical and null-canonical rows independently", async () => {
  const { dedupeListings } = await loadQueriesForDedupeTests();
  const rows = [
    dedupeFixture({ listing_no: "E1", canonical_property_no: "C900" }),
    dedupeFixture({ listing_no: "E2", canonical_property_no: null }),
    dedupeFixture({ listing_no: "E3", canonical_property_no: "C900" }), // dup of E1
    dedupeFixture({ listing_no: "E2", canonical_property_no: null }), // dup of E2 (same listing_no)
    dedupeFixture({ listing_no: "E4", canonical_property_no: null }), // distinct, null canonical
  ];
  const result = dedupeListings(rows);
  assert.deepEqual(
    result.map((r) => r.listing_no),
    ["E1", "E2", "E4"],
  );
});
