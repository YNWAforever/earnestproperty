import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import ts from "typescript";

import { getYouTubeEmbedUrl, isYouTubeVideoUrl } from "../lib/youtube-video-url.js";

const root = process.cwd();
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

/**
 * Loads the real src/config/site.ts as an executable data: URL module, with
 * VITE_CONTACT_WHATSAPP_PHONE injected as a literal (site.ts reads it via
 * import.meta.env, which only exists under Vite -- plain `node --test` has no
 * import.meta.env at all, so every other test in this file source-greps site.ts
 * as text instead of importing it). This is the one behavior that text-matching
 * cannot verify: whether whatsappUrl() actually returns a wa.me URL versus
 * silently falling back to "/contact" -- which is exactly the bug this suite
 * exists to catch (see the audit correction in the remediation plan).
 *
 * console.warn is silenced for the phone==="" case: that branch intentionally
 * logs a warning (see site.ts), which would otherwise spam `node --test` output.
 */
async function importSiteWithInjectedPhone(phone) {
  const branchesUrl = dataUrl(
    transpile(readFileSync(join(root, "src/config/site-branches.js"), "utf8")),
  );
  const source = transpile(readFileSync(join(root, "src/config/site.ts"), "utf8"))
    .replace('from "./site-branches.js"', `from "${branchesUrl}"`)
    .replace(
      'const whatsappPhone = import.meta.env.VITE_CONTACT_WHATSAPP_PHONE ?? "";',
      `const whatsappPhone = ${JSON.stringify(phone)};`,
    )
    .replace(
      'const phoneDisplay = import.meta.env.VITE_CONTACT_PHONE_DISPLAY ?? "";',
      'const phoneDisplay = "";',
    )
    .replace(
      'const phoneTel = import.meta.env.VITE_CONTACT_PHONE_TEL ?? "";',
      'const phoneTel = "";',
    );

  const originalWarn = console.warn;
  if (!phone) console.warn = () => {};
  try {
    return await import(dataUrl(source));
  } finally {
    console.warn = originalWarn;
  }
}

test("whatsappUrl returns a real wa.me link once the phone is configured", async () => {
  const site = await importSiteWithInjectedPhone("85261234567");

  assert.equal(site.hasWhatsAppPhone, true);
  assert.equal(
    site.whatsappUrl("你好，我想查詢深井物業"),
    "https://wa.me/85261234567?text=" + encodeURIComponent("你好，我想查詢深井物業"),
  );
  assert.equal(site.whatsappIntentUrl("buy").startsWith("https://wa.me/85261234567?text="), true);
});

test("whatsappUrl falls back to /contact when the phone is not configured, and hasWhatsAppPhone says so", async () => {
  const site = await importSiteWithInjectedPhone("");

  assert.equal(site.hasWhatsAppPhone, false);
  assert.equal(site.whatsappUrl("你好，我想查詢深井物業"), "/contact");
  assert.equal(site.whatsappIntentUrl("rent"), "/contact");
});

test("propertyEnquiryMessage carries deal-aware price and does not repeat the listing number already in title", () => {
  return importSiteWithInjectedPhone("85261234567").then((site) => {
    const sale = site.propertyEnquiryMessage({
      title: "麗都花園 售盤 #C024131",
      dealType: "sale",
      price: 6_000_000,
    });
    assert.equal(sale, "你好，想查詢 麗都花園 售盤 #C024131（$6,000,000）");
    assert.equal((sale.match(/C024131/g) ?? []).length, 1);

    const rent = site.propertyEnquiryMessage({
      title: "海韻花園 租盤 #R013153",
      dealType: "rent",
      price: 19_500,
    });
    assert.equal(rent, "你好，想查詢 海韻花園 租盤 #R013153（$19,500/月）");

    const noPrice = site.propertyEnquiryMessage({
      title: "麗都花園 售盤 #C024131",
      dealType: "sale",
      price: null,
    });
    assert.equal(noPrice, "你好，想查詢 麗都花園 售盤 #C024131");
  });
});

