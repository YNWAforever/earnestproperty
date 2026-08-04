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
  // the client asked for it. Compared on the rendered section eyebrows rather
  // than bare text, so a comment mentioning either name cannot skew the order.
  const featuredAt = home.indexOf('eyebrow="精選筍盤"');
  const videosAt = home.indexOf('eyebrow="精選樓盤影片"');
  assert.ok(featuredAt > -1, "featured listings section should carry its eyebrow");
  assert.ok(videosAt > -1, "video section should carry its eyebrow");
  assert.ok(featuredAt < videosAt, "精選樓盤影片 must render after 精選筍盤");
});
