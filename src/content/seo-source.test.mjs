import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("public navigation and homepage use corrected estate slugs", () => {
  const files = [
    "src/components/site/SiteHeader.tsx",
    "src/components/site/SiteFooter.tsx",
    "src/routes/index.tsx",
  ]
    .map(read)
    .join("\n");

  assert.equal(files.includes("/estate/belvedere-garden"), false);
  assert.equal(files.includes("/estate/sea-pearl-garden"), false);
  assert.match(files, /\/estate\/bellagio/);
  assert.match(files, /\/estate\/rhine-garden/);

  const vercel = read("vercel.ts");
  assert.match(vercel, /\/estate\/belvedere-garden/);
  assert.match(vercel, /\/estate\/sea-pearl-garden/);
  assert.match(vercel, /\/estate\/bellagio/);
  assert.match(vercel, /\/estate\/rhine-garden/);
});

test("root metadata no longer references lovable preview assets", () => {
  const root = read("src/routes/__root.tsx");
  assert.equal(root.includes("lovable.app"), false);
  assert.equal(root.includes("id-preview"), false);
});

test("seo content registry contains required full-content routes", () => {
  const source = read("src/content/seo.ts");
  for (const slug of [
    "bellagio",
    "rhine-garden",
    "sham-tseng-buying-guide-2026",
    "bellagio-vs-sea-crest-villa-vs-hong-kong-garden",
  ]) {
    assert.match(source, new RegExp(slug));
  }
});

test("blog routes render real indexed articles", () => {
  const blog = read("src/routes/blog.tsx");
  const detail = read("src/routes/blog.$slug.tsx");
  const queries = read("src/lib/queries.ts");

  assert.match(queries, /fetchPublishedArticles/);
  assert.match(queries, /fetchArticleBySlug/);
  assert.match(blog, /深井買樓全攻略 2026/);
  assert.match(detail, /Article/);
  assert.match(detail, /BreadcrumbList/);
});

test("district and about pages contain full local seo content", () => {
  const shamTseng = read("src/routes/district.sham-tseng.tsx");
  const tsuenWan = read("src/routes/district.tsuen-wan.tsx");
  const tingKau = read("src/routes/district.ting-kau.tsx");
  const about = read("src/routes/about.tsx");

  assert.match(shamTseng, /西半山平民海景區/);
  assert.match(tsuenWan, /港鐵荃灣綫總站/);
  assert.match(tingKau, /低密度別墅/);
  assert.match(about, /真盤源/);
  assert.match(about, /C-018613/);
});

test("estate pages use seo registry and latest listing sections", () => {
  const estate = read("src/routes/estate.$slug.tsx");
  const queries = read("src/lib/queries.ts");

  assert.match(estate, /estateSeo/);
  assert.match(estate, /BreadcrumbList/);
  assert.match(estate, /FAQPage/);
  assert.match(estate, /最新放盤/);
  assert.match(queries, /fetchListingsForEstate/);
});

test("listings page supports district and imported listing freshness", () => {
  const listings = read("src/routes/listings.tsx");
  const queries = read("src/lib/queries.ts");

  assert.match(listings, /district/);
  assert.match(listings, /最後更新/);
  assert.match(queries, /districtSlug/);
  assert.match(queries, /last_seen_at/);
});

test("property detail pages expose real estate schema and legacy support", () => {
  const property = read("src/routes/property.$listingNo.tsx");
  const queries = read("src/lib/queries.ts");
  const vercel = read("vercel.ts");

  assert.match(property, /RealEstateListing/);
  assert.match(property, /Residence/);
  assert.match(property, /BreadcrumbList/);
  assert.match(queries, /fetchPropertyByLegacyDetailId/);
  assert.match(vercel, /property-detail\/:oldId\.html/);
});
