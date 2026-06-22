import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function findMatchingBrace(source, start) {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    }

    if (source[index] === "}") {
      depth -= 1;
    }

    if (depth === 0) {
      return index;
    }
  }

  return -1;
}

function estateBlock(source, slug) {
  const slugIndex = source.indexOf(`slug: "${slug}"`);
  assert.notEqual(slugIndex, -1);

  const blockStart = source.lastIndexOf("{", slugIndex);
  assert.notEqual(blockStart, -1);

  const blockEnd = findMatchingBrace(source, blockStart);
  assert.notEqual(blockEnd, -1);

  return source.slice(blockStart, blockEnd + 1);
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

  assert.match(source, /export const coreEstatePageSlugs = Object\.keys\(estatePageContent\)/);
});

test("estate conversion lookup contract is explicit for unknown slugs", () => {
  const source = read("src/content/estate-pages.ts");
  const inheritedObjectSlugs = ["toString", "constructor"];
  const usesOwnPropertyGuard =
    /Object\.hasOwn\(estatePageContent, slug\)/.test(source) ||
    /Object\.prototype\.hasOwnProperty\.call\(estatePageContent, slug\)/.test(source);

  assert.match(
    source,
    /export function getEstatePageContent\(slug: string\): EstatePageContent \| null/,
  );
  assert.equal(
    usesOwnPropertyGuard,
    true,
    `lookup should reject inherited object keys such as ${inheritedObjectSlugs.join(", ")}`,
  );
  assert.match(source, /return null/);
  assert.match(source, /return estatePageContent\[slug as keyof typeof estatePageContent\]/);
});

test("each estate block carries the required conversion content fields", () => {
  const source = read("src/content/estate-pages.ts");
  const requiredFields = [
    "buyerFit",
    "pros",
    "watchouts",
    "marketNote",
    "saleCta",
    "rentCta",
    "valuationCta",
    "faqs",
    "relatedLinks",
  ];

  for (const slug of [
    "bellagio",
    "sea-crest-villa",
    "hong-kong-garden",
    "rhine-garden",
    "lido-garden",
  ]) {
    const block = estateBlock(source, slug);

    for (const field of requiredFields) {
      assert.match(block, new RegExp(`${field}:`), `${slug} should include ${field}`);
    }
  }
});

test("estate conversion registry includes factual trust proof from public sources", () => {
  const source = read("src/content/estate-pages.ts");

  assert.match(source, /C-018613/);
  assert.match(source, /深井麗都花園地下5A舖/);
  assert.match(source, /2688 2988/);
  assert.match(source, /28hse\.com\/agent\/540/);
  assert.match(source, /229 個公開放售樓盤/);
  assert.match(source, /2026-06-22/);
  assert.match(source, /observedListingFootprint: ".*顯示/);
  assert.equal(/Google review|testimonial|五星|客戶好評/.test(source), false);
});

test("estate conversion source avoids the older disallowed listing wording", () => {
  const forbidden = String.fromCharCode(30495, 30436, 28304);
  const source = read("src/content/estate-pages.ts");
  assert.equal(source.includes(forbidden), false);
});