const files = [
  "src/config/site.ts",
  "src/config/site-branches.js",
  "src/components/site/SiteHeader.tsx",
  "src/components/site/SiteFooter.tsx",
  "src/routes/contact.tsx",
  "src/routes/index.tsx",
  "src/routes/district.ting-kau.tsx",
  "src/routes/videos.tsx",
  "src/routes/estate-reviews.tsx",
  "src/routes/transactions.tsx",
  "src/routes/estate.$slug.tsx",
  "src/routes/admin.cms.tsx",
  "src/components/dashboard/PropertyForm.tsx",
  "src/lib/queries.ts",
  "src/lib/neon/public-data.server.ts",
  "src/lib/neon/admin-data.server.ts",
  "src/lib/neon/admin-data.types.ts",
  "src/lib/youtube-video-url.js",
];

test("public source files do not contain placeholder contact values", () => {
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.equal(combined.includes("852XXXXXXXX"), false);
  assert.equal(combined.includes("+852 0000 0000"), false);
  assert.equal(combined.includes("tel:+85200000000"), false);
});

test("site config exposes segmented whatsapp intent helpers", () => {
  const source = readFileSync("src/config/site.ts", "utf8");

  assert.match(source, /export type WhatsAppIntent = "buy" \| "rent" \| "valuation"/);
  assert.match(source, /export function whatsappIntentMessage/);
  assert.match(source, /export function whatsappIntentUrl/);
  assert.match(source, /我要買樓/);
  assert.match(source, /我要租樓/);
  assert.match(source, /我要放盤估價/);
  assert.match(source, /深井業主估價報告/);
});

test("site config exposes all public branch contact details", () => {
  const source = ["src/config/site.ts", "src/config/site-branches.js"]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  for (const text of [
    "SITE_BRANCHES",
    "麗都分行",
    "深井麗都花園地下5A舖",
    "26882988",
    "海韻分行",
    "深井海韻花園地下G3舖",
    "26886996",
    "青山公路豪景分行",
    "青龍頭村11號地下",
    "26882883",
  ]) {
    assert.match(source, new RegExp(text));
  }
});

