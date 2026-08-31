import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Plain data modules with no imports of their own (see each file's header
// comment), so -- like castle-peak-road.test.mjs already does for the same
// module -- they can be imported directly under Node's native TS stripping,
// letting the P4 Task 4 tests below prove real behavior instead of grepping.
import { findCastlePeakRoadSegmentByDistrictSlug } from "./castle-peak-road.ts";
import { getSchoolNet } from "./school-nets.ts";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

// Extracts and actually executes estate.$slug.tsx's head() function (mirrors
// the extraction pattern already established in
// src/routes/property.listing-detail.contract.test.mjs) so Task 3's
// seo_title/seo_description override chain (DR-10) is proven by real
// execution, not just a string match against the source text.
function transpileAndRun(snippet) {
  const { outputText } = ts.transpileModule(snippet, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const exportsObj = {};
  new Function("exports", outputText)(exportsObj);
  return exportsObj;
}

function buildEstateHead(routeSource) {
  const startNeedle = "head: ({ loaderData }) => {";
  const bodyStart = routeSource.indexOf(startNeedle) + startNeedle.length;
  assert.ok(bodyStart > startNeedle.length - 1, "expected the route head()");
  const endMarker = "\n  },\n  errorComponent:";
  const bodyEnd = routeSource.indexOf(endMarker, bodyStart);
  assert.ok(bodyEnd !== -1, "expected head() to close before errorComponent");
  const body = routeSource.slice(bodyStart, bodyEnd);

  const snippet = `
const estateSeo = {
  "with-seo": { title: "registry title", description: "registry description" },
  "no-seo": {},
};
function canonicalLink(path) {
  return { rel: "canonical", href: "https://example.test" + path };
}
function head({ loaderData }) {
  ${body}
}
exports.head = head;
`;
  return transpileAndRun(snippet).head;
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

// Locates an estate's content block by its object key (e.g. `bellagio: {` or
// `"sea-crest-villa": {`) rather than a literal `slug: "..."` field. DR-10
// moved slug/nameZh/nameEn to be sourced from estate-registry.ts via a spread
// (`...estatePageIdentity(slug)`), so `slug: "..."` no longer appears as
// literal source text here -- the object key itself is still literal source
// text either way, so it stays a reliable anchor for this source-text-based
// test.
function estateBlock(source, slug) {
  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(slug) ? slug : JSON.stringify(slug);
  const keyIndex = source.indexOf(`${key}: {`);
  assert.notEqual(keyIndex, -1, `${slug} block not found`);

  const blockStart = source.indexOf("{", keyIndex);
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

test("estate conversion registry includes factual trust proof and no 28Hse dependency", () => {
  const source = read("src/content/estate-pages.ts");

  assert.match(source, /C-018613/);
  assert.match(source, /深井麗都花園地下5A舖/);
  assert.match(source, /2688 2988/);
  assert.match(source, /agentDirectoryHref: "\/agents"/);
  assert.equal(/28hse/i.test(source), false);
  assert.equal(/Google review|testimonial|五星|客戶好評/.test(source), false);
});

// Same char-code spelling as the site-wide guard in src/config/site.test.mjs, so
// the banned phrases never appear as literals anywhere the repo-wide grep looks.
test("estate conversion source avoids the older disallowed listing wording", () => {
  const forbidden = [
    String.fromCharCode(30495, 30436, 28304),
    String.fromCharCode(22533, 30436, 28304),
    String.fromCharCode(21313, 22810, 24180),
  ];
  const source = read("src/content/estate-pages.ts");
  for (const phrase of forbidden) {
    assert.equal(source.includes(phrase), false, `${phrase} is no longer approved copy`);
  }
});

test("conversion components use intent helpers and factual proof", () => {
  const intent = read("src/components/site/IntentWhatsAppCTA.tsx");
  const fallback = read("src/components/site/SearchFallbackCTA.tsx");
  const owner = read("src/components/site/OwnerValuationPanel.tsx");
  const trust = read("src/components/site/TrustProofPanel.tsx");
  const snapshot = read("src/components/site/EstateMarketSnapshot.tsx");

  assert.match(intent, /whatsappIntentUrl/);
  assert.match(intent, /我要買樓/);
  assert.match(intent, /我要租樓/);
  assert.match(intent, /我要放盤估價/);
  assert.match(fallback, /搵唔到心水盤/);
  assert.match(fallback, /type WhatsAppIntent/);
  assert.match(fallback, /intent\?: Exclude<WhatsAppIntent, "valuation">/);
  assert.match(fallback, /whatsappIntentUrl\(intent/);
  assert.match(owner, /深井業主估價報告/);
  assert.match(trust, /earnestPublicTrust/);
  assert.match(trust, /earnestPublicTrust\.licenceNo/);
  assert.match(snapshot, /成交資料/);
  assert.match(snapshot, /fetchEstateTransactions|EstateTransaction/);
  assert.match(snapshot, /最新顯示售盤/);
  assert.match(snapshot, /最新顯示租盤/);
  assert.doesNotMatch(snapshot, /公開售盤/);
  assert.doesNotMatch(snapshot, /公開租盤/);
});

test("conversion components avoid nested anchors and handle unknown market data", () => {
  const intent = read("src/components/site/IntentWhatsAppCTA.tsx");
  const fallback = read("src/components/site/SearchFallbackCTA.tsx");
  const owner = read("src/components/site/OwnerValuationPanel.tsx");
  const trust = read("src/components/site/TrustProofPanel.tsx");
  const snapshot = read("src/components/site/EstateMarketSnapshot.tsx");

  for (const source of [intent, fallback, owner]) {
    assert.match(source, /<Button[^>]*asChild/);
    assert.doesNotMatch(source, /<a[\s\S]*?<Button/);
  }

  assert.match(intent, /compact \? "grid-cols-1" : "sm:grid-cols-3"/);
  assert.doesNotMatch(trust, /publicLicenceNo/);
  assert.doesNotMatch(trust, /C-018613/);
  assert.doesNotMatch(snapshot, /totalUnits \?\? 0/);
  assert.match(snapshot, /待查/);
  assert.match(snapshot, /overflow-x-auto/);
  assert.match(snapshot, /min-w-\[/);
});

test("estate route renders conversion seo sections", () => {
  const route = read("src/routes/estate.$slug.tsx");

  assert.match(route, /fetchEstateTransactions/);
  assert.match(route, /getEstatePageContent/);
  assert.match(route, /EstateMarketSnapshot/);
  assert.match(route, /IntentWhatsAppCTA/);
  assert.match(route, /OwnerValuationPanel/);
  assert.match(route, /SearchFallbackCTA/);
  assert.match(route, /TrustProofPanel/);
  assert.match(route, /優點/);
  assert.match(route, /要留意/);
});

test("EstateRecord includes seo_title/seo_description (DR-10) so the head() override below is type-safe", () => {
  const queries = read("src/lib/queries.ts");
  const typeStart = queries.indexOf("export type EstateRecord = {");
  assert.notEqual(typeStart, -1, "expected EstateRecord type in queries.ts");
  const typeEnd = queries.indexOf("};", typeStart);
  const typeBody = queries.slice(typeStart, typeEnd);
  assert.match(typeBody, /seo_title: string \| null;/);
  assert.match(typeBody, /seo_description: string \| null;/);
});

test("estate head() prefers estate.seo_title/seo_description over the estateSeo registry entry, which stays the fallback (DR-10)", () => {
  const head = buildEstateHead(read("src/routes/estate.$slug.tsx"));

  const overridden = head({
    loaderData: {
      estate: {
        slug: "with-seo",
        name_zh: "測試屋苑",
        seo_title: "override title",
        seo_description: "override description",
        total_units: 100,
        avg_saleable_psf: 12000,
      },
    },
  });
  assert.equal(overridden.meta[0].title, "override title");
  assert.equal(overridden.meta[1].content, "override description");

  const fallsBackToRegistry = head({
    loaderData: {
      estate: {
        slug: "with-seo",
        name_zh: "測試屋苑",
        seo_title: null,
        seo_description: null,
        total_units: 100,
        avg_saleable_psf: 12000,
      },
    },
  });
  assert.equal(fallsBackToRegistry.meta[0].title, "registry title");
  assert.equal(fallsBackToRegistry.meta[1].content, "registry description");

  const fallsBackToDefault = head({
    loaderData: {
      estate: {
        slug: "no-seo",
        name_zh: "測試屋苑",
        seo_title: null,
        seo_description: null,
        total_units: 88,
        avg_saleable_psf: 9000,
      },
    },
  });
  assert.equal(fallsBackToDefault.meta[0].title, "測試屋苑｜晉誠地產屋苑專頁");
  assert.match(fallsBackToDefault.meta[1].content, /測試屋苑 88 個單位，平均實呎 \$9000/);
});

test("public search and homepage expose lead capture paths", () => {
  const listings = read("src/routes/listings.tsx");
  const home = read("src/routes/index.tsx");
  const header = read("src/components/site/SiteHeader.tsx");
  const footer = read("src/components/site/SiteFooter.tsx");

  assert.match(listings, /SearchFallbackCTA/);
  assert.match(listings, /describeListingSearch/);
  assert.match(listings, /keyword/);
  assert.match(listings, /fallbackIntent = search\.deal === "rent" \? "rent" : "buy"/);
  assert.match(listings, /intent={fallbackIntent}/);
  assert.match(home, /useNavigate/);
  assert.match(home, /OwnerValuationPanel/);
  assert.match(home, /IntentWhatsAppCTA/);
  assert.match(home, /keyword/);
  assert.match(header, /業主放盤 \/ 免費估價/);
  assert.match(footer, /業主放盤/);
  assert.match(footer, /查看持牌代理團隊/);
  assert.equal(/28hse/i.test(footer), false);
});

test("homepage drops the district stats strip", () => {
  const home = read("src/routes/index.tsx");

  // Removed at the client's request. The derived values and the `Stat` component
  // existed only to feed this strip, so none of them should linger as dead code.
  for (const gone of [/深井住宅單位/, /平均實用呎價/, /近 12 個月/, /個精選/, /function Stat\(/]) {
    assert.doesNotMatch(home, gone);
  }
  assert.doesNotMatch(home, /const totalUnits =/);
  assert.doesNotMatch(home, /const avgPsf =/);
});

test("homepage featured listings show real media and link to the listing", () => {
  const home = read("src/routes/index.tsx");

  // The card used to render only a gradient and never read `images`, and its
  // sole link was the WhatsApp button -- so the homepage could not reach a
  // listing page at all.
  assert.match(home, /property\.images\?\.\[0\]/);
  assert.match(home, /const photoCount = property\.images\?\.length \?\? 0/);
  // Not a bare Boolean(...): video_url is shared with VR-tour links elsewhere
  // in the codebase, so this must go through the same YouTube check used to
  // build the video carousel above.
  assert.match(home, /const hasVideo = isYouTubeVideoUrl\(property\.video_url\)/);
  assert.match(home, /to="\/property\/\$listingNo"/);
  assert.match(home, /params=\{\{ listingNo: property\.listing_no \}\}/);

  // Media count badges must not depend on hover -- they carry the count, and
  // there is no hover on touch. Only the "查看更多" hint is hover-revealed.
  assert.match(home, /group-hover:scale-105/);
  assert.match(home, /查看更多/);
});

test("homepage shows featured property videos after featured listings", () => {
  const home = read("src/routes/index.tsx");

  assert.match(home, /精選樓盤影片/);
  assert.match(home, /fetchCmsVideos/);
  // Cheaper than /videos' fetchVideosPageData, which also runs a listing scan.
  // Matched against the import list, not the whole file -- the name legitimately
  // appears in a comment explaining why it is *not* used.
  assert.doesNotMatch(home, /^\s+fetchVideosPageData,$/m);
  // Thumbnail facade, not three embedded players on the landing page.
  assert.match(home, /i\.ytimg\.com/);
  assert.doesNotMatch(home, /youtube\.com\/embed/);
  assert.match(home, /to="\/videos"/);

  // The video band must come after 精選筍盤, which is the whole point of where
  // the client asked for it. Compared on the rendered section titles rather
  // than bare text, so a comment mentioning either name cannot skew the order.
  // These two SectionHeader calls intentionally carry no `eyebrow` -- an
  // eyebrow identical to the title duplicated the label visually, and was
  // removed in ecaef90 ("fix: remove duplicate homepage section labels").
  const featuredAt = home.indexOf('title="精選筍盤"');
  const videosAt = home.indexOf('title="精選樓盤影片"');
  assert.ok(featuredAt > -1, "featured listings section should carry its title");
  assert.ok(videosAt > -1, "video section should carry its title");
  assert.ok(featuredAt < videosAt, "精選樓盤影片 must render after 精選筍盤");
});

// --- P4 Task 4: verified-facts DataNote, transport, school-net, PSF trend ---

test("findCastlePeakRoadSegmentByDistrictSlug resolves the real district of every hasPage estate and degrades to null outside a known segment (P4 Task 4)", () => {
  // All five of today's real /estate/$slug estates carry
  // district_slug === "sham-tseng" (estate-registry.ts) -- the estate
  // template's new transport section must actually match for them, not just
  // compile against the function's type signature.
  const shamTsengMatch = findCastlePeakRoadSegmentByDistrictSlug("sham-tseng");
  assert.notEqual(shamTsengMatch, null);
  assert.equal(typeof shamTsengMatch.transport, "string");
  assert.ok(shamTsengMatch.transport.length > 0);

  // Task 2's three unknown-district estates (帝華軒/海韻台/龍騰閣) have
  // district_slug === null in both the DB row and EstateRecord's type. The
  // route isn't reachable for them yet (hasPage: false), but the lookup
  // itself must still degrade to null rather than throw if that ever changes.
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug(null), null);
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug(undefined), null);

  // A district outside every known corridor segment resolves to null too --
  // "hide, don't placeholder" rather than a false match.
  assert.equal(findCastlePeakRoadSegmentByDistrictSlug("mong-kok"), null);
});

test("getSchoolNet stays the estate template's only school-net source, imported not re-derived (P4 Task 5)", () => {
  // Task 5 replaced the single shamTsengSchoolNet constant with a
  // schoolNets map + getSchoolNet(code) lookup so the route can resolve a
  // school net per-estate instead of only ever showing sham-tseng's. Net 62
  // (荃灣, covering sham-tseng and tsing-lung-tau) is still real, sourced
  // data -- same invariant as before, just addressed by code now.
  const net62 = getSchoolNet("62");
  assert.notEqual(net62, null);
  assert.equal(net62.netCode, "62");
  assert.equal(Array.isArray(net62.primarySchools), true);

  // An unknown/missing code degrades to null rather than throwing or
  // inventing data -- the route treats null as "omit the section".
  assert.equal(getSchoolNet("no-such-code"), null);
  assert.equal(getSchoolNet(null), null);
  assert.equal(getSchoolNet(undefined), null);
});

test("estate route wires the verified-facts DataNote, transport, and school-net sections (P4 Task 4)", () => {
  const route = read("src/routes/estate.$slug.tsx");

  assert.match(route, /import \{ DataNote \} from "@\/components\/layout\/DataNote";/);
  assert.match(
    route,
    /import \{ findCastlePeakRoadSegmentByDistrictSlug \} from "@\/content\/castle-peak-road";/,
  );
  assert.match(route, /import \{ getSchoolNet \} from "@\/content\/school-nets";/);

  // Verified-facts block: sourced from estate.verified_at (Task 2's column,
  // null for every estate today), with an honest caveat rather than a
  // fabricated date when it's null -- and the DataNote component is actually
  // used, not just a plain paragraph.
  assert.match(route, /estate\.verified_at/);
  assert.match(route, /<DataNote/);
  assert.match(route, /尚待人手覆核並標註核實日期/);

  // Transport + school-net are each gated on the real derived value (not a
  // hardcoded true), so both the "renders" and "omitted" branches are
  // reachable in the actual output -- the "renders" branch is proven for
  // real above via findCastlePeakRoadSegmentByDistrictSlug/getSchoolNet
  // directly; this proves the route's rendering is actually conditioned on
  // that same result rather than always showing (or always hiding) the
  // section. Task 5 made schoolNet per-estate (derived from the registry
  // entry's districtSlug), replacing the old hardcoded
  // `district_slug === "sham-tseng"` gate -- see
  // estate.district-driven.contract.test.mjs for the tests that guard
  // against that hardcoding coming back.
  assert.match(route, /const transportSegment = findCastlePeakRoadSegmentByDistrictSlug\(/);
  assert.match(route, /const schoolNet = getSchoolNet\(/);
  assert.match(route, /\{transportSegment && \(/);
  assert.match(route, /\{schoolNet && \(/);
});

test("EstateMarketSnapshot renders a PSF-trend line chart fed by the real transactions prop, hidden below two data points (P4 Task 4)", () => {
  const snapshot = read("src/components/site/EstateMarketSnapshot.tsx");

  assert.match(snapshot, /from "recharts";/);
  assert.match(snapshot, /LineChart/);
  assert.match(snapshot, /ResponsiveContainer/);

  // Built from the transactions param already passed into the component and
  // already used for the 5-row table -- not a new query, not a fixture.
  assert.match(
    snapshot,
    /function buildPsfTrend\(transactions: EstateTransaction\[\]\): PsfTrendPoint\[\]/,
  );
  assert.match(snapshot, /const psfTrend = buildPsfTrend\(transactions\);/);
  assert.doesNotMatch(snapshot, /fetchEstateTransactions\(/);

  // A single point (or zero) can't draw a trend -- must be hidden, not shown
  // broken, matching this repo's established "hide, don't placeholder" rule.
  assert.match(snapshot, /psfTrend\.length >= 2/);
});

// --- P4 Task 5: nearby-estate comparison table ---
//
// buildComparisonColumns/buildComparisonRowDefs/estateTextFigure's actual
// 2/1/0-comparable and em-dash-formatting behaviour is proven by real
// execution in src/components/site/estate-comparison.test.mjs (that module
// has no JSX, so it can be imported directly under Node's native TS
// stripping, same as estate-registry.ts/castle-peak-road.ts already are
// elsewhere in this file). The tests here only prove the *wiring* --
// that estate.$slug.tsx's loader/render and EstateComparisonTable.tsx
// actually use that logic, via source-scan (this route can't be rendered
// without a bundler/render harness, matching every other route test in
// this file).

test("estate.$slug.tsx wires findComparableEstates + EstateComparisonTable (P4 Task 5)", () => {
  const route = read("src/routes/estate.$slug.tsx");

  assert.match(
    route,
    /import \{\s*EstateComparisonTable,\s*type EstateComparisonRow,\s*\} from "@\/components\/site\/EstateComparisonTable";/,
  );
  // P4 Task 5 (district-driven route, docs/superpowers/plans/2026-08-30-...)
  // merged getEstateEntry into this same import statement rather than adding
  // a second import line -- match either shape, since which named exports
  // share the statement isn't the invariant this test protects.
  assert.match(
    route,
    /import \{ findComparableEstates(?:, getEstateEntry)? \} from "@\/content\/estate-registry";/,
  );

  // Up to 2 comparables, computed from the registry alone (before any DB
  // fetch), so the "which estates are comparable" decision stays
  // deterministic and independent of what facts happen to be in the DB.
  assert.match(route, /const comparableEntries = findComparableEstates\(estate\.slug, 2\);/);

  // A `null` DB record for a comparable (no row, or an unpublished row)
  // still keeps its registry name/hasPage and simply renders every fact as
  // "—" -- it is not dropped from the "up to 2" slots or backfilled with a
  // third candidate.
  assert.match(route, /const record = comparableRecords\[index\];/);
  assert.match(route, /nameZh: entry\.nameZh,/);
  assert.match(route, /hasPage: entry\.hasPage,/);

  // The current estate's own column uses the same avgPsf conversion
  // EstateMarketSnapshot already gets below it, so a non-numeric/zero DB
  // value can't silently read as a real $0 psf in either component.
  assert.match(route, /avgPsf: Number\(estate\.avg_saleable_psf \?\? 0\) \|\| null,/);

  assert.match(route, /<EstateComparisonTable/);
  assert.match(route, /current=\{currentComparisonRow\}/);
  assert.match(route, /comparables=\{comparableEstates\}/);
});

test("EstateComparisonTable renders nothing for zero comparables and never links to a page that 404s (P4 Task 5)", () => {
  const component = read("src/components/site/EstateComparisonTable.tsx");

  assert.match(
    component,
    /import \{\s*buildComparisonColumns,\s*buildComparisonRowDefs,[\s\S]*?type EstateComparisonRow,\s*\} from "\.\/estate-comparison";/,
  );

  // The "0 comparable -> section absent entirely" behaviour is gated on the
  // real, shared buildComparisonColumns result (proven by direct execution
  // in estate-comparison.test.mjs), not a hardcoded `true`/`false` here.
  assert.match(component, /const columns = buildComparisonColumns\(current, comparables\);/);
  assert.match(component, /if \(!columns\) return null;/);

  // Every row's cell comes from the same shared row definitions -- no
  // second, divergent formatting implementation inside the component.
  assert.match(component, /const rows = buildComparisonRowDefs\(\);/);
  assert.match(component, /row\.formatCell\(estate\)/);

  // A comparable only links to its detail page when hasPage is true -- the
  // current estate (index 0) never gets a link to itself, and no other
  // column links unconditionally.
  assert.match(component, /index > 0 && estate\.hasPage/);
  assert.match(component, /to="\/estate\/\$slug"/);
});

test("estate-comparison.ts is a plain .ts module with no JSX, importable directly under Node's native TS stripping (P4 Task 5)", () => {
  const source = read("src/components/site/estate-comparison.ts");
  // No React import and no JSX-only syntax -- same "plain data/logic module"
  // discipline estate-registry.ts documents for itself, which is exactly
  // what lets estate-comparison.test.mjs import and execute this file
  // directly instead of only source-scanning it.
  assert.doesNotMatch(source, /from "react"/i);
  assert.doesNotMatch(source, /React\./);
  assert.match(source, /export function buildComparisonColumns/);
  assert.match(source, /export function buildComparisonRowDefs/);
  assert.match(source, /export function estateTextFigure/);
});
