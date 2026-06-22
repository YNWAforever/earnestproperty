import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("castle peak road content registry defines the approved core corridor launch", () => {
  const source = read("src/content/castle-peak-road.ts");

  for (const path of [
    "/castle-peak-road",
    "/castle-peak-road/tsuen-wan-yau-kom-tau",
    "/castle-peak-road/ting-kau",
    "/castle-peak-road/sham-tseng",
    "/castle-peak-road/tsing-lung-tau",
    "/castle-peak-road/so-kwun-wat-gold-coast",
  ]) {
    assert.match(source, new RegExp(path.replaceAll("/", "\\/")));
  }

  assert.match(source, /Core Corridor Launch/);
  assert.match(source, /汀九 Ting Kau · 青山公路低密度海景住宅/);
  assert.match(source, /C-018613/);
  assert.match(source, /school net 62|62 校網/);
  assert.match(source, /Vista Del Mar|觀海別墅/);
  assert.match(source, /Royal Dragon Villa|嘉御龍庭/);
  assert.match(source, /Ting Kau Villa|汀九別墅/);
  assert.match(source, /export type CorridorHub/);
  assert.match(source, /satisfies CorridorHub/);
  assert.match(source, /getCastlePeakRoadSegment\(slug: string\): CorridorSegment \| null/);
});

test("segment registry carries live listing aliases and FAQ content", () => {
  const source = read("src/content/castle-peak-road.ts");

  for (const token of [
    "districtSlugs",
    "estateSlugs",
    "textAliases",
    "featuredEstates",
    "faqs",
    "castlePeakRoadSitemapPaths",
  ]) {
    assert.match(source, new RegExp(token));
  }

  for (const alias of [
    "ting-kau",
    "sham-tseng",
    "tsing-lung-tau",
    "so-kwun-wat",
    "gold-coast",
    "hong-kong-garden",
  ]) {
    assert.match(source, new RegExp(alias));
  }

  assert.match(source, /districtSlugs: \["tsuen-wan", "yau-kom-tau", "castle-peak-road"\]/);
  assert.match(source, /districtSlugs: \["tsing-lung-tau", "castle-peak-road"\]/);
  assert.match(source, /districtSlugs: \["so-kwun-wat", "gold-coast", "castle-peak-road"\]/);
});

test("corridor inventory uses Neon alias query with public query wrapper", () => {
  const server = read("src/lib/neon/public-data.server.ts");
  const client = read("src/lib/neon/public-data.ts");
  const types = read("src/lib/neon/public-data.types.ts");
  const queries = read("src/lib/queries.ts");

  assert.match(types, /NeonCorridorInventoryInput/);
  assert.match(types, /NeonCorridorInventoryResult/);
  assert.match(server, /export async function fetchCorridorInventory/);
  assert.match(server, /unnest/);
  assert.match(server, /ILIKE|lower/);
  assert.match(client, /fetchNeonCorridorInventory/);
  assert.match(queries, /fetchCorridorInventoryForAliases/);
  assert.doesNotMatch(queries, /Supabase/i);
});

test("corridor inventory guards empty aliases and SQL wildcard matching", () => {
  const server = read("src/lib/neon/public-data.server.ts");
  const queries = read("src/lib/queries.ts");

  assert.match(server, /emptyCorridorInventory/);
  assert.match(server, /escapeLikeTerm/);
  assert.match(server, /ESCAPE/);
  assert.match(server, /hasCorridorAliases/);

  assert.match(queries, /emptyCorridorInventory/);
  assert.match(queries, /normalizeCorridorInventoryInput/);
  assert.match(queries, /Math\.min\(Math\.max\(1, .*?\), 24\)/);
  assert.match(queries, /hasCorridorAliases/);
});

test("corridor inventory stays on Neon and avoids legacy fallback paths", () => {
  const queries = read("src/lib/queries.ts");

  assert.match(queries, /fetchNeonCorridorInventory/);
  assert.doesNotMatch(queries, /Supabase/i);
  assert.doesNotMatch(queries, /dedupeListingKeys/);
});

