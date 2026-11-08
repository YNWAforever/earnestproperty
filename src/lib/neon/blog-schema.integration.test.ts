import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";

// The owned harness uses Node registerHooks, which Bun does not implement.
// Delegate the actual DB assertions to Node, preserving failures and diagnostics.
test("owned database blog schema, body round-trip/restore and sole copy owner contracts", () => {
  const result = spawnSync("node", ["scripts/test-blog-schema-db.mjs"], {
    encoding: "utf8",
    timeout: 240000,
    env: process.env,
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
}, 250000);
