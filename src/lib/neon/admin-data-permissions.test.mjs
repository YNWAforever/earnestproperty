import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(process.cwd(), "src/lib/neon/admin-data.ts"), "utf8");

// Every CMS-write server fn must gate on the declared cms.publish permission,
// not a hardcoded ["admin", "manager"] array -- see the P6a plan's §0 for why.
const CMS_WRITE_FUNCTIONS = [
  "saveAdminEstateServer",
  "saveAdminArticleServer",
  "saveAdminFaqServer",
  "saveAdminCmsVideoServer",
  "deleteAdminFaqServer",
  "updateAdminMediaAssetServer",
  "checkAdminFaqConflictsServer",
];

for (const fnName of CMS_WRITE_FUNCTIONS) {
  test(`${fnName} enforces cms.publish via requireStaffPermission`, () => {
    const start = source.indexOf(`const ${fnName} = createServerFn`);
    assert.notEqual(start, -1, `${fnName} not found in admin-data.ts`);
    const handlerSlice = source.slice(start, start + 400);
    assert.match(
      handlerSlice,
      /requireStaffPermission\(getRequest\(\), "cms\.publish"\)/,
      `${fnName} must call requireStaffPermission(getRequest(), "cms.publish")`,
    );
  });
}

test("rebuildAdminAiKnowledgeServer enforces ai.knowledge.rebuild via requireStaffPermission", () => {
  const start = source.indexOf("const rebuildAdminAiKnowledgeServer = createServerFn");
  assert.notEqual(start, -1);
  const handlerSlice = source.slice(start, start + 300);
  assert.match(handlerSlice, /requireStaffPermission\(getRequest\(\), "ai\.knowledge\.rebuild"\)/);
});
