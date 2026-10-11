import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { campaignHasDeliveryHistorySql } from "./campaign-retry.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("admin data layer exposes CMS, listing, CRM, WhatsApp, and blast mutations", () => {
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");
  const types = read("src/lib/neon/admin-data.types.ts");

  const exports = [
    "fetchAdminAgents",
    "saveAdminFaq",
    "deleteAdminFaq",
    "restoreAdminFaq",
    "fetchAdminMediaAssets",
    "updateAdminMediaAsset",
    "updateAdminPropertyStatus",
    "fetchAdminLead",
    "updateAdminLead",
    "createAdminLeadActivity",
    "fetchAdminConversation",
    "updateAdminConversation",
    "fetchAdminBlastOptions",
    "saveAdminAudience",
    "previewAdminAudience",
    "saveAdminCampaign",
    "materializeCampaignRecipients",
    "sendAdminCampaignQueue",
    "cancelAdminCampaign",
    "finishCampaignWithoutSending",
    "fetchLeadLiveAgentTranscript",
  ];

  for (const name of exports) {
    const exportPattern = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${name}\\b`);
    assert.match(client, exportPattern, `admin-data.ts should export ${name}`);
    assert.match(server, exportPattern, `admin-data.server.ts should export ${name}`);
  }

  // FX-19a-2: no screen reorders FAQs, so the browser-callable wrapper is gone;
  // the server implementation (and its unit test below) stays.
  assert.doesNotMatch(client, /reorderAdminFaqs/);
  assert.match(server, /export\s+async\s+function\s+reorderAdminFaqs\(/);

  for (const typeName of [
    "AdminEstateInput",
    "AdminArticleInput",
    "AdminFaqInput",
    "AdminLeadDetail",
    "AdminConversationDetail",
    "AdminAudiencePreview",
    "AdminCampaignInput",
  ]) {
    assert.match(types, new RegExp(`export\\s+type\\s+${typeName}\\b`));
  }

  assert.doesNotMatch(server, /input\.agent_id\s*\|\|\s*actor\.staffId/);
  assert.match(server, /input\.agent_id\s*\?\?\s*null/);

  assert.match(
    client,
    /fetchLeadLiveAgentTranscriptServer[\s\S]*?requireStaff\(\["admin", "manager", "agent"\]\)/,
  );
  // FX-10b I2: managers and admins only, through the staff server-fn wrapper.
  assert.match(
    client,
    /finishCampaignWithoutSendingServer = createServerFn\(\{ method: "POST" \}\)[\s\S]*?requireStaff\(\["admin", "manager"\]\)/,
  );
  assert.match(
    client,
    /export async function finishCampaignWithoutSending\([\s\S]*?callStaffServerFn\([\s\S]*?withStaffAuthHeaders\(options\)/,
  );
  assert.match(
    server,
    /export\s+async\s+function\s+fetchLeadLiveAgentTranscript[\s\S]*?await assertLeadInScope\(input\.leadId, actor\)/,
  );
});

test("command center read model is guarded and set-based", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const client = read("src/lib/neon/admin-data.ts");

  assert.match(server, /export\s+async\s+function\s+listCommandCenter\b/);
  assert.match(server, /export\s+async\s+function\s+completeAdminLeadActivity\b/);
  assert.match(server, /LEFT JOIN LATERAL/);
  assert.match(server, /COMMAND_CENTER_ROW_LIMIT/);

  assert.match(client, /export\s+async\s+function\s+fetchCommandCenter\b/);
  assert.match(client, /export\s+async\s+function\s+completeAdminLeadActivity\b/);
  assert.match(client, /fetchCommandCenterServer[\s\S]*?requireStaff\(\["admin", "manager"\]\)/);
});

test("attention reads are staff-scoped server functions next to the overview", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const client = read("src/lib/neon/admin-data.ts");
  const types = read("src/lib/neon/admin-data.types.ts");

  for (const name of ["fetchAdminAttentionCounts", "fetchAdminTodayTasks"])
    assert.match(client, new RegExp(`export\\s+async\\s+function\\s+${name}\\b`));
  for (const name of ["getAdminAttentionCounts", "getAdminTodayTasks"])
    assert.match(server, new RegExp(`export\\s+async\\s+function\\s+${name}\\b`));
  assert.match(
    client,
    /fetchAdminAttentionCountsServer[\s\S]*?requireStaff\(\["admin", "manager", "agent"\]\)/,
  );
  assert.match(
    client,
    /fetchAdminTodayTasksServer[\s\S]*?requireStaff\(\["admin", "manager", "agent"\]\)/,
  );

  // PR #222 appends at the end of these files; the attention reads sit next to the overview.
  const placed = server.indexOf("export async function getAdminAttentionCounts");
  assert.ok(placed > server.indexOf("export async function getAdminOverview"));
  assert.ok(placed < server.indexOf("export async function listAdminListings"));
  assert.match(server, /wa_can_read_conversation\(\$1::uuid,\s*w\.id\)/);

  assert.match(types, /export\s+type\s+AdminAttentionCounts\b/);
  assert.match(types, /export\s+type\s+AdminTodayTask\b/);
  assert.match(types, /leadsNeedingAttention:\s*number/);
});

test("background attention reads never reload the page under the user", () => {
  const source = read("src/lib/neon/admin-data.ts");
  const file = ts.createSourceFile("admin-data.ts", source, ts.ScriptTarget.Latest, true);
  const body = (name) => {
    const declaration = file.statements.find(
      (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
    );
    assert.ok(declaration?.body, `admin-data.ts should declare ${name}`);
    return { declaration, text: declaration.body.getText(file) };
  };

  // A background poll that fails must not reload the page (a half-typed reply would be lost),
  // and its success must not clear the reload guard that foreground reads rely on.
  const background = body("callStaffServerFnInBackground");
  assert.doesNotMatch(background.text, /reloadOnStaleServerFunction|clearStorageFlag/);
  assert.match(background.text, /unwrapServerFnResponse\(call\(\)\)/);
  assert.ok(
    !ts.getModifiers(background.declaration)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    "callStaffServerFnInBackground stays private to admin-data.ts",
  );

  const counts = body("fetchAdminAttentionCounts").text;
  assert.match(counts, /\bcallStaffServerFnInBackground\(/);
  assert.doesNotMatch(counts, /\bcallStaffServerFn\(/);
});

test("background inbox and command-center polls never reload the page under the user", () => {
  const source = read("src/lib/neon/admin-data.ts");
  const file = ts.createSourceFile("admin-data.ts", source, ts.ScriptTarget.Latest, true);
  const functions = file.statements.filter(ts.isFunctionDeclaration);
  const index = (name) => functions.findIndex((statement) => statement.name?.text === name);
  const body = (name) => {
    const declaration = functions[index(name)];
    assert.ok(declaration?.body, `admin-data.ts should declare ${name}`);
    assert.ok(
      ts.getModifiers(declaration)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
      `${name} is exported`,
    );
    return declaration.body.getText(file);
  };

  for (const name of ["fetchAdminPageInBackground", "fetchCommandCenterInBackground"]) {
    const text = body(name);
    assert.match(text, /\bcallStaffServerFnInBackground\(/, name);
    assert.doesNotMatch(text, /\bcallStaffServerFn\(/, name);
  }
  // The foreground reads keep their reload-on-stale behaviour.
  for (const name of ["fetchAdminPage", "fetchCommandCenter"])
    assert.match(body(name), /\bcallStaffServerFn\(/, name);

  // PR #222 appends after fetchAdminPage at the end of the file, so the background page read
  // sits with the other background reads next to the overview, and the command-center one
  // directly after its foreground twin.
  assert.ok(index("fetchAdminPageInBackground") > index("fetchAdminTodayTasks"));
  assert.ok(index("fetchAdminPageInBackground") < index("fetchAdminListings"));
  assert.equal(index("fetchCommandCenterInBackground"), index("fetchCommandCenter") + 1);
});

test("property mutation keeps Copilot content fields explicit and scoped", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  const types = read("src/lib/neon/admin-data.types.ts");
  assert.match(types, /title_en:\s*string\s*\|\s*null/);
  assert.match(types, /features:\s*string\[\]/);
  assert.match(server, /video_url, agent_id, title_en, features/);
  assert.match(server, /input\.features \?\? \[\]/);
});

test("campaign save rejects delivery statuses before any database write", async () => {
  const source = read("src/lib/neon/admin-data.server.ts");
  const file = ts.createSourceFile("admin-data.server.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "saveAdminCampaign",
  );
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  let writes = 0;
  const queries = [];
  const save = new Function(
    "requireNonEmpty",
    "queryRows",
    "writeAudit",
    "stringOrEmpty",
    "campaignHasDeliveryHistorySql",
    executable + "\nreturn saveAdminCampaign;",
  )(
    () => {},
    async (sql, params) => {
      writes += 1;
      queries.push({ sql, params });
      return [{ id: "campaign-1" }];
    },
    async () => {},
    String,
    campaignHasDeliveryHistorySql,
  );
  const input = {
    name: "Campaign",
    template_id: null,
    audience_id: null,
    status: "review",
    scheduled_at: null,
  };
  for (const status of ["queued", "sending", "completed", "failed", null]) {
    assert.deepEqual(await save({ ...input, status }, { staffId: "manager-1" }), {
      id: "",
      error: "INVALID_CAMPAIGN_STATUS",
    });
  }
  assert.equal(writes, 0, "an invalid status must not create or update a campaign");
  assert.deepEqual(await save(input, { staffId: "manager-1" }), { id: "campaign-1" });
  assert.equal(writes, 1, "review remains an editable status");
  assert.deepEqual(await save({ ...input, id: "campaign-1" }, { staffId: "manager-1" }), {
    id: "campaign-1",
  });
  assert.match(
    queries[1].sql,
    /WHERE id=\$6\s+AND status IN \('draft', 'review', 'scheduled'\)/,
    "a concurrent queue or send must prevent an edit",
  );
  // FX-10b: once a recipient may have been reached, template and audience are frozen.
  assert.match(
    queries[1].sql,
    /AND \(NOT \(EXISTS \(SELECT 1 FROM whatsapp_campaign_recipients history[\s\S]*audit_logs requeued[\s\S]*OR \(template_id IS NOT DISTINCT FROM \$2 AND audience_id IS NOT DISTINCT FROM \$3\)\)/,
    "a campaign with delivery history keeps its template and audience",
  );
});

// FX-17a D-13 fix round 1: the server mirrors the form. A save without a schedule
// time keeps the stored one, and 已排期 can be kept but never chosen.
test("campaign save keeps a stored scheduled_at and never moves a campaign into 已排期", async () => {
  const source = read("src/lib/neon/admin-data.server.ts");
  const file = ts.createSourceFile("admin-data.server.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "saveAdminCampaign",
  );
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const queries = [];
  let answer = (sql) => (/^\s*SELECT/.test(sql) ? [] : [{ id: "campaign-1" }]);
  const save = new Function(
    "requireNonEmpty",
    "queryRows",
    "writeAudit",
    "stringOrEmpty",
    "campaignHasDeliveryHistorySql",
    executable + "\nreturn saveAdminCampaign;",
  )(
    () => {},
    async (sql, params) => {
      queries.push({ sql, params });
      return answer(sql);
    },
    async () => {},
    String,
    campaignHasDeliveryHistorySql,
  );
  const actor = { staffId: "manager-1" };
  const input = { name: "Campaign", template_id: null, audience_id: null, status: "review" };

  // Create: 已排期 is refused before any write.
  assert.deepEqual(await save({ ...input, status: "scheduled", scheduled_at: null }, actor), {
    id: "",
    error: "INVALID_CAMPAIGN_STATUS",
  });
  assert.equal(queries.length, 0);

  // Update without the field, or with "", sends null and the SQL keeps the stored value.
  for (const scheduled of [{}, { scheduled_at: "" }, { scheduled_at: null }]) {
    queries.length = 0;
    assert.deepEqual(await save({ ...input, ...scheduled, id: "campaign-1" }, actor), {
      id: "campaign-1",
    });
    assert.equal(queries[0].params[4], null);
  }
  const update = queries[0].sql;
  assert.match(
    update,
    /scheduled_at=COALESCE\(\$5::timestamptz, whatsapp_campaigns\.scheduled_at\)/,
  );
  assert.doesNotMatch(update, /scheduled_at=\$5\b/);
  assert.match(
    update,
    /AND \(\$4::whatsapp_campaign_status <> 'scheduled' OR status = 'scheduled'\)/,
  );

  // Update into 已排期 from another status matches no row and says why.
  queries.length = 0;
  answer = (sql) => (/^\s*SELECT/.test(sql) ? [{ status: "review", has_history: false }] : []);
  assert.deepEqual(await save({ ...input, status: "scheduled", id: "campaign-1" }, actor), {
    id: "",
    error: "INVALID_CAMPAIGN_STATUS",
  });
  // A row that is already 已排期 keeps it.
  answer = (sql) => (/^\s*SELECT/.test(sql) ? [] : [{ id: "campaign-1" }]);
  assert.deepEqual(await save({ ...input, status: "scheduled", id: "campaign-1" }, actor), {
    id: "campaign-1",
  });
});

test("campaign cancellation only changes active campaigns and their pending recipients", async () => {
  const source = read("src/lib/neon/admin-data.server.ts");
  const file = ts.createSourceFile("admin-data.server.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "cancelAdminCampaign",
  );
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const statements = [];
  let rows = [{ id: "campaign-1" }];
  const cancel = new Function("getSql", "queryRows", executable + "\nreturn cancelAdminCampaign;")(
    () => ({
      transaction: async (callback) => {
        callback({
          query: (sql) => {
            statements.push(sql);
            return rows;
          },
        });
        return [rows];
      },
    }),
    async (sql) => {
      statements.push(sql);
      return rows;
    },
  );

  assert.deepEqual(await cancel("campaign-1", { staffId: "manager-1" }), { ok: true });
  assert.equal(
    statements.length,
    1,
    "the transition and its side effects must share one statement",
  );
  assert.match(
    statements[0],
    /WHERE id = \$1::uuid\s+AND status IN \('draft', 'review', 'scheduled', 'queued', 'sending'\)/,
    "completed and already cancelled campaigns must be immutable",
  );
  assert.match(
    statements[0],
    /UPDATE whatsapp_campaign_recipients[\s\S]*campaign_id IN \(SELECT id FROM cancelled\)/,
    "recipient cancellation must depend on the campaign transition",
  );
  assert.match(
    statements[0],
    /INSERT INTO audit_logs[\s\S]*FROM cancelled/,
    "audit must record only a successful cancellation",
  );
  rows = [];
  assert.deepEqual(await cancel("campaign-1", { staffId: "manager-1" }), {
    ok: false,
    error: "Not found",
  });
});

test("activity completion verifies its lead and audits the stored lead", async () => {
  const source = read("src/lib/neon/admin-data.server.ts");
  const file = ts.createSourceFile("admin-data.server.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "completeAdminLeadActivity",
  );
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const queries = [];
  let matched = true;
  const complete = new Function("queryRows", executable + "\nreturn completeAdminLeadActivity;")(
    async (sql, params) => {
      queries.push({ sql, params });
      return matched ? [{ id: "activity-1", lead_id: "lead-actual" }] : [];
    },
  );
  const input = { activity_id: "activity-1", lead_id: "lead-actual" };
  const actor = { staffId: "manager-1" };
  assert.deepEqual(await complete(input, actor), { ok: true });
  assert.equal(queries.length, 1, "the completion and its audit row are one statement");
  assert.deepEqual(queries[0].params, ["activity-1", "lead-actual", "manager-1"]);
  assert.match(
    queries[0].sql,
    /WHERE id = \$1::uuid\s+AND lead_id = \$2::uuid\s+AND completed_at IS NULL\s+RETURNING id, lead_id/,
  );
  // The audit row names the stored lead and exists only when a row completed.
  assert.match(
    queries[0].sql,
    /INSERT INTO audit_logs \(actor_id, action, subject_type, subject_id, metadata\)\s+SELECT \$3::uuid, 'lead\.activity\.complete', 'lead', done\.lead_id,[\s\S]*FROM done/,
  );

  matched = false;
  assert.deepEqual(await complete({ ...input, lead_id: "lead-mismatch" }, actor), {
    ok: false,
    error: "Not found or already complete",
  });
  assert.equal(queries.length, 2, "a rejected completion sends no second statement");
});

test("FAQ reorder rejects invalid batches and skips empty database work", async () => {
  const source = read("src/lib/neon/admin-data.server.ts");
  const file = ts.createSourceFile("admin-data.server.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "reorderAdminFaqs",
  );
  assert.ok(declaration);
  const executable = ts.transpileModule(declaration.getText(file).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const queries = [];
  const audits = [];
  let changedRows = [];
  const reorder = new Function(
    "queryRows",
    "writeAudit",
    executable + "\nreturn reorderAdminFaqs;",
  )(
    async (sql, params) => {
      queries.push({ sql, params });
      return changedRows;
    },
    async (...args) => {
      audits.push(args);
    },
  );
  const actor = { staffId: "manager-1" };
  const first = "00000000-0000-0000-0000-000000000001";
  const second = "00000000-0000-0000-0000-000000000002";

  assert.deepEqual(await reorder([], actor), { ok: true });
  assert.equal(queries.length, 0, "empty reorder must not reach Neon");
  assert.equal(audits.length, 0, "empty reorder is not a mutation");

  const oversized = Array.from(
    { length: 121 },
    (_, index) => `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
  );
  for (const ids of [null, ["bad-id"], [first, first], oversized]) {
    await assert.rejects(
      () => reorder(ids, actor),
      (error) => error instanceof Response && error.status === 400,
    );
  }
  assert.equal(queries.length, 0, "invalid batches must not reach Neon");
  assert.equal(audits.length, 0);

  changedRows = [{ id: first }, { id: second }];
  assert.deepEqual(await reorder([first, second], actor), { ok: true });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [[first, second]]);
  assert.match(queries[0].sql, /sort_order IS DISTINCT FROM d.ord[\s\S]*RETURNING faqs.id/);
  assert.equal(audits.length, 1);

  changedRows = [];
  assert.deepEqual(await reorder([first, second], actor), { ok: true });
  assert.equal(audits.length, 1, "unchanged order must not write an audit entry");
});

