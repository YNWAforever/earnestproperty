import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parseSavedDetail, parseSavedIndex } from "./parse-28hse-saved.mjs";

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

test("committed fixture has unique records and precise saved coverage", () => {
  const { listings } = JSON.parse(
    readFileSync(new URL("../src/content/28hse-preview.json", import.meta.url)),
  );
  assert.equal(listings.length, 18);
  assert.equal(new Set(listings.map((row) => row.id)).size, 18);
  assert.equal(listings.filter((row) => row.deal_type === "sale").length, 15);
  assert.equal(listings.filter((row) => row.deal_type === "rent").length, 3);
  assert.equal(listings.find((row) => row.id === "4064528").rent, 18600);
  assert.equal(listings.find((row) => row.id === "4068791").bedrooms, null);
  assert.ok(listings.every((row) => (row.price ?? row.rent) > 0 && row.main_image_url));
});
