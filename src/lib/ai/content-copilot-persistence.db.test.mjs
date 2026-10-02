import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { buildContentFingerprint } from "./content-copilot.ts";

test(
  "content proposals revalidate active actor, scope and DB revision at save and apply",
  { timeout: 120000 },
  async (t) => {
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      const repo = await import("./content-copilot-repository.server.ts");
      const [staff] = await query(
        "INSERT INTO staff_users(auth_user_id,email) VALUES('synthetic-copilot','qa-copilot@example.invalid') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent')", [staff.id]);
      let number = 0;
      async function start() {
        const [property] = await query(
          "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price,agent_id) VALUES($1,$1,'原有標題','sale','sham-tseng','active',10000000,$2) RETURNING *",
          ["QA-COPY-" + number++, staff.id],
        );
        const fp = await buildContentFingerprint(property);
        const request = {
          resourceType: "listing",
          resourceId: property.id,
          action: "improve",
          selectedFields: ["title_zh"],
          tone: "professional_property",
          targetLanguage: "zh-HK",
          researchMode: "internal",
        };
        const row = await repo.startContentProposal({
          staffId: staff.id,
          authUserId: "synthetic-copilot",
          sourceDbRevision: (
            await query("SELECT ep_content_source_revision('listing',$1::uuid) revision", [
              property.id,
            ])
          )[0].revision,
          knowledgeDependencies: [],
          request,
          sourceFingerprint: fp,
          promptVersion: "content-copilot-v1",
        });
        const completion = {
          staffId: staff.id,
          authUserId: "synthetic-copilot",
          proposalId: row.id,
          resourceType: "listing",
          resourceId: property.id,
          action: request.action,
          proposal: {
            resourceType: "listing",
            sourceFingerprint: fp,
            patches: [
              {
                field: "title_zh",
                before: "原有標題",
                after: "待確認新標題",
                reason: "改善文案",
                confidence: "high",
                evidenceIds: [],
                unsupportedClaims: [],
                claimType: "subjective",
              },
            ],
            evidence: [],
            warnings: [],
          },
        };
        return { property, row, completion };
      }
      await t.test(
        "source changes during generation cannot become a generated proposal",
        async () => {
          const x = await start();
          await query("UPDATE properties SET price=11000000 WHERE id=$1", [x.property.id]);
          await assert.rejects(
            repo.completeContentProposal(x.completion),
            /COPILOT_STALE_PROPOSAL/,
          );
          assert.equal(
            (await query("SELECT status FROM ai_content_proposals WHERE id=$1", [x.row.id]))[0]
              .status,
            "generating",
          );
          await repo.failContentProposal({
            staffId: staff.id,
            proposalId: x.row.id,
            errorCode: "COPILOT_STALE_PROPOSAL",
          });
        },
      );
      await t.test(
        "active actor/source apply retains draft isolation and protected facts",
        async () => {
          const x = await start();
          await repo.completeContentProposal(x.completion);
          const decided = await repo.decideContentProposal({
            staffId: staff.id,
            authUserId: "synthetic-copilot",
            proposalId: x.row.id,
            acceptedFields: ["title_zh"],
          });
          assert.equal(decided.status, "applied");
          const retried = await repo.decideContentProposal({
            staffId: staff.id,
            authUserId: "synthetic-copilot",
            proposalId: x.row.id,
            acceptedFields: ["title_zh"],
          });
          assert.equal(retried.status, "applied");
          assert.equal(retried.decidedAt, decided.decidedAt);
          const [unchanged] = await query("SELECT title_zh,price FROM properties WHERE id=$1", [
            x.property.id,
          ]);
          assert.equal(unchanged.title_zh, "原有標題");
          assert.equal(Number(unchanged.price), 10000000);
        },
      );
      for (const change of ["active", "scope", "price", "role"]) {
        await t.test(change + " changes after generation deny apply", async () => {
          await query("UPDATE staff_users SET active=true WHERE id=$1", [staff.id]);
          await query(
            "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent') ON CONFLICT DO NOTHING",
            [staff.id],
          );
          const x = await start();
          await repo.completeContentProposal(x.completion);
          if (change === "active")
            await query("UPDATE staff_users SET active=false WHERE id=$1", [staff.id]);
          if (change === "scope")
            await query("UPDATE properties SET agent_id=NULL WHERE id=$1", [x.property.id]);
          if (change === "price")
            await query("UPDATE properties SET price=12000000 WHERE id=$1", [x.property.id]);
          if (change === "role")
            await query("DELETE FROM staff_roles WHERE staff_user_id=$1", [staff.id]);
          await assert.rejects(
            repo.decideContentProposal({
              staffId: staff.id,
              authUserId: "synthetic-copilot",
              proposalId: x.row.id,
              acceptedFields: ["title_zh"],
            }),
            /COPILOT_FORBIDDEN|COPILOT_STALE_PROPOSAL/,
          );
          assert.equal(
            (await query("SELECT status FROM ai_content_proposals WHERE id=$1", [x.row.id]))[0]
              .status,
            "generated",
          );
        });
      }
      for (const change of ["active", "scope"]) {
        await t.test(change + " changes during generation deny save", async () => {
          await query("UPDATE staff_users SET active=true WHERE id=$1", [staff.id]);
          await query(
            "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'agent') ON CONFLICT DO NOTHING",
            [staff.id],
          );
          const x = await start();
          if (change === "active")
            await query("UPDATE staff_users SET active=false WHERE id=$1", [staff.id]);
          else await query("UPDATE properties SET agent_id=NULL WHERE id=$1", [x.property.id]);
          await assert.rejects(repo.completeContentProposal(x.completion), /COPILOT_FORBIDDEN/);
          await repo.failContentProposal({
            staffId: staff.id,
            proposalId: x.row.id,
            errorCode: "COPILOT_FORBIDDEN",
          });
        });
      }
      const [manager] = await query(
        "INSERT INTO staff_users(auth_user_id,email) VALUES('synthetic-manager','qa-manager@example.invalid') RETURNING id",
      );
      await query("INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'manager')", [manager.id]);
      async function articleStart(dependencies = [], beforeStart = async () => {}) {
        await query(
          "UPDATE ai_content_proposals SET status='failed' WHERE requested_by=$1 AND status='generating'",
          [manager.id],
        );
        const [article] = await query(
          "INSERT INTO articles(slug,title,content,published) VALUES($1,'原文','原內容',true) RETURNING *",
          ["qa-copy-" + number++],
        );
        const request = {
          resourceType: "article",
          resourceId: article.id,
          action: "improve",
          selectedFields: ["title"],
          tone: "professional_property",
          targetLanguage: "zh-HK",
          researchMode: "internal",
        };
        const [{ revision }] = await query(
          "SELECT ep_content_source_revision('article',$1::uuid) revision",
          [article.id],
        );
        await beforeStart(article);
        const fp = await buildContentFingerprint(article);
        const row = await repo.startContentProposal({
          staffId: manager.id,
          authUserId: "synthetic-manager",
          request,
          sourceFingerprint: fp,
          sourceDbRevision: revision,
          knowledgeDependencies: dependencies,
          promptVersion: "content-copilot-v1",
        });
        const completion = {
          staffId: manager.id,
          authUserId: "synthetic-manager",
          proposalId: row.id,
          resourceType: "article",
          resourceId: article.id,
          action: "improve",
          proposal: {
            resourceType: "article",
            sourceFingerprint: fp,
            patches: [],
            evidence: [],
            warnings: [],
          },
        };
        return { article, row, completion };
      }
      await t.test(
        "mutation between context read and start rejects the captured old revision",
        async () => {
          await assert.rejects(
            articleStart([], (a) => query("UPDATE articles SET title='新版' WHERE id=$1", [a.id])),
            /COPILOT_STALE_PROPOSAL/,
          );
        },
      );
      for (const phase of ["completion", "apply"]) {
        await t.test("authenticated account binding change rejects " + phase, async () => {
          await query("UPDATE staff_users SET auth_user_id='synthetic-manager' WHERE id=$1", [
            manager.id,
          ]);
          const x = await articleStart();
          if (phase === "apply") await repo.completeContentProposal(x.completion);
          await query("UPDATE staff_users SET auth_user_id='replacement-account' WHERE id=$1", [
            manager.id,
          ]);
          const operation =
            phase === "apply"
              ? () =>
                  repo.decideContentProposal({
                    staffId: manager.id,
                    authUserId: "synthetic-manager",
                    proposalId: x.row.id,
                    acceptedFields: ["title"],
                  })
              : () => repo.completeContentProposal(x.completion);
          await assert.rejects(operation, /COPILOT_FORBIDDEN/);
          if (phase === "completion")
            await repo.failContentProposal({
              staffId: manager.id,
              proposalId: x.row.id,
              errorCode: "COPILOT_FORBIDDEN",
            });
        });
      }
      await query("UPDATE staff_users SET auth_user_id='synthetic-manager' WHERE id=$1", [
        manager.id,
      ]);
      const knowledge = await import("./knowledge.server.ts");
      for (const phase of ["completion", "apply"])
        for (const change of ["price", "withdrawal", "faq-change", "faq-delete"]) {
          await t.test(
            "cited " + change + " rejects " + phase + " while article remains unchanged",
            async () => {
              const [listing] = await query(
                "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price) VALUES($1,$1,'引用海景盤','sale','sham-tseng','active',10000000) RETURNING id",
                ["QA-EVIDENCE-" + number++],
              );
              const [faq] = await query(
                "INSERT INTO faqs(question,answer,scope) VALUES($1,'原有答案','general') RETURNING id,question",
                ["引用海景問題-" + number++],
              );
              await knowledge.repairPublicKnowledgeIndex();
              const chunks = await knowledge.searchPublicKnowledge({
                query: change.startsWith("faq") ? faq.question : "引用海景",
                limit: 6,
              });
              const relevant = chunks.filter((c) =>
                change.startsWith("faq") ? c.source_type === "faq" : c.listing_id === listing.id,
              );
              assert.ok(relevant.length);
              const dependencies = relevant.map((c) => ({
                chunkId: c.id,
                sourceId: c.source_id,
                sourceRevision: c.source_revision,
              }));
              const x = await articleStart(dependencies);
              if (phase === "apply") await repo.completeContentProposal(x.completion);
              if (change === "price")
                await query("UPDATE properties SET price=12000000 WHERE id=$1", [listing.id]);
              if (change === "withdrawal")
                await query("UPDATE properties SET status='inactive' WHERE id=$1", [listing.id]);
              if (change === "faq-change")
                await query("UPDATE faqs SET answer='新版答案' WHERE id=$1", [faq.id]);
              if (change === "faq-delete") await query("DELETE FROM faqs WHERE id=$1", [faq.id]);
              const operation =
                phase === "apply"
                  ? () =>
                      repo.decideContentProposal({
                        staffId: manager.id,
                        authUserId: "synthetic-manager",
                        proposalId: x.row.id,
                        acceptedFields: ["title"],
                      })
                  : () => repo.completeContentProposal(x.completion);
              await assert.rejects(operation, /COPILOT_STALE_PROPOSAL/);
              if (phase === "completion")
                await repo.failContentProposal({
                  staffId: manager.id,
                  proposalId: x.row.id,
                  errorCode: "COPILOT_STALE_PROPOSAL",
                });
            },
          );
        }
      await t.test(
        "real context/service carries every evidence revision through start and rejects in-flight change",
        async () => {
          const { createContentCopilotContextLoader } =
            await import("./content-copilot-context.server.ts");
          const { createContentCopilotService } = await import("./content-copilot.server.ts");
          const [faq] = await query(
            "INSERT INTO faqs(question,answer,scope) VALUES('QA service dependency','Original answer','general') RETURNING *",
          );
          const [article] = await query(
            "INSERT INTO articles(slug,title,content,published) VALUES('qa-service-context','Article title','Saved content',true) RETURNING *",
          );
          await knowledge.repairPublicKnowledgeIndex();
          const chunks = await knowledge.searchPublicKnowledge({ query: faq.question, limit: 6 });
          assert.equal(chunks.length, 1);
          const loader = createContentCopilotContextLoader({
            queryRows: query,
            searchPublicKnowledge: async () => chunks,
          });
          const actor = {
            staffId: manager.id,
            authUserId: "synthetic-manager",
            email: "qa-manager@example.invalid",
            name: "QA Manager",
            roles: ["manager"],
            bootstrap: false,
          };
          const request = {
            resourceType: "article",
            resourceId: article.id,
            action: "improve",
            selectedFields: ["title"],
            tone: "professional_property",
            targetLanguage: "zh-HK",
            researchMode: "internal",
          };
          const context = await loader.load(request, actor);
          assert.equal(
            context.sourceDbRevision,
            (
              await query("SELECT ep_content_source_revision('article',$1::uuid) revision", [
                article.id,
              ])
            )[0].revision,
          );
          assert.deepEqual(context.knowledgeDependencies, [
            {
              chunkId: chunks[0].id,
              sourceId: chunks[0].source_id,
              sourceRevision: chunks[0].source_revision,
            },
          ]);
          const service = createContentCopilotService({
            loadContext: (r, a) => loader.load(r, a),
            startProposal: repo.startContentProposal,
            completeProposal: repo.completeContentProposal,
            failProposal: repo.failContentProposal,
            writeAudit: repo.writeContentCopilotAudit,
            generate: async () => {
              await query("UPDATE faqs SET answer='Changed during generation' WHERE id=$1", [
                faq.id,
              ]);
              return {
                ok: true,
                value: { patches: [], warnings: [] },
                model: "synthetic-only",
                latencyMs: 1,
                usageMetadata: {},
                error: null,
              };
            },
          });
          const result = await service.generateContentProposal(request, actor);
          assert.equal(result.ok, false);
          assert.equal(result.error, "COPILOT_STALE_PROPOSAL");
          const [saved] = await query("SELECT * FROM ai_content_proposals WHERE resource_id=$1", [
            article.id,
          ]);
          assert.equal(saved.status, "failed");
          assert.equal(saved.requested_auth_user_id, actor.authUserId);
          assert.deepEqual(saved.knowledge_dependencies, context.knowledgeDependencies);
        },
      );
    });
  },
);
