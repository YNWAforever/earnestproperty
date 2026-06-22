import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("estate conversion registry covers the five approved core estates", () => {
  const source = read("src/content/estate-pages.ts");

  for (const slug of [
    "bellagio",
    "sea-crest-villa",
    "hong-kong-garden",
    "rhine-garden",
    "lido-garden",
  ]) {
    assert.match(source, new RegExp(slug));
  }

  for (const phrase of [
    "buyerFit",
    "pros",
    "watchouts",
    "marketNote",
    "saleCta",
    "rentCta",
    "valuationCta",
    "relatedLinks",
  ]) {
    assert.match(source, new RegExp(phrase));
  }
});

test("estate conversion registry includes factual trust proof from public sources", () => {
  const source = read("src/content/estate-pages.ts");

  assert.match(source, /C-018613/);
  assert.match(source, /深井麗都花園地下5A舖/);
  assert.match(source, /2688 2988/);
  assert.match(source, /28hse\.com\/agent\/540/);
  assert.match(source, /229 個公開放售樓盤/);
  assert.equal(/Google review|testimonial|五星|客戶好評/.test(source), false);
});

test("estate conversion source avoids the older disallowed listing wording", () => {
  const forbidden = String.fromCharCode(30495, 30436, 28304);
  const source = read("src/content/estate-pages.ts");
  assert.equal(source.includes(forbidden), false);
});
