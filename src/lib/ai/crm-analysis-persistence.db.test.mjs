import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
  repoRoot,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test(
  "CRM contract persists safe fallback and metadata with independent full-schema SQL readback",
  { timeout: 120000 },
  async () => {
    await withOwnedPostgres(async ({ query, transaction, migrationCount }) => {
      await mockOwnedServerDb(mock, query, transaction);
      mock.module(new URL("src/lib/ai/provider.server.ts", repoRoot).href, {
        exports: {
          generateAiJson: async (input) => ({
            ok: false,
            value: input.fallback,
            error: "SYNTHETIC_DISABLED",
          }),
        },
      });
      const { analyzeCrmLead } = await import("./crm-enrichment.server.ts");
      const [lead] = await query(
        "INSERT INTO crm_leads(source,note) VALUES('test','測試記錄：沒有客戶聯絡資料') RETURNING id",
      );
      await analyzeCrmLead(lead.id);
      const [profile] = await query("SELECT * FROM crm_ai_profiles WHERE lead_id=$1", [lead.id]);
      assert.equal(profile.action_type, "mark_test");
      assert.equal(profile.result_kind, "fallback");
      assert.equal(profile.generated_by, "fallback");
      assert.equal(profile.validation_code, "SYNTHETIC_DISABLED");
      assert.equal(profile.analysis_version, "crm-analysis-v2");
      assert.equal(profile.lead_score, 0);
      assert.doesNotMatch(profile.next_best_action, /WhatsApp|電話|推廣/);
      const [effects] = await query(
        "SELECT (SELECT count(*) FROM whatsapp_outbound_intents)::int AS outbound",
      );
      assert.equal(effects.outbound, 0);
      const [missing] = await query("INSERT INTO crm_leads(source) VALUES('website') RETURNING id");
      await analyzeCrmLead(missing.id);
      const [missingProfile] = await query("SELECT * FROM crm_ai_profiles WHERE lead_id=$1", [
        missing.id,
      ]);
      assert.equal(missingProfile.action_type, "complete_contact");
      assert.doesNotMatch(missingProfile.next_best_action, /WhatsApp|電話|推廣/);
      assert.ok(migrationCount >= 83);
    });
  },
);
