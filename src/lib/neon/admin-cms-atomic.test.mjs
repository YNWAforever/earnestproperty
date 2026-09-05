import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeRestoreDraft } from "./cms-revisions.ts";
test("restore provenance is distinct from current publication base", () => {
  const result = makeRestoreDraft(
    {
      id: "one",
      resource_type: "article",
      resource_id: "a",
      version_number: 1,
      payload: { title: "old" },
    },
    3,
  );
  assert.equal(result.basePublishedVersion, 3);
  assert.equal(result.restoredFromRevisionId, "one");
});
test("atomic migration locks resource before reading and guards persisted edit token", () => {
  const sql = readFileSync("neon/migrations/20260905110000_cms_atomic_mutations.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /draft_edit_version = p_edit/);
  assert.match(sql, /CMS_REVISION_CONFLICT/);
  assert.match(sql, /cms_published/);
  assert.match(sql, /cms_archived/);
  assert.match(sql, /CMS_IMMUTABLE_REVISION/);
});
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const serverSource = readFileSync("src/lib/neon/admin-cms.server.ts", "utf8");
function injected({ roles = ["admin"], fail = false } = {}) {
  const calls = [];
  const row = {
    id: "draft",
    resource_type: "article",
    resource_id: "resource",
    version_number: 4,
    draft_edit_version: 8,
    payload: { title: "Persisted", slug: "persisted" },
    base_published_version: 3,
    current_published_version: 3,
    restored_from_revision_id: "history",
    created_at: "2026-09-05",
    published_at: "2026-09-05",
  };
  const modules = {
    "@tanstack/react-start/server-only": {},
    "@tanstack/react-start/server": { getRequest: () => ({}) },
    "./auth.server": {
      requireStaffAccess: async (_request, allowed) => {
        if (!roles.some((r) => allowed.includes(r))) throw Error("FORBIDDEN");
        return { staffId: "actor", roles };
      },
    },
    "./db.server": {
      queryRows: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.startsWith("SELECT resource_type"))
          return [{ resource_type: "article", resource_id: "resource" }];
        if (fail) throw Error("injected_database_failure");
        return [{ revision: row }];
      },
      stringOrEmpty: (v) => (v == null ? "" : String(v)),
      stringOrNull: (v) => (v == null ? null : String(v)),
      dateOrNull: (v) => v ?? null,
    },
    "./cms-revisions": { CMS_RESOURCE_TYPES: ["estate", "article", "video", "faq", "media"] },
    "./cms-videos-schema": {},
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(serverSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, name);
        return modules[name];
      },
      structuredClone,
      Date,
      Error,
    },
  );
  return { api: exports, calls };
}
const mutationInput = {
  resourceType: "article",
  resourceId: "resource",
  payload: { title: "Local", slug: "local" },
  basePublishedVersion: 3,
  draftRevisionId: "draft",
  draftEditVersion: 7,
  revisionId: "draft",
};
const operations = [
  "saveAdminCmsDraft",
  "publishAdminCmsRevision",
  "restoreAdminCmsRevision",
  "archiveAdminCmsResource",
];
test("actual server authorization gates every mutation and never calls DB for denied roles", async () => {
  for (const roles of [["admin"], ["manager"], ["agent"], ["viewer"], []])
    for (const operation of operations) {
      const { api, calls } = injected({ roles });
      const allowed =
        roles.includes("admin") ||
        roles.includes("manager") ||
        (roles.includes("agent") && operation === "saveAdminCmsDraft");
      if (allowed) {
        await api[operation](mutationInput, {});
        assert.ok(calls.length > 0);
      } else {
        await assert.rejects(api[operation](mutationInput, {}), /FORBIDDEN/);
        assert.equal(calls.length, 0);
      }
    }
});
test("save sends revision identity and edit version, returns persisted increment instead of local state", async () => {
  const { api, calls } = injected();
  const { revisionId, ...input } = mutationInput;
  const saved = await api.saveAdminCmsDraft(input, {});
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT cms_mutate/);
  assert.deepEqual(Array.from(calls[0].params.slice(5)), [3, 7, "draft"]);
  assert.equal(saved.editState.draftEditVersion, 8);
  assert.equal(saved.editState.payload.title, "Persisted");
  assert.equal(saved.revisionId, "draft");
});
test("publish and archive make exactly one atomic mutation request, no separate audit/live writes", async () => {
  for (const operation of ["publishAdminCmsRevision", "archiveAdminCmsResource"]) {
    const { api, calls } = injected();
    await api[operation](mutationInput, {});
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /SELECT cms_mutate/);
  }
});
test("restore uses only identity before atomic mutation and returns database current publication base", async () => {
  const { api, calls } = injected();
  const saved = await api.restoreAdminCmsRevision({ revisionId: "history" }, {});
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /SELECT resource_type, resource_id/);
  assert.equal(calls[1].params[0], "restore");
  assert.equal(calls[1].params[7], "history");
  assert.equal(saved.editState.basePublishedVersion, 3);
  assert.equal(saved.editState.restoredFromRevisionId, "history");
});
test("database failure propagates for all operations without a successful or separately audited result", async () => {
  for (const operation of operations) {
    const { api, calls } = injected({ fail: true });
    await assert.rejects(api[operation](mutationInput, {}), /injected_database_failure/);
    assert.equal(calls.filter((c) => c.sql.startsWith("SELECT cms_mutate")).length, 1);
  }
});
test("all SQL mutation reads follow shared resource lock; history has database uniqueness and immutability", () => {
  const sql = readFileSync("neon/migrations/20260905110000_cms_atomic_mutations.sql", "utf8");
  const mutate = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION cms_mutate"),
    sql.indexOf("-- Idempotent legacy"),
  );
  assert.ok(
    mutate.indexOf("pg_advisory_xact_lock") <
      mutate.indexOf("SELECT version_number INTO v_current"),
  );
  assert.match(mutate, /id=p_revision AND state='draft' AND draft_edit_version = p_edit/);
  assert.match(mutate, /GET DIAGNOSTICS v_count=ROW_COUNT/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS cms_one_publication/);
  assert.match(
    readFileSync("neon/migrations/20260711090000_cms_content_revisions.sql", "utf8"),
    /UNIQUE \(resource_type, resource_id, version_number\)/,
  );
});
test("retired drafts are excluded from every active edit and publish path without exposing private payloads", () => {
  const sql = readFileSync("neon/migrations/20260905110000_cms_atomic_mutations.sql", "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS draft_retired_at timestamptz/);
  const restore = sql.slice(
    sql.indexOf("ELSIF p_op='restore'"),
    sql.indexOf("ELSIF p_op='publish'"),
  );
  assert.match(restore, /SET draft_retired_at=now\(\)[\s\S]*created_by=p_actor/);
  const archive = sql.slice(
    sql.indexOf("IF p_type='media' AND EXISTS"),
    sql.indexOf("v_action='cms_archived'"),
  );
  assert.match(archive, /SET draft_retired_at=now\(\)/);
  const publish = sql.slice(
    sql.indexOf("ELSIF p_op='publish'"),
    sql.indexOf("IF p_type='media' AND EXISTS"),
  );
  assert.match(publish, /state='draft' AND draft_retired_at IS NULL/);
  assert.match(serverSource, /state = 'draft' AND draft_retired_at IS NULL/);
  assert.match(serverSource, /WHERE r.draft_retired_at IS NULL AND/);
});
test("estate nullable array projection preserves database null without extracting JSON scalar elements", () => {
  const sql = readFileSync("neon/migrations/20260905110000_cms_atomic_mutations.sql", "utf8");
  for (const field of ["facilities", "aliases"])
    assert.ok(
      sql.includes(
        `CASE WHEN payload->'${field}' IS NULL OR payload->'${field}' = 'null'::jsonb THEN NULL`,
      ),
    );
});
