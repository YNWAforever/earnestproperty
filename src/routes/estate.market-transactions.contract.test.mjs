import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const route = read("src/routes/estate.$slug.tsx");
const propertyRoute = read("src/routes/property.$listingNo.tsx");

test("estate route renders 市場註冊成交 from the static snapshot, on its own search schema", () => {
  // The snapshot is ~5.7 MB and database-free: it is read through a server
  // function so the client bundle only ever receives the current page of rows.
  assert.match(route, /import \{ fetchEstateMarketBlock \} from "@\/lib\/market\/estate-market"/);
  assert.match(
    route,
    /const \{ market: marketRegistrations, chart: marketChart \} = await loadEstateMarketBlock\(/,
  );
  assert.match(route, /<EstateMarketRegistrations market=\{marketRegistrations\}/);
  // Filters/pagination are validated URL state, not client-only state.
  assert.match(route, /validateSearch: zodValidator\(estateMarketSearchSchema\)/);
  assert.match(route, /loaderDeps: \(\{ search \}\) => search/);
  // Neither route may import the snapshot module directly: doing that from a
  // loader put a 5.6 MB chunk into .output/public once already.
  assert.doesNotMatch(route, /market-transactions-snapshot/);
  assert.doesNotMatch(propertyRoute, /market-transactions-snapshot/);
  assert.match(propertyRoute, /fetchEstateMarketBlock\(\{/);
  assert.match(propertyRoute, /estateMarketSlug/);
});

test("agency 本行成交 and market registered transactions never share a table or a count", () => {
  assert.match(route, /fetchEstateTransactions\(estate\.id, 8\)/);
  assert.match(route, /<EstateMarketSnapshot[\s\S]*?transactions=\{transactions\}/);
  assert.doesNotMatch(
    route,
    /transactions:\s*marketRegistrations|transactions\.concat|transactions\.push|marketRegistrations\.rows\.push/,
  );
  // The registry table is now the only market block on the page: the separate
  // EPRC export and its own source count were removed.
  assert.doesNotMatch(route, /EstateRegisteredTransactions|其他來源：EPRC/);
});

test("listing detail page adds the estate market summary and keeps 本行成交 labelled", () => {
  assert.match(propertyRoute, /<ListingEstateMarketSummary/);
  assert.match(propertyRoute, /本行成交紀錄/);
  // Fail-soft: a snapshot problem must not take the listing page down.
  assert.match(propertyRoute, /\[property\] market registrations snapshot failed/);
  assert.doesNotMatch(propertyRoute, /txns\.(?:concat|push)\(estateMarket/);
});

test("market snapshot modules and components stay off database/agency dependency paths", () => {
  for (const path of [
    "src/lib/queries.ts",
    "src/lib/neon/public-data.ts",
    "src/lib/neon/public-data.server.ts",
    "src/lib/neon/admin-data.ts",
    "src/lib/neon/admin-data.server.ts",
    "src/components/site/EstateMarketSnapshot.tsx",
  ]) {
    assert.doesNotMatch(
      read(path),
      /eprc|RegisteredTransactions|marketTransactions|marketRegistrations/i,
      path,
    );
  }
  for (const path of [
    "src/content/market-transactions.ts",
    "src/content/market-transactions-snapshot.ts",
    "src/components/site/EstateMarketRegistrations.tsx",
    "src/components/site/ListingEstateMarketSummary.tsx",
  ]) {
    assert.doesNotMatch(
      read(path),
      /from ["'][^"']*(?:queries|neon|admin)|fetchEstateTransactions|createServerFn|queryRows/,
      path,
    );
  }
  // The only server boundary for these rows: it may use createServerFn, but it
  // must not touch the database/agency readers, and the snapshot it wraps must
  // stay server-only so a client import fails the build instead of shipping 5 MB.
  const boundary = read("src/lib/market/estate-market.ts");
  assert.match(boundary, /createServerFn/);
  assert.match(boundary, /market-transactions-snapshot/);
  assert.doesNotMatch(boundary, /from "@\/(?:lib\/neon|lib\/queries)/);
  assert.match(
    read("src/content/market-transactions-snapshot.ts"),
    /import "@tanstack\/react-start\/server-only"/,
  );
});

test("the estate page carries no provenance or verification caveat copy for these tables", () => {
  assert.doesNotMatch(route, /尚待人手覆核並標註核實日期|本行屋苑資料庫/);
  const market = read("src/components/site/EstateMarketRegistrations.tsx");
  assert.doesNotMatch(
    market,
    /資料來源|筆來源紀錄|臨時＋正式合約配對|去重後|更新於/,
    "the registry table shows rows, not repeated claims about them",
  );
});
