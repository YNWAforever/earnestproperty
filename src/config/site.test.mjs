import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getYouTubeEmbedUrl, isYouTubeVideoUrl } from "../lib/youtube-video-url.js";

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

test("homepage and navigation include Ting Kau content entry points", () => {
  const combined = files.map((file) => readFileSync(file, "utf8")).join("\n");

  for (const text of [
    "汀九",
    "YouTube影片",
    "屋苑開箱",
    "成交快訊",
    "深井 青山公路 汀九買樓租樓",
    "準備搵深井 青山公路 汀九筍盤",
    "深井 青山公路 汀九我哋比你更熟",
    "/district/ting-kau",
    "/videos",
    "/estate-reviews",
    "/transactions",
  ]) {
    assert.match(combined, new RegExp(text));
  }
});

test("header exposes approved mega menu structure and controls", () => {
  const source = readFileSync("src/components/site/SiteHeader.tsx", "utf8");

  for (const text of [
    "地區與屋苑",
    "買租服務",
    "市場資訊",
    "深井買樓租樓",
    "汀九地區頁",
    "青山公路",
    "屋苑入口",
    "查看全部放盤",
    "買樓",
    "租樓",
    "業主放盤 / 免費估價",
    "代理團隊",
    "聯絡門市",
    "YouTube影片",
    "成交快訊",
    "屋苑開箱",
    "市場分析",
    "關於晉誠",
    "觀看最新影片",
    "/district/sham-tseng",
    "/district/ting-kau",
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
  // The mobile cta is deduped both against the header WhatsApp link and
  // against any featured/link item that already points to the same route
  // (e.g. market's "/videos" featured item and cta), to avoid duplicate keys.
  assert.equal(source.includes('"href" in menu.cta && menu.cta.href === whatsappHref'), true);
  assert.equal(source.includes("base.some((item) => itemKey(item) === itemKey(menu.cta))"), true);
  assert.equal(source.includes('split("?")[0].split("#")[0]'), false);
});

test("property experience navigation exposes the mortgage calculator everywhere", () => {
  const header = readFileSync("src/components/site/SiteHeader.tsx", "utf8");
  const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");

  assert.match(header, /to: "\/mortgage", label: "按揭計算機"/);
  assert.match(header, /menuMobileItems\(menu, WHATSAPP_URL\)/);
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
  assert.match(sitemap, /\.catch\(\(\) => \[\]\)/);
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
  const source = readFileSync("src/lib/neon/public-data.server.ts", "utf8");

  assert.match(source, /relation "cms_videos" does not exist/);
  assert.match(source, /return \[\]/);
});

test("videos page orders CMS videos above listing videos", () => {
  const source = readFileSync("src/lib/queries.ts", "utf8");
  const fetchCmsIndex = source.indexOf("fetchCmsVideos()");
  const fetchListingIndex = source.indexOf("fetchVideoListings(12)");
  assert.notEqual(fetchCmsIndex, -1);
  assert.notEqual(fetchListingIndex, -1);
  assert.ok(fetchCmsIndex < fetchListingIndex);

  const routeSource = readFileSync("src/routes/videos.tsx", "utf8");
  const cmsSectionIndex = routeSource.indexOf("{cmsVideos.length > 0 &&");
  const listingSectionIndex = routeSource.indexOf("{listingVideos.length > 0 &&");
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

test("source files avoid the older disallowed listing wording", () => {
  const forbidden = String.fromCharCode(30495, 30436, 28304);
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
  assert.equal(combined.includes(forbidden), false);
});
