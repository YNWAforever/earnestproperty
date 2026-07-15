import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const healthRoutePath = "src/routes/api.admin.control-plane.health.ts";

test("health route is permissioned and uses stable response envelopes", () => {
  const source = readFileSync(healthRoutePath, "utf8");

  assert.match(source, /requireStaffPermission\(request, "system\.health\.read"\)/);
  assert.match(source, /runControlPlaneHealthChecks\(\)/);
  assert.match(source, /successResponse\(health, context\.requestId\)/);
  assert.match(source, /errorResponse\(error, context\.requestId, status\)/);
  assert.doesNotMatch(source, /process\.env/);
});

test("health service queries table and column metadata once each", () => {
  const source = readFileSync("src/lib/control-plane/health.server.ts", "utf8");
  assert.equal((source.match(/information_schema\.tables/g) ?? []).length, 1);
  assert.equal((source.match(/information_schema\.columns/g) ?? []).length, 1);
});

test("migration and audit routes enforce exact permissions and bounded inputs", () => {
  const listSource = readFileSync("src/routes/api.admin.control-plane.migrations.ts", "utf8");
  const planSource = readFileSync(
    "src/routes/api.admin.control-plane.migrations.$id.plan.ts",
    "utf8",
  );
  const applySource = readFileSync(
    "src/routes/api.admin.control-plane.migrations.$id.apply.ts",
    "utf8",
  );
  const auditSource = readFileSync("src/routes/api.admin.control-plane.audit.ts", "utf8");

  assert.match(listSource, /requireStaffPermission\(request, "system\.migrations\.plan"\)/);
  assert.match(planSource, /requireStaffPermission\(request, "system\.migrations\.plan"\)/);
  assert.match(applySource, /requireStaffPermission\(request, "system\.migrations\.apply"\)/);
  assert.match(auditSource, /requireStaffPermission\(request, "audit\.read"\)/);

  assert.match(planSource, /z\.object\(\{\}\)\.strict\(\)/);
  assert.match(
    applySource,
    /approvalToken:\s*z\.string\(\)\.min\(20\)/,
  );
  for (const source of [planSource, applySource]) {
    assert.doesNotMatch(source, /(?:sql|statement|query)\s*:/i);
  }
  for (const key of ["cursor", "limit", "outcome", "action", "requestId"]) {
    assert.match(auditSource, new RegExp(`${key}:`));
  }
  assert.match(auditSource, /\.max\(100\)/);
  assert.doesNotMatch(auditSource, /process\.env/);
});

test("audit service uses keyset pagination and re-sanitizes stored metadata", () => {
  const source = readFileSync("src/lib/control-plane/audit.server.ts", "utf8");
  assert.match(source, /\(created_at, id\) < \(\$4::timestamptz, \$5::uuid\)/);
  assert.match(source, /limit \+ 1/);
  assert.match(source, /sanitizeAuditMetadata\(row\.metadata/);
  assert.doesNotMatch(source, /OFFSET/i);
});
