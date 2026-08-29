import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test } from "node:test";

// The corridor registry is plain data with no imports, so it can be loaded
// directly under Node's native type stripping (>= 22.18). Importing it means the
// zone/redirect assertions below run against the real exported values instead of
// grepping the source text, which is what let the previous five-zone assertions
// pass while the rendered page said something else.
//
// This is deliberately only true of the *data* assertions. The route files are
// .tsx and cannot be imported or rendered under `node --test`, so the wiring
// checks further down still read them as source text. That is a weaker guard and
// is called out where it happens rather than dressed up as behavioural coverage.
import {
  castlePeakRoadHub,
  castlePeakRoadSegments,
  castlePeakRoadSitemapPaths,
  corridorRegionScope,
  getCastlePeakRoadSegment,
  isWithinCorridorRegion,
} from "./castle-peak-road.ts";
import { renderableFaqs } from "../lib/faq.ts";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

// The five-zone structure shipped with these slugs. Three of them no longer
// have a page, and all three were live URLs, so they are the redirect
// contract this suite guards rather than an implementation detail.
// so-kwun-wat-gold-coast (小欖/掃管笏/三聖, including Gold Coast) was retired
// separately from the original five-to-three collapse: it further narrowed
// scope to just 深井/青山公路/汀九.
const RETIRED_SEGMENT_SLUGS = ["tsuen-wan-yau-kom-tau", "tsing-lung-tau", "so-kwun-wat-gold-coast"];

const surviving = castlePeakRoadSegments.map((segment) => segment.slug);
const survivingPaths = castlePeakRoadSegments.map((segment) => segment.path);

function parseRedirects() {
  const source = read("vercel.ts");
  return [...source.matchAll(/redirectEntry\(\s*"([^"]+)",\s*"([^"]+)",\s*(true|false)/g)].map(
    ([, from, to, permanent]) => ({ from, to, permanent: permanent === "true" }),
  );
}

function collectFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      collectFiles(full, files);
      continue;
    }
    if (/\.(ts|tsx|mjs|js)$/.test(entry) && !entry.includes(".test.")) files.push(full);
  }
  return files;
}

test("the corridor is split into exactly the two client-approved lifestyle zones", () => {
  assert.deepEqual(surviving, ["ting-kau", "sham-tseng"]);
  assert.deepEqual(
    castlePeakRoadSegments.map((segment) => segment.nameZh),
    ["油柑頭 汀九", "深井 / 青山公路"],
  );

  for (const segment of castlePeakRoadSegments) {
    assert.equal(segment.path, `/castle-peak-road/${segment.slug}`);
    assert.equal(getCastlePeakRoadSegment(segment.slug), segment);
    assert.ok(segment.zoneSummary.length > 0, `${segment.slug} needs zone card copy`);
    assert.ok(
      segment.zoneSummary.every((paragraph) => paragraph.trim().length > 0),
      `${segment.slug} zone copy must not contain empty paragraphs`,
    );
    assert.ok(segment.textAliases.length > 0, `${segment.slug} needs listing aliases`);
    assert.ok(segment.faqs.length > 0, `${segment.slug} needs FAQ content`);
    // Same non-empty rule as the zone copy above: a blank answer renders an empty
    // <p> and, worse, an empty `acceptedAnswer.text` in the FAQPage schema.
    assert.ok(
      segment.faqs.every((faq) => faq.question.trim().length > 0 && faq.answer.trim().length > 0),
      `${segment.slug} FAQ entries must all carry a question and an answer`,
    );
  }

  assert.ok(
    castlePeakRoadHub.faqs.every(
      (faq) => faq.question.trim().length > 0 && faq.answer.trim().length > 0,
    ),
    "hub FAQ entries must all carry a question and an answer",
  );

  assert.equal(getCastlePeakRoadSegment("tsing-lung-tau"), null);
  assert.equal(castlePeakRoadHub.launchName, "Core Corridor Launch");
});

