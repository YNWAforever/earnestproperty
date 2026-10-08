import assert from "node:assert/strict";
import test, { mock } from "node:test";
import {
  withOwnedPostgres,
  mockOwnedServerDb,
  repoRoot,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";

test(
  "public knowledge gates actual normal/fallback SQL and discards in-flight stale answers",
  { timeout: 120000 },
  async (t) => {
    await withOwnedPostgres(async ({ query, transaction }) => {
      await mockOwnedServerDb(mock, query, transaction);
      mock.module(new URL("src/lib/ai/provider.server.ts", repoRoot).href, {
        exports: {
          embedAiTexts: async () => ({ ok: false }),
        },
      });
      const knowledge = await import("./knowledge.server.ts");
      const [property] = await query(
        "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price,description) VALUES('QA-SALE','QA-GROUP','測試海景樓盤','sale','sham-tseng','active',10000000,'海景測試') RETURNING id",
      );
      const [source] = await query(
        "INSERT INTO ai_knowledge_sources(source_type,source_id,title,url_path,content_hash) VALUES('listing',$1,'測試海景樓盤','/property/QA-GROUP','old') RETURNING id",
        [property.id],
      );
      const [chunk] = await query(
        "INSERT INTO ai_knowledge_chunks(source_id,listing_id,chunk_text,content_hash,metadata) VALUES($1,$2,'測試海景樓盤售價10000000','old','{}') RETURNING id",
        [source.id, property.id],
      );
      async function indexCurrent() {
        try {
          const { publicKnowledgeCurrentSourcesCte } =
            await import("./knowledge-freshness.server.ts");
          const [current] = await query(
            publicKnowledgeCurrentSourcesCte() +
              " SELECT source_revision FROM current_public_sources WHERE source_type='listing' AND source_id=$1",
            [property.id],
          );
          await query(
            "UPDATE ai_knowledge_chunks SET metadata=jsonb_build_object('source_revision',$1::text),stale=false WHERE id=$2",
            [current.source_revision, chunk.id],
          );
        } catch (error) {
          if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
        }
      }
      await t.test("unversioned listing is excluded", async () => {
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試海景" })).length, 0);
      });
      await indexCurrent();
      await t.test("unchanged source retains its revision", async () => {
        const [current] = await knowledge.searchPublicKnowledge({ query: "測試海景" });
        assert.match(current.source_revision ?? "", /^[a-f0-9]{32}$/);
      });
      await indexCurrent();
      await t.test("manual protected description changes full revision", async () => {
        await query("UPDATE properties SET description='人手核實新資料' WHERE id=$1", [
          property.id,
        ]);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試海景" })).length, 0);
      });
      await indexCurrent();
      await t.test("current valid canonical listing remains retrievable", async () => {
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試海景" })).length, 1);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "海景 詢問" })).length, 1);
      });
      await t.test("price change excludes normal and token fallback before LIMIT", async () => {
        await query("UPDATE properties SET price=11000000 WHERE id=$1", [property.id]);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試海景" })).length, 0);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "海景 詢問" })).length, 0);
      });
      await indexCurrent();
      await t.test(
        "sibling rent offer changes revision even without touching sale updated_at",
        async () => {
          await query(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,rent) VALUES('QA-RENT','QA-GROUP','測試租盤','rent','sham-tseng','active',20000)",
          );
          assert.equal((await knowledge.searchPublicKnowledge({ query: "測試海景" })).length, 0);
        },
      );
      await indexCurrent();
      await t.test("withdrawal excludes indexed source despite stale=false", async () => {
        await query("UPDATE properties SET status='inactive' WHERE id=$1", [property.id]);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試海景" })).length, 0);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "海景 詢問" })).length, 0);
      });
      await t.test("FAQ remains available but deleted canonical FAQ cannot be cited", async () => {
        const [faq] = await query(
          "INSERT INTO faqs(scope,question,answer) VALUES('QA','測試按揭問題','測試按揭資料') RETURNING id",
        );
        const [faqSource] = await query(
          "INSERT INTO ai_knowledge_sources(source_type,source_id,title,content_hash) VALUES('faq',$1,'測試按揭問題','qa') RETURNING id",
          [faq.id],
        );
        await query(
          "INSERT INTO ai_knowledge_chunks(source_id,chunk_text,content_hash,metadata) SELECT $1,'測試按揭資料','qa',jsonb_build_object('source_revision',md5(to_jsonb(f)::text)) FROM faqs f WHERE f.id=$2",
          [faqSource.id, faq.id],
        );
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試按揭" })).length, 1);
        await query("DELETE FROM faqs WHERE id=$1", [faq.id]);
        assert.equal((await knowledge.searchPublicKnowledge({ query: "測試按揭" })).length, 0);
      });
      await t.test("unpublished FAQ never in context", async () => {
        const [faq] = await query(
          "INSERT INTO faqs(scope,question,answer,published) VALUES('QA','FX11A 隱藏問題','FX11A_TOKEN',false) RETURNING id",
        );
        await knowledge.rebuildAiKnowledgeIndex({ allowEmbeddings: false });
        assert.equal((await knowledge.searchPublicKnowledge({ query: "FX11A" })).length, 0);
        const rows = await query(
          "SELECT published, public_visibility FROM ai_knowledge_sources WHERE source_type='faq' AND source_id=$1",
          [faq.id],
        );
        for (const row of rows) {
          assert.equal(row.published, false);
          assert.equal(row.public_visibility, "staff");
        }
      });
      await t.test(
        "unpublishing an indexed estate removes it from search before any rebuild",
        async () => {
          try {
            await knowledge.rebuildAiKnowledgeIndex({ allowEmbeddings: false });
            const before = await knowledge.searchPublicKnowledge({ query: "碧堤半島" });
            assert.ok(before.filter((r) => r.source_type === "estate").length >= 1);
            await query("UPDATE estates SET published=false WHERE slug='bellagio'");
            const after = await knowledge.searchPublicKnowledge({ query: "碧堤半島" });
            assert.equal(after.filter((r) => r.source_type === "estate").length, 0);
          } finally {
            await query("UPDATE estates SET published=true WHERE slug='bellagio'");
          }
        },
      );
      await t.test("listing chunk text carries HK$ and 呎 units", async () => {
        await query(
          "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,price,saleable_area,description) VALUES('FX11A-SALE','FX11A-GROUP','FX11A單位測試','sale','sham-tseng','active',6800000,512,'FX11A單位描述')",
        );
        await knowledge.rebuildAiKnowledgeIndex({ allowEmbeddings: false });
        const chunks = await query(
          "SELECT chunk_text FROM ai_knowledge_chunks WHERE chunk_text LIKE '%FX11A單位測試%'",
        );
        assert.ok(chunks.length >= 1);
        const text = chunks.map((c) => c.chunk_text).join(" ");
        assert.ok(text.includes("出售：$6,800,000（680萬）"), text);
        assert.ok(text.includes("實用面積：512 呎"), text);
        assert.ok(!text.includes("出售：6800000"), text);
      });
    });
  },
);
