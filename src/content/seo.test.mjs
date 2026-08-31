import assert from "node:assert/strict";
import test from "node:test";

import { canonicalLink, estateAliases, estateSeo, seo, SITE_URL } from "./seo.ts";

const NEW_ESTATE_SLUGS = [
  "hoi-wan-hin",
  "tai-wah-hin",
  "hoi-wan-toi",
  "chun-wong-kui",
  "lung-tang-kok",
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
];

test("canonicalLink returns a bare-path canonical, no query string assumptions", () => {
  assert.deepEqual(canonicalLink("/listings"), {
    rel: "canonical",
    href: `${SITE_URL}/listings`,
  });
});

test("seo() mirrors title/description into og:title/og:description and canonicalises the path", () => {
  const result = seo({ title: "T", description: "D", path: "/p" });
  assert.deepEqual(result.meta, [
    { title: "T" },
    { name: "description", content: "D" },
    { property: "og:title", content: "T" },
    { property: "og:description", content: "D" },
  ]);
  assert.deepEqual(result.links, [canonicalLink("/p")]);
});

test("seo() adds an og:image meta only when ogImage is passed", () => {
  const withImage = seo({ title: "T", description: "D", path: "/p", ogImage: "https://x/og.jpg" });
  assert.ok(withImage.meta.some((m) => "property" in m && m.property === "og:image"));

  const withoutImage = seo({ title: "T", description: "D", path: "/p" });
  assert.ok(!withoutImage.meta.some((m) => "property" in m && m.property === "og:image"));
});

test("seo() adds a noindex robots meta only when noindex is true", () => {
  const noindexed = seo({ title: "T", description: "D", path: "/p", noindex: true });
  assert.ok(
    noindexed.meta.some(
      (m) => "name" in m && m.name === "robots" && m.content === "noindex,follow",
    ),
  );

  const indexed = seo({ title: "T", description: "D", path: "/p" });
  assert.ok(!indexed.meta.some((m) => "name" in m && m.name === "robots"));
});

test("estateSeo includes all 17 new estate-expansion slugs", () => {
  for (const slug of NEW_ESTATE_SLUGS) {
    assert.ok(slug in estateSeo, `expected estateSeo to have an entry for "${slug}"`);
  }
});

test("every new estateSeo entry has a non-empty nameEn (estateSeoIdentity throws otherwise)", () => {
  for (const slug of NEW_ESTATE_SLUGS) {
    const entry = estateSeo[slug];
    assert.ok(
      typeof entry.nameEn === "string" && entry.nameEn.length > 0,
      `expected estateSeo["${slug}"].nameEn to be a non-empty string`,
    );
  }
});

test("estateAliases derives entries for all 22 estates (5 original + 17 new)", () => {
  const slugsWithAliases = new Set(Object.values(estateAliases));
  const allSlugs = [
    "bellagio",
    "sea-crest-villa",
    "hong-kong-garden",
    "rhine-garden",
    "lido-garden",
    ...NEW_ESTATE_SLUGS,
  ];
  assert.equal(allSlugs.length, 22);
  for (const slug of allSlugs) {
    assert.ok(
      slugsWithAliases.has(slug),
      `expected estateAliases to derive at least one alias entry for "${slug}"`,
    );
  }
});
