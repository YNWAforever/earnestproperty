import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
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
