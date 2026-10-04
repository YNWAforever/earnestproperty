import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { assertWorkspaceCurrent, dispatchWorkspaceRequest } from "./workspace-request.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { requestControlPlane } from "./operations/operations-client.ts";
import { runWhatsappLinkBatch, reconcileLinkBatch } from "./whatsapp-link-batch-client.ts";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
// Extract the actual callback, retain its body and compile only its TypeScript syntax.
function callback(file, name, context) {
  const source = ts.createSourceFile(
    file,
    file === "src/lib/admin/media-upload.ts" && process.env.EP_REVIEW_MEDIA_REVISION
      ? execFileSync("git", ["show", `${process.env.EP_REVIEW_MEDIA_REVISION}:${file}`], {
          encoding: "utf8",
        })
      : readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let body;
  function visit(node) {
    if (
      ts.isArrowFunction(node) &&
      name.startsWith("$") &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
      node.body.getText(source).includes(name.slice(1))
    )
      body = node.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = node.getText(source);
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      ts.isArrowFunction(node.initializer)
    )
      body = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(body, `actual callback ${name}`);
  const output = ts.transpileModule(`const extracted = (${body.replace(/^export\s+/, "")});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(`${output} extracted;`, context);
}
const setters = (names) => Object.fromEntries(names.map((name) => [name, () => {}]));

test("R1: control-plane stops before dispatch when credential preparation outlives workspace", async () => {
  const auth = deferred();
  let live = true;
  let dispatched = 0;
  const pending = requestControlPlane(
    "/jobs/owned/retry",
    { method: "POST", body: "{}" },
    async () => {
      dispatched++;
      return new Response(JSON.stringify({ ok: true, data: {}, requestId: "owned" }));
    },
    () => auth.promise,
    () => live,
  );
  live = false;
  auth.resolve({ headers: new Headers({ authorization: "Bearer synthetic-B" }) });
  await assert.rejects(pending, /WORKSPACE_REQUEST_CANCELLED/);
  assert.equal(dispatched, 0);
});

test("R2: old accepted chunk cannot regress reconciled progress; receipt remains recoverable", async () => {
  const accepted = deferred();
  let live = true;
  let saved;
  const row = {
    rowKey: "r",
    placementId: "website:r",
    input: {
      placementSource: "website",
      entryPointType: "reception",
      enabled: true,
      placementVerified: true,
    },
  };
  const initial = {
    batchId: "batch",
    rows: Array.from({ length: 60 }, () => row),
    chunkIds: ["chunk", "chunk-2"],
    completed: [],
    nextChunk: 0,
    uncertain: false,
    preview: { previewToken: "token" },
  };
  const receipt = { batchId: "batch", chunkId: "chunk", state: "committed", rows: [] };
  const pending = runWhatsappLinkBatch(
    initial,
    { commit: () => accepted.promise, read: async () => ({ operations: [receipt] }) },
    (next) => {
      saved = next;
    },
    () => live,
  );
  assert.equal(saved.uncertain, true);
  live = false;
  saved = {
    ...initial,
    completed: [receipt, { ...receipt, chunkId: "chunk-2" }],
    nextChunk: 2,
    uncertain: false,
  };
  const reconciled = saved;
  accepted.resolve(receipt);
  await pending;
  assert.equal(saved.nextChunk, 2);
  assert.equal(saved, reconciled);
  assert.equal(reconcileLinkBatch(initial, [receipt]).nextChunk, 1);
});

test("R3: delayed A handoff read cannot clear newly selected B or its draft", async () => {
  const read = deferred();
  let selected = "A";
  const toasts = [];
  const context = {
    detail: { id: "A" },
    selectedIdRef: { current: "A" },
    isWorkspaceCurrent: () => true,
    canApplyConversationDetail: (id) => selected === id,
    updateAdminConversation: async () => ({ ok: true }),
    assertNoMutationError: () => {},
    listRequestRef: { current: 0 },
    listCursorRef: { current: null },
    inboxQuery: "",
    inboxStatus: "all",
    fetchAdminPage: async () => ({ rows: [], nextCursor: null, total: 0 }),
    fetchAdminConversation: () => read.promise,
    loadConversationDetail: async () => true,
    clearSelectedConversation: () => {
      selected = null;
    },
    toast: { success: (t) => toasts.push(t), error: (t) => toasts.push(t) },
    errorText: String,
    Date,
    ...setters([
      "setMutatingAction",
      "setLoadingRows",
      "setListCursor",
      "setNextListCursor",
      "setListTotal",
      "setRows",
      "setListUpdatedAt",
    ]),
  };
  const run = callback("src/routes/admin.whatsapp.tsx", "saveConversationUpdate", context);
  const pending = run({ status: "open", assigned_agent_id: "other" });
  await new Promise((r) => setImmediate(r));
  selected = "B";
  context.selectedIdRef.current = "B";
  read.resolve(null);
  await pending;
  assert.equal(selected, "B");
  assert.deepEqual(toasts, []);
});

test("R4: migration plan arriving after workspace retirement emits no global success", async () => {
  const plan = deferred();
  let live = true;
  const toasts = [];
  const run = callback("src/components/admin/operations/AdminOperationsMigrations.tsx", "runPlan", {
    planningId: null,
    applying: false,
    isCurrent: () => live,
    planOperationsMigration: () => plan.promise,
    toast: { success: (t) => toasts.push(t), error: (t) => toasts.push(t) },
    migrationErrorMessage: () => "error",
    ...setters(["setPlanningId", "setPlan", "setTypedId", "setConfirmOpen", "setError"]),
  });
  const pending = run({ id: "owned", status: "pending" });
  live = false;
  plan.resolve({ data: {} });
  await pending;
  assert.deepEqual(toasts, []);
});

test("R4: accepted campaign save outliving membership makes no follow-up read or toast", async () => {
  const save = deferred();
  let live = true;
  let reads = 0;
  const toasts = [];
  const run = callback("src/routes/admin.blasts.tsx", "handleSaveAudience", {
    audienceDraft: { name: "owned", description: "", filters: {} },
    isWorkspaceCurrent: () => live,
    nullIfBlank: (v) => v || null,
    normalizeAudienceFilters: (v) => v,
    saveAdminAudience: () => save.promise,
    assertNoServerError: () => {},
    refreshAdminData: async () => {
      reads++;
    },
    errorText: String,
    toast: { success: (t) => toasts.push(t), error: (t) => toasts.push(t) },
    ...setters([
      "setSaving",
      "setSavedAudienceDraft",
      "setSelectedPreviewAudienceId",
      "setAudienceDraft",
    ]),
  });
  const pending = run({ preventDefault() {} });
  live = false;
  save.resolve({ id: "accepted-owned" });
  await pending;
  assert.equal(reads, 0);
  assert.deepEqual(toasts, []);
});

test("R1: upload file preparation cannot dispatch or create an intent after retirement", async () => {
  const bytes = deferred();
  let live = true;
  let dispatched = 0;
  const stored = new Map();
  const file = new File([new Uint8Array([1])], "owned.png", { type: "image/png" });
  file.arrayBuffer = () => bytes.promise;
  const run = callback("src/lib/admin/media-upload.ts", "uploadAdminMedia", {
    assertWorkspaceCurrent,
    withStaffUploadIdentity: async () => ({ actorId: "synthetic", headers: new Headers() }),
    crypto,
    FormData,
    Uint8Array,
    sessionStorage: { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v) },
    fetch: async () => {
      dispatched++;
      return new Response(
        JSON.stringify({ ok: true, url: "owned", pathname: "owned", receipt: "accepted" }),
      );
    },
  });
  const pending = run(file, "property", () => live);
  await new Promise((r) => setImmediate(r));
  live = false;
  bytes.resolve(new Uint8Array([1]).buffer);
  await assert.rejects(pending, /WORKSPACE_REQUEST_CANCELLED/);
  assert.equal(dispatched, 0);
  assert.equal(stored.size, 0);
});

test("R1: dispatched upload retains original intent and receipt after retirement", async () => {
  const response = deferred();
  const stored = new Map();
  let live = true;
  let dispatched = 0;
  const run = callback("src/lib/admin/media-upload.ts", "uploadAdminMedia", {
    assertWorkspaceCurrent,
    withStaffUploadIdentity: async () => ({ actorId: "synthetic", headers: new Headers() }),
    crypto,
    FormData,
    Uint8Array,
    sessionStorage: { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v) },
    fetch: () => {
      dispatched++;
      return response.promise;
    },
  });
  const pending = run(
    new File([new Uint8Array([1])], "owned.png", { type: "image/png" }),
    "property",
    () => live,
  );
  while (!dispatched) await new Promise((r) => setImmediate(r));
  const original = JSON.parse([...stored.values()][0]).id;
  live = false;
  response.resolve(
    new Response(
      JSON.stringify({ ok: true, url: "owned", pathname: "owned", receipt: "accepted" }),
    ),
  );
  await pending;
  assert.equal(dispatched, 1);
  const saved = JSON.parse([...stored.values()][0]);
  assert.equal(saved.id, original);
  assert.equal(saved.receipt, "accepted");
});

test("dispatch control permits a still-current prepared request", async () => {
  let calls = 0;
  const result = await dispatchWorkspaceRequest(
    async () => "synthetic",
    (credential) => {
      calls++;
      return credential;
    },
    () => true,
  );
  assert.equal(result, "synthetic");
  assert.equal(calls, 1);
});

for (const [file, marker, write, read, extra] of [
  [
    "src/components/admin/StaffEndpointEditor.tsx",
    "$await updateStaffEndpoint",
    "updateStaffEndpoint",
    "fetchStaffEndpoints",
    { form: {}, edit: null },
  ],
  [
    "src/components/admin/StaffReferenceEditor.tsx",
    "$await createStaffReference",
    "createStaffReference",
    "fetchStaffReferences",
    { form: {} },
  ],
  [
    "src/components/admin/whatsapp/StaffTestNotificationDialog.tsx",
    "$await confirmStaffTestReceipt",
    "confirmStaffTestReceipt",
    "getStaffTestNotification",
    { status: { attemptId: "owned" }, evidenceRef: "owned-evidence" },
  ],
])
  test(`R4: accepted ${write} stops obsolete follow-up read`, async () => {
    const accepted = deferred();
    let live = true;
    let reads = 0;
    const run = callback(file, marker, {
      ...extra,
      isCurrent: () => live,
      [write]: () => accepted.promise,
      [read]: async () => {
        reads++;
        return [];
      },
      ...setters(["setBusy", "setError", "setRows", "setEdit", "setStatus"]),
    });
    const pending = run({ preventDefault() {} });
    live = false;
    accepted.resolve({ ok: true });
    await pending;
    assert.equal(reads, 0);
  });
