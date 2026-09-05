import { test, expect } from "@playwright/test";

test("private to public Link navigation creates a fresh document and history remains isolated", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    route.request().method() === "GET" ? route.continue() : route.abort(),
  );
  await page.goto("/auth/sign-in");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#earnest-ga4")).toHaveCount(0);
  await page.evaluate(() => {
    (window as Window & { privateDocumentCanary?: boolean }).privateDocumentCanary = true;
  });
  const home = page.locator('header a[href="/"]').first();
  await expect(home).toBeVisible();
  await home.hover(); // Exercise the router's normal intent preload before click.
  await home.click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForLoadState("networkidle");
  expect(
    await page.evaluate(
      () => (window as Window & { privateDocumentCanary?: boolean }).privateDocumentCanary,
    ),
  ).toBeUndefined();
  await page.goBack();
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#earnest-ga4")).toHaveCount(0);
});
