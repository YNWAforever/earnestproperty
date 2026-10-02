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
  async (t) => {
    await withOwnedPostgres(async ({ pool, query, transaction, migrationCount }) => {
      await mockOwnedServerDb(mock, query, transaction);
      let duringGenerate = async () => {};
      let providerCalls = 0;
      let modelValue = null;
      mock.module(new URL("src/lib/ai/provider.server.ts", repoRoot).href, {
        exports: {
          generateAiJson: async (input) => {
            providerCalls++;
            await duringGenerate();
            return modelValue
              ? {
                  ok: true,
                  value: modelValue,
                  error: null,
                  metadata: {
                    provider: "synthetic-provider",
                    resolvedModel: "synthetic-resolved-model",
                    usage: {
                      inputTokens: 17,
                      outputTokens: 9,
                      costAmount: null,
                      costCurrency: null,
                    },
                  },
                }
              : { ok: false, value: input.fallback, error: "SYNTHETIC_DISABLED" };
          },
        },
      });
      const { analyzeCrmLead, approveCrmAiTag } = await import("./crm-enrichment.server.ts");
      const [staff] = await query(
        "INSERT INTO staff_users(auth_user_id,email) VALUES('synthetic-agent','qa-crm@example.invalid') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [staff.id]);
      const actor = {
        staffId: staff.id,
        authUserId: "synthetic-agent",
        email: null,
        name: null,
        roles: ["agent"],
        bootstrap: false,
      };
      const [lead] = await query(
        "INSERT INTO crm_leads(source,note,assigned_agent_id) VALUES('test','測試記錄：沒有客戶聯絡資料',$1) RETURNING id",
        [staff.id],
      );
      await analyzeCrmLead(lead.id, actor);
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
      const [missing] = await query(
        "INSERT INTO crm_leads(source,assigned_agent_id) VALUES('website',$1) RETURNING id",
        [staff.id],
      );
      await analyzeCrmLead(missing.id, actor);
      const [missingProfile] = await query("SELECT * FROM crm_ai_profiles WHERE lead_id=$1", [
        missing.id,
      ]);
      assert.equal(missingProfile.action_type, "complete_contact");
      assert.doesNotMatch(missingProfile.next_best_action, /WhatsApp|電話|推廣/);
      assert.ok(migrationCount >= 83);
      for (const change of ["contact", "consent", "ownership", "role", "active", "price"]) {
        await t.test(
          "generation rechecks " + change + " before saving any profile/tags",
          async () => {
            await query("UPDATE staff_users SET active=true WHERE id=$1", [staff.id]);
            await query(
              "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent') ON CONFLICT DO NOTHING",
              [staff.id],
            );
            const [contact] = await query(
              "INSERT INTO crm_contacts(source) VALUES('website') RETURNING id",
            );
            const [property] = await query(
              "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price) VALUES($1,$1,'獨立測試盤','sale','sham-tseng','active',10000000) RETURNING id",
              ["QA-CRM-" + change],
            );
            const [target] = await query(
              "INSERT INTO crm_leads(source,contact_id,assigned_agent_id,property_id) VALUES('website',$1,$2,$3) RETURNING id",
              [contact.id, staff.id, property.id],
            );
            duringGenerate = async () => {
              // Independent connection: no locks are held during model work.
              const client = await pool.connect();
              try {
                if (change === "contact")
                  await client.query(
                    "UPDATE crm_contacts SET email='changed@example.invalid' WHERE id=$1",
                    [contact.id],
                  );
                if (change === "consent")
                  await client.query(
                    "UPDATE crm_contacts SET opted_out_whatsapp=true WHERE id=$1",
                    [contact.id],
                  );
                if (change === "ownership")
                  await client.query("UPDATE crm_leads SET assigned_agent_id=NULL WHERE id=$1", [
                    target.id,
                  ]);
                if (change === "role")
                  await client.query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff.id]);
                if (change === "active")
                  await client.query("UPDATE staff_users SET active=false WHERE id=$1", [staff.id]);
                if (change === "price")
                  await client.query("UPDATE properties SET price=11000000 WHERE id=$1", [
                    property.id,
                  ]);
              } finally {
                client.release();
              }
            };
            const result = await analyzeCrmLead(target.id, actor);
            const [counts] = await query(
              "SELECT (SELECT count(*) FROM crm_ai_profiles WHERE lead_id=$1)::int profiles,(SELECT count(*) FROM crm_ai_tags WHERE lead_id=$1)::int tags",
              [target.id],
            );
            assert.equal(counts.profiles, 0);
            assert.equal(counts.tags, 0);
            assert.ok(["stale", "denied"].includes(result.analysis?.status));
            duringGenerate = async () => {};
          },
        );
      }
      await query(
        "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent') ON CONFLICT DO NOTHING",
        [staff.id],
      );
      await query("UPDATE staff_users SET active=true WHERE id=$1", [staff.id]);
      duringGenerate = async () => {};
      await t.test(
        "a repeated run request reuses persisted result without another provider call",
        async () => {
          const requestId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
          const before = providerCalls;
          const first = await analyzeCrmLead(missing.id, actor, { requestId });
          const second = await analyzeCrmLead(missing.id, actor, { requestId });
          assert.equal(providerCalls - before, 1);
          assert.equal(first.analysis.runId, second.analysis.runId);
        },
      );
      await t.test(
        "current actor/scope denies request before any provider call despite stale claimed admin role",
        async () => {
          const [other] = await query(
            "INSERT INTO crm_leads(source) VALUES('website') RETURNING id",
          );
          const before = providerCalls;
          const result = await analyzeCrmLead(other.id, { ...actor, roles: ["admin"] });
          assert.equal(result.analysis.status, "denied");
          assert.equal(providerCalls, before);
        },
      );
      await t.test("tag apply validates origin run and preserves human decisions", async () => {
        modelValue = {
          summary: "核實查詢",
          urgency: "normal",
          timeline: null,
          action: { type: "review_enquiry", reason: "由同事覆核" },
          suggested_tags: [
            { tag: "needs_confirmation", confidence: 0.4, reason: "待確認" },
            { tag: "review_later", confidence: 0.5, reason: "由同事確認" },
          ],
        };
        const result = await analyzeCrmLead(missing.id, actor);
        assert.equal(result.analysis.resultKind, "model_validated");
        assert.equal(result.analysis.provider, "synthetic-provider");
        assert.equal(result.analysis.resolvedModel, "synthetic-resolved-model");
        assert.deepEqual(result.analysis.usage, {
          inputTokens: 17,
          outputTokens: 9,
          costAmount: null,
          costCurrency: null,
        });
        const [tag] = await query(
          "SELECT * FROM crm_ai_tags WHERE lead_id=$1 AND tag='needs_confirmation'",
          [missing.id],
        );
        assert.equal(tag.analysis_run_id, result.analysis.runId);
        const approved = await approveCrmAiTag(
          { tagId: tag.id, staffId: actor.staffId, approve: true },
          actor,
        );
        assert.equal(approved.status, "approved");
        modelValue.suggested_tags[0].reason = "模型改動，不可覆蓋人工決定";
        await analyzeCrmLead(missing.id, actor);
        const [preserved] = await query("SELECT * FROM crm_ai_tags WHERE id=$1", [tag.id]);
        assert.equal(preserved.reason, "待確認");
        assert.equal(preserved.analysis_run_id, tag.analysis_run_id);
        const [suggested] = await query(
          "SELECT * FROM crm_ai_tags WHERE lead_id=$1 AND tag='review_later'",
          [missing.id],
        );
        await query("UPDATE crm_leads SET note='來源已更新' WHERE id=$1", [missing.id]);
        await assert.rejects(
          approveCrmAiTag({ tagId: suggested.id, staffId: actor.staffId, approve: true }, actor),
          (error) => error.code === "CRM_AI_STALE",
        );
        assert.equal(
          (await query("SELECT status FROM crm_ai_tags WHERE id=$1", [suggested.id]))[0].status,
          "suggested",
        );
        modelValue = null;
      });
      await t.test(
        "restart with unknown provider outcome retains failed run and never silently spends again",
        async () => {
          const requestId = "aaaaaaab-cdef-4abc-8def-abcdefabcdef";
          await query("SELECT ep_begin_crm_analysis_run($1,$2,$3,$4,NULL)", [
            requestId,
            missing.id,
            actor.staffId,
            actor.authUserId,
          ]);
          await query(
            "UPDATE crm_ai_analysis_runs SET expires_at=now()-interval '1 second' WHERE id=$1",
            [requestId],
          );
          const before = providerCalls;
          const result = await analyzeCrmLead(missing.id, actor, { requestId });
          assert.equal(result.analysis.status, "failed");
          assert.equal(result.analysis.validationCode, "UNKNOWN_PROVIDER_OUTCOME");
          assert.equal(result.analysis.usage, null);
          assert.equal(providerCalls, before);
        },
      );
      await t.test(
        "cancel before start and late output after cancellation cannot save",
        async () => {
          const { cancelCrmAnalysisRun } = await import("./crm-analysis-runs.server.ts");
          const first = "bbbbbbab-cdef-4abc-8def-abcdefabcdef";
          await cancelCrmAnalysisRun(missing.id, first, actor);
          const before = providerCalls;
          assert.equal(
            (await analyzeCrmLead(missing.id, actor, { requestId: first })).analysis.status,
            "cancelled",
          );
          assert.equal(providerCalls, before);
          const late = "ccccccab-cdef-4abc-8def-abcdefabcdef";
          const [prior] = await query(
            "SELECT analysis_run_id FROM crm_ai_profiles WHERE lead_id=$1",
            [missing.id],
          );
          duringGenerate = () => cancelCrmAnalysisRun(missing.id, late, actor);
          assert.equal(
            (await analyzeCrmLead(missing.id, actor, { requestId: late })).analysis.status,
            "cancelled",
          );
          assert.equal(
            (
              await query("SELECT analysis_run_id FROM crm_ai_profiles WHERE lead_id=$1", [
                missing.id,
              ])
            )[0].analysis_run_id,
            prior.analysis_run_id,
          );
          duringGenerate = async () => {};
        },
      );
      await t.test("a later run supersedes a delayed earlier output", async () => {
        let releaseOld;
        let notifyStarted;
        let calls = 0;
        const started = new Promise((resolve) => {
          notifyStarted = resolve;
        });
        const blocked = new Promise((resolve) => {
          releaseOld = resolve;
        });
        duringGenerate = async () => {
          if (calls++ === 0) {
            notifyStarted();
            await blocked;
          }
        };
        const old = analyzeCrmLead(missing.id, actor, {
          requestId: "ddddddab-cdef-4abc-8def-abcdefabcdef",
        });
        await started;
        const next = await analyzeCrmLead(missing.id, actor, {
          requestId: "eeeeeeab-cdef-4abc-8def-abcdefabcdef",
        });
        releaseOld();
        const previous = await old;
        assert.equal(next.analysis.status, "completed");
        assert.equal(previous.analysis.status, "cancelled");
        assert.equal(
          (
            await query("SELECT analysis_run_id FROM crm_ai_profiles WHERE lead_id=$1", [
              missing.id,
            ])
          )[0].analysis_run_id,
          next.analysis.runId,
        );
        duringGenerate = async () => {};
      });
    });
  },
);
