import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("estate editor routes exist and export a Route", () => {
  for (const [path, routePath] of [
    ["src/routes/admin.estates.tsx", "/admin/estates"],
    ["src/routes/admin.estates_.$id.tsx", "/admin/estates_/$id"],
    ["src/routes/admin.estates_.new.tsx", "/admin/estates_/new"],
  ]) {
    const source = read(path);
    assert.match(source, /export const Route = createFileRoute/, `${path} must export Route`);
    assert.match(source, new RegExp(`createFileRoute\\("${routePath.replace(/\$/g, "\\$")}"\\)`));
    assert.match(source, /"robots", content: "noindex"/, `${path} must be noindexed`);
  }
});

test("the estate editor routes through the same revision engine as the CMS tab's dialog", () => {
  const source = read("src/components/admin/estates/AdminEstateEditorForm.tsx");
  assert.match(source, /from "@\/lib\/neon\/admin-cms"/);
  assert.match(source, /saveAdminCmsDraft/);
  assert.match(source, /publishAdminCmsRevision/);
  assert.match(source, /restoreAdminCmsRevision/);
  assert.match(source, /archiveAdminCmsResource/);
});

test("the form covers every P4 field the old CMS dialog has no UI for", () => {
  const source = read("src/components/admin/estates/AdminEstateEditorForm.tsx");
  for (const field of [
    "aliases",
    "address",
    "blocks",
    "school_net_code",
    "transport_note",
    "district_id",
    "avg_saleable_psf",
    "lat",
    "lng",
    "verified_at",
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`), `form must expose ${field}`);
  }
});

test("verified_at is stamped by a button, never a manually-editable date field", () => {
  const source = read("src/components/admin/estates/AdminEstateEditorForm.tsx");
  assert.doesNotMatch(source, /type="date"[^>]*verified_at|verified_at[^>]*type="date"/);
  assert.match(source, /標記為已核實/);
});

test("the sidebar has a 屋苑管理 entry pointing at /admin/estates", () => {
  const source = read("src/components/admin/AdminShell.tsx");
  assert.match(source, /to: "\/admin\/estates", label: "屋苑管理"/);
});

test("every estate editor route is registered in the generated route tree", () => {
  const routeTree = read("src/routeTree.gen.ts");
  for (const path of ["'/admin/estates'", "'/admin/estates/$id'", "'/admin/estates/new'"]) {
    assert.ok(
      routeTree.includes(path),
      `${path} missing from routeTree.gen.ts -- did you run npm run build after adding the route file?`,
    );
  }
});
