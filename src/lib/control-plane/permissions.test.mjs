import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { hasPermission } from "./permissions.ts";

// The grants live in the client-safe role-permissions.ts; permissions.ts re-exports them and
// keeps the server-side requireStaffPermission.
const source = readFileSync(
  join(process.cwd(), "src/lib/control-plane/role-permissions.ts"),
  "utf8",
);
const serverSource = readFileSync(
  join(process.cwd(), "src/lib/control-plane/permissions.ts"),
  "utf8",
);

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
  assert.match(
    serverSource,
    /requireStaffAccess\(request, \["admin", "manager", "agent", "viewer"\]\)/,
  );
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
    assert.equal(
      hasPermission(["viewer"], permission),
      false,
      `viewer must not hold ${permission}`,
    );
  }
});

test("an unrecognized role grants no permission", () => {
  assert.equal(hasPermission(["not-a-real-role"], "system.health.read"), false);
});

test("only admin holds system.diagnostics.read (FX-17a G-11)", async () => {
  const { canReadDiagnostics } = await import("./permissions.ts");
  assert.equal(hasPermission(["admin"], "system.diagnostics.read"), true);
  assert.equal(canReadDiagnostics(["admin"]), true);
  for (const role of ["manager", "agent", "viewer", "not-a-real-role"]) {
    assert.equal(hasPermission([role], "system.diagnostics.read"), false, role);
    assert.equal(canReadDiagnostics([role]), false, role);
  }
  assert.equal(canReadDiagnostics([]), false);
  assert.equal(canReadDiagnostics(["manager", "agent"]), false);
  assert.equal(canReadDiagnostics(["agent", "admin"]), true);
});

test("operations capabilities carry diagnosticsRead for admin only", async () => {
  const { operationsCapabilitiesForRoles } = await import("./capabilities.ts");
  assert.equal(operationsCapabilitiesForRoles(["admin"]).diagnosticsRead, true);
  for (const role of ["manager", "agent", "viewer"])
    assert.equal(operationsCapabilitiesForRoles([role]).diagnosticsRead, false, role);
});

test("role-permissions.ts is client-safe: no import at all (FX-17a M-3)", () => {
  assert.doesNotMatch(source, /^\s*import/m);
  assert.doesNotMatch(source, /import\(/);
  const client = readFileSync(
    join(process.cwd(), "src/components/admin/AdminTechnicalDetails.tsx"),
    "utf8",
  );
  assert.match(client, /from "@\/lib\/control-plane\/role-permissions"/);
  assert.doesNotMatch(client, /control-plane\/permissions"/);
});
