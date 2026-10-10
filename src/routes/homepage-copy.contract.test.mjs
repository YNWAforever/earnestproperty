import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./index.tsx", import.meta.url), "utf8");
// EstateCard/CoreEstateGrid moved out of this route into their own component
// module, so they can be rendered against fixtures by EstateGroupGrid.test.tsx
// rather than only scanned as text. These assertions follow the code.
const gridModuleSource = await readFile(
  new URL("../components/site/EstateGroupGrid.tsx", import.meta.url),
  "utf8",
);

test("homepage uses Chinese-only large headings for the requested sections", () => {
  for (const title of ["最新放盤", "精選樓盤影片", "深井核心屋苑", "為何選晉誠"]) {
    assert.match(source, new RegExp(`title=\\"${title}\\"`));
  }

  for (const title of [
    "Featured Listings",
    "Featured Property Videos",
    "Sham Tseng Signature Estates",
    "Why Earnest Property",
  ]) {
    assert.doesNotMatch(source, new RegExp(`title=\\"${title}\\"`));
  }
});

test("homepage keeps the featured video section in the requested order", () => {
  assert.match(source, /FEATURED LISTINGS[\s\S]*精選樓盤影片/);
});

test("section headers only render an eyebrow when one is supplied", () => {
  assert.match(source, /eyebrow\?: string/);
  assert.match(source, /eyebrow \? \(/);
});

test("the future 青山公路／汀九屋苑 block is not added by this slice", () => {
  assert.doesNotMatch(source, /青山公路及汀九屋苑/);
});

// P3 Task 8 -- the homepage used to repeat its core trust/credibility claims
// (local expertise, licensed, real listings, fast response) across five
// separate spots: hero subhead, WHY US tiles, agent-team-preview tagline,
// about-preview paragraph, and Organization JSON-LD. Only the last two prose
// repeats (agent-team-preview tagline, about-preview paragraph) were cut --
// hero subhead, WHY US tiles, and the JSON-LD were deliberately kept. See
// docs/ROUTE_FUNCTION_PARITY.md for the full before/after/why log.
test("ABOUT PREVIEW no longer restates the local-expertise paragraph", () => {
  assert.doesNotMatch(source, /我哋係一間以深井、青山公路為核心的本地地產代理/);
  assert.doesNotMatch(source, /對每個屋苑座向、樓層景觀、車位、會所和近期叫價都有第一手理解/);
  // The section still has a teaser line and its existing /about CTA -- this
  // is a consolidation, not a deletion of the whole section.
  assert.match(source, /ABOUT PREVIEW/);
  assert.match(source, /<Link to="\/about">/);
});

test("AGENT TEAM PREVIEW no longer restates the local-market/instant-WhatsApp tagline", () => {
  assert.doesNotMatch(source, /熟悉深井、青山公路及汀九市場，直接 WhatsApp 查詢。/);
  // The section still has its own CTA and renders the agent cards.
  const agentPreview = source.slice(
    source.indexOf("{/* AGENT TEAM PREVIEW */}"),
    source.indexOf("{/* MARKET INFO */}"),
  );
  assert.match(agentPreview, /查看全部代理/);
  assert.match(agentPreview, /agents\.map/);
});

test("featured-listings PropertyCard shows a FreshnessStamp", () => {
  assert.match(source, /import \{ FreshnessStamp \} from "@\/components\/layout\/FreshnessStamp";/);
  const propertyCard = source.slice(source.indexOf("function PropertyCard("));
  assert.match(propertyCard, /<FreshnessStamp updatedAt=\{propertyUpdatedAt\(property\)\}/);
});

test("featured-listings empty state uses the shared EmptyState component", () => {
  assert.match(source, /import \{ EmptyState \} from "@\/components\/layout\/EmptyState";/);
  const featuredSection = source.slice(
    source.indexOf("{/* FEATURED LISTINGS"),
    source.indexOf("{/* FEATURED VIDEOS"),
  );
  assert.match(featuredSection, /<EmptyState/);
});

// P3 plan acceptance criterion: CoreEstateGrid already correctly renders an
// em-dash for missing avg PSF / listing-count data, never "0" -- this is a
// regression guard, not new behavior (nothing above this test changes
// CoreEstateGrid).
test("CoreEstateGrid renders an em-dash, never 0, for missing avg PSF or listing count", () => {
  // EstateCard and CoreEstateGrid moved out of this route and into
  // components/site/EstateGroupGrid.tsx, so they can be rendered against
  // fixtures by EstateGroupGrid.test.tsx rather than only scanned as text.
  // These assertions follow the code to the file that now owns it.
  const gridSource = gridModuleSource;
  assert.match(
    gridSource,
    /psf === null \|\| psf === undefined \|\| !Number\.isFinite\(psf\)\s*\?\s*"—"/,
  );
  assert.match(gridSource, /listingCount === null \|\| listingCount === undefined\s*\?\s*"—"/);
});

// 2026-09-01 17-estate expansion: estate-registry.ts's hasPage:true no longer
// implies published -- 17 of the 22 registry entries have hasPage:true while
// staying published=false in Neon until a human clears each one. A card must
// only link (and only count toward the grid at all) once its live DB row
// actually exists in `estates`, or the grid ships a link to a page that
// 404s. This is a real regression this repo shipped and fixed once already
// (see design/estate-expansion-17's final review) -- guarding it here so it
// can't silently return.
test("CoreEstateGrid gates both grid membership and card linking on a live DB row, not hasPage alone", () => {
  // EstateCard and CoreEstateGrid moved out of this route and into
  // components/site/EstateGroupGrid.tsx, so they can be rendered against
  // fixtures by EstateGroupGrid.test.tsx rather than only scanned as text.
  // These assertions follow the code to the file that now owns it.
  const gridSource = gridModuleSource;
  assert.match(
    gridSource,
    /list\.filter\(\(estate\) => estate\.hasPage && live\.has\(estate\.slug\)\)/,
    "the linkable filter must require both hasPage and a live DB row, not hasPage alone",
  );
  assert.doesNotMatch(
    gridSource,
    /list\.filter\(\(estate\) => estate\.hasPage\)\)/,
    "must not regress to gating the grid on hasPage alone",
  );
  assert.match(
    gridSource,
    /return dbRow \? \(/,
    "the card's <Link> wrapper must be gated on dbRow, not estate.hasPage",
  );
});

// Real production bug (systematic-debugging, 2026-09-01): when a
// CoreEstateGrid group has zero linkable estates (true today for 青山公路屋苑
// -- all 12 of its estates stay published=false until each individually
// clears the publish gate), the section rendered its SectionHeader with a
// bare, cardless grid underneath -- looking broken, not like an honest
// "nothing here yet" state. estate-reviews.tsx's own 屋苑文章 section (and
// this same file's 最新放盤 section, a few hundred lines up) already
// established the pattern for this: a shared EmptyState component, not a
// silently-empty container.
test("CoreEstateGrid renders the shared EmptyState, not a bare cardless grid, when a group has zero linkable estates", () => {
  // EstateCard and CoreEstateGrid moved out of this route and into
  // components/site/EstateGroupGrid.tsx, so they can be rendered against
  // fixtures by EstateGroupGrid.test.tsx rather than only scanned as text.
  // These assertions follow the code to the file that now owns it.
  const gridSource = gridModuleSource;
  assert.match(
    gridSource,
    /if \(linkableEstates\.length === 0 && linkableOther\.length === 0\)/,
    "must explicitly branch on the zero-estates case, counting the 其他 tier too",
  );
  assert.match(
    gridSource,
    /<EmptyState/,
    "the zero-estates branch must render the shared EmptyState component, matching estate-reviews.tsx's own pattern",
  );
  assert.match(
    gridSource,
    /whatsappUrl\(`你好，想查詢\$\{districtLabel\}屋苑放盤`\)/,
    "the empty state's CTA must be per-district, not a hardcoded 深井 message",
  );
});

test("homepage does not hide current timestamps when legacy source metadata is missing", () => {
  const card = source.slice(source.indexOf("function PropertyCard("));
  assert.doesNotMatch(card, /property\.source_site &&/);
  assert.doesNotMatch(source, /即日新放盤/);
});

// FX-15 Task 3: anonymous public HTML is CDN-cached. Only these route files
// may opt in, the root layout never does, and none of them (nor the root's
// loader/beforeLoad) may read the request, so cached HTML is identical for
// every visitor.
const CDN_CACHED_ROUTES = [
  "castle-peak-road.$segment.tsx",
  "castle-peak-road.index.tsx",
  "estate.$slug.tsx",
  "index.tsx",
  "listings.tsx",
  "property.$listingNo.tsx",
];

test("only the six allowlisted route files call publicPageCacheHeaders", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(new URL("./", import.meta.url))).filter((name) =>
    /\.tsx?$/.test(name),
  );
  const callers = [];
  for (const name of files) {
    const text = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
    if (text.includes("publicPageCacheHeaders")) callers.push(name);
  }
  assert.deepEqual(callers.sort(), CDN_CACHED_ROUTES);
  for (const name of CDN_CACHED_ROUTES) {
    const text = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
    assert.match(
      text,
      /^\s*headers: (publicPageCacheHeaders|\(ctx\) => publicPageCacheHeaders\()/m,
    );
  }
});