// Audit finding: footer phone links rendered as ~69x20px tap targets, well
// under the 44px guideline, because the <a> only wrapped the bare text inside
// a <p>. The fix makes the link itself the tappable element.
test("footer phone and email links meet the 44px tap-target guideline", () => {
  const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");

  const phoneLink = footer.match(/<a\s+href=\{`tel:\$\{branch\.phone\}`\}[^>]*>/)?.[0] ?? "";
  assert.match(phoneLink, /className="inline-flex min-h-11 items-center/);

  const mailLink =
    footer.match(/<a\s+href=\{`mailto:\$\{SITE_CONTACT\.email\}`\}[^>]*>/)?.[0] ?? "";
  assert.match(mailLink, /className="inline-flex min-h-11 items-center/);
});

// Audit finding: "no sticky WhatsApp/bottom conversion bar — the only
// persistent element is the 問樓助手 AI chat bubble, which doesn't hand off to
// WhatsApp".
test("a sticky mobile WhatsApp bar is mounted site-wide, suppressed where a page has its own", () => {
  const bar = readFileSync("src/components/site/StickyWhatsAppBar.tsx", "utf8");
  assert.match(bar, /whatsappUrl\(/);
  assert.match(
    bar,
    /bottom-16/,
    "must sit above the 問樓助手 bubble (fixed at bottom-4/5), not on top of it",
  );
  assert.match(
    bar,
    /lg:hidden/,
    "desktop already has the header WhatsApp button and mega-menu CTA",
  );

  const root = readFileSync("src/routes/__root.tsx", "utf8");
  assert.match(
    root,
    /import \{ StickyWhatsAppBar \} from "@\/components\/site\/StickyWhatsAppBar"/,
  );
  assert.match(root, /\{showStickyWhatsAppBar \? <StickyWhatsAppBar \/> : null\}/);
  assert.match(root, /function shouldShowStickyWhatsAppBar/);
  // /property/$listingNo has its own listing-aware bar (PropertyDecisionActions);
  // showing both would duplicate the CTA.
  assert.match(root, /pathname\.startsWith\("\/property\/"\)/);
  assert.match(root, /"\/admin", "\/auth", "\/account", "\/dashboard"/);
  // The bar is `fixed`, so a page needs bottom padding reserved or its own
  // last content (e.g. footer) sits underneath it with no way to scroll clear.
  assert.match(root, /showStickyWhatsAppBar \? "pb-16 lg:pb-0" : ""/);
});

test("homepage and navigation include Ting Kau content entry points", () => {
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const text of [
    "汀九",
    "YouTube影片",
    "屋苑開箱",
    "晉誠地產最新成交",
    "深井 青山公路 汀九買樓租樓",
    "準備搵深井 青山公路筍盤",
    "深井 青山公路 汀九我哋比你更熟",
    "/district/ting-kau",
    "/videos",
    "/estate-reviews",
    "/transactions",
  ]) {
    assert.match(combined, new RegExp(text));
  }
});

// 精選筍盤置頂 (client p2). This regressed once already because the copy edits
// landed and the move did not, and nothing failed — so the order is pinned here.
test("homepage puts 精選筍盤 above 深井核心屋苑", () => {
  const source = readFileSync("src/routes/index.tsx", "utf8");

  // These three SectionHeader calls intentionally carry no `eyebrow` -- an
  // eyebrow identical to the title duplicated the label visually, and was
  // removed in ecaef90 ("fix: remove duplicate homepage section labels").
  const featured = source.indexOf('title="精選筍盤"');
  const estates = source.indexOf('title="深井核心屋苑"');
  const whyUs = source.indexOf('title="為何選晉誠"');

  assert.notEqual(featured, -1, "homepage should still have a 精選筍盤 section");
  assert.notEqual(estates, -1, "homepage should still have a 深井核心屋苑 section");
  assert.ok(featured < estates, "精選筍盤 must render before 深井核心屋苑");
  assert.ok(estates < whyUs, "深井核心屋苑 must stay above 為何選晉誠");

  // DOM order is only visual order while nothing reorders with CSS.
  assert.doesNotMatch(source, /\border-\d\b|flex-col-reverse|flex-row-reverse/);

  // The anchor and the two WhatsApp attribution strings carry no other coverage
  // and are easy to lose when sections move.
  assert.match(source, /id="owner-valuation"/);
  assert.match(source, /source: "homepage-owner-valuation"/);
  assert.match(source, /source: "homepage-final-cta"/);
});

// Audit finding: 海雲軒/帝華軒/海韻台/縉皇居/龍騰閣 (core-estates.ts's hasPage:false
// entries) rendered as non-clickable gradient boxes next to real cards. The fix
// filters them out of the homepage grid entirely rather than shipping five thin
// pages -- core-estates.ts itself keeps all ten client-approved entries.
test("homepage estate grid only renders estates with a detail page", () => {
  const source = readFileSync("src/routes/index.tsx", "utf8");

  assert.match(
    source,
    /const linkableEstates = coreEstates\.filter\(\(estate\) => estate\.hasPage\)/,
  );
  assert.match(source, /const visible = expanded\s*\n?\s*\?\s*linkableEstates/);
  assert.match(source, /linkableEstates\.length > CORE_ESTATES_PREVIEW_COUNT/);
  assert.doesNotMatch(
    source,
    /const visible = expanded \? coreEstates :/,
    "visible must be derived from the hasPage-filtered list, not the raw client list",
  );
});

test("homepage share card uses an absolute image and the shared meta registry", () => {
  const source = readFileSync("src/routes/index.tsx", "utf8");
  const seo = readFileSync("src/content/seo.ts", "utf8");

  // og:image must be absolute; the Vite import alone is a hashed relative path.
  assert.match(source, /const HERO_OG_IMAGE = new URL\(heroImage, SITE_URL\)\.href/);
  assert.match(source, /property: "og:image", content: HERO_OG_IMAGE/);
  assert.match(source, /name: "twitter:image", content: HERO_OG_IMAGE/);
  assert.doesNotMatch(source, /"og:image", content: heroImage/);

  // The description used to be duplicated here with a divergent tail, so the
  // homepage and the sitemap advertised two different strings.
  assert.match(source, /content: pageSeo\.home\.description/);
  assert.match(seo, /home: \{/);
  const homeDescriptions = [...seo.matchAll(/持牌代理 C-018613。/g)];
  assert.ok(homeDescriptions.length > 0, "registry keeps the canonical licence tail");
  assert.equal(source.includes("Licence C-018613。"), false);
});

test("header exposes approved mega menu structure and controls", () => {
  const source = readFileSync("src/components/site/SiteHeader.tsx", "utf8");

  for (const text of [
    "地區與屋苑",
    "買租服務",
    "市場資訊",
    "深井區買樓租樓",
    "青山公路區買樓租樓",
    "汀九豪宅區買樓租樓",
    "屋苑入口",
    "查看全部放盤",
    "買樓",
    "租樓",
    "業主放盤 / 免費估價",
    "代理團隊",
    "聯絡門市",
    "YouTube影片",
    "晉誠地產最新成交",
    "屋苑開箱",
    "市場分析",
    "關於晉誠",
    "觀看最新影片",
    "/district/sham-tseng",
    // Ting Kau's canonical page is the corridor segment; /district/ting-kau 301s.
    "/castle-peak-road/ting-kau",
    "/castle-peak-road",
    "/estate/bellagio",
    "/listings?deal=sale",
    "/listings?deal=rent",
    "/#owner-valuation",
    "/videos",
    "/transactions",
  ]) {
    assert.equal(source.includes(text), true, `${text} should appear in the header source`);
  }

  for (const text of [
    "mega-menu-districts",
    "mega-menu-services",
    "mega-menu-market",
    "aria-expanded",
    "aria-controls",
    "activeMegaMenu",
    "setActiveMegaMenu(null)",
    "document.addEventListener",
    "Escape",
    "mousedown",
    "location.href",
    "menu.featured, ...menu.links",
  ]) {
    assert.equal(source.includes(text), true, `${text} should be wired in the header source`);
  }

  assert.equal(source.includes("...menu.featured, ...menu.links, menu.cta"), false);
  // The mobile cta is deduped both against the header's own general WhatsApp
  // button and against any featured/link item that already points to the same
  // route (e.g. market's "/videos" featured item and cta), to avoid duplicate
  // keys. The whatsapp side is an explicit `ctaMirrorsGlobalWhatsapp` marker,
  // not a URL string comparison -- comparing built URLs only ever worked
  // because both happened to be built from the identical hardcoded message
  // and so produced byte-identical strings by coincidence.
  assert.equal(source.includes("ctaMirrorsGlobalWhatsapp?: boolean"), true);
  assert.equal(source.includes("menu.ctaMirrorsGlobalWhatsapp || ctaIsDuplicate"), true);
  assert.equal(source.includes("base.some((item) => itemKey(item) === itemKey(menu.cta))"), true);
  assert.equal(source.includes("menu.cta.href === whatsappHref"), false);
  assert.equal(source.includes('split("?")[0].split("#")[0]'), false);
});

test("property experience navigation exposes the mortgage calculator everywhere", () => {
  const header = readFileSync("src/components/site/SiteHeader.tsx", "utf8");
  const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");

  assert.match(header, /to: "\/mortgage", label: "按揭計算機"/);
  assert.match(header, /menuMobileItems\(menu\)/);
  assert.match(footer, /<Link to="\/mortgage"[\s\S]*?按揭計算機/);
});

test("sitemap includes property experience routes and only discovered public agent profiles", () => {
  const sitemap = readFileSync("src/routes/sitemap[.]xml.ts", "utf8");

  assert.match(sitemap, /"\/mortgage"/);
  assert.match(sitemap, /"\/agents"/);
  assert.match(
    sitemap,
    /import \{ listPublicAgentProfiles \} from "@\/lib\/neon\/public-data\.server"/,
  );
  assert.match(sitemap, /await listPublicAgentProfiles\(\)/);
  assert.match(
    sitemap,
    /profile\.public_slug \? \[`\/agents\/\$\{profile\.public_slug\}`\] : \[\]/,
  );
  // A DB blip used to silently ship a sitemap with zero agent URLs -- still
  // degrade gracefully (a missing sitemap is worse than one missing 23 agent
  // URLs), but the failure must be logged, not swallowed outright.
  assert.match(sitemap, /catch\(\(error: unknown\) => \{/);
  assert.match(sitemap, /console\.error\(/);

  assert.match(sitemap, /<lastmod>\$\{lastmod\}<\/lastmod>/);
});

// Both pages render a graceful empty state instead of 404ing, which is correct
// UX, but an *indexed* empty page is a soft-404 risk. Both conditions must
// self-heal (no path listed / no noindex) the moment real rows land, with no
// further deploy -- so the sitemap and the two routes' own head() must gate on
// the actual fetched length, never a hardcoded true/false.
test("empty /transactions and /estate-reviews are dropped from the sitemap and noindexed", () => {
  const sitemap = readFileSync("src/routes/sitemap[.]xml.ts", "utf8");
  const transactions = readFileSync("src/routes/transactions.tsx", "utf8");
  const estateReviews = readFileSync("src/routes/estate-reviews.tsx", "utf8");

  assert.match(sitemap, /transactions\.length > 0 \? "\/transactions" : null/);
  assert.match(sitemap, /estateReviewArticles\.length > 0 \? "\/estate-reviews" : null/);
  assert.doesNotMatch(
    sitemap,
    /^\s*"\/transactions",\s*$/m,
    "/transactions must not be an unconditional static path anymore",
  );
  assert.doesNotMatch(
    sitemap,
    /^\s*"\/estate-reviews",\s*$/m,
    "/estate-reviews must not be an unconditional static path anymore",
  );

  assert.match(transactions, /head:\s*\(\{\s*loaderData\s*\}\)\s*=>/);
  // Task 2 (P5) changed loaderData from a bare transactions array to
  // { transactions, estates } (the loader now also loads estate filter
  // options) -- the noindex gate moved with it onto the same nested field.
  assert.match(transactions, /loaderData\.transactions\.length === 0/);
  assert.match(transactions, /name: "robots", content: "noindex,follow"/);

  assert.match(estateReviews, /head:\s*\(\{\s*loaderData\s*\}\)\s*=>/);
  assert.match(estateReviews, /loaderData\.articles\.length === 0/);
  assert.match(estateReviews, /name: "robots", content: "noindex,follow"/);
});

// DR-8: the two eyebrow labels above the estate-reviews sections were left in
// English on an otherwise zh-HK page.
test("estate-reviews.tsx eyebrows are zh-HK, not English", () => {
  const estateReviews = readFileSync("src/routes/estate-reviews.tsx", "utf8");

  assert.doesNotMatch(estateReviews, /Review Articles|Estate Pages/);
  assert.match(estateReviews, /屋苑文章/);
  assert.match(estateReviews, /屋苑專頁/);
});

// Audit item 8: /privacy, /disclaimer, /terms all 404'd, and the EAA credential
// in the footer was plain text a visitor could not verify.
test("privacy, disclaimer and terms pages exist and are linked from the footer, and the licence is verifiable", () => {
  for (const route of ["privacy", "disclaimer", "terms"]) {
    assert.equal(
      existsSync(`src/routes/${route}.tsx`),
      true,
      `src/routes/${route}.tsx should exist`,
    );
  }

  const seo = readFileSync("src/content/seo.ts", "utf8");
  for (const key of ["privacy", "disclaimer", "terms"]) {
    assert.match(seo, new RegExp(`${key}: \\{`));
  }

  const sitemap = readFileSync("src/routes/sitemap[.]xml.ts", "utf8");
  assert.match(sitemap, /pageSeo\.privacy\.path/);
  assert.match(sitemap, /pageSeo\.disclaimer\.path/);
  assert.match(sitemap, /pageSeo\.terms\.path/);

  const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");
  assert.match(footer, /法律 Legal/);
  assert.match(footer, /<Link to="\/privacy"/);
  assert.match(footer, /<Link to="\/disclaimer"/);
  assert.match(footer, /<Link to="\/terms"/);

  // The licence number appeared twice -- once from SITE_CONTACT.licenceNo, once
  // hardcoded as a literal "C-018613" -- so the two could silently drift apart.
  assert.doesNotMatch(footer, /C-018613/, "the footer must not hardcode the licence number");
  assert.match(footer, /牌照號 Licence No\.: \{SITE_CONTACT\.licenceNo\}/);

  // The EAA credit was plain text with no way for a visitor to verify it.
  assert.match(footer, /href="https:\/\/www\.eaa\.org\.hk\/"/);
  assert.match(footer, /Estate Agents Authority HK/);
});

// The sitemap's static list is hand-maintained, so a new public page ships
// unlisted unless someone remembers to touch two files. Derive the expected
// paths from the route directory instead of asserting on literals: this fails
// when the *next* page is added, which is how /videos, /transactions and
// /estate-reviews went missing in the first place.
test("sitemap lists every indexable public route", () => {
  const nonPublicPrefix = /^(?:__root|admin|api|auth|account|dashboard|control-plane|sitemap)\b/;
  const declared = [
    readFileSync("src/routes/sitemap[.]xml.ts", "utf8"),
    readFileSync("src/content/seo.ts", "utf8"),
  ].join("\n");

  const missing = readdirSync("src/routes")
    .filter((file) => file.endsWith(".tsx") && !file.includes(".test."))
    .filter((file) => !nonPublicPrefix.test(file) && !file.includes("$") && !file.includes("_"))
    // Redirect-only routes are deliberately absent — listing a 301 wastes crawl
    // budget and splits the signal from the canonical URL.
    .filter((file) => !readFileSync(`src/routes/${file}`, "utf8").includes("statusCode: 301"))
    .map((file) => {
      const segments = file.replace(/\.tsx$/, "").split(".");
      const path = `/${segments.filter((segment) => segment !== "index").join("/")}`;
      return path === "/" ? "/" : path;
    })
    .filter((path) => !declared.includes(`"${path}"`));

  assert.deepEqual(missing, [], `sitemap is missing public routes: ${missing.join(", ")}`);
});

test("property experience npm script runs every focused suite with a Windows-compatible runner", () => {
  const packageJson = readFileSync("package.json", "utf8");

  assert.match(packageJson, /"test:property-experience"\s*:\s*"bun test/);
  for (const testFile of [
    "src/config/site-branches.test.mjs",
    "src/components/property/property-decision.test.mjs",
    "src/lib/mortgage.test.ts",
    "src/routes/mortgage.test.mjs",
    "src/routes/agents.contract.test.mjs",
    "src/lib/neon/agent-profiles.contract.test.mjs",
    "src/lib/neon/staff-security-policy.test.mjs",
    "src/lib/neon/website-inquiry.test.mjs",
  ]) {
    assert.equal(
      packageJson.includes(testFile),
      true,
      `${testFile} should be covered by the npm script`,
    );
  }
});
test("youtube channel metadata and CMS video source are wired", () => {
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const text of [
    "SITE_YOUTUBE_CHANNEL",
    "https://www.youtube.com/@%E6%99%89%E8%AA%A0%E5%9C%B0%E7%94%A2-EarnestProperty",
    "cms_videos",
    "fetchCmsVideos",
    "fetchAdminCmsVideos",
    "saveAdminCmsVideo",
    "YouTube影片",
  ]) {
    assert.match(combined, new RegExp(text));
  }
});

test("public CMS videos only fetch published rows", () => {
  const source = readFileSync("src/lib/neon/public-data.server.ts", "utf8");
  assert.match(source, /FROM cms_videos\s+WHERE\s+published\s*=\s*true/i);
});

test("public videos tolerate missing CMS table during rollout", () => {
  // The recogniser lives in cms-videos-schema.ts so the admin and public read
  // paths share one definition of "the table isn't there yet".
  const guard = readFileSync("src/lib/neon/cms-videos-schema.ts", "utf8");
  assert.match(guard, /relation "\$\{CMS_VIDEOS_TABLE\}" does not exist/);
  assert.match(guard, /42P01/);

  const source = readFileSync("src/lib/neon/public-data.server.ts", "utf8");
  assert.match(source, /isMissingCmsVideosTableError/);
  assert.match(source, /if \(isMissingCmsVideosTableError\(error\)\) return \[\];/);
});

test("videos page orders CMS videos above listing videos", () => {
  const source = readFileSync("src/lib/queries.ts", "utf8");
  const fetchCmsIndex = source.indexOf("fetchCmsVideos()");
  const fetchListingIndex = source.indexOf("fetchVideoListings(12)");
  assert.notEqual(fetchCmsIndex, -1);
  assert.notEqual(fetchListingIndex, -1);
  assert.ok(fetchCmsIndex < fetchListingIndex);

  // Variable names renamed by the Aug 20 paged/filtered-grid refactor
  // (0a5ce14): cmsVideos -> sortedCmsVideos, listingVideos ->
  // matchingListingVideos. Same CMS-before-listing render order.
  const routeSource = readFileSync("src/routes/videos.tsx", "utf8");
  const cmsSectionIndex = routeSource.indexOf("{sortedCmsVideos.length > 0 &&");
  const listingSectionIndex = routeSource.indexOf("{matchingListingVideos.length > 0 &&");
  assert.notEqual(cmsSectionIndex, -1);
  assert.notEqual(listingSectionIndex, -1);
  assert.ok(cmsSectionIndex < listingSectionIndex);
});

test("admin property save SQL includes SEO and video URL parameters", () => {
  const source = readFileSync("src/lib/neon/admin-data.server.ts", "utf8");
  assert.match(source, /video_url = \$19/);
  assert.match(source, /INSERT INTO properties \(/);
  assert.match(source, /seo_title, seo_description, video_url, agent_id/);
});

test("YouTube CMS URL validation is present in admin CMS paths", () => {
  const cmsSource = readFileSync("src/routes/admin.cms.tsx", "utf8");
  const serverSource = readFileSync("src/lib/neon/admin-data.server.ts", "utf8");

  assert.match(cmsSource, /isYouTubeVideoUrl/);
  assert.match(serverSource, /isYouTubeVideoUrl/);
  assert.match(cmsSource, /請輸入有效 YouTube 連結/);
  assert.match(serverSource, /請輸入有效 YouTube 連結/);
});

test("YouTube URL helper accepts only video URLs with IDs", () => {
  const accepted = [
    ["https://www.youtube.com/watch?v=abc123", "https://www.youtube.com/embed/abc123"],
    ["https://youtube.com/watch?v=abc123", "https://www.youtube.com/embed/abc123"],
    ["https://m.youtube.com/watch?v=abc123", "https://www.youtube.com/embed/abc123"],
    ["https://youtu.be/abc123", "https://www.youtube.com/embed/abc123"],
    ["https://www.youtube.com/embed/abc123", "https://www.youtube.com/embed/abc123"],
    ["https://www.youtube.com/shorts/abc123", "https://www.youtube.com/embed/abc123"],
  ];

  for (const [url, embedUrl] of accepted) {
    assert.equal(isYouTubeVideoUrl(url), true);
    assert.equal(getYouTubeEmbedUrl(url), embedUrl);
  }

  for (const url of [
    "",
    "not a url",
    "https://notyoutube.com/watch?v=abc123",
    "https://example.com/watch?v=abc123",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=",
    "https://youtu.be/",
    "https://www.youtube.com/embed/",
    "https://www.youtube.com/shorts/",
  ]) {
    assert.equal(isYouTubeVideoUrl(url), false);
    assert.equal(getYouTubeEmbedUrl(url), null);
  }
});

test("listing admin can save property video urls", () => {
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const text of [
    "video_url",
    "YouTube影片連結",
    "property?.video_url",
    "input.video_url",
    "p.video_url",
  ]) {
    assert.match(combined, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("valuation whatsapp intent includes search summary context", () => {
  const source = readFileSync("src/config/site.ts", "utf8");
  const valuationStart = source.indexOf('"你好，我要放盤估價');
  const valuationEnd = source.indexOf("].join", valuationStart);
  const valuationMessage = source.slice(valuationStart, valuationEnd);

  assert.notEqual(valuationStart, -1);
  assert.notEqual(valuationEnd, -1);
  assert.match(valuationMessage, /contextLine\("搜尋條件", context\.searchSummary\)/);
});

// The banned phrases are spelled with char codes, not literals: a plain literal
// here would itself show up in the repo-wide grep this guard exists to keep clean.
test("source files avoid the older disallowed listing wording", () => {
  const forbidden = [
    String.fromCharCode(30495, 30436, 28304),
    String.fromCharCode(22533, 30436, 28304),
    String.fromCharCode(21313, 22810, 24180),
  ];
  const required = String.fromCharCode(20840, 37096, 30495, 30436);
  const files = [
    "src/config/site.ts",
    "src/content/seo.ts",
    "src/routes/index.tsx",
    "src/routes/listings.tsx",
    "src/routes/estate.$slug.tsx",
    "src/components/site/SiteHeader.tsx",
    "src/components/site/SiteFooter.tsx",
  ];
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  for (const phrase of forbidden) {
    assert.equal(combined.includes(phrase), false, `${phrase} is no longer approved copy`);
  }
  assert.equal(combined.includes(required), true, `${required} should be the listing wording`);
});
