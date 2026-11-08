import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// FX-16 Task 7: a 27-page axe gate at 375 and 1440 px against the WCAG 2.2 AA tags.
//
// It only loads pages (GET); it never submits a form. Run it against a preview or staging that has
// data (public pages read Neon), not in the main CI matrix:
//   PLAYWRIGHT_BASE_URL=<preview> npm run test:a11y
// A Vercel-protected preview needs access, supplied only through the environment and never
// logged: VERCEL_AUTOMATION_BYPASS_SECRET (sent as a header to the target origin only) and/or
// A11Y_STORAGE_STATE (path to a Playwright storageState that holds the share cookie).
//
// With PLAYWRIGHT_BASE_URL set, a 5xx fails the run (a remote target must have data). Without it
// (a local `npm run dev` with no database) a 5xx skips the page.

const REMOTE = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const STORAGE_STATE = process.env.A11Y_STORAGE_STATE;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

type Viewport = { label: string; width: number; height: number; mobile: boolean };
const VIEWPORTS: Viewport[] = [
  { label: "375px", width: 375, height: 812, mobile: true },
  { label: "1440px", width: 1440, height: 900, mobile: false },
];

type Target = { name: string; path: string | ((page: Page) => Promise<string | null>) };

// Dynamic paths are discovered on the live data set, so the spec works on any data.
const firstHref = (selector: string, from: string) => async (page: Page) => {
  const response = await page.goto(from);
  if (!response || response.status() >= 400) return null;
  // count() does not wait, so a page with no cards returns null (a clean local skip) instead of
  // getAttribute() waiting out the 30 s test timeout.
  if ((await page.locator(selector).count()) === 0) return null;
  return page.locator(selector).first().getAttribute("href");
};

const PAGES: Target[] = [
  { name: "1 home", path: "/" },
  { name: "2 listings all", path: "/listings?deal=all&page=1" },
  { name: "3 listings sale page 2", path: "/listings?deal=sale&page=2&sort=newest" },
  { name: "4 listings rent", path: "/listings?deal=rent&page=1&sort=newest" },
  {
    // Discovered from the sale list (not deal=all, which is newest first and can be a rent
    // listing, duplicating page 6), so the sale layout -- the 計月供 bar and mortgage teaser -- is
    // always scanned.
    name: "5 property sale (first card on sale listings)",
    path: firstHref('a[href^="/property/"]', "/listings?deal=sale&page=1&sort=newest"),
  },
  {
    name: "6 property rent (first card on rent listings)",
    path: async (page) => {
      const href = await firstHref(
        'a[href^="/property/"]',
        "/listings?deal=rent&page=1&sort=newest",
      )(page);
      return href ? `${href.split("?")[0]}?deal=rent` : null;
    },
  },
  { name: "7 estate bellagio", path: "/estate/bellagio" },
  { name: "8 estate hong-kong-garden", path: "/estate/hong-kong-garden" },
  { name: "9 castle-peak-road", path: "/castle-peak-road" },
  { name: "10 castle-peak-road sham-tseng", path: "/castle-peak-road/sham-tseng" },
  { name: "11 castle-peak-road ting-kau", path: "/castle-peak-road/ting-kau" },
  { name: "12 district sham-tseng", path: "/district/sham-tseng" },
  { name: "13 privacy (legal template)", path: "/privacy" },
  { name: "14 agents", path: "/agents" },
  { name: "15 agent (first agent link)", path: firstHref('a[href^="/agents/"]', "/agents") },
  { name: "16 blog", path: "/blog" },
  { name: "17 blog category", path: "/blog?category=樓市分析" },
  { name: "18 blog sham-tseng-buying-guide-2026", path: "/blog/sham-tseng-buying-guide-2026" },
  { name: "19 blog bellagio-estate-review", path: "/blog/bellagio-estate-review" },
  { name: "20 blog editorial-standards", path: "/blog/editorial-standards" },
  { name: "21 estate-reviews", path: "/estate-reviews" },
  { name: "22 videos", path: "/videos" },
  { name: "23 transactions", path: "/transactions" },
  { name: "24 mortgage", path: "/mortgage" },
  { name: "25 contact", path: "/contact" },
  { name: "26 about", path: "/about" },
  { name: "27 not found", path: "/zz-fx16-not-found" },
];