test("the 深井 / 青山公路 zone ships only the copy the client actually supplied", () => {
  const shamTseng = getCastlePeakRoadSegment("sham-tseng");

  // The docx (p57) read "……..，車位比例高，租售價錢十分相宜"; the client supplied the
  // missing clauses on 2026-07-29. Pinning the exact approved wording is what stops
  // this card being silently truncated back to the fragment.
  assert.deepEqual(shamTseng.zoneSummary, [
    "深井是青山公路最成熟的海景住宅生活圈，屋苑規模、巴士小巴、餐飲和日常配套都比汀九集中。",
    "碧堤半島、浪翠園、麗都花園、海韻花園與周邊屋苑形成穩定自住及租務市場，車位比例高，租售價錢十分相宜",
  ]);
  assert.ok(
    shamTseng.zoneSummary.every((paragraph) => !paragraph.includes("……")),
    "the placeholder ellipsis must not reach the rendered card",
  );

  // Element-wise, not deepEqual: an earlier pass filled the gap by pasting a page's
  // own intro sentences into its zone card and calling them client copy. 深井 is
  // exempt because the client's supplied opener genuinely is `intro[0]` — its exact
  // wording is pinned by the deepEqual above, which is the stronger guard.
  for (const segment of castlePeakRoadSegments) {
    if (segment.slug === "sham-tseng") continue;
    for (const paragraph of segment.zoneSummary) {
      assert.ok(
        !segment.intro.includes(paragraph),
        `${segment.slug} zone copy must be the client's own text, not recycled intro copy`,
      );
    }
  }
});

test("blank FAQ answers never reach a rendered list or FAQPage schema", () => {
  const rows = [
    { question: "有答案", answer: "有內容" },
    { question: "無答案", answer: "" },
    { question: "空白答案", answer: "   \n  " },
    { question: "   ", answer: "有內容但無問題" },
  ];

  assert.deepEqual(renderableFaqs(rows), [{ question: "有答案", answer: "有內容" }]);
  assert.deepEqual(renderableFaqs([]), []);
  // Nothing valid is dropped: over-filtering would silently delete live FAQ copy.
  assert.deepEqual(renderableFaqs(castlePeakRoadHub.faqs), castlePeakRoadHub.faqs);
  for (const segment of castlePeakRoadSegments) {
    assert.deepEqual(renderableFaqs(segment.faqs), segment.faqs);
  }
});

