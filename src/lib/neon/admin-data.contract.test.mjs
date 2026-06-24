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
