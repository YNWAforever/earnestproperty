import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  // These suites own loopback servers and refuse external targets. Use their named scripts.
  testIgnore: [
    "**/admin-property-maintenance.spec.ts",
    "**/admin-operations-recovery.spec.ts",
    "**/admin-staff-setup.spec.ts",
    "**/admin-whatsapp-mobile.spec.ts",
    "**/admin-property-sync-recovery.spec.ts",
    "**/admin-daily-work.spec.ts",
    "**/admin-campaign-review.spec.ts",
    "**/admin-leave-guards.spec.ts",
    "**/admin-safer-actions.spec.ts",
    "**/admin-performance-readback.spec.ts",
    "**/admin-link-bulk-owned.spec.ts",
    "**/admin-attention.spec.ts",
    "**/public-form-feedback.spec.ts",
    "**/public-mobile-chrome.spec.ts",
  ],
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: remoteBaseUrl ?? "http://localhost:8080",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuse/start the local app only for local runs. A staging base URL must not
  // make Playwright probe or launch localhost in CI.
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        // "/mortgage" does not require a database, so it is a stable local
        // readiness probe even when public data credentials are absent.
        url: "http://localhost:8080/mortgage",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