test("castle peak road hub and segment routes render content, inventory, and schema", () => {
  const layout = read("src/routes/castle-peak-road.tsx");
  const hub = read("src/routes/castle-peak-road.index.tsx");
  const segment = read("src/routes/castle-peak-road.$segment.tsx");
  const inventory = read("src/components/site/CorridorInventory.tsx");

  assert.match(layout, /createFileRoute\(["']\/castle-peak-road["']\)/);
  assert.match(layout, /<Outlet \/>/);
  assert.match(hub, /createFileRoute\(["']\/castle-peak-road\/["']\)/);
  assert.match(segment, /createFileRoute\(["']\/castle-peak-road\/\$segment["']\)/);
  assert.match(hub, /castlePeakRoadHub/);
  assert.match(segment, /getCastlePeakRoadSegment/);
  assert.match(hub, /fetchCorridorInventoryForAliases/);
  assert.match(segment, /fetchCorridorInventoryForAliases/);
  assert.match(inventory, /saleTotal/);
  assert.match(inventory, /rentTotal/);
  assert.match(segment, /BreadcrumbList/);
  assert.match(segment, /FAQPage/);
  assert.match(segment, /ItemList/);
});

test("castle peak road routes avoid nested main landmarks and define route errors", () => {
  const hub = read("src/routes/castle-peak-road.index.tsx");
  const segment = read("src/routes/castle-peak-road.$segment.tsx");

  assert.doesNotMatch(hub, /<main className="bg-background">/);
  assert.doesNotMatch(segment, /<main className="bg-background">/);
  assert.match(hub, /errorComponent:\s*CastlePeakRoadRouteError/);
  assert.match(segment, /errorComponent:\s*CastlePeakRoadSegmentError/);
  assert.match(hub, /useRouter\(\)/);
  assert.match(segment, /useRouter\(\)/);
  assert.match(hub, /載入青山公路總覽時遇到問題/);
  assert.match(segment, /載入青山公路分段時遇到問題/);
});

test("castle peak road links and media use route-aware safeguards", () => {
  const segment = read("src/routes/castle-peak-road.$segment.tsx");
  const inventory = read("src/components/site/CorridorInventory.tsx");

  assert.doesNotMatch(segment, /district=\$\{segment\.districtSlugs\[0\]/);
  assert.match(segment, /function getSegmentListingsHref/);
  assert.match(segment, /const supportedListingDistrictSlugs/);
  assert.match(segment, /function CorridorRelatedLink/);
  assert.doesNotMatch(segment, /<a\s+key=\{link\.href\}/);
  assert.match(inventory, /function ListingHrefLink/);
  assert.doesNotMatch(inventory, /<a href=\{listingsHref\}/);
  assert.match(segment, /target="_blank"/);
  assert.match(segment, /rel="noopener noreferrer"/);
  assert.match(inventory, /loading="lazy"/);
  assert.match(inventory, /decoding="async"/);
});

test("canonical links, redirects, and sitemap use castle peak road routes", () => {
  const seo = read("src/content/seo.ts");
  const vercel = read("vercel.ts");
  const layoutRoute = read("src/routes/castle-peak-road.tsx");
  const hubRoute = read("src/routes/castle-peak-road.index.tsx");
  const segmentRoute = read("src/routes/castle-peak-road.$segment.tsx");
  const tingKauRoute = read("src/routes/district.ting-kau.tsx");
  const tsuenWanRoute = read("src/routes/district.tsuen-wan.tsx");
  const shamTsengRoute = read("src/routes/district.sham-tseng.tsx");
  const header = read("src/components/site/SiteHeader.tsx");
  const footer = read("src/components/site/SiteFooter.tsx");
  const sitemap = read("src/routes/sitemap[.]xml.ts");

  assert.match(seo, /castlePeakRoad/);
  assert.match(seo, /path:\s*"\/castle-peak-road\/ting-kau"/);
  assert.match(vercel, /\/district\/ting-kau/);
  assert.match(vercel, /\/district\/ting-kau\//);
  assert.match(vercel, /\/castle-peak-road\/ting-kau/);
  assert.match(hubRoute, /rel:\s*["']canonical["']/);
  assert.match(hubRoute, /SITE_URL/);
  assert.match(hubRoute, /castlePeakRoadHub\.path/);
  assert.match(layoutRoute, /<Outlet \/>/);
  assert.doesNotMatch(layoutRoute, /rel:\s*["']canonical["']/);
  assert.match(segmentRoute, /rel:\s*["']canonical["']/);
  assert.match(segmentRoute, /loaderData\?\.segment\.path/);
  assert.match(segmentRoute, /castlePeakRoadHub\.path/);
  assert.match(tingKauRoute, /redirect/);
  assert.match(tingKauRoute, /\/castle-peak-road\/\$segment/);
  assert.match(tingKauRoute, /statusCode:\s*(301|308)/);
  assert.match(tsuenWanRoute, /rel:\s*["']canonical["']/);
  assert.match(tsuenWanRoute, /pageSeo\.tsuenWan\.path/);
  assert.match(tsuenWanRoute, /\/castle-peak-road/);
  assert.match(shamTsengRoute, /rel:\s*["']canonical["']/);
  assert.match(shamTsengRoute, /pageSeo\.shamTseng\.path/);
  assert.match(shamTsengRoute, /\/castle-peak-road/);
  assert.match(header, /青山公路/);
  assert.match(footer, /\/castle-peak-road\/ting-kau/);
  assert.match(sitemap, /sitemap\.xml/);
  assert.match(sitemap, /castlePeakRoadSitemapPaths/);
  assert.match(sitemap, /function escapeXml/);
  assert.match(sitemap, /escapeXml\(\`\$\{SITE_URL\}\$\{path\}\`\)/);
});
