import assert from "node:assert/strict";
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
    "saveAdminEstate",
    "saveAdminArticle",
    "saveAdminFaq",
    "deleteAdminFaq",
    "reorderAdminFaqs",
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
    "queueAdminCampaign",
    "cancelAdminCampaign",
    "fetchLeadLiveAgentTranscript",
  ];

  for (const name of exports) {
    const exportPattern = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${name}\\b`);
    assert.match(client, exportPattern, `admin-data.ts should export ${name}`);
    assert.match(server, exportPattern, `admin-data.server.ts should export ${name}`);
  }

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
  assert.match(server, /title_en = \$21/);
  assert.match(server, /features = \$22::text\[\]/);
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
    /AND \(NOT EXISTS \(SELECT 1 FROM whatsapp_campaign_recipients history[\s\S]*OR \(template_id IS NOT DISTINCT FROM \$2 AND audience_id IS NOT DISTINCT FROM \$3\)\)/,
    "a campaign with delivery history keeps its template and audience",
  );
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
  const audits = [];
  let matched = true;
  const complete = new Function(
    "queryRows",
    "writeAudit",
    executable + "\nreturn completeAdminLeadActivity;",
  )(
    async (sql, params) => {
      queries.push({ sql, params });
      return matched ? [{ id: "activity-1", lead_id: "lead-actual" }] : [];
    },
    async (...args) => {
      audits.push(args);
    },
  );
  const input = { activity_id: "activity-1", lead_id: "lead-actual" };
  const actor = { staffId: "manager-1" };
  assert.deepEqual(await complete(input, actor), { ok: true });
  assert.deepEqual(queries[0].params, ["activity-1", "lead-actual"]);
  assert.match(
    queries[0].sql,
    /WHERE id = \$1::uuid\s+AND lead_id = \$2::uuid\s+AND completed_at IS NULL\s+RETURNING id, lead_id/,
  );
  assert.deepEqual(audits[0].slice(0, 4), [
    "manager-1",
    "lead.activity.complete",
    "lead",
    "lead-actual",
  ]);

  matched = false;
  assert.deepEqual(await complete({ ...input, lead_id: "lead-mismatch" }, actor), {
    ok: false,
    error: "Not found or already complete",
  });
  assert.equal(audits.length, 1, "a rejected completion must not write an audit entry");
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
