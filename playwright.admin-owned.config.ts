import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "admin-property-maintenance.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 20000,
  expect: { timeout: 4000 },
  reporter: "list",
  outputDir: ".audit/property-maintenance-playwright",
  projects: [{ name: "owned-chromium", use: { ...devices["Desktop Chrome"] } }],
});
