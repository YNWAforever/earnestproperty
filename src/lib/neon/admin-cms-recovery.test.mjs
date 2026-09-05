import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = "src/lib/neon/admin-cms.server.ts";
const source =
  process.env.CMS_RECOVERY_BASELINE === "1"
    ? execFileSync("git", ["show", `897f01a:${sourcePath}`], { encoding: "utf8" })
    : readFileSync(sourcePath, "utf8");
function fixture({
  actor = "alice",
  roles = ["agent"],
  draft = null,
  publication = null,
  live = null,
  history = [],
} = {}) {
  const queries = [];
  const queryRows = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.startsWith("SELECT cms_mutate")) {
      const [op, type, id, actor, payload, base, token, revisionId] = params;
      if (op === "save") {
        if (
          base !== (publication?.version_number ?? null) ||
          (draft &&
            (draft.base_published_version !== base ||
              draft.draft_edit_version !== token ||
              draft.id !== revisionId))
        )
          throw Error("CMS_REVISION_CONFLICT");
        draft = {
          ...draft,
          id: draft?.id ?? "saved",
          resource_type: type,
          resource_id: id,
          state: "draft",
          created_by: actor,
          payload: JSON.parse(payload),
          base_published_version: base,
          version_number: draft?.version_number ?? 4,
          draft_edit_version: (draft?.draft_edit_version ?? 0) + 1,
        };
      } else if (op === "restore") {
        const old = history.find((r) => r.id === revisionId);
        draft = {
          ...old,
          id: "restored-new",
          state: "draft",
          created_by: actor,
          version_number: 4,
          draft_edit_version: 1,
          base_published_version: publication?.version_number ?? null,
          restored_from_revision_id: old.id,
        };
      }
      return [
        { revision: { ...draft, current_published_version: publication?.version_number ?? null } },
      ];
    }
    if (sql.includes("WHERE id = $1 LIMIT 1")) return history;
    if (sql.includes("state = 'draft'")) {
      return draft &&
        (!sql.includes("draft_retired_at IS NULL") || !draft.draft_retired_at) &&
        (params[3] === draft.id || params[2] === draft.created_by)
        ? [draft]
        : [];
    }
    if (sql.includes("state = 'published'")) return publication ? [publication] : [];
    if (sql.startsWith("SELECT * FROM estates")) return live ? [live] : [];
    if (sql.includes("INSERT INTO cms_content_revisions")) {
      draft = {
        id: "saved",
        resource_type: params[0],
        resource_id: params[1],
        state: "draft",
        payload: JSON.parse(params[2]),
        base_published_version: params[3],
        created_by: params[4],
        restored_from_revision_id: params[5],
        version_number: 4,
      };
      return [draft];
    }
    if (sql.includes("UPDATE cms_content_revisions")) {
      draft = {
        ...draft,
        payload: JSON.parse(params[0]),
        base_published_version: params[1],
        restored_from_revision_id: params[2],
      };
      return [draft];
    }
    return [{ id: "saved", version_number: 4 }];
    if (sql.includes("UPDATE cms_content_revisions")) return [{ id: "saved", version_number: 4 }];
    return [...(draft ? [draft] : []), ...(publication ? [publication] : []), ...history]
      .sort((a, b) => b.version_number - a.version_number)
      .slice(0, 20);
  };
  const exports = {};
  const modules = {
    "./public-estate-options-cache": { invalidatePublicEstateOptions() {} },
    "./auth.server": {
      requireStaffAccess: async (_request, allowed) => {
        if (!roles.some((role) => allowed.includes(role))) throw new Error("FORBIDDEN");
        return { staffId: actor, roles };
      },
    },
    "./db.server": {
      queryRows,
      stringOrEmpty: (v) => (v == null ? "" : String(v)),
      stringOrNull: (v) => (v == null ? null : String(v)),
      dateOrNull: (v) => v ?? null,
    },
    "./cms-revisions": {
      CMS_RESOURCE_TYPES: ["estate", "article", "video", "faq", "media"],
      makeRestoreDraft: (r) => ({
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        payload: r.payload,
        basePublishedVersion: r.version_number,
        restoredFromRevisionId: r.id,
      }),
    },
    "./admin-data.server": { writeAudit: async () => undefined },
    "./cms-videos-schema": {},
    "@tanstack/react-start/server": { getRequest: () => ({}) },
    "@tanstack/react-start/server-only": {},
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
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
    },
  );
  return { api: exports, queries };
}
const draft = {
  id: "draft-a",
  resource_type: "article",
  resource_id: "resource",
  state: "draft",
  version_number: 25,
  created_by: "alice",
  base_published_version: 1,
  payload: { title: "Recovered body", content: "saved draft", slug: "test" },
};
const publication = {
  ...draft,
  id: "pub",
  state: "published",
  version_number: 3,
  payload: { title: "Current", slug: "test", content: "current" },
};
const input = { resourceType: "article", resourceId: "resource" };
test("reopen recovers the actor draft payload and original base independently of current publication/history cap", async () => {
  const { api } = fixture({
    draft,
    publication,
    history: Array.from({ length: 20 }, (_, i) => ({ ...draft, version_number: 50 - i })),
  });
  const result = await api.fetchAdminCmsEditor(input);
  assert.equal(result.payload.content, "saved draft");
  assert.equal(result.editState.basePublishedVersion, 1);
  assert.equal(result.editState.currentPublishedVersion, 3);
});
test("another staff member cannot recover Alice's draft implicitly", async () => {
  const { api, queries } = fixture({ actor: "bob", draft, publication });
  const result = await api.fetchAdminCmsEditor(input);
  assert.equal(result.payload.content, "current");
  assert.equal(result.editState.draftRevisionId, null);
  assert.ok(
    queries.some(({ sql, params }) => sql.includes("created_by = $3") && params[2] === "bob"),
  );
});
test("manager review of another author's draft requires explicit revision selection", async () => {
  const { api } = fixture({ actor: "bob", roles: ["manager"], draft, publication });
  assert.equal(
    (await api.fetchAdminCmsEditor({ ...input, reviewDraftRevisionId: "draft-a" })).payload.content,
    "saved draft",
  );
});
test("agent cannot request another author's draft review", async () => {
  const { api } = fixture({ actor: "bob", draft });
  await assert.rejects(
    api.fetchAdminCmsEditor({ ...input, reviewDraftRevisionId: "draft-a" }),
    /CMS_REVIEW_FORBIDDEN/,
  );
});
test("legacy estate without history is fetched in full by ID beyond list caps", async () => {
  const live = {
    id: "last-estate",
    slug: "legacy",
    name_zh: "Legacy",
    aliases: ["Alias"],
    address: "Address",
    district_id: "district",
    blocks: 12,
    area_min: 300,
    avg_saleable_psf: 14000,
    lat: 22.4,
    lng: 114.1,
    verified_at: "2026-09-05",
  };
  const { api, queries } = fixture({ live });
  const result = await api.fetchAdminCmsEditor({ resourceType: "estate", resourceId: live.id });
  assert.equal(JSON.stringify(result.payload), JSON.stringify(live));
  assert.equal(result.editState.basePublishedVersion, null);
  assert.ok(
    queries.some(
      ({ sql, params }) => sql === "SELECT * FROM estates WHERE id = $1" && params[0] === live.id,
    ),
  );
});
test("saving stale local text rejects before any write and never rebases draft", async () => {
  const { api, queries } = fixture({ draft, publication });
  await assert.rejects(
    api.saveAdminCmsDraft({ ...input, payload: draft.payload, basePublishedVersion: 1 }, {}),
    /CMS_REVISION_CONFLICT/,
  );
  assert.equal(queries.filter(({ sql }) => /^(UPDATE|INSERT)/.test(sql.trim())).length, 0);
});
test("restore historical body uses current publication base and records historical source", async () => {
  const old = {
    ...draft,
    id: "old",
    state: "superseded",
    version_number: 1,
    payload: { title: "Old", slug: "test", content: "historical" },
  };
  const { api } = fixture({ roles: ["manager"], publication, history: [old] });
  const result = await api.restoreAdminCmsRevision({ revisionId: "old" }, {});
  assert.equal(result.editState.basePublishedVersion, 3);
  assert.equal(result.editState.restoredFromRevisionId, "old");
  assert.equal(result.editState.payload.content, "historical");
});
test("viewer and unauthenticated callers cannot read full draft content", async () => {
  for (const roles of [["viewer"], []]) {
    await assert.rejects(fixture({ roles, draft }).api.fetchAdminCmsEditor(input), /FORBIDDEN/);
  }
});

