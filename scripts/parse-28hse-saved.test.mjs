import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseSavedDetail, parseSavedIndex, selectNewListings } from "./parse-28hse-saved.mjs";

test("saved cards keep missing fields null and ignore unrelated links", () => {
  const html = `<div class="property_item"><a class="detail_page" href="https://www.28hse.com/buy/apartment/property-123"></a><div class="header"><a>Title</a></div><div class="extra"><span class="red label">售 $460 萬元</span></div></div>`;
  const rows = parseSavedIndex(html + html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 4600000);
  for (const key of ["rent", "bedrooms", "estate", "district", "saleable_area", "main_image_url"])
    assert.equal(rows[0][key], null);
  assert.throws(() => parseSavedIndex("<html>Unrecognized</html>"));
});

test("rent price and visible bedroom table override inconsistent structured rooms", () => {
  const html = `<h1>Rent</h1><table><tr data-key="price"><td>每月租金</td><td><div class="pairValue">$18,600 元</div></td></tr><tr data-key="roomBath"><td>房間及浴室</td><td><div class="pairValue">3 房 2 浴室</div></td></tr></table><script type="application/ld+json">{"mainEntity":{"numberOfRooms":1}}</script>`;
  const row = parseSavedDetail(
    html,
    "https://www.28hse.com/rent/apartment/property-456",
    "detail_rent_1.html",
  );
  assert.equal(row.rent, 18600);
  assert.equal(row.price, null);
  assert.equal(row.bedrooms, 3);
  assert.equal(row.main_image_url, null);
});

const entry = (id, status = "NEW", deal = "sale") => ({
  "類別 status": status,
  "28hse編號 hse_id": id,
  "買/租 deal": deal,
  "28hse連結 source_url": `https://www.28hse.com/${deal === "rent" ? "rent" : "buy"}/apartment/property-${id}`,
});

test("full comparison selection excludes all non-NEW statuses and site matches", () => {
  const rows = selectNewListings([
    entry("1"),
    entry("2", "NEW", "rent"),
    entry("3", "ALREADY_ON_SITE"),
    entry("4", "ON_SITE_PRICE_CHANGED"),
    entry("5", "UNSURE"),
    { ...entry("6"), "網站盤號 site_no": "A123" },
    { ...entry("7"), "網站連結 site_url": "https://example.com/existing" },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["1", "2"],
  );
  assert.equal(rows[1].deal_type, "rent");
  for (const key of ["price", "rent", "bedrooms", "saleable_area", "main_image_url", "posted"])
    assert.equal(rows[0][key], null);
});

test("keeps merged repost IDs as provenance and rejects duplicate canonical IDs", () => {
  const rows = selectNewListings([{ ...entry("1"), "重複28hse編號 duplicate_ids": "2;3" }]);
  assert.deepEqual(rows[0].duplicate_source_ids, ["2", "3"]);
  assert.throws(() => selectNewListings([entry("1"), entry("1")]), /Duplicate/);
  assert.throws(
    () => selectNewListings([{ ...entry("1"), "28hse連結 source_url": "https://example.com" }]),
    /source URL/,
  );
});

test("fixture contains all 56 unique new flats: 38 sale and 18 rent", () => {
  const { listings } = JSON.parse(
    readFileSync(new URL("../src/content/28hse-preview.json", import.meta.url)),
  );
  assert.equal(listings.length, 56);
  assert.equal(new Set(listings.map((row) => row.id)).size, 56);
  assert.equal(listings.filter((row) => row.deal_type === "sale").length, 38);
  assert.equal(listings.filter((row) => row.deal_type === "rent").length, 18);
  assert.equal(
    listings.filter((row) => row.estate === "OMA OMA" && row.id === "4068170").length,
    1,
  );
  assert.ok(!listings.some((row) => row.id === "4067425"));
  assert.ok(listings.every((row) => (row.price ?? row.rent) > 0 && row.main_image_url));
  assert.equal(listings.find((row) => row.id === "4030683").bedrooms, null);
  assert.equal(listings.find((row) => row.id === "4040071").saleable_area, null);
});

test("homepage limits each tab to 9 and catalog retains every listing", async () => {
  const { PREVIEW_HOME_LIMIT, previewListingsForDeal } =
    await import("../src/lib/saved-preview-catalog.js");
  const { listings } = JSON.parse(
    readFileSync(new URL("../src/content/28hse-preview.json", import.meta.url)),
  );
  const before = JSON.stringify(listings);
  for (const [deal, total] of [
    ["sale", 38],
    ["rent", 18],
  ]) {
    assert.equal(previewListingsForDeal(listings, deal, PREVIEW_HOME_LIMIT).length, 9);
    assert.equal(previewListingsForDeal(listings, deal).length, total);
  }
  assert.equal(JSON.stringify(listings), before);
  assert.equal(previewListingsForDeal(listings, "sale", 9)[0].id, "4068818");
  const rows = [
    { id: "3", deal_type: "rent", posted: null },
    { id: "1", deal_type: "rent", posted: "1 日前 刊登" },
    { id: "2", deal_type: "rent", posted: "2 小時前 刊登" },
    { id: "4", deal_type: "rent", posted: null },
  ];
  assert.deepEqual(
    previewListingsForDeal(rows, "rent").map((row) => row.id),
    ["2", "1", "4", "3"],
  );
});
