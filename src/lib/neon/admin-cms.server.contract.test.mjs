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
