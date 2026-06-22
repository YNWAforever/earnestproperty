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
});