test("__root.tsx has no headers option", async () => {
  const root = await readFile(new URL("./__root.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(root, /^\s*headers\s*:/m);
  assert.doesNotMatch(root, /publicPageCacheHeaders|Vercel-CDN-Cache-Control/);
});

test("no public route reads the request, cookies or headers during SSR", async () => {
  for (const name of [...CDN_CACHED_ROUTES, "castle-peak-road.tsx", "__root.tsx"]) {
    const text = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
    for (const reader of [
      "getRequest",
      "getCookie",
      "getRequestHeader",
      "getRequestIP",
      "setCookie",
      "setResponseHeader",
      "document.cookie",
    ]) {
      assert.equal(text.includes(reader), false, `${name} uses ${reader}`);
    }
  }
});

// TanStack merges every rendered match's `headers` root to leaf, and a child
// returning undefined does not clear its parent's. So a route nested under a
// cached route would silently inherit the CDN header unless it is reviewed
// into the allowlist or explicitly opts out with `private, no-store`.
const CACHED_PARENT_PREFIXES = [
  "castle-peak-road.",
  "listings.",
  "property.$listingNo.",
  "estate.$slug.",
  "index.",
];

function nestedRouteViolation(name, text) {
  if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) return null;
  if (CDN_CACHED_ROUTES.includes(name)) return null;
  // The castle-peak-road layout itself carries no headers.
  if (name === "castle-peak-road.tsx") return null;
  const parent = CACHED_PARENT_PREFIXES.find((prefix) => name.startsWith(prefix));
  if (!parent) return null;
  const optsOut =
    /["']?(Vercel-CDN-Cache-Control|Cache-Control)["']?\s*:\s*["']private, no-store/.test(text);
  return optsOut ? null : `${name} is nested under ${parent.slice(0, -1)}`;
}

test("no route nested under a cached route can inherit the CDN header", async () => {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(new URL("./", import.meta.url), { withFileTypes: true });
  // Flat routes only: a routes subdirectory would need its own review.
  assert.deepEqual(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    [],
  );
  const violations = [];
  for (const entry of entries) {
    const text = await readFile(new URL(`./${entry.name}`, import.meta.url), "utf8");
    const violation = nestedRouteViolation(entry.name, text);
    if (violation) violations.push(violation);
  }
  assert.deepEqual(violations, []);

  // The rule itself: a new child fails unless it opts out explicitly.
  assert.match(
    nestedRouteViolation("listings.compare.tsx", "headers: () => undefined"),
    /listings/,
  );
  assert.match(nestedRouteViolation("property.$listingNo.print.tsx", ""), /property/);
  assert.match(nestedRouteViolation("estate.$slug.reviews.tsx", ""), /estate/);
  assert.match(nestedRouteViolation("castle-peak-road.$segment.map.tsx", ""), /castle-peak-road/);
  assert.equal(
    nestedRouteViolation(
      "listings.compare.tsx",
      'headers: () => ({ "Vercel-CDN-Cache-Control": "private, no-store" }),',
    ),
    null,
  );
  // `_` breaks nesting in flat routes, and other public pages are not children.
  assert.equal(nestedRouteViolation("listings_.compare.tsx", ""), null);
  assert.equal(nestedRouteViolation("estate-reviews.tsx", ""), null);
});

// The SSR closure of the cached routes: every module they (and the root
// layout) import directly, plus the server modules their loaders reach.
test("components and loader helpers rendered on cached routes never read the request", async () => {
  const srcRoot = new URL("../", import.meta.url);
  const routeFiles = [...CDN_CACHED_ROUTES, "castle-peak-road.tsx", "__root.tsx"];
  const modules = new Set([
    "lib/neon/db.server.ts",
    "lib/neon/public-data.server.ts",
    "lib/neon/whatsapp-enquiries.server.ts",
  ]);
  const { existsSync } = await import("node:fs");
  for (const name of routeFiles) {
    const text = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
    for (const [, spec] of text.matchAll(/from "@\/([^"]+)"/g)) {
      const resolved = ["", ".ts", ".tsx", ".js"]
        .map((ext) => `${spec}${ext}`)
        .find(
          (candidate) => /\.[jt]sx?$/.test(candidate) && existsSync(new URL(candidate, srcRoot)),
        );
      if (resolved) modules.add(resolved);
    }
  }
  for (const required of [
    "components/site/SiteHeader.tsx",
    "components/site/SiteFooter.tsx",
    "components/layout/FreshnessStamp.tsx",
    "lib/queries.ts",
    "lib/neon/public-data.ts",
  ]) {
    assert.ok(modules.has(required), `${required} is in the scanned set`);
  }
  const readers = /getRequest|getCookie|getHeader|getRequestHeader|\bcookies\b/;
  for (const module of modules) {
    let text = await readFile(new URL(module, srcRoot), "utf8");
    if (module === "lib/neon/whatsapp-enquiries.ts") {
      // Staff server functions in this module read the request only to
      // authenticate (`requireStaffAccess(getRequest(), …)`); the public
      // resolver the loaders call must not.
      const start = text.indexOf("export const resolveWhatsappLinks");
      const end = text.indexOf("export const", start + 1);
      assert.ok(start >= 0, "resolveWhatsappLinks is defined");
      assert.doesNotMatch(text.slice(start, end < 0 ? undefined : end), readers);
      for (const line of text.split("\n").filter((l) => l.includes("getRequest()"))) {
        assert.match(line, /requireStaffAccess\(getRequest\(\)/, line);
      }
      continue;
    }
    assert.doesNotMatch(text, readers, module);
  }
});

test("the footer year cannot cause a hydration mismatch on a cached page", async () => {
  const footer = await readFile(
    new URL("../components/site/SiteFooter.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(footer, /new Date\(\)\.getFullYear\(\)/);
  assert.match(footer, /timeZone: "Asia\/Hong_Kong", year: "numeric"/);
  assert.match(footer, /key=\{mounted \? "client" : "server"\} suppressHydrationWarning/);
});

test("the loader returns homeVideos and never cmsVideos", () => {
  const loaderAll = source.slice(source.indexOf("loader:"), source.indexOf("errorComponent"));
  const loader = loaderAll
    .slice(loaderAll.lastIndexOf("return {"))
    .replace(/toHomeVideos\([\s\S]*?HOME_VIDEO_COUNT,?\s*\)/, "");
  assert.match(loader, /homeVideos/);
  assert.doesNotMatch(loader, /^\s*cmsVideos\s*[,:]/m);
  assert.doesNotMatch(source.slice(source.indexOf("function HomePage")), /cmsVideos/);
});

test("hero, 最新放盤 and 精選樓盤影片 sections are not deferred", () => {
  const start = source.indexOf("function HomePage");
  const body = source.slice(start);
  const cut = body.indexOf("{/* CORE ESTATES */}");
  assert.ok(cut > 0);
  assert.doesNotMatch(body.slice(0, cut), /defer-render/);
});

test("no section before an in-page anchor target is deferred, and the sections after the form are", async () => {
  const body = source.slice(source.indexOf("function HomePage"));
  // Safari has no scroll anchoring: a deferred section above the target resizes
  // after the jump and pushes the target out of view.
  const header = await readFile(
    new URL("../components/site/SiteHeader.tsx", import.meta.url),
    "utf8",
  );
  const ids = [...body.matchAll(/\bid="([a-z][\w-]*)"/g)].map((m) => m[1]);
  const targets = ids.filter((id) => header.includes("#" + id));
  assert.ok(targets.includes("owner-valuation"));
  for (const id of targets) {
    const before = body.slice(0, body.indexOf(`id="${id}"`));
    assert.doesNotMatch(before, /defer-render/, `deferred section above #${id}`);
  }
  const after = body.slice(body.indexOf('id="owner-valuation"'));
  const afterSections = after.match(/<section\b[^>]*>/g) ?? [];
  assert.ok(afterSections.length >= 1);
  for (const tag of afterSections) assert.match(tag, /defer-render/);
});

test("public number formatting passes zh-HK and matches en-US output", async () => {
  assert.equal((1234567.5).toLocaleString("zh-HK"), (1234567.5).toLocaleString("en-US"));
  const files = [
    "../routes/listings.tsx",
    "../routes/estate.$slug.tsx",
    "../routes/castle-peak-road.index.tsx",
    "../routes/district.sham-tseng.tsx",
    "../routes/transactions.tsx",
    "../components/site/CorridorInventory.tsx",
    "../components/site/EstateMarketSnapshot.tsx",
    "../content/core-estates.ts",
  ];
  for (const f of files) {
    const text = await readFile(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(text, /toLocale(Date)?String\(\)/, `${f} formats without a locale`);
  }
});

test("home videos match the pre-change selection for a mixed featured and CMS fixture", async () => {
  const { toHomeVideos } = await import("../lib/home-videos.js");
  // Old logic: [featured walkthroughs..., cms...] deduped by video id, first three.
  const listing = (n, yt) => ({
    key: `listing-${n}`,
    title: `T${n}`,
    url: `https://www.youtube.com/watch?v=${yt}`,
    eyebrow: "e",
    listingNo: `N${n}`,
  });
  const cms = (id, yt) => ({ id, title: "", video_url: `https://youtu.be/${yt}` });
  const out = toHomeVideos(
    [listing(1, "aaaaaaaaaaa"), listing(2, "bbbbbbbbbbb")],
    [cms("x", "bbbbbbbbbbb"), cms("y", "ccccccccccc"), cms("z", "ddddddddddd")],
    3,
  );
  assert.deepEqual(
    out.map((v) => v.key),
    ["listing-1", "listing-2", "cms-y"],
  );
  assert.equal(out[2].title, "晉誠地產 YouTube影片");
});
