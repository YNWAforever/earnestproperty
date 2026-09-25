import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const incremental = readFileSync(new URL("./api.youtube-sync.ts", import.meta.url), "utf8");
const full = readFileSync(new URL("./api.youtube-sync.full.ts", import.meta.url), "utf8");

test("incremental route retains protected GET and staff POST for manual sync", () => {
  assert.match(incremental, /createFileRoute\(["']\/api\/youtube-sync["']\)/);
  assert.match(incremental, /GET/);
  assert.match(incremental, /POST/);
  assert.match(incremental, /handlers\.cron\(request, ["']incremental["']\)/);
  assert.match(incremental, /handlers\.staff\(request\)/);
});

test("full route retains its protected GET handler for manual sync", () => {
  assert.match(full, /createFileRoute\(["']\/api\/youtube-sync\/full["']\)/);
  assert.match(full, /handlers\.cron\(request, ["']full["']\)/);
  assert.doesNotMatch(full, /POST/);
});

const publicData = readFileSync(
  new URL("../lib/neon/public-data.server.ts", import.meta.url),
  "utf8",
);
const vercel = readFileSync(new URL("../../vercel.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

test("public CMS video reads combine staff publication with source availability", () => {
  const fetchCmsVideos = publicData.match(
    /export async function fetchCmsVideos\(\)[\s\S]*?\r?\n}\r?\n/,
  )?.[0];
  assert.ok(fetchCmsVideos, "fetchCmsVideos must remain exported");
  assert.match(
    fetchCmsVideos,
    /published = true[\s\S]*youtube_managed = false OR youtube_available = true/,
  );
  assert.match(
    fetchCmsVideos,
    /ORDER BY sort_order ASC, COALESCE\(youtube_published_at, created_at\) DESC/,
  );
  assert.match(fetchCmsVideos, /SELECT id, title, video_url, description, sort_order, created_at/);
});

test("Vercel does not invoke YouTube or job routes on an idle schedule", () => {
  assert.match(vercel, /crons:\s*\[\s*\]/);
});

test("server-only configuration is documented without values", () => {
  assert.match(envExample, /^YOUTUBE_API_KEY=""$/m);
  assert.doesNotMatch(envExample, /YOUTUBE_API_KEY=".+"/);
  assert.match(envExample, /YouTube Data API v3/i);
});

test("package exposes deterministic and disposable-database YouTube suites", () => {
  assert.match(packageJson.scripts["test:youtube-sync"], /youtube-reconciliation\.test\.ts/);
  assert.match(packageJson.scripts["test:youtube-sync"], /api\.youtube-sync\.test\.mjs/);
  assert.equal(
    packageJson.scripts["test:youtube-sync:db"],
    "bun test --no-env-file src/lib/youtube-sync/youtube-sync.integration.test.mjs",
  );
});
