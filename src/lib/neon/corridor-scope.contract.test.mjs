import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { getCastlePeakRoadSegment } from "../../content/castle-peak-road.ts";

// DR-1 regression coverage: fetchCorridorInventoryForAliases() (src/lib/queries.ts)
// is the function every corridor page calls, and it is the actual leak vector --
// isWithinCorridorRegion() already exists and is applied at fetchEstatesByDistrict
// and fetchFeaturedProperties, but not here. This file proves the post-filter added
// inside fetchCorridorInventoryForAliases actually drops out-of-scope rows, using
// fixture rows shaped like what a leaky SQL WHERE clause (Ting Kau's old
// districtSlugs: ["ting-kau", "castle-peak-road"]) would have returned.
//
// Same harness as listing-search.contract.test.mjs / agent-profiles.contract.test.mjs:
// public-data.server.ts is loaded as a data: URL module with getSql() stubbed to a
// fixture-returning function, so fetchCorridorInventory's real SQL-shape mapping
// (mapListingRow) runs without a live Neon connection. queries.ts is then loaded the
// same way, on top of that, with its @/lib/neon/public-data import redirected to a
// thin shim wired to the already-loaded fetchCorridorInventory -- this exercises the
// REAL, unmodified fetchCorridorInventoryForAliases(), including the new
// isWithinCorridorRegion() post-filter this task adds, rather than re-implementing
// that logic in the test.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// Exact mechanism reused from listing-search.contract.test.mjs: a data: URL module
// has no filesystem location, so every relative import in the loaded module has to
// be inlined as its own data: URL too.
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

/** Loads public-data.server.ts with getSql() stubbed to `query`. Returns both the
 * imported module and the data: URL it was loaded from, so a second consumer
 * (the queries.ts shim below) can `import()` the identical cached module instead
 * of re-transpiling and re-evaluating it. */
async function loadPublicDataServer(query) {
  globalThis.__corridorScopeContractQuery = query;
  const dbUrl = dataUrl(
    "export const getSql = () => ({ query: (...args) => globalThis.__corridorScopeContractQuery(...args) });",
  );
  const executable = inlineRelativeImports(
    transpile(read("src/lib/neon/public-data.server.ts"))
      .replace('import "@tanstack/react-start/server-only";', "")
      .replace('from "./db.server"', `from "${dbUrl}"`),
    "src/lib/neon",
  );
  const url = dataUrl(executable);
  return { url, module: await import(url) };
}

