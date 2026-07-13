import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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