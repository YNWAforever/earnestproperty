import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const incremental = readFileSync(new URL("./api.youtube-sync.ts", import.meta.url), "utf8");
const full = readFileSync(new URL("./api.youtube-sync.full.ts", import.meta.url), "utf8");

test("daily route exposes cron GET and staff POST through the shared handlers", () => {
  assert.match(incremental, /createFileRoute\(["']\/api\/youtube-sync["']\)/);
  assert.match(incremental, /GET/);
  assert.match(incremental, /POST/);
  assert.match(incremental, /handlers\.cron\(request, ["']incremental["']\)/);
  assert.match(incremental, /handlers\.staff\(request\)/);
});

test("monthly route exposes only full cron GET", () => {
  assert.match(full, /createFileRoute\(["']\/api\/youtube-sync\/full["']\)/);
  assert.match(full, /handlers\.cron\(request, ["']full["']\)/);
  assert.doesNotMatch(full, /POST/);
});
