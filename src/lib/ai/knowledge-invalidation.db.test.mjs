import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
  repoRoot,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test(
  "committed source changes have durable repair, rollback has none, and rebuild preserves current facts",
  { timeout: 120000 },
  async (t) => {
    await withOwnedPostgres(async ({ pool, query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      let providerCalls = 0;
      mock.module(new URL("src/lib/ai/provider.server.ts", repoRoot).href, {
        exports: {
          generateAiText: async () => {
            providerCalls++;
            throw new Error("knowledge rebuild must not call a model");
          },
          generateAiJson: async () => {
            providerCalls++;
            throw new Error("knowledge rebuild must not call a model");
          },
        },
      });
      const knowledge = await import("./knowledge.server.ts");
      const [property] = await query(
        "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price) VALUES('QA-REPAIR','QA-REPAIR','修復海景盤','sale','sham-tseng','active',10000000) RETURNING id",
      );
      await t.test(
        "existing rebuild must write a canonical revision and retain valid retrieval",
        async () => {
          await knowledge.rebuildAiKnowledgeIndex();
          const chunks = await knowledge.searchPublicKnowledge({ query: "修復海景" });
          assert.equal(chunks.length, 1);
          assert.match(chunks[0].chunk_text, /\$10,000,000/);
        },
      );
      await t.test(
        "rebuild stores chunks with NULL embedding and makes no provider call",
        async () => {
          const before = providerCalls;
          await knowledge.rebuildAiKnowledgeIndex();
          const [withEmbedding] = await query(
            "SELECT count(*)::int n FROM ai_knowledge_chunks WHERE embedding IS NOT NULL",
          );
          const [all] = await query("SELECT count(*)::int n FROM ai_knowledge_chunks");
          assert.equal(withEmbedding.n, 0);
          assert.ok(all.n > 0, "rebuild must still store chunks");
          assert.equal(providerCalls, before);
        },
      );
      await t.test("committed price mutation queues repair in the same transaction", async () => {
        await query("UPDATE properties SET price=11000000 WHERE id=$1", [property.id]);
        assert.equal(
          (await knowledge.searchPublicKnowledge({ query: "修復海景" })).filter(
            (chunk) => chunk.source_type === "listing" && chunk.listing_id === property.id,
          ).length,
          0,
        );
        const jobs = await query("SELECT * FROM ops_jobs WHERE job_type='ai.knowledge.repair'");
        assert.ok(jobs.length > 0, "Committed mutation must have a durable repair job");
      });
      await t.test(
        "rollback cannot invalidate committed current content or leave a repair request",
        async () => {
          const before = (
            await query("SELECT count(*)::int n FROM ops_jobs WHERE job_type='ai.knowledge.repair'")
          )[0].n;
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("UPDATE properties SET price=999999 WHERE id=$1", [property.id]);
            await client.query("ROLLBACK");
          } finally {
            client.release();
          }
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM ops_jobs WHERE job_type='ai.knowledge.repair'",
              )
            )[0].n,
            before,
          );
          assert.equal(
            Number(
              (await query("SELECT price FROM properties WHERE id=$1", [property.id]))[0].price,
            ),
            11000000,
          );
        },
      );
      await t.test(
        "repair uses no model budget, replays safely and restores current text",
        async () => {
          const before = providerCalls;
          assert.equal(typeof knowledge.repairPublicKnowledgeIndex, "function");
          await knowledge.repairPublicKnowledgeIndex();
          const chunks = await knowledge.searchPublicKnowledge({ query: "修復海景" });
          assert.equal(chunks.length, 1);
          assert.match(chunks[0].chunk_text, /\$11,000,000/);
          assert.doesNotMatch(chunks[0].chunk_text, /\$10,000,000/);
          await knowledge.repairPublicKnowledgeIndex();
          assert.equal(providerCalls, before);
          assert.equal(
            (
              await query(
                "SELECT count(*)::int n FROM ai_knowledge_chunks c JOIN ai_knowledge_sources s ON s.id=c.source_id WHERE s.source_type='listing' AND s.source_id=$1",
                [property.id],
              )
            )[0].n,
            1,
          );
        },
      );
      await t.test("mutation during repair does not consume newer pending work", async () => {
        await query("UPDATE properties SET price=12000000 WHERE id=$1", [property.id]);
        let changed = false;
        await knowledge.repairPublicKnowledgeIndex({
          checkpoint: async () => {
            if (!changed) {
              changed = true;
              await query("UPDATE properties SET price=13000000 WHERE id=$1", [property.id]);
            }
          },
        });
        assert.ok(
          (
            await query(
              "SELECT * FROM ai_knowledge_repair_requests WHERE revision>completed_revision",
            )
          ).length > 0,
        );
        await knowledge.repairPublicKnowledgeIndex();
        assert.match(
          (await knowledge.searchPublicKnowledge({ query: "修復海景" }))[0].chunk_text,
          /\$13,000,000/,
        );
      });
      await t.test("a worker interruption preserves pending work for restart", async () => {
        await query("UPDATE properties SET price=14000000 WHERE id=$1", [property.id]);
        await assert.rejects(
          knowledge.repairPublicKnowledgeIndex({
            checkpoint: async () => {
              throw new Error("Synthetic worker interruption");
            },
          }),
          /Synthetic worker interruption/,
        );
        const [request] = await query(
          "SELECT revision>completed_revision AS pending FROM ai_knowledge_repair_requests WHERE source_type='listing' AND source_id=$1",
          [property.id],
        );
        assert.equal(request.pending, true);
        assert.equal(
          (await knowledge.searchPublicKnowledge({ query: "修復海景" })).filter(
            (chunk) => chunk.source_type === "listing" && chunk.listing_id === property.id,
          ).length,
          0,
        );
        await knowledge.repairPublicKnowledgeIndex();
        assert.match(
          (await knowledge.searchPublicKnowledge({ query: "修復海景" }))[0].chunk_text,
          /\$14,000,000/,
        );
      });
      await t.test("older worker cannot overwrite a newer completed repair", async () => {
        await query("UPDATE properties SET price=15000000 WHERE id=$1", [property.id]);
        let checkpoints = 0;
        await knowledge.repairPublicKnowledgeIndex({
          checkpoint: async () => {
            if (++checkpoints === 2) {
              // A already read 15m; B publishes and acknowledges 16m before A resumes.
              await query("UPDATE properties SET price=16000000 WHERE id=$1", [property.id]);
              await knowledge.repairPublicKnowledgeIndex();
            }
          },
        });
        const [ledger] = await query(
          "SELECT revision=completed_revision complete FROM ai_knowledge_repair_requests WHERE source_type='listing' AND source_id=$1",
          [property.id],
        );
        assert.equal(ledger.complete, true);
        const chunks = (await knowledge.searchPublicKnowledge({ query: "修復海景" })).filter(
          (c) => c.listing_id === property.id,
        );
        assert.ok(chunks.length, "Completed ledger must retain the newer readable publication");
        assert.match(chunks[0].chunk_text, /\$16,000,000/);
      });
      await t.test("withdrawal repairs only affected sources and retains history", async () => {
        const [other] = await query(
          "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price) VALUES('QA-OTHER','QA-OTHER','另一有效盤','sale','sham-tseng','active',9000000) RETURNING id",
        );
        await knowledge.repairPublicKnowledgeIndex();
        await query("UPDATE properties SET status='inactive' WHERE id=$1", [property.id]);
        const chunks = await knowledge.searchPublicKnowledge({ query: "另一有效盤" });
        assert.ok(
          chunks.some((chunk) => chunk.listing_id === other.id && chunk.source_type === "listing"),
        );
        await knowledge.repairPublicKnowledgeIndex();
        const [source] = await query(
          "SELECT s.published,count(c.id)::int AS chunks FROM ai_knowledge_sources s LEFT JOIN ai_knowledge_chunks c ON c.source_id=s.id WHERE s.source_type='listing' AND s.source_id=$1 GROUP BY s.id",
          [property.id],
        );
        assert.equal(source.published, false);
        assert.ok(source.chunks > 0, "Historical chunks remain retained but unavailable");
        assert.equal(
          (await knowledge.searchPublicKnowledge({ query: "修復海景" })).filter(
            (chunk) => chunk.source_type === "listing" && chunk.listing_id === property.id,
          ).length,
          0,
        );
      });
      await t.test("older absence snapshot cannot hide a newer reactivated listing", async () => {
        let checkpoints = 0;
        await knowledge.rebuildAiKnowledgeIndex({
          checkpoint: async () => {
            if (++checkpoints === 2) {
              await query("UPDATE properties SET status='active' WHERE id=$1", [property.id]);
              await knowledge.repairPublicKnowledgeIndex();
            }
          },
        });
        assert.ok(
          (await knowledge.searchPublicKnowledge({ query: "修復海景" })).some(
            (c) => c.listing_id === property.id,
          ),
        );
      });
    });
  },
);
