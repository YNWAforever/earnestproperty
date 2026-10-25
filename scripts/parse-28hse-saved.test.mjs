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

test("allowlist excludes existing and uncertain matches and merges explicit duplicates", () => {
  const card = (id) => ({
    id,
    source_url: `https://www.28hse.com/buy/apartment/property-${id}`,
    main_image_url: null,
  });
  const entry = (id, status = "NEW") => ({
    hse_id: id,
    status,
    deal_type: "sale",
    source_url: card(id).source_url,
  });
  const rows = selectNewListings(
    [
      { ...entry("1"), duplicate_of_28hse_ids: "2" },
      { ...entry("2"), duplicate_of_28hse_ids: "1" },
      entry("3", "ALREADY_ON_SITE"),
      entry("4", "UNSURE"),
      { ...entry("5"), match_listing_no: "A123" },
    ],
    [card("1"), card("2")],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "1");
  assert.deepEqual(rows[0].duplicate_source_ids, ["2"]);
  assert.equal(rows[0].price, null);
  assert.throws(() => selectNewListings([entry("6")], []), /Missing saved card/);
});

test("committed fixture contains only the five approved new flats", () => {
  const { listings } = JSON.parse(
    readFileSync(new URL("../src/content/28hse-preview.json", import.meta.url)),
  );
  assert.deepEqual(
    listings.map((row) => row.id),
    ["4068170", "4063699", "4061626", "4060450", "4060439"],
  );
  assert.deepEqual(
    listings.map((row) => row.estate),
    ["OMA OMA", "OMA by the Sea", "黃金海灣", "縉皇居", "飛揚"],
  );
  assert.equal(listings.filter((row) => row.deal_type === "rent").length, 0);
  assert.deepEqual(listings[0].duplicate_source_ids, ["4067425"]);
  assert.ok(listings.every((row) => row.price > 0 && row.main_image_url));
});
