import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./api.mls-sync.ts", import.meta.url), "utf8");
const vercel = readFileSync(new URL("../../vercel.ts", import.meta.url), "utf8");

test("mls sync route protects cron endpoint", () => {
  assert.match(source, /createFileRoute\(["']\/api\/mls-sync["']\)/);
  assert.match(source, /authorization/i);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /status:\s*401/);
  assert.match(source, /createMlsImporter/);
});

test("vercel config registers the daily mls cron", () => {
  assert.match(vercel, /crons/);
  assert.match(vercel, /\/api\/mls-sync/);
  assert.match(vercel, /0 20 \* \* \*/);
});
