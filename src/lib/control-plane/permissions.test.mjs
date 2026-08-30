import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { hasPermission } from "./permissions.ts";

const source = readFileSync(join(process.cwd(), "src/lib/control-plane/permissions.ts"), "utf8");

test("StaffRole includes viewer and rolePermissions grants it read-only permissions", () => {
  assert.match(source, /viewer: new Set\(\[\s*"system\.health\.read",\s*"audit\.read",?\s*\]\)/);
});

test("hasPermission's role-literal check includes viewer", () => {
  assert.match(
    source,
    /role === "admin" \|\| role === "manager" \|\| role === "agent" \|\| role === "viewer"/,
  );
});

test("requireStaffPermission admits viewer into requireStaffAccess's allowed-role list", () => {
  assert.match(source, /requireStaffAccess\(request, \["admin", "manager", "agent", "viewer"\]\)/);
});

test("viewer holds exactly system.health.read and audit.read, nothing else", () => {
  assert.equal(hasPermission(["viewer"], "system.health.read"), true);
  assert.equal(hasPermission(["viewer"], "audit.read"), true);
  for (const permission of [
    "ai.draft.generate",
    "ai.knowledge.rebuild",
    "campaign.queue",
    "cms.publish",
    "staff.manage",
    "system.jobs.read",
    "system.jobs.retry",
    "system.jobs.cancel",
    "system.migrations.plan",
    "system.migrations.apply",
  ]) {
    assert.equal(hasPermission(["viewer"], permission), false, `viewer must not hold ${permission}`);
  }
});

test("an unrecognized role grants no permission", () => {
  assert.equal(hasPermission(["not-a-real-role"], "system.health.read"), false);
});
