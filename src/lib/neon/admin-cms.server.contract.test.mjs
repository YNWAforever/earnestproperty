import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("admin CMS server guards draft and publication operations", () => {
  const source = read("src/lib/neon/admin-cms.server.ts");
  assert.match(source, /requireStaffAccess\(request, \["admin", "manager", "agent"\]\)/);
  assert.match(source, /requireStaffAccess\(request, \["admin", "manager"\]\)/);
  assert.match(source, /CMS_REVISION_CONFLICT/);
  assert.match(source, /export async function fetchAdminCmsHub\b/);
  assert.match(source, /export async function saveAdminCmsDraft\b/);
  assert.match(source, /export async function publishAdminCmsRevision\b/);
  assert.match(source, /export async function restoreAdminCmsRevision\b/);
  assert.match(source, /export async function archiveAdminCmsResource\b/);
});

test("the estate projector persists P4's pending fields (aliases, geo, PSF, district_id)", () => {
  const source = read("src/lib/neon/admin-cms.server.ts");
  const start = source.indexOf("INSERT INTO estates");
  assert.notEqual(start, -1);
  const end = source.indexOf('if (resourceType === "article")', start);
  const estateProjector = source.slice(start, end);
  for (const column of ["aliases", "district_id", "avg_saleable_psf", "lat", "lng"]) {
    assert.match(
      estateProjector,
      new RegExp(`\\b${column}\\b`),
      `estate projector must persist ${column}, not silently drop it on publish`,
    );
  }
});

test("fetchAdminCmsEditor exposes the latest revision's raw payload", () => {
  const source = read("src/lib/neon/admin-cms.server.ts");
  const start = source.indexOf("export async function fetchAdminCmsEditor");
  assert.notEqual(start, -1);
  const body = source.slice(start, start + 2000);
  assert.match(body, /payload:/);
});
