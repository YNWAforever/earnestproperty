import { test, expect } from "@playwright/test";

// The dedicated runner attests Neon identity, seeds actual migrated tables and starts
// its own local app. A normal remote read-only run must not invent these records.
test.skip(
  process.env.EARNEST_SYNTHETIC_PUBLIC_FIXTURE !== "true",
  "Requires the isolated public fixture runner",
);
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.abort();
    return route.continue();
  });
});

for (const keyword of ["A074714", "a074714", " A074714 ", "SYNC-AUDIT-OLD"]) {
  test(`public search resolves current identity: ${JSON.stringify(keyword)}`, async ({ page }) => {
    await page.goto("/listings?deal=all");
    await page.waitForLoadState("networkidle");
    const search = page.getByRole("searchbox", { name: "關鍵字", exact: true });
    await search.fill(keyword);
    await search.press("Enter");
    await expect(page).toHaveURL(/keyword=/);
    const links = page.locator('main a[href^="/property/"]');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", "/property/A074714?deal=rent");
    // A user-entered legacy alias can remain in the filter chip; the listing card must be public.
    await expect(links).not.toContainText("SYNC-AUDIT");
  });
}

test("latest offline sale suppresses old sale while current rental remains", async ({ page }) => {
  const saleResponse = await page.goto("/listings?deal=sale&keyword=A074714");
  expect(saleResponse?.status()).toBe(200);
  await expect(page.locator('main a[href^="/property/"]')).toHaveCount(0);
  const rentResponse = await page.goto("/listings?deal=rent&keyword=A074714");
  expect(rentResponse?.status()).toBe(200);
  await expect(page.locator('main a[href="/property/A074714?deal=rent"]')).toHaveCount(1);
});

test("legacy alias redirects to canonical rental with clean WhatsApp context", async ({ page }) => {
  const response = await page.goto("/property/SYNC-AUDIT-OLD");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/property\/A074714(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "合成現有租盤", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/property\/A074714$/,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    /\/property\/A074714$/,
  );
  await expect(page.locator("main")).not.toContainText("SYNC-AUDIT");
  const links = await page
    .locator('main a[href*="wa.me"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => new URL((node as HTMLAnchorElement).href).searchParams.get("text") ?? ""),
    );
  const contexts = links.filter((text) => text.includes("A074714"));
  expect(contexts.length).toBeGreaterThan(0);
  for (const context of contexts) {
    expect(context).toContain("租");
    expect(context).not.toMatch(/SYNC-AUDIT|EPWA/);
  }
});
