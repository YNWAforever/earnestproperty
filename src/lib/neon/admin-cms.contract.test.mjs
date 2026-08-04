import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("admin CMS wrappers expose isolated hub and revision operations", () => {
  const source = read("src/lib/neon/admin-cms.ts");
  for (const name of [
    "fetchAdminCmsHub",
    "fetchAdminCmsCategory",
    "fetchAdminCmsEditor",
    "saveAdminCmsDraft",
    "publishAdminCmsRevision",
    "restoreAdminCmsRevision",
    "archiveAdminCmsResource",
  ])
    assert.match(source, new RegExp(`export const ${name}\\b`));
  assert.match(source, /withStaffAuthHeaders/);
  assert.match(source, /saveAdminCmsDraft[\s\S]*?request/);
  assert.match(source, /publishAdminCmsRevision[\s\S]*?request/);
});