// FX-17a D-13 / G-25: the browser-callable queueAdminCampaign flipped a campaign
// to queued WITHOUT re-materialising its recipients, so opt-outs, lapsed
// consent and duplicate phones were not re-checked. 發送… is the only way in.
test("the only browser-callable campaign send path re-materialises recipients", () => {
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");
  const queueRoute = read("src/routes/api.admin.campaigns.$id.queue.ts");

  // No client export, no server-fn wrapper, no handler that reaches the bare queue.
  assert.doesNotMatch(client, /export\s+(?:async\s+function|const)\s+queueAdminCampaign\b/);
  assert.doesNotMatch(client, /queueAdminCampaignServer/);
  assert.doesNotMatch(client, /adminData\.queueAdminCampaign\(/);
  assert.doesNotMatch(client, /\bqueueAdminCampaign\b/);
  // The uncalled server alias is gone too. The server function itself stays but
  // is module-private (FX-19a-2): sendAdminCampaignQueue calls it, and the owned
  // DB suites reach it only through the test-only queueAdminCampaignForTests.
  assert.doesNotMatch(server, /export\s+async\s+function\s+queueCampaign\b/);
  assert.match(server, /^async\s+function\s+queueAdminCampaign\(/m);
  assert.doesNotMatch(server, /export\s+(?:async\s+function|const)\s+queueAdminCampaign\b/);
  assert.match(server, /export const queueAdminCampaignForTests = queueAdminCampaign;/);
  const testOnlyUsers = execFileSync("git", ["grep", "-l", "queueAdminCampaignForTests"], {
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !/\.test\.m?[jt]sx?$/.test(path) && !path.endsWith(".md"));
  assert.deepEqual(testOnlyUsers, ["src/lib/neon/admin-data.server.ts"]);

  // The real path: the queue route calls sendAdminCampaignQueue, which
  // validates, then materialises, and only then queues.
  assert.match(queueRoute, /adminData\.sendAdminCampaignQueue\(params\.id, staff/);
  assert.doesNotMatch(queueRoute, /adminData\.queueAdminCampaign\(/);
  const start = server.indexOf("export async function sendAdminCampaignQueue(");
  const end = server.slice(start).search(/\r?\n}\r?\n/) + start;
  assert.ok(start >= 0 && end > start);
  const send = server.slice(start, end);
  const validate = send.indexOf("validateAdminCampaignQueueability(id)");
  const materialise = send.indexOf("materializeCampaignRecipients(id, actor)");
  const queue = send.indexOf("queueAdminCampaign(id, actor, options)");
  assert.ok(validate >= 0 && materialise > validate && queue > materialise);
  assert.match(send, /if \(!materialization\.ok\)\s*return/);

  // No other screen or admin helper can reach the bare queue.
  for (const file of ["src/routes/admin.blasts.tsx", "src/lib/admin/blast-review.ts"]) {
    assert.doesNotMatch(read(file), /\bqueueAdminCampaign\b/, file);
  }
});

// FX-17a D-13: 已排期 never sent anything by itself. The send-queue cron only
// picks up campaigns already in queued/sending, so a scheduled row waits for 發送….
test("no cron or job path sends a campaign because it is 已排期", () => {
  const cron = read("src/routes/api.admin.jobs.send-queue.ts");
  assert.match(cron, /WHERE campaign\.status IN \('queued', 'sending'\)/);
  assert.doesNotMatch(cron, /'scheduled'/);
  const server = read("src/lib/neon/admin-data.server.ts");
  assert.doesNotMatch(server, /scheduled_at\s*(?:<=|<|>=|>)\s*now\(\)/);
});

// FX-18a C-16: a retry or a failed audit insert must not leave a FAQ or video
// write without its audit row, so the audit is part of the same statement.
test("FAQ and video saves write their audit row in the same statement", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  for (const name of ["saveAdminFaq", "saveAdminCmsVideo"]) {
    const start = server.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const end = server.slice(start).search(/\r?\n}\r?\n/) + start;
    const body = server.slice(start, end);
    assert.doesNotMatch(body, /await writeAudit\(/, name);
    assert.match(body, /INSERT INTO audit_logs/, name);
    assert.match(body, /cmsRowVersionSql\(/, name);
  }
});

// FX-18a C-16: transaction and property writes insert their audit row in the
// same statement, so a failed audit insert cannot leave the write committed.
test("transaction and property writes insert their audit row in the same statement", () => {
  const server = read("src/lib/neon/admin-data.server.ts");
  for (const name of ["saveAdminTransaction", "saveAdminProperty", "updateAdminPropertyStatus"]) {
    const start = server.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const end = server.slice(start).search(/\r?\n}\r?\n/) + start;
    const body = server.slice(start, end);
    assert.doesNotMatch(body, /await writeAudit\(/, name);
    assert.match(body, /INSERT INTO audit_logs/, name);
  }
});

test("no browser-callable hard delete or unversioned CMS writer remains", () => {
  const client = read("src/lib/neon/admin-data.ts");
  const server = read("src/lib/neon/admin-data.server.ts");
  for (const name of ["deleteAdminProperty", "saveAdminEstate", "saveAdminArticle"]) {
    assert.doesNotMatch(client, new RegExp(`\\b${name}(Server)?\\b`), `${name} in admin-data.ts`);
    assert.doesNotMatch(server, new RegExp(`\\b${name}\\b`), `${name} in admin-data.server.ts`);
  }
  assert.doesNotMatch(server, /DELETE\s+FROM\s+properties/i);
});

test("the public enquiry schema never rejects listing fields", async () => {
  // C-15: a malformed listing number or property id must never cost the enquiry.
  const source = read("src/lib/neon/admin-data.ts");
  const file = ts.createSourceFile("admin-data.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (item) => ts.isIdentifier(item.name) && item.name.text === "websiteInquirySchema",
      ),
  );
  assert.ok(declaration, "websiteInquirySchema must stay a top-level declaration");
  const executable = ts.transpileModule(declaration.getText(file), {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { z } = await import("zod");
  const schema = new Function("z", executable + "\nreturn websiteInquirySchema;")(z);

  const base = {
    submissionId: "79180000-0000-4000-8000-000000000001",
    name: "陳先生",
    phone: "9123 4567",
  };
  for (const listing of [
    { listingNo: "樓盤 A 12", property_id: "abc" },
    { listingNo: 12345, property_id: 42 },
    { listingNo: "x".repeat(500), property_id: "y".repeat(500) },
    { listingNo: null, property_id: null },
  ]) {
    const parsed = schema.safeParse({ ...base, ...listing });
    assert.equal(parsed.success, true, JSON.stringify(listing));
    assert.equal(parsed.data.name, "陳先生");
  }
  const valid = schema.parse({
    ...base,
    listingNo: "EP12345-R",
    property_id: "79180000-0000-4000-8000-000000000002",
  });
  assert.equal(valid.listingNo, "EP12345-R");
  assert.equal(valid.property_id, "79180000-0000-4000-8000-000000000002");
  // Everything else is still validated.
  assert.equal(schema.safeParse({ ...base, phone: "abc" }).success, false);
});

// FX-18a C-16: an audited create inserts its audit row in the same statement
// as the write, so a failed audit insert rolls the write back and a retry
// cannot duplicate it. The functions still on a trailing writeAudit are listed
// here by name (the FX-18 follow-ups); a new writer cannot quietly join them.
test("audited creates in admin-data.server.ts insert their audit row in the same statement", () => {
  const source = read("src/lib/neon/admin-data.server.ts");
  const file = ts.createSourceFile("admin-data.server.ts", source, ts.ScriptTarget.Latest, true);
  const stillOnWriteAudit = new Set([
    "updateStaffRoles",
    "setStaffActive",
    "saveAdminProperty",
    "updateAdminPropertyStatus",
    "deleteAdminProperty",
    "saveAdminTransaction",
    "saveAdminAgentProfile",
    "rebuildAdminAiKnowledge",
    "saveAdminCrmSegment",
    "materializeAdminCrmSegment",
    "createAdminAudienceFromSegment",
    "saveAdminCmsVideo",
    "saveAdminEstate",
    "saveAdminArticle",
    "saveAdminFaq",
    "deleteAdminFaq",
    "reorderAdminFaqs",
    "updateAdminMediaAsset",
    "analyzeAdminLeadAiProfile",
    "approveAdminAiTag",
    "rejectAdminAiTag",
    "bulkUpdateAdminLeads",
    "updateAdminConversation",
    "saveAdminAudience",
    "deleteAdminAudience",
    "saveAdminCampaign",
    "materializeCampaignRecipients",
  ]);
  const sameStatement = [
    "createAdminLeadActivity",
    "completeAdminLeadActivity",
    "updateInquiryStatus",
  ];
  const bodies = new Map();
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    if (statement.name.text === "writeAudit") continue;
    bodies.set(statement.name.text, statement.getText(file));
  }
  for (const [name, body] of bodies) {
    if (/\bwriteAudit\(/.test(body)) {
      assert.ok(
        stillOnWriteAudit.has(name),
        `${name} calls writeAudit after its write; insert the audit row in the same statement`,
      );
    }
  }
  for (const name of sameStatement) {
    const body = bodies.get(name);
    assert.ok(body, name);
    assert.ok(!stillOnWriteAudit.has(name), name);
    assert.doesNotMatch(body, /\bwriteAudit\(/, name);
    assert.equal((body.match(/\bqueryRows\b/g) ?? []).length, 1, `${name}: one statement`);
    assert.match(
      body,
      /INSERT INTO audit_logs \(actor_id, action, subject_type, subject_id, metadata\)\s+SELECT[\s\S]*FROM (ins|done|updated)\b/,
      name,
    );
  }
});
