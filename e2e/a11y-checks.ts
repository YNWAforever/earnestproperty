import { expect, type Page } from "@playwright/test";
export const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

type Viewport = { label: string; width: number; height: number; mobile: boolean };
export const VIEWPORTS: Viewport[] = [
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

export const PAGES: Target[] = [
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
  { name: "17 blog category", path: "/blog?category=市場評論" },
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

export async function expectCurrentLinksMatchPath(page: Page) {
  const mismatched = await page.evaluate(() => {
    const here = location.pathname.replace(/\/+$/, "") || "/";
    return [...document.querySelectorAll<HTMLAnchorElement>('a[aria-current="page"]')]
      .map((link) => ({
        text: (link.textContent ?? "").trim().slice(0, 40),
        path: new URL(link.href, location.href).pathname.replace(/\/+$/, "") || "/",
      }))
      .filter((link) => link.path !== here);
  });
  expect(mismatched, 'every aria-current="page" link points to the current pathname').toEqual([]);
}

export async function expectOneBlogFilterCurrent(page: Page) {
  const filters = page.getByRole("group", { name: "按分類篩選文章" }).locator("a");
  expect(await filters.count(), "blog filter links").toBeGreaterThan(1);
  await expect(
    page.getByRole("group", { name: "按分類篩選文章" }).locator('a[aria-current="page"]'),
    "exactly one blog filter is current",
  ).toHaveCount(1);
}

export async function expectPaginationCurrentIs(page: Page, label: string) {
  const current = page.getByRole("navigation", { name: "分頁" }).locator('[aria-current="page"]');
  await expect(current, "the pagination nav has exactly one current link").toHaveCount(1);
  await expect(current, `and it reads ${label}`).toHaveText(label);
}

// F-20: a p, li or dd with 12+ CJK characters renders at 14 px or more at 375 px. Labels, chips,
// badges, prices and timestamps are not p/li/dd running text; the legal line in the footer
// (copyright or licence) is exempt.
export async function expectNoSmallRunningChinese(page: Page) {
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
  expect(small, "no running Chinese text is under 14 px").toEqual([]);
}
