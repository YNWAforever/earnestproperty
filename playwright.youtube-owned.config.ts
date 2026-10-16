import { defineConfig, devices } from "@playwright/test";

if (process.env.PLAYWRIGHT_BASE_URL) {
  throw new Error("YouTube fixture refuses PLAYWRIGHT_BASE_URL; synthetic loopback evidence only.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "youtube-videos.spec.ts",
  outputDir: ".audit/youtube-videos-playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 4_000 },
  reporter: "list",
  use: {
    serviceWorkers: "block",
    locale: "zh-HK",
    timezoneId: "Asia/Hong_Kong",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "synthetic-desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "synthetic-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
