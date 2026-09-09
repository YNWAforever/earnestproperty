import test from "node:test";
import assert from "node:assert/strict";
import { groupEstateDirectory, estateListingHref } from "./estate-directory.ts";
import { clientAreaGroupsInNavOrder } from "../content/client-area-presentation.ts";

const row = (over) => ({
  slug: "mun-ming-shan",
  nameZh: "滿名山",
  nameEn: "The Bloomsway",
  aliases: [],
  districtSlug: "castle-peak-road",
  total: 9,
  sale: 5,
  rent: 5,
  ...over,
});

const rows = [
  row({}),
  row({
    slug: "bellagio",
    nameZh: "碧堤半島",
    nameEn: "Bellagio",
    districtSlug: "sham-tseng",
    total: 33,
    sale: 20,
    rent: 15,
  }),
];

test("directory groups all rows and searches normalized names and registered aliases", () => {
  assert.equal(groupEstateDirectory(rows, "").flatMap((g) => g.estates).length, 2);
  assert.equal(groupEstateDirectory(rows, "THE BLOOMS WAY")[0].estates[0].slug, "mun-ming-shan");
  assert.equal(groupEstateDirectory(rows, "滿名")[0].estates.length, 1);
  assert.deepEqual(groupEstateDirectory(rows, "no such estate"), []);
});

test("sale and rental shortcuts carry exact estate filters", () => {
  assert.equal(
    estateListingHref("mun-ming-shan", "sale"),
    "/listings?estate=mun-ming-shan&deal=sale",
  );
  assert.equal(estateListingHref("bellagio", "rent"), "/listings?estate=bellagio&deal=rent");
});

test("registry display region takes precedence over database district fallback", () => {
  // 豪景花園's DB row is sham-tseng, but the client groups it under 青山公路.
  const hongKongGarden = row({
    slug: "hong-kong-garden",
    nameZh: "豪景花園",
    districtSlug: "sham-tseng",
  });
  assert.equal(groupEstateDirectory([hongKongGarden], "")[0].label, "青山公路區小欖至三聖");
});

test("group headings use the client's exact 2026-09-07 labels", () => {
  // docx p1. The same three labels back the directory shortcuts and the header
  // navigation, so one destination cannot acquire conflicting names.
  const tingKau = row({ slug: "ting-kau-only", nameZh: "汀九測試", districtSlug: "ting-kau" });
  const labels = groupEstateDirectory([...rows, tingKau], "").map((group) => group.label);
  assert.deepEqual(labels, ["深井 / 青龍頭", "青山公路區小欖至三聖", "油柑頭汀九"]);
  assert.deepEqual(
    labels,
    clientAreaGroupsInNavOrder().map((group) => group.label),
    "the rendered order must be the client's navigation order, not insertion order",
  );
});

test("a 青龍頭 row groups with 深井 without its database district being rewritten", () => {
  const taiWahHin = row({
    slug: "tai-wah-hin",
    nameZh: "帝華軒",
    districtSlug: "tsing-lung-tau",
  });
  const [group] = groupEstateDirectory([taiWahHin], "");
  assert.equal(group.label, "深井 / 青龍頭");
  assert.equal(group.estates[0].districtSlug, "tsing-lung-tau");
});

test("estates inside a group follow the client's approved order", () => {
  // The client's 深井 order is 豪景花園(→青山公路 group) … 浪翠園, 海雲軒,
  // 麗都花園, 碧堤半島 …, so 浪翠園 must sort ahead of 碧堤半島 here even
  // though the registry array lists 碧堤半島 first.
  const seaCrest = row({ slug: "sea-crest-villa", nameZh: "浪翠園", districtSlug: "sham-tseng" });
  const bellagio = row({ slug: "bellagio", nameZh: "碧堤半島", districtSlug: "sham-tseng" });
  const [group] = groupEstateDirectory([bellagio, seaCrest], "");
  assert.deepEqual(
    group.estates.map((estate) => estate.slug),
    ["sea-crest-villa", "bellagio"],
  );
});

test("an estate outside the three client groups still gets an honest heading", () => {
  const stray = row({ slug: "somewhere-else", nameZh: "其他地區屋苑", districtSlug: "kowloon" });
  const [group] = groupEstateDirectory([stray], "");
  assert.equal(group.label, "其他屋苑");
});