// Every name queries.ts imports from "@/lib/neon/public-data" other than
// fetchNeonCorridorInventory. None of these are reachable from
// fetchCorridorInventoryForAliases, so they only need to exist as exports (ESM
// throws at load time on a missing named export) -- they should never actually run.
const UNUSED_PUBLIC_DATA_EXPORTS = [
  "fetchNeonArticleBySlug",
  "fetchNeonCmsVideos",
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

/**
 * Loads the real src/lib/queries.ts with its two aliased imports redirected:
 * "@/lib/neon/public-data" -> a shim whose fetchNeonCorridorInventory calls the
 * already-loaded, getSql-stubbed public-data.server.ts's real fetchCorridorInventory
 * (the same handoff createServerFn's own handler does, minus the RPC machinery,
 * which this test has no need to exercise); "@/content/castle-peak-road" -> the real
 * module, inlined the same way relative imports are inlined above (it has no
 * imports of its own, so no further rewriting is needed inside it).
 */
async function loadQueriesForFixtureCorridorRows(fixtureRows, queryLog = null) {
  const query = async (text, params) => {
    queryLog?.push({ text, params });
    if (/GROUP BY p\.deal_type/.test(text)) {
      const totals = new Map();
      for (const row of fixtureRows) {
        totals.set(row.deal_type, (totals.get(row.deal_type) ?? 0) + 1);
      }
      return [...totals].map(([deal_type, total]) => ({ deal_type, total }));
    }
    // The ranked corridor-row query inside fetchCorridorRows. The stub doesn't
    // evaluate the WHERE clause -- this file isn't testing SQL construction (that's
    // listing-search.contract.test.mjs's job) -- it hands back the fixture rows
    // as-is so the real mapListingRow() + region-scope filter chain runs on them,
    // simulating what a leaky WHERE clause would have actually returned.
    return fixtureRows;
  };

  const { url: serverUrl } = await loadPublicDataServer(query);

  const publicDataStubSource = `
    export async function fetchNeonCorridorInventory({ data }) {
      const server = await import(${JSON.stringify(serverUrl)});
      return server.fetchCorridorInventory(data);
    }
    ${UNUSED_PUBLIC_DATA_EXPORTS.map(
      (name) => `export async function ${name}() {
        throw new Error(${JSON.stringify(`${name} is not exercised by corridor-scope.contract.test.mjs`)});
      }`,
    ).join("\n")}
  `;

  const castlePeakRoadUrl = dataUrl(transpile(read("src/content/castle-peak-road.ts")));

  const queriesSource = transpile(read("src/lib/queries.ts"))
    .replace('from "@/lib/neon/public-data"', `from "${dataUrl(publicDataStubSource)}"`)
    .replace('from "@/content/castle-peak-road"', `from "${castlePeakRoadUrl}"`);

  return import(dataUrl(queriesSource));
}

function fixtureRow({ id, title_zh, district_slug, address = null }) {
  return {
    id,
    listing_no: id,
    title_zh,
    deal_type: "sale",
    district_slug,
    address,
  };
}

// A row a leaky WHERE clause (Ting Kau's old districtSlugs: ["ting-kau",
// "castle-peak-road"]) would have returned, but which sits in one of
// corridorRegionScope's outOfScopeTextAliases -- 屯門, 掃管笏, 黃金海岸, 大欖涌 are
// nowhere near Ting Kau, geographically.
const outOfScopeFixtures = [
  fixtureRow({ id: "out-1", title_zh: "屯門青山公路住宅盤源", district_slug: "castle-peak-road" }),
  fixtureRow({ id: "out-2", title_zh: "掃管笏花園盤源", district_slug: "castle-peak-road" }),
  fixtureRow({ id: "out-3", title_zh: "黃金海岸盤源", district_slug: "castle-peak-road" }),
  fixtureRow({ id: "out-4", title_zh: "大欖涌盤源", district_slug: "castle-peak-road" }),
];

const genuineTingKauFixture = fixtureRow({
  id: "ting-kau-1",
  title_zh: "汀九別墅",
  district_slug: "ting-kau",
});

// A genuinely nearby castle-peak-road-tagged row -- doesn't mention any
// outOfScopeTextAliases place name, so it belongs in the nearby ("附近選擇") set.
const nearbyFixture = fixtureRow({
  id: "nearby-1",
  title_zh: "青山公路住宅盤源",
  district_slug: "castle-peak-road",
});

const allFixtures = [...outOfScopeFixtures, genuineTingKauFixture, nearbyFixture];

test("Ting Kau's strict corridor query excludes 屯門/掃管笏/黃金海岸/大欖涌 rows even when a leaky WHERE clause would have matched them", async () => {
  const tingKau = getCastlePeakRoadSegment("ting-kau");
  assert.ok(tingKau);

  const { fetchCorridorInventoryForAliases } = await loadQueriesForFixtureCorridorRows(allFixtures);
  const result = await fetchCorridorInventoryForAliases({
    districtSlugs: ["ting-kau"],
    estateSlugs: [],
    textAliases: tingKau.textAliases,
  });

  const returnedIds = [...result.saleRows, ...result.rentRows].map((row) => row.listing_no);
  for (const excluded of outOfScopeFixtures) {
    assert.ok(
      !returnedIds.includes(excluded.listing_no),
      `${excluded.title_zh} (${excluded.listing_no}) must not reach Ting Kau's strict result set`,
    );
  }
});

test("a genuine Ting Kau row is included in the strict result set", async () => {
  const tingKau = getCastlePeakRoadSegment("ting-kau");
  assert.ok(tingKau);

  const { fetchCorridorInventoryForAliases } = await loadQueriesForFixtureCorridorRows(allFixtures);
  const result = await fetchCorridorInventoryForAliases({
    districtSlugs: ["ting-kau"],
    estateSlugs: [],
    textAliases: tingKau.textAliases,
  });

  const returnedIds = [...result.saleRows, ...result.rentRows].map((row) => row.listing_no);
  assert.ok(returnedIds.includes(genuineTingKauFixture.listing_no));
});

test("fetchCorridorInventoryForAliases sends corridorRegionScope.outOfScopeTextAliases as a SQL-level exclusion on every corridor query, not just an app-layer filter after the fact", async () => {
  // Regression coverage for the code-review finding that the SQL COUNT (saleTotal/
  // rentTotal) and the LIMIT-ranked rows disagreed because the out-of-scope exclusion
  // only ran client-side, after both queries had already run. corridorWhere()
  // (public-data.server.ts) now ANDs a NOT EXISTS(...) exclusion, built from
  // outOfScopeTextAliases, into the WHERE clause used by BOTH the COUNT query and the
  // ranked-rows query -- this asserts that clause and its bound parameter actually
  // reach every SQL call this fixture's query stub observes, rather than re-deriving
  // the exclusion result in JS (which corridor-scope's other tests already cover via
  // the app-layer filter).
  const tingKau = getCastlePeakRoadSegment("ting-kau");
  assert.ok(tingKau);

  const queryLog = [];
  const { fetchCorridorInventoryForAliases } = await loadQueriesForFixtureCorridorRows(
    allFixtures,
    queryLog,
  );
  await fetchCorridorInventoryForAliases({
    districtSlugs: ["ting-kau"],
    estateSlugs: [],
    textAliases: tingKau.textAliases,
  });

  // Both the COUNT query and the ranked-rows query call corridorWhere(), so both
  // entries in the log must carry the exclusion.
  assert.ok(queryLog.length >= 2, "expected both the COUNT query and the rows query to run");
  for (const { text, params } of queryLog) {
    assert.match(
      text,
      /AND NOT EXISTS/,
      "corridorWhere() must AND NOT the out-of-scope alias set into every corridor query",
    );
    const outOfScopeParam = params.find(
      (param) => Array.isArray(param) && param.includes("屯門"),
    );
    assert.ok(
      outOfScopeParam,
      "corridorRegionScope.outOfScopeTextAliases must be bound as a query parameter",
    );
  }
});

test("Ting Kau's nearby alias set returns castle-peak-road rows that don't match any outOfScopeTextAliases term", async () => {
  const tingKau = getCastlePeakRoadSegment("ting-kau");
  assert.ok(tingKau);
  assert.deepStrictEqual(tingKau.nearbyDistrictSlugs, ["castle-peak-road"]);

  const { fetchCorridorInventoryForAliases } = await loadQueriesForFixtureCorridorRows(allFixtures);
  const result = await fetchCorridorInventoryForAliases({
    districtSlugs: tingKau.nearbyDistrictSlugs,
    estateSlugs: tingKau.nearbyEstateSlugs,
    textAliases: tingKau.nearbyTextAliases,
  });

  const returned = [...result.saleRows, ...result.rentRows];
  const nearbyRow = returned.find((row) => row.listing_no === nearbyFixture.listing_no);
  assert.ok(nearbyRow, "the nearby castle-peak-road row must be returned");

  const returnedIds = returned.map((row) => row.listing_no);
  for (const excluded of outOfScopeFixtures) {
    assert.ok(
      !returnedIds.includes(excluded.listing_no),
      `${excluded.title_zh} must not reach the nearby set either -- the region guard applies to both`,
    );
  }
});
