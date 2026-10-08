import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

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
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(out), { regions: ["sin1"], fns: null });
  // One region needs no failover setting.
  assert.doesNotMatch(readFileSync("vercel.ts", "utf8"), /functionFailoverRegions/);
});
