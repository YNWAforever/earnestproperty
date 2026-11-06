import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";

test("integrated importer/CMS/public workflow preserves 101 articles on an owned database", () => {
  const result = spawnSync(
    "node",
    ["--experimental-test-module-mocks", "scripts/test-blog-cms-db.mjs"],
    { encoding: "utf8", timeout: 240000, env: process.env },
  );
  if (result.stdout) console.log(result.stdout);
  const warning =
    `(node:${result.pid}) ExperimentalWarning: Module mocking is an experimental feature and might change at any time\n(Use ` +
    "`node --trace-warnings ...`" +
    ` to show where the warning was created)\n`;
  const stderr = (result.stderr ?? "").replaceAll("\r\n", "\n");
  const unexpected = stderr.replace(warning, "");
  if (unexpected) console.error(unexpected);
  expect(stderr.split(warning).length - 1).toBe(1);
  expect(unexpected).toBe("");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
}, 250000);
