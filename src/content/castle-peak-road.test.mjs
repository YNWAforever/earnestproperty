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
  assert.match(queries, /runWithSupabaseFallback/);
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

test("corridor inventory fallback stays on pure Supabase reads", () => {
  const queries = read("src/lib/queries.ts");
  const fallbackStart = queries.indexOf(
    "async function fetchCorridorInventoryFromSupabaseFallback",
  );
  const fallbackEnd = queries.indexOf("export async function fetchCorridorInventoryForAliases");
  const fallbackSource = queries.slice(fallbackStart, fallbackEnd);

  assert.ok(fallbackStart >= 0);
  assert.ok(fallbackEnd > fallbackStart);
  assert.doesNotMatch(fallbackSource, /\bsearchListings\(/);
  assert.doesNotMatch(fallbackSource, /\bfetchListingsForEstate\(/);
  assert.match(fallbackSource, /fetchCorridorDealFromSupabase/);
  assert.match(fallbackSource, /dealType: "sale" \| "rent"/);
});

test("corridor inventory fallback totals dedupe across alias buckets", () => {
  const queries = read("src/lib/queries.ts");
  const fallbackStart = queries.indexOf("async function fetchCorridorDealFromSupabase");
  const fallbackEnd = queries.indexOf("export async function fetchCorridorInventoryForAliases");
  const fallbackSource = queries.slice(fallbackStart, fallbackEnd);

  assert.ok(fallbackStart >= 0);
  assert.ok(fallbackEnd > fallbackStart);
  assert.match(fallbackSource, /fetchCorridorCountRowsFromSupabase/);
  assert.match(fallbackSource, /dedupeListingKeys/);
  assert.match(fallbackSource, /total: dedupeListingKeys/);
  assert.doesNotMatch(fallbackSource, /reduce\(\(sum, result\) => sum \+ result\.total/);
});

test("castle peak road hub and segment routes render content, inventory, and schema", () => {
  const hub = read("src/routes/castle-peak-road.tsx");
  const segment = read("src/routes/castle-peak-road.$segment.tsx");
  const inventory = read("src/components/site/CorridorInventory.tsx");

  assert.match(hub, /createFileRoute\(["']\/castle-peak-road["']\)/);
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
