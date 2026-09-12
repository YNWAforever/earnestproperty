import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const required = ["PLAYWRIGHT_BASE_URL", "STAFF_HANDOFF_BROWSER_FIXTURE"];
for (const key of required)
  if (!process.env[key])
    throw Error(`BLOCKED: ${key} is required for approved synthetic staging browser journeys`);
if (!existsSync(process.env.STAFF_HANDOFF_BROWSER_FIXTURE))
  throw Error("BLOCKED: synthetic fixture manifest does not exist");
const r = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "e2e/staff-handoff.spec.ts"],
  { stdio: "inherit", env: process.env },
);
process.exit(r.status ?? 1);
