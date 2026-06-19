import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseArea,
  parseLegacyDetail,
  parseMoney,
} from "../parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../__fixtures__/property-detail-6470722.html");

test("parseMoney converts HKD ten-thousand notation to numbers", () => {
  assert.equal(parseMoney("$450萬"), 4_500_000);
  assert.equal(parseMoney("售$1,280萬"), 12_800_000);
  assert.equal(parseMoney("$32,000"), 32_000);
  assert.equal(parseMoney("--"), null);
});

test("parseArea extracts square-foot integers", () => {
  assert.equal(parseArea("實用461呎"), 461);
  assert.equal(parseArea("588 呎"), 588);
  assert.equal(parseArea("--"), null);
});

test("parseLegacyDetail extracts stable listing fields", () => {
  const html = readFileSync(fixturePath, "utf8");
  const parsed = parseLegacyDetail(
    html,
    "https://www.earnestproperty.com/property-detail/6470722.html",
  );

  assert.equal(parsed.legacyDetailId, "6470722");
  assert.equal(parsed.legacyPropertyNo, "B059390");
  assert.equal(parsed.titleZh, "THE CARMEL TWR 01");
  assert.equal(parsed.districtZh, "屯門");
  assert.equal(parsed.dealType, "sale");
  assert.equal(parsed.price, 4_500_000);
  assert.equal(parsed.rent, null);
  assert.equal(parsed.saleableArea, 461);
  assert.equal(parsed.grossArea, 588);
  assert.equal(parsed.orientation, "北");
  assert.deepEqual(parsed.features, ["1房2廳", "開放廚"]);
  assert.deepEqual(parsed.images, ["https://imgs.property.hk/midPhotos/2026/example.jpeg"]);
  assert.equal(parsed.whatsappPhone, "85297838435");
});
