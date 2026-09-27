import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  validateStaffHandoffFixture,
  validateStaffHandoffManifest,
} from "./staff-handoff-fixture.mjs";

const { path, base } = validateStaffHandoffFixture(
  process.env.PLAYWRIGHT_BASE_URL,
  process.env.STAFF_HANDOFF_BROWSER_FIXTURE,
);
const fixture = validateStaffHandoffManifest(JSON.parse(readFileSync(path, "utf8")), base);
console.log(
  JSON.stringify({
    targetKind: fixture.targetKind,
    synthetic: true,
    browserJourneys: "prepared-state-only",
    providerSend: false,
  }),
);
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test", "e2e/staff-handoff.spec.ts"],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
