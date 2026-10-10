import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// F-01: functions must run in sin1, next to Neon (aws-ap-southeast-1).
test("vercel.ts pins every function to sin1 and nothing else", () => {
  const out = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      "import {config} from './vercel.ts'; console.log(JSON.stringify({regions: config.regions, fns: config.functions ?? null}))",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(out), { regions: ["sin1"], fns: null });
  // One region needs no failover setting.
  assert.doesNotMatch(readFileSync(`${root}vercel.ts`, "utf8"), /functionFailoverRegions/);
});

// Nitro writes .vc-config.json regions only from its own vercel.functions.regions
// (verified with a Vercel-preset build), so vercel.ts alone does not pin the function.
test("vite.config.ts pins the Nitro Vercel function to sin1", () => {
  const source = readFileSync(`${root}vite.config.ts`, "utf8");
  assert.match(
    source,
    /nitro\(\s*\{\s*vercel:\s*\{\s*functions:\s*\{\s*regions:\s*\["sin1"\]\s*\}\s*\}\s*\}\s*\)/,
  );
  assert.doesNotMatch(source, /functionFailoverRegions/);
});
