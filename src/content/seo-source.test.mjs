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

  // An estate can be linked either as a literal href ("/estate/bellagio") or
  // through the typed route (<Link to="/estate/$slug" params={{ slug: "..." }}>),
  // so match on the slug in either position rather than the literal path.
  const linksEstate = (slug) =>
    new RegExp(`/estate/${slug}\\b|slug:\\s*["']${slug}["']`).test(files);

  assert.equal(linksEstate("belvedere-garden"), false);
  assert.equal(linksEstate("sea-pearl-garden"), false);
  assert.ok(linksEstate("bellagio"), "navigation should link the bellagio estate page");
  assert.ok(linksEstate("rhine-garden"), "navigation should link the rhine-garden estate page");

  const vercel = read("vercel.ts");
  assert.match(vercel, /\/estate\/belvedere-garden/);
  assert.match(vercel, /\/estate\/sea-pearl-garden/);
  assert.match(vercel, /\/estate\/bellagio/);
  assert.match(vercel, /\/estate\/rhine-garden/);
});

test("estate summary queries canonicalize legacy database slugs", () => {
  const queries = read("src/lib/queries.ts");
  const fetchEstatesBody = queries.slice(
    queries.indexOf("export async function fetchEstates"),
    queries.indexOf("export async function fetchEstateBySlug"),
  );
  const fetchEstateBySlugBody = queries.slice(
    queries.indexOf("export async function fetchEstateBySlug"),
    queries.indexOf("async function fetchFaqsByScope"),
  );

  assert.match(queries, /function canonicalEstateSlug/);
  assert.match(queries, /function estateSlugCandidates/);
  assert.match(fetchEstatesBody, /withCanonicalSlug/);
  assert.match(fetchEstatesBody, /fetchNeonEstates/);
  assert.match(fetchEstateBySlugBody, /estateSlugCandidates\(slug\)/);
  assert.doesNotMatch(fetchEstateBySlugBody, /ESTATE_DB_SLUG_FALLBACKS\[slug\]/);
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
  const detail = read("src/routes/blog_.$slug.tsx");
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
  const tingKauRedirect = read("src/routes/district.ting-kau.tsx");
  const corridorContent = read("src/content/castle-peak-road.ts");
  const about = read("src/routes/about.tsx");

  assert.match(shamTseng, /西半山平民海景區/);
  assert.match(tsuenWan, /港鐵荃灣綫總站/);
  assert.match(tingKauRedirect, /\/castle-peak-road\/\$segment/);
  assert.match(corridorContent, /低密度別墅/);
  assert.match(about, /全部真盤/);
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

test("listing queries require the Neon MLS schema", () => {
  const queries = read("src/lib/queries.ts");

  assert.doesNotMatch(queries, /retryWithoutMlsColumns/);
  assert.match(queries, /legacy_detail_id|last_seen_at|source_site/);
});

test("public listing queries use Neon server functions only", () => {
  const queries = read("src/lib/queries.ts");
  const neonClient = read("src/lib/neon/public-data.ts");
  const neonServer = read("src/lib/neon/public-data.server.ts");
  const neonDb = read("src/lib/neon/db.server.ts");

  assert.match(neonServer, /@tanstack\/react-start\/server-only/);
  assert.match(neonDb, /@neondatabase\/serverless/);
  assert.match(neonDb, /DATABASE_URL/);

  assert.match(neonClient, /createServerFn/);
  assert.match(neonClient, /searchNeonListings/);
  assert.match(neonClient, /fetchNeonPropertyByListingNo/);

  assert.match(queries, /searchNeonListings/);
  assert.match(queries, /fetchNeonFeaturedProperties/);
  assert.doesNotMatch(queries, /Supabase/i);
  assert.doesNotMatch(queries, /Promise\.race/);
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

test("root and public trust pages use localized first-party metadata", () => {
  const root = read("src/routes/__root.tsx");
  const home = read("src/routes/index.tsx");
  const contact = read("src/routes/contact.tsx");
  const agents = read("src/routes/agents.tsx");

  assert.match(root, /<html lang=["']zh-HK["']/);
  assert.match(root, /SITE_OG_IMAGE/);
  assert.match(home, /RealEstateAgent/);
  assert.match(contact, /聯絡晉誠地產/);
  assert.match(agents, /持牌/);
});
