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