if (STORAGE_STATE) test.use({ storageState: STORAGE_STATE });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = baseURL ? new URL(baseURL).origin : null;
  await page.route("**/*", (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.abort();
    // The bypass secret goes to the target origin only, never to third parties (maps, fonts).
    if (BYPASS && origin && new URL(request.url()).origin === origin) {
      return route.continue({
        headers: {
          ...request.headers(),
          "x-vercel-protection-bypass": BYPASS,
          "x-vercel-set-bypass-cookie": "true",
        },
      });
    }
    return route.continue();
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`a11y at ${viewport.label}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });

    for (const target of PAGES) {
      test(`${target.name}`, async ({ page }, testInfo) => {
        const path = typeof target.path === "string" ? target.path : await target.path(page);
        if (!path) {
          testInfo.skip(!REMOTE, `${target.name}: no link discovered on the source page`);
          expect(path, `${target.name}: no link discovered on the source page`).toBeTruthy();
          return;
        }
        const expectedStatus = path.startsWith("/zz-fx16-not-found") ? 404 : 200;
        const response = await page.goto(path);
        const status = response?.status() ?? 0;
        if (!REMOTE && status >= 500) {
          testInfo.skip(true, `${path} returned ${status}: needs a live DATABASE_URL`);
          return;
        }
        expect(status, `${path} status`).toBe(expectedStatus);
        await page.waitForLoadState("networkidle").catch(() => undefined);

        // iframes (the Google Maps embeds) are third-party markup this app cannot remediate.
        const results = await new AxeBuilder({ page }).withTags(TAGS).exclude("iframe").analyze();
        const found = results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.target.join(" ")).slice(0, 8),
        }));
        expect.soft(found, JSON.stringify(found, null, 2)).toEqual([]);

        await expectCurrentLinksMatchPath(page);

        const url = new URL(page.url());
        if (url.pathname === "/blog") await expectOneBlogFilterCurrent(page);
        if (url.pathname === "/listings" && url.searchParams.get("page") === "2") {
          await expectPaginationCurrentIs(page, "2");
        }
        if (viewport.mobile) await expectNoSmallRunningChinese(page);
      });
    }
  });
}

async function expectCurrentLinksMatchPath(page: Page) {
  const mismatched = await page.evaluate(() => {
    const here = location.pathname.replace(/\/+$/, "") || "/";
    return [...document.querySelectorAll<HTMLAnchorElement>('a[aria-current="page"]')]
      .map((link) => ({
        text: (link.textContent ?? "").trim().slice(0, 40),
        path: new URL(link.href, location.href).pathname.replace(/\/+$/, "") || "/",
      }))
      .filter((link) => link.path !== here);
  });
  expect
    .soft(mismatched, 'every aria-current="page" link points to the current pathname')
    .toEqual([]);
}

async function expectOneBlogFilterCurrent(page: Page) {
  const filters = page.getByRole("group", { name: "按分類篩選文章" }).locator("a");
  expect(await filters.count(), "blog filter links").toBeGreaterThan(1);
  await expect
    .soft(
      page.getByRole("group", { name: "按分類篩選文章" }).locator('a[aria-current="page"]'),
      "exactly one blog filter is current",
    )
    .toHaveCount(1);
}

async function expectPaginationCurrentIs(page: Page, label: string) {
  const current = page.getByRole("navigation", { name: "分頁" }).locator('[aria-current="page"]');
  await expect.soft(current, "the pagination nav has exactly one current link").toHaveCount(1);
  await expect.soft(current, `and it reads ${label}`).toHaveText(label);
}

// F-20: a p, li or dd with 12+ CJK characters renders at 14 px or more at 375 px. Labels, chips,
// badges, prices and timestamps are not p/li/dd running text; the legal line in the footer
// (copyright or licence) is exempt.
async function expectNoSmallRunningChinese(page: Page) {
  const small = await page.evaluate(() => {
    const cjk = /[㐀-鿿豈-﫿]/g;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("p, li, dd")) {
      const text = (el.textContent ?? "").replace(/\s+/g, "");
      if ((text.match(cjk) ?? []).length < 12) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!rect.width || !rect.height || style.visibility === "hidden") continue;
      if (el.closest("footer") && /©|牌照|licen[cs]e/i.test(text)) continue;
      const size = parseFloat(style.fontSize);
      if (size < 14) out.push(`${size}px ${text.slice(0, 30)}`);
    }
    return out;
  });
  expect.soft(small, "no running Chinese text is under 14 px").toEqual([]);
}
