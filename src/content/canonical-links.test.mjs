import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("canonicalLink is a bare-path helper, not a root-level canonical", () => {
  const seo = read("src/content/seo.ts");
  assert.match(seo, /export function canonicalLink\(path: string\)/);
  assert.match(seo, /rel: "canonical", href: `\$\{SITE_URL\}\$\{path\}`/);

  const root = read("src/routes/__root.tsx");
  assert.doesNotMatch(
    root,
    /canonicalLink/,
    "a root-level canonical would stamp the homepage URL onto every page",
  );
});

// P7a: castle-peak-road.index, castle-peak-road.$segment, and
// district.tsuen-wan were the last 3 routes still inlining a raw
// `{ rel: "canonical", href: ... }` object instead of calling the helper --
// district.sham-tseng was fixed alongside them (now `canonicalLink`, not the
// `seo()` combinator, since its og:title/og:description genuinely differ
// from its meta title/description).
test("every public route emits a canonical link", () => {
  const staticRoutes = [
    ["src/routes/index.tsx", "canonicalLink(pageSeo.home.path)"],
    ["src/routes/about.tsx", "canonicalLink(pageSeo.about.path)"],
    ["src/routes/contact.tsx", "canonicalLink(pageSeo.contact.path)"],
    ["src/routes/agents.tsx", 'canonicalLink("/agents")'],
    ["src/routes/blog.tsx", "canonicalLink(pageSeo.blog.path)"],
    [
      "src/routes/blog_.editorial-standards.tsx",
      "canonicalLink(pageSeo.blogEditorialStandards.path)",
    ],
    ["src/routes/videos.tsx", 'canonicalLink("/videos")'],
    ["src/routes/transactions.tsx", 'canonicalLink("/transactions")'],
    ["src/routes/estate-reviews.tsx", 'canonicalLink("/estate-reviews")'],
    ["src/routes/privacy.tsx", "canonicalLink(pageSeo.privacy.path)"],
    ["src/routes/disclaimer.tsx", "canonicalLink(pageSeo.disclaimer.path)"],
    ["src/routes/terms.tsx", "canonicalLink(pageSeo.terms.path)"],
    ["src/routes/district.sham-tseng.tsx", "canonicalLink(pageSeo.shamTseng.path)"],
  ];
  for (const [file, expected] of staticRoutes) {
    assert.ok(read(file).includes(expected), `${file} should emit ${expected}`);
  }

  // Query-bearing routes must canonicalise to the bare path, not fork per filter.
  assert.match(read("src/routes/listings.tsx"), /canonicalLink\(pageSeo\.listings\.path\)/);
  assert.match(read("src/routes/mortgage.tsx"), /canonicalLink\("\/mortgage"\)/);

  // Dynamic-slug routes build their own canonical from loaderData, not a
  // hardcoded pageSeo path.
  assert.match(
    read("src/routes/estate.$slug.tsx"),
    /canonicalLink\(`\/estate\/\$\{loaderData\.estate\.slug\}`\)/,
  );
  assert.match(
    read("src/routes/agents_.$slug.tsx"),
    /canonicalLink\(`\/agents\/\$\{profile\.public_slug\}`\)/,
  );
  assert.match(
    read("src/routes/blog_.$slug.tsx"),
    /canonicalLink\(`\/blog\/\$\{loaderData\.slug\}`\)/,
  );
  assert.match(
    read("src/routes/property.$listingNo.tsx"),
    /canonicalLink\(`\/property\/\$\{p\.listing_no\}`\)/,
  );
});

// P7a: these 3 routes adopt the seo() combinator, which calls canonicalLink()
// internally (see seo.ts) -- their own source calls seo({ path: ... }), not
// canonicalLink() directly, so they need their own assertions rather than
// fitting the literal-string check above.
test("castle-peak-road and tsuen-wan routes emit a canonical via the seo() combinator", () => {
  const indexSource = read("src/routes/castle-peak-road.index.tsx");
  assert.match(indexSource, /seo\(\{/);
  assert.match(indexSource, /path: castlePeakRoadHub\.path/);
  assert.doesNotMatch(indexSource, /rel: "canonical", href: `\$\{SITE_URL\}/);

  const segmentSource = read("src/routes/castle-peak-road.$segment.tsx");
  assert.match(segmentSource, /seo\(\{/);
  assert.match(segmentSource, /path: loaderData\?\.segment\.path \?\? castlePeakRoadHub\.path/);
  assert.doesNotMatch(segmentSource, /rel: "canonical", href: `\$\{SITE_URL\}/);

  const tsuenWanSource = read("src/routes/district.tsuen-wan.tsx");
  assert.match(tsuenWanSource, /seo\(\{/);
  assert.match(tsuenWanSource, /path: pageSeo\.tsuenWan\.path/);
  assert.match(
    tsuenWanSource,
    /noindex: true/,
    "district.tsuen-wan is orphaned (no nav/sitemap entry) -- must stay noindexed",
  );
  assert.doesNotMatch(tsuenWanSource, /rel: "canonical", href: `\$\{SITE_URL\}/);
});
