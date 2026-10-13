import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { onDbTarget } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { applyMigrations, isolatedDatabase } from "../../../scripts/acceptance/migrated-schema.mjs";
import {
  previewWhatsappLinkBatch,
  commitWhatsappLinkChunk,
  getWhatsappLinkBatchResult,
} from "../neon/whatsapp-link-batches.server.ts";

// The on-demand Neon run keeps its ASTRA_TEST_DATABASE_URL contract.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };
// Owned Docker Postgres by default (a fresh database in the container, two clients on separate
// pooled connections); ASTRA_TEST_DATABASE_URL (behind the disposable guard) for an explicit Neon
// run with two HTTP clients. In CI a missing database fails instead of skipping. The isolated
// schema is built from every real migration, in order.
test(
  "real database batch 50+10 recovery and independent-connection placement race",
  onDbTarget(async (target, t) => {
    const { sql: primary, pool, end } = await isolatedDatabase(target);
    const schema = "wa_batch_" + randomUUID().replaceAll("-", "");
    const secondary = target.owned
      ? (await import("../../../scripts/acceptance/owned-postgres-test.mjs")).ownedNeonSql(pool)
      : (await import("@neondatabase/serverless")).neon(target.url);
    const queryFor =
      (db) =>
      async (statement, params = []) => {
        const results = await db.transaction((tx) => [
          tx.query("SELECT set_config('search_path',$1,true)", [schema]),
          tx.query(statement, params),
        ]);
        return results[1];
      };
    const query = queryFor(primary);
    const secondQuery = queryFor(secondary);
    const adminId = randomUUID();
    const managerId = randomUUID();
    const agentId = randomUUID();
    const propertyId = randomUUID();
    const admin = { staffId: adminId, roles: ["admin"] };
    const manager = { staffId: managerId, roles: ["manager"] };
    const makeRow = (value) => ({
      rowKey: randomUUID(),
      placementId: "website:test-" + value,
      input: {
        placementSource: "website",
        entryPointType: "sales",
        publicListingNo: "SYNTHETIC-1",
        propertyId,
        dealType: "sale",
        requestedStaffId: agentId,
        placementVerified: true,
        enabled: true,
      },
    });
    const previousChannel = process.env.EP_WA_COMPANY_CHANNEL_ID;
    process.env.EP_WA_COMPANY_CHANNEL_ID = "synthetic-company";
    let schemaCreated = false;
    try {
      await primary.query("CREATE SCHEMA " + schema);
      schemaCreated = true;
      await applyMigrations(primary, schema, MIGRATION_VERSIONS);
      await query(
        "INSERT INTO staff_users(id,active,name_zh,name_en) VALUES($1,true,'Admin',null),($2,true,'Manager',null),($3,true,'Agent',null)",
        [adminId, managerId, agentId],
      );
      await query(
        "INSERT INTO staff_roles(staff_user_id,role) VALUES($1,'admin'),($2,'manager'),($3,'agent')",
        [adminId, managerId, agentId],
      );
      await query(
        "INSERT INTO whatsapp_staff_channels(staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,eligible,retired_at,verified_at,verification_ref) VALUES($1,'synthetic-company','synthetic-inbox-user','synthetic-folder','synthetic-node',true,null,now(),'synthetic')",
        [agentId],
      );
      // The real public-identity trigger makes listing SYNTHETIC-1 its own public group.
      await query(
        "INSERT INTO properties(id,listing_no,title_zh,deal_type,district_slug,status,source_updated_at,last_seen_at,updated_at,created_at) VALUES($1,'SYNTHETIC-1','Synthetic','sale','synthetic','active',now(),now(),now(),now())",
        [propertyId],
      );
      assert.deepEqual(
        await query("SELECT public_listing_no FROM property_public_members WHERE property_id=$1", [
          propertyId,
        ]),
        [{ public_listing_no: "SYNTHETIC-1" }],
      );

      const rows = Array.from({ length: 60 }, (_, index) => makeRow(index));
      const batchId = randomUUID();
      const preview = await previewWhatsappLinkBatch({ batchId, rows }, admin, query);
      assert.deepEqual(preview.counts, { create: 60, reuse: 0, blocked: 0 });
      const firstChunkId = randomUUID();
      const firstStart = performance.now();
      const first = await commitWhatsappLinkChunk(
        {
          batchId,
          chunkId: firstChunkId,
          previewToken: preview.previewToken,
          rows: rows.slice(0, 50),
        },
        admin,
        query,
      );
      t.diagnostic(
        (target.owned ? "owned Postgres" : "real Neon") +
          " 50-row chunk " +
          Math.round(performance.now() - firstStart) +
          " ms",
      );
      assert.equal(first.state, "committed");
      assert.equal(first.rows.length, 50);
      const replay = await commitWhatsappLinkChunk(
        {
          batchId,
          chunkId: firstChunkId,
          previewToken: preview.previewToken,
          rows: rows.slice(0, 50),
        },
        admin,
        secondQuery,
      );
      assert.deepEqual(replay, first);
      const second = await commitWhatsappLinkChunk(
        {
          batchId,
          chunkId: randomUUID(),
          previewToken: preview.previewToken,
          rows: rows.slice(50),
        },
        admin,
        secondQuery,
      );
      assert.equal(second.state, "committed");
      assert.equal(second.rows.length, 10);
      assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 60);
      assert.equal((await getWhatsappLinkBatchResult(batchId, admin, query)).operations.length, 2);

      const rival = makeRow("race");
      const rivalCopy = { ...rival, rowKey: randomUUID() };
      const rivalA = await previewWhatsappLinkBatch(
        { batchId: randomUUID(), rows: [rival] },
        admin,
        query,
      );
      const rivalB = await previewWhatsappLinkBatch(
        { batchId: randomUUID(), rows: [rivalCopy] },
        manager,
        secondQuery,
      );
      const [a, b] = await Promise.all([
        commitWhatsappLinkChunk(
          {
            batchId: rivalA.batchId,
            chunkId: randomUUID(),
            previewToken: rivalA.previewToken,
            rows: [rival],
          },
          admin,
          query,
        ),
        commitWhatsappLinkChunk(
          {
            batchId: rivalB.batchId,
            chunkId: randomUUID(),
            previewToken: rivalB.previewToken,
            rows: [rivalCopy],
          },
          manager,
          secondQuery,
        ),
      ]);
      assert.equal(a.state, "committed");
      assert.equal(b.state, "committed");
      assert.deepEqual([a.rows[0].outcome, b.rows[0].outcome].sort(), ["created", "reused"]);
      assert.equal(a.rows[0].linkId, b.rows[0].linkId);
      assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 61);
    } finally {
      if (previousChannel === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
      else process.env.EP_WA_COMPANY_CHANNEL_ID = previousChannel;
      try {
        if (schemaCreated) await primary.query("DROP SCHEMA " + schema + " CASCADE");
      } finally {
        await end();
      }
    }
  }, neonRun),
);
