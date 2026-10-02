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
          request,
          sourceFingerprint: fp,
          promptVersion: "content-copilot-v1",
        });
        const completion = {
          staffId: staff.id,
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
            proposalId: x.row.id,
            acceptedFields: ["title_zh"],
          });
          assert.equal(decided.status, "applied");
          const retried = await repo.decideContentProposal({
            staffId: staff.id,
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
    });
  },
);
