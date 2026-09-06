import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePropertyhkRequest } from "../lib/mls/propertyhk-http.mjs";
test("Propertyhk file route only binds server snapshot ingestion; existing GET status retained", () => {
  const route = readFileSync("src/routes/api.admin.propertyhk-sync.ts", "utf8");
  assert.match(route, /createFileRoute\("\/api\/admin\/propertyhk-sync"\)/);
  assert.match(route, /POST:/);
  assert.match(route, /PROPERTYHK_SYNC_SECRET/);
  assert.match(route, /ingestSnapshot\(payload, options\)/);
  assert.doesNotMatch(route, /crawl|playwright|puppeteer|child_process|fetch\(/i);
  const status = readFileSync("src/routes/api.mls-sync.ts", "utf8");
  assert.match(status, /GET:/);
  assert.doesNotMatch(status, /POST:/);
});
test("wrong method and content type never reach ingestion", async () => {
  for (const [method, contentType, status] of [
    ["GET", "application/json", 405],
    ["POST", "text/plain", 400],
  ]) {
    const response = await handlePropertyhkRequest(
      new Request("https://example.invalid", {
        method,
        headers: { authorization: "Bearer secret", "content-type": contentType },
      }),
      { secret: "secret", ingest: () => assert.fail("no ingestion") },
    );
    assert.equal(response.status, status);
  }
});