// Source-text check: these are .tsx and cannot be rendered under `node --test`.
// It guards the wiring, not the output — every FAQ surface must run its array
// through the shared filter and gate the JSON-LD on the filtered length, because
// each one feeds the same array to both the visible list and `mainEntity`.
test("every FAQ surface filters blanks and gates its FAQPage schema", () => {
  // The gated element differs by page — four wrap the <script> directly, the
  // homepage wraps the whole <section> that contains it — so the shape is spelled
  // out per file rather than guessed with a proximity window.
  const surfaces = {
    "src/routes/index.tsx": /\{faqs\.length > 0 && \(\s*<section/,
    "src/routes/estate.$slug.tsx": /\{visibleFaqs\.length > 0 && \(\s*<script/,
    "src/routes/district.sham-tseng.tsx": /\{faqs\.length > 0 && \(\s*<script/,
    "src/routes/castle-peak-road.index.tsx": /\{faqs\.length > 0 && \(\s*<script/,
    "src/routes/castle-peak-road.$segment.tsx": /\{faqs\.length > 0 && \(\s*<script/,
  };

  for (const [path, gate] of Object.entries(surfaces)) {
    const source = read(path);
    assert.match(source, /import \{ renderableFaqs \} from "@\/lib\/faq"/, `${path} must filter`);
    assert.match(source, /renderableFaqs\(/, `${path} must apply the filter`);
    assert.notEqual(source.indexOf('"@type": "FAQPage"'), -1, `${path} still needs FAQ schema`);
    assert.match(source, gate, `${path} must not emit FAQPage with an empty mainEntity`);
    // The raw loader rows must never be rendered alongside the filtered array.
    assert.doesNotMatch(source, /faqRows\.map/, `${path} must render the filtered array`);
  }
});

test("the hub guidance sentence routes buyers into both surviving zones", () => {
  const guidance = castlePeakRoadHub.faqs.map((faq) => faq.answer).join("\n");

  assert.match(
    guidance,
    /可以先由油柑頭\/汀九，深井\/青龍頭段入手，再按交通、校網、樓齡、海景和放盤量收窄選擇。/,
  );
  // so-kwun-wat-gold-coast is retired; the guidance must not still send buyers there.
  assert.doesNotMatch(guidance, /小欖|掃管笏|三聖/);

  // Every zone must be reachable from the sentence: take the leading place name
  // off each zone title and require it to appear, so renaming a zone without
  // rewriting the guidance fails here.
  for (const segment of castlePeakRoadSegments) {
    const leadName = segment.nameZh.split(/[\s/]+/)[0];
    assert.ok(guidance.includes(leadName), `guidance should send buyers to ${segment.nameZh}`);
  }

  const intro = castlePeakRoadHub.intro.join("\n");
  assert.match(intro, /分成三個買家容易理解的生活圈/);
  assert.doesNotMatch(intro, /分成五個/);
});

test("retired zone URLs 301 to a surviving zone and are never canonical", () => {
  const redirects = parseRedirects();

  for (const slug of RETIRED_SEGMENT_SLUGS) {
    assert.equal(getCastlePeakRoadSegment(slug), null, `${slug} should no longer have a page`);

    for (const source of [`/castle-peak-road/${slug}`, `/castle-peak-road/${slug}/`]) {
      const redirect = redirects.find((entry) => entry.from === source);
      assert.ok(redirect, `${source} must 301 instead of 404`);
      assert.equal(redirect.permanent, true);
      assert.ok(
        survivingPaths.includes(redirect.to),
        `${source} must land on a surviving zone, got ${redirect.to}`,
      );
    }
  }

  // The /district/ting-kau regression: a URL must never be both a redirect
  // source and an advertised canonical.
  for (const path of [...survivingPaths, castlePeakRoadHub.path]) {
    assert.ok(
      !redirects.some((entry) => entry.from === path || entry.from === `${path}/`),
      `${path} is canonical, so it must not also redirect`,
    );
    assert.ok(castlePeakRoadSitemapPaths.includes(path), `${path} should be in the sitemap`);
  }

  for (const slug of RETIRED_SEGMENT_SLUGS) {
    assert.ok(
      !castlePeakRoadSitemapPaths.includes(`/castle-peak-road/${slug}`),
      `${slug} must be dropped from the sitemap`,
    );
  }
});

test("nothing in src links into a retired corridor URL", () => {
  const dir = new URL("../../src", import.meta.url).pathname;
  const offenders = [];

  for (const file of collectFiles(dir)) {
    const source = readFileSync(file, "utf8");
    for (const [, slug] of source.matchAll(/\/castle-peak-road\/([A-Za-z0-9$-]+)/g)) {
      if (slug === "$segment" || surviving.includes(slug)) continue;
      offenders.push(`${file.replace(dir, "src")} → /castle-peak-road/${slug}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test("region whitelist keeps out-of-corridor listings off the homepage", () => {
  assert.deepEqual(corridorRegionScope.labels, ["深井", "青山公路", "汀九", "青龍頭", "油柑頭"]);

  // The listing the client flagged: 大欖涌, 屯門 falls back to tsuen-wan in the
  // MLS normaliser, so both the slug and the place name have to be rejected.
  assert.equal(
    isWithinCorridorRegion({
      districtSlug: "tsuen-wan",
      text: ["大欖涌半山 售盤", "青山公路大欖涌段, 屯門"],
    }),
    false,
  );
  assert.equal(
    isWithinCorridorRegion({ districtSlug: "castle-peak-road", text: ["屯門三聖邨 租盤"] }),
    false,
  );
  assert.equal(isWithinCorridorRegion({ districtSlug: "tuen-mun", text: ["某某花園"] }), false);
  assert.equal(
    isWithinCorridorRegion({ districtSlug: "tsuen-wan", text: ["荃灣中心 售盤"] }),
    false,
  );

  for (const districtSlug of corridorRegionScope.districtSlugs) {
    assert.equal(
      isWithinCorridorRegion({ districtSlug, text: ["某某大廈 售盤"] }),
      true,
      `${districtSlug} is inside the client's scope`,
    );
  }

  // 油柑頭 stock is normalised to tsuen-wan, so it only survives via the name.
  assert.equal(isWithinCorridorRegion({ districtSlug: "tsuen-wan", text: ["海雲軒 售盤"] }), true);
  assert.equal(
    isWithinCorridorRegion({ districtSlug: "tsuen-wan", text: ["油柑頭青山公路 售盤"] }),
    true,
  );

  // An estate the corridor already owns outranks any name-based guard.
  assert.equal(
    isWithinCorridorRegion({ estateSlug: "hong-kong-garden", text: ["豪景花園 售盤"] }),
    true,
  );
});

test("the whitelist is enforced at the consumer, not inside the listing API", () => {
  const queries = read("src/lib/queries.ts");
  const server = read("src/lib/neon/public-data.server.ts");

  assert.match(queries, /import \{ isWithinCorridorRegion \} from "@\/content\/castle-peak-road"/);

  const featured = queries.slice(
    queries.indexOf("export async function fetchFeaturedProperties"),
    queries.indexOf("export type DistrictTransaction"),
  );
  const estates = queries.slice(
    queries.indexOf("export async function fetchEstatesByDistrict"),
    queries.indexOf("export async function fetchEstateBySlug"),
  );

  assert.match(featured, /isWithinCorridorRegion\(/);
  assert.match(estates, /isWithinCorridorRegion\(/);

  // The listing API and the MLS scraper are off limits, so the filter must not
  // have leaked into them.
  assert.doesNotMatch(server, /isWithinCorridorRegion|corridorRegionScope/);
});

test("district entry links are exactly the three the client approved", () => {
  const header = read("src/components/site/SiteHeader.tsx");
  const footer = read("src/components/site/SiteFooter.tsx");

  const labels = ["深井區買樓租樓", "青山公路區買樓租樓", "汀九豪宅區買樓租樓"];

  for (const source of [header, footer]) {
    for (const label of labels) {
      assert.equal(source.includes(label), true, `${label} should be a district entry`);
    }
    // The superseded labels must be gone, otherwise the old and new wording ship
    // side by side.
    assert.equal(source.includes("汀九地區頁"), false);
    assert.equal(source.includes("荃灣 Tsuen Wan"), false);
  }
});

test("segment registry carries live listing aliases and FAQ content", () => {
  const source = read("src/content/castle-peak-road.ts");

  for (const token of [
    "districtSlugs",
    "estateSlugs",
    "textAliases",
    "featuredEstates",
    "faqs",
    "castlePeakRoadSitemapPaths",
  ]) {
    assert.match(source, new RegExp(token));
  }

  assert.match(source, /C-018613/);
  assert.match(source, /school net 62|62 校網/);
  assert.match(source, /export type CorridorHub/);
  assert.match(source, /satisfies CorridorHub/);
  assert.match(source, /getCastlePeakRoadSegment\(slug: string\): CorridorSegment \| null/);

  const tingKau = getCastlePeakRoadSegment("ting-kau");
  // 油柑頭 was folded into this zone; without these aliases its inventory
  // (海雲軒 / 縉皇居, both normalised to tsuen-wan) disappears from the corridor.
  for (const alias of ["油柑頭", "Yau Kom Tau", "海雲軒", "縉皇居"]) {
    assert.ok(tingKau.textAliases.includes(alias), `ting-kau should still match ${alias}`);
  }
  assert.ok(!tingKau.districtSlugs.includes("tsuen-wan"));
  for (const estate of ["觀海別墅", "嘉御龍庭", "汀九別墅"]) {
    assert.ok(tingKau.featuredEstates.some((name) => name.includes(estate)));
  }

  const shamTseng = getCastlePeakRoadSegment("sham-tseng");
  // 青龍頭 was folded in here, so both its district slug and its estate must ride along.
  assert.ok(shamTseng.districtSlugs.includes("tsing-lung-tau"));
  assert.ok(shamTseng.estateSlugs.includes("hong-kong-garden"));

  // so-kwun-wat-gold-coast (小欖/掃管笏/三聖) is retired -- see the
  // "retired zone URLs 301" test for its redirect/sitemap/getCastlePeakRoadSegment
  // coverage.
});

test("Ting Kau's strict alias set excludes the castle-peak-road catch-all and the dead yau-kom-tau slug", () => {
  const tingKau = castlePeakRoadSegments.find((s) => s.slug === "ting-kau");
  assert.ok(tingKau);
  assert.deepStrictEqual(tingKau.districtSlugs, ["ting-kau"]);
  assert.ok(!tingKau.districtSlugs.includes("castle-peak-road"));
  assert.ok(!tingKau.districtSlugs.includes("yau-kom-tau"));
});

test("Ting Kau's nearby set carries the castle-peak-road catch-all", () => {
  const tingKau = castlePeakRoadSegments.find((s) => s.slug === "ting-kau");
  assert.ok(tingKau);
  assert.deepStrictEqual(tingKau.nearbyDistrictSlugs, ["castle-peak-road"]);
});

test("every segment declares nearby alias arrays, even when empty", () => {
  for (const segment of castlePeakRoadSegments) {
    assert.ok(Array.isArray(segment.nearbyDistrictSlugs));
    assert.ok(Array.isArray(segment.nearbyEstateSlugs));
    assert.ok(Array.isArray(segment.nearbyTextAliases));
  }
});

test("corridor inventory uses Neon alias query with public query wrapper", () => {
  const server = read("src/lib/neon/public-data.server.ts");
  const client = read("src/lib/neon/public-data.ts");
  const types = read("src/lib/neon/public-data.types.ts");
  const queries = read("src/lib/queries.ts");

  assert.match(types, /NeonCorridorInventoryInput/);
  assert.match(types, /NeonCorridorInventoryResult/);
  assert.match(server, /export async function fetchCorridorInventory/);
  assert.match(server, /unnest/);
  assert.match(server, /ILIKE|lower/);
  assert.match(client, /fetchNeonCorridorInventory/);
  assert.match(queries, /fetchCorridorInventoryForAliases/);
  assert.doesNotMatch(queries, /Supabase/i);
});

test("corridor inventory guards empty aliases and SQL wildcard matching", () => {
  const server = read("src/lib/neon/public-data.server.ts");
  const queries = read("src/lib/queries.ts");

  assert.match(server, /emptyCorridorInventory/);
  assert.match(server, /escapeLikeTerm/);
  assert.match(server, /ESCAPE/);
  assert.match(server, /hasCorridorAliases/);

  assert.match(queries, /emptyCorridorInventory/);
  assert.match(queries, /normalizeCorridorInventoryInput/);
  assert.match(queries, /Math\.min\(Math\.max\(1, .*?\), 24\)/);
  assert.match(queries, /hasCorridorAliases/);
});

test("corridor inventory stays on Neon and avoids legacy fallback paths", () => {
  const queries = read("src/lib/queries.ts");

  assert.match(queries, /fetchNeonCorridorInventory/);
  assert.doesNotMatch(queries, /Supabase/i);
  assert.doesNotMatch(queries, /dedupeListingKeys/);
});

test("castle peak road hub and segment routes render content, inventory, and schema", () => {
  const layout = read("src/routes/castle-peak-road.tsx");
  const hub = read("src/routes/castle-peak-road.index.tsx");
  const segment = read("src/routes/castle-peak-road.$segment.tsx");
  const inventory = read("src/components/site/CorridorInventory.tsx");

  assert.match(layout, /createFileRoute\(["']\/castle-peak-road["']\)/);
  assert.match(layout, /<Outlet \/>/);
  assert.match(hub, /createFileRoute\(["']\/castle-peak-road\/["']\)/);
  assert.match(segment, /createFileRoute\(["']\/castle-peak-road\/\$segment["']\)/);
  assert.match(hub, /castlePeakRoadHub/);
  // Source-text check, not a render: .tsx cannot be imported here. It guards that
  // the zone card still maps the client's paragraphs, so a multi-paragraph zone
  // shows as paragraphs rather than one run-on line.
  assert.match(hub, /segment\.zoneSummary\.map/);
  assert.match(segment, /getCastlePeakRoadSegment/);
  assert.match(hub, /fetchCorridorInventoryForAliases/);
  assert.match(segment, /fetchCorridorInventoryForAliases/);
  assert.match(inventory, /saleTotal/);
  assert.match(inventory, /rentTotal/);
  assert.match(segment, /BreadcrumbList/);
  assert.match(segment, /FAQPage/);
  assert.match(segment, /ItemList/);
});

test("castle peak road routes avoid nested main landmarks and define route errors", () => {
  const hub = read("src/routes/castle-peak-road.index.tsx");
  const segment = read("src/routes/castle-peak-road.$segment.tsx");

  assert.doesNotMatch(hub, /<main className="bg-background">/);
  assert.doesNotMatch(segment, /<main className="bg-background">/);
  assert.match(hub, /errorComponent:\s*CastlePeakRoadRouteError/);
  assert.match(segment, /errorComponent:\s*CastlePeakRoadSegmentError/);
  assert.match(hub, /useRouter\(\)/);
  assert.match(segment, /useRouter\(\)/);
  assert.match(hub, /載入青山公路總覽時遇到問題/);
  assert.match(segment, /載入青山公路分段時遇到問題/);
});

test("castle peak road links and media use route-aware safeguards", () => {
  const segment = read("src/routes/castle-peak-road.$segment.tsx");
  const inventory = read("src/components/site/CorridorInventory.tsx");

  assert.doesNotMatch(segment, /district=\$\{segment\.districtSlugs\[0\]/);
  assert.match(segment, /function getSegmentListingsHref/);
  assert.match(segment, /const supportedListingDistrictSlugs/);
  assert.match(segment, /function CorridorRelatedLink/);
  assert.doesNotMatch(segment, /<a\s+key=\{link\.href\}/);
  assert.match(inventory, /function ListingHrefLink/);
  assert.doesNotMatch(inventory, /<a href=\{listingsHref\}/);
  assert.match(segment, /target="_blank"/);
  assert.match(segment, /rel="noopener noreferrer"/);
  // ListingMiniCard's cover image renders via AppImage, which defaults loading
  // to "lazy" and decoding to "async" internally (see
  // src/components/media/AppImage.tsx), so the literal attributes no longer
  // appear in this file's source -- assert the component is used instead.
  assert.match(inventory, /<AppImage\b/);
});

test("canonical links, redirects, and sitemap use castle peak road routes", () => {
  const seo = read("src/content/seo.ts");
  const vercel = read("vercel.ts");
  const layoutRoute = read("src/routes/castle-peak-road.tsx");
  const hubRoute = read("src/routes/castle-peak-road.index.tsx");
  const segmentRoute = read("src/routes/castle-peak-road.$segment.tsx");
  const tingKauRoute = read("src/routes/district.ting-kau.tsx");
  const tsuenWanRoute = read("src/routes/district.tsuen-wan.tsx");
  const shamTsengRoute = read("src/routes/district.sham-tseng.tsx");
  const header = read("src/components/site/SiteHeader.tsx");
  const footer = read("src/components/site/SiteFooter.tsx");
  const sitemap = read("src/routes/sitemap[.]xml.ts");

  assert.match(seo, /castlePeakRoad/);
  assert.match(seo, /path:\s*"\/castle-peak-road\/ting-kau"/);
  assert.match(vercel, /\/district\/ting-kau/);
  assert.match(vercel, /\/district\/ting-kau\//);
  assert.match(vercel, /\/castle-peak-road\/ting-kau/);
  assert.match(hubRoute, /rel:\s*["']canonical["']/);
  assert.match(hubRoute, /SITE_URL/);
  assert.match(hubRoute, /castlePeakRoadHub\.path/);
  assert.match(layoutRoute, /<Outlet \/>/);
  assert.doesNotMatch(layoutRoute, /rel:\s*["']canonical["']/);
  assert.match(segmentRoute, /rel:\s*["']canonical["']/);
  assert.match(segmentRoute, /loaderData\?\.segment\.path/);
  assert.match(segmentRoute, /castlePeakRoadHub\.path/);
  assert.match(tingKauRoute, /redirect/);
  assert.match(tingKauRoute, /\/castle-peak-road\/\$segment/);
  assert.match(tingKauRoute, /statusCode:\s*(301|308)/);
  assert.match(tsuenWanRoute, /rel:\s*["']canonical["']/);
  assert.match(tsuenWanRoute, /pageSeo\.tsuenWan\.path/);
  assert.match(tsuenWanRoute, /\/castle-peak-road/);
  assert.match(shamTsengRoute, /rel:\s*["']canonical["']/);
  assert.match(shamTsengRoute, /pageSeo\.shamTseng\.path/);
  assert.match(shamTsengRoute, /\/castle-peak-road/);
  assert.match(header, /青山公路/);
  // Typed <Link> to a param route, so the slug appears in params rather than as
  // a literal path. What matters is that it targets the corridor page and not
  // the legacy /district/ting-kau URL, which 301s.
  assert.match(footer, /segment:\s*["']ting-kau["']/);
  assert.doesNotMatch(footer, /to="\/district\/ting-kau"/);
  assert.match(sitemap, /sitemap\.xml/);
  assert.match(sitemap, /castlePeakRoadSitemapPaths/);
  assert.match(sitemap, /function escapeXml/);
  assert.match(sitemap, /escapeXml\(\`\$\{SITE_URL\}\$\{path\}\`\)/);
});
