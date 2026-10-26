import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { estateRegistry, getEstateEntry } from "./estate-registry.ts";
import { estateSeo } from "./seo.ts";
import { getEstatePageContent } from "./estate-pages.ts";
import { approvedPresentationEstateSlugs } from "./client-area-presentation.ts";

const evidence = JSON.parse(
  readFileSync(
    new URL("./fixtures/listing-estate-expansion-20261026.json", import.meta.url),
    "utf8",
  ),
);

test("all 40 active listing estates have complete public content, a labelled photo and a card", () => {
  assert.equal(evidence.estates.length, 40);
  for (const estate of evidence.estates) {
    const { slug } = estate;
    const entry = getEstateEntry(slug);
    assert.equal(entry.hasPage, true, slug);
    assert.equal(entry.published, true, slug);
    assert.equal(entry.photo, estate.photo.url, slug);
    assert.ok(
      estate.listings.some((listing) => listing.listingNo === estate.photo.listingNo),
      `${slug}: photo belongs to evidenced listing`,
    );
    assert.ok(estate.sources.length >= 1, slug);
    assert.equal(entry.districtSlug, estate.districtSlug, slug);
    assert.match(entry.photoCredit, /放盤參考照片/, slug);
    assert.ok(approvedPresentationEstateSlugs.includes(slug), slug);
    assert.ok(estateSeo[slug]?.description, slug);
    const content = getEstatePageContent(slug);
    assert.equal(content?.overview.length, 2, slug);
    assert.ok(content?.transportLifestyle, slug);
    assert.ok(content?.watchouts.length, slug);
    assert.ok(
      content?.relatedLinks.some((link) => link.href.includes(`estate=${slug}`)),
      slug,
    );
  }
});

test("Pearl Island Bungalow and Garden retain distinct identities and aliases", () => {
  const garden = getEstateEntry("lung-chu-island-garden");
  const bungalow = getEstateEntry("pearl-island-bungalow");
  assert.ok(!garden.aliases.includes("龍珠島別墅"));
  assert.ok(bungalow.aliases.includes("龍珠島別墅"));
  assert.notEqual(garden.slug, bungalow.slug);
  assert.ok(!estateRegistry.some((entry) => entry.slug === "其他"));
});
