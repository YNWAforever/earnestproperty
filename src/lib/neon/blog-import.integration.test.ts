import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
test("repeatable import uses a real owned PostgreSQL container", () => {
  const result = spawnSync("node", ["scripts/test-blog-import-db.mjs"], {
    encoding: "utf8",
    timeout: 240000,
    env: process.env,
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
}, 250000);

test("fresh import preserves existing editorial feature order in owned PostgreSQL", () => {
  const result = spawnSync("node", ["scripts/test-blog-import-feature-order-db.mjs"], {
    encoding: "utf8",
    timeout: 120000,
    env: process.env,
  });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
}, 130000);
