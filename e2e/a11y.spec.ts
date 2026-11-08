import { test, expect } from "@playwright/test";
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

import {
  TAGS,
  VIEWPORTS,
  PAGES,
  expectCurrentLinksMatchPath,
  expectOneBlogFilterCurrent,
  expectPaginationCurrentIs,
  expectNoSmallRunningChinese,
} from "./a11y-checks";

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