function extractedFunctions(path, names, context = {}) {
  const text = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = [];
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
      declarations.push(node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(declarations.length, names.length);
  const script = ts.transpileModule(declarations.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(`${script}; ({${names.join(",")}})`, { ...context, structuredClone });
}
const estateFormPath = "src/components/admin/estates/AdminEstateEditorForm.tsx";
test("editing only an estate title preserves every unedited field including whitespace and verification metadata", () => {
  const { createInitialForm, buildPayload } = extractedFunctions(estateFormPath, [
    "splitList",
    "createInitialForm",
    "parseNullableNumber",
    "buildPayload",
  ]);
  const original = {
    slug: "estate",
    name_zh: "Old",
    district_slug: "district",
    aliases: ["Alias, with comma"],
    facilities: ["Pool"],
    address: " Address ",
    description: " body\n",
    blocks: 12,
    area_min: 300,
    area_max: 900,
    district_id: "district-id",
    avg_saleable_psf: 12000.25,
    lat: 22.4,
    lng: 114.1,
    verified_at: "2026-09-05T01:00:00Z",
  };
  const form = createInitialForm(original, "estate-id");
  form.name_zh = "New";
  assert.equal(
    JSON.stringify(buildPayload(form, original)),
    JSON.stringify({ ...original, name_zh: "New" }),
  );
});
test("dedicated publish sends only the saved reviewed revision with its base, never saves local fields again", async () => {
  const calls = [];
  const reviewed = {
    resourceId: "estate-id",
    draftRevisionId: "reviewed",
    basePublishedVersion: 3,
    draftEditVersion: 5,
  };
  const { handlePublish } = extractedFunctions(estateFormPath, ["handlePublish"], {
    validate: () => null,
    setPublishing: () => {},
    reviewed,
    isDirty: false,
    callCms: (fn) => fn(),
    saveAdminCmsDraft: () => {
      throw new Error("must not save");
    },
    publishAdminCmsRevision: async (input) => {
      calls.push(input.data);
      return { ok: true };
    },
    set: () => {},
    fetchAdminCmsEditor: async () => ({ editState: null }),
    setReviewed: () => {},
    onSaved: () => {},
    refreshRevisions: async () => {},
    toast: {
      success() {},
      error(message) {
        throw new Error(message);
      },
    },
  });
  await handlePublish();
  assert.equal(
    JSON.stringify(calls),
    JSON.stringify([
      {
        resourceType: "estate",
        resourceId: "estate-id",
        revisionId: "reviewed",
        basePublishedVersion: 3,
        draftEditVersion: 5,
      },
    ]),
  );
});
test("dedicated publish retains unsaved local edits and refuses a stale reviewed snapshot", async () => {
  const errors = [];
  const { handlePublish } = extractedFunctions(estateFormPath, ["handlePublish"], {
    validate: () => null,
    setPublishing: () => {},
    reviewed: { draftRevisionId: "old" },
    isDirty: true,
    callCms: () => {
      throw new Error("must not dispatch");
    },
    toast: { error: (message) => errors.push(message) },
  });
  await handlePublish();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /儲存草稿/);
});

test("save a new article draft then close and reopen recovers the persisted body", async () => {
  const { api } = fixture();
  const saved = await api.saveAdminCmsDraft(
    {
      ...input,
      payload: { title: "New", slug: "new", content: "persist me" },
      basePublishedVersion: null,
    },
    {},
  );
  const reopened = await api.fetchAdminCmsEditor(input);
  assert.equal(reopened.editState.draftRevisionId, saved.revisionId);
  assert.equal(reopened.payload.content, "persist me");
  assert.equal(reopened.editState.basePublishedVersion, null);
});

test("reopening after restored publication cannot select retired older actor draft", async () => {
  const { api } = fixture({ draft: { ...draft, draft_retired_at: "2026-09-05" }, publication });
  const result = await api.fetchAdminCmsEditor(input);
  assert.equal(result.editState.draftRevisionId, null);
  assert.equal(result.editState.payload.content, "current");
  assert.equal(result.editState.basePublishedVersion, 3);
});
for (const kind of ["Estate", "Article"])
  for (const outcome of ["switch", "close"]) {
    test(`${kind} loader ignores delayed success after ${outcome}`, async () => {
      const pending = new Map();
      const writes = [];
      const context = {
        fetchAdminCmsEditor: ({ data }) =>
          new Promise((resolve) => pending.set(data.resourceId, resolve)),
        toast: { error: () => assert.fail("unexpected load error") },
      };
      context[kind.toLowerCase() + "LoadSequence"] = { current: 0 };
      context["empty" + kind] = {};
      for (const suffix of ["Edit", "Revisions", "LatestPayload"])
        context["set" + kind + suffix] = (value) => writes.push([suffix, value]);
      context["setEditing" + kind] = (value) => writes.push(["Editing", value]);
      const functionName = "load" + kind + "Revisions";
      const { [functionName]: load } = extractedFunctions(
        "src/routes/admin.cms.tsx",
        [functionName],
        context,
      );
      const stale = load("old");
      if (outcome === "switch") {
        const current = load("new");
        pending.get("new")({
          revisions: [],
          payload: { title: "new" },
          editState: { resourceId: "new" },
        });
        await current;
      } else await load(undefined);
      const expected = JSON.stringify(writes);
      pending.get("old")({
        revisions: [],
        payload: { title: "old" },
        editState: { resourceId: "old" },
      });
      await stale;
      assert.equal(JSON.stringify(writes), expected);
    });
  }
for (const kind of ["Estate", "Article"])
  test(`${kind} delayed save preserves later typing and keeps publish dirty-blocked`, async () => {
    const initial = {
      id: "same",
      slug: "slug",
      name_zh: "Before",
      district_slug: "district",
      title: "Before",
    };
    let current = { ...initial };
    let reviewed = null;
    let finish;
    let publishes = 0;
    const errors = [];
    const prefix = kind.toLowerCase();
    const context = {
      callCms: (fn) => fn(),
      saveAdminCmsDraft: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      setSaving: () => {},
      refreshCmsData: async () => {},
      errorText: (e) => e.message,
      toast: { success: () => {}, error: (message) => errors.push(message) },
    };
    context["editing" + kind] = initial;
    context[prefix + "Edit"] = null;
    context[prefix + "LatestPayload"] = null;
    context[prefix + "LoadSequence"] = { current: 0 };
    context["set" + kind + "Edit"] = (value) => {
      reviewed = value;
    };
    context["setEditing" + kind] = (value) => {
      current = typeof value === "function" ? value(current) : value;
    };
    const name = "handleSave" + kind + "Draft";
    const { [name]: save } = extractedFunctions("src/routes/admin.cms.tsx", [name], context);
    const request = save({ preventDefault() {} });
    current = { ...current, title: "Typed later", name_zh: "Typed later" };
    finish({
      resourceId: "same",
      editState: {
        resourceId: "same",
        draftRevisionId: "saved",
        draftEditVersion: 2,
        basePublishedVersion: null,
        payload: { ...initial },
      },
    });
    await request;
    assert.equal(current.title, "Typed later");
    assert.equal(current.name_zh, "Typed later");
    assert.equal(reviewed.payload.title, "Before");
    const publishName = "handlePublish" + kind;
    const publishContext = { ...context };
    publishContext["editing" + kind] = current;
    publishContext[prefix + "Edit"] = reviewed;
    publishContext["empty" + kind] = {};
    publishContext.setPublishing = () => {};
    publishContext.publishAdminCmsRevision = async () => {
      publishes++;
    };
    const { [publishName]: publish } = extractedFunctions(
      "src/routes/admin.cms.tsx",
      [publishName],
      publishContext,
    );
    await publish();
    assert.equal(publishes, 0);
    assert.ok(errors.some((message) => message.includes("儲存草稿")));
  });
