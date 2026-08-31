import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Reuses an already-running `npm run dev` if one exists (this repo's dev
  // server runs on 8080, not Vite's default 5173 -- confirmed by starting it
  // during P7b's own research). Starts one otherwise.
  webServer: {
    command: "npm run dev",
    // Playwright's readiness probe requires a 2xx from this URL -- "/" needs
    // a live DATABASE_URL and 500s without one (confirmed while writing this
    // suite), which would make the server never look "ready" in an
    // environment without one. "/mortgage" needs no DB at all, so it's a
    // reliable readiness signal regardless of what data is available.
    url: "http://localhost:8080/mortgage",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
