import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import {
  previewWhatsappLinkBatch,
  commitWhatsappLinkChunk,
  getWhatsappLinkBatchResult,
} from "../neon/whatsapp-link-batches.server.ts";

function splitSqlStatements(query) {
  const statements = [];
  let current = "";
  let single = false;
  let double = false;
  let dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    const next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "real Neon batch 50+10 recovery and independent-connection placement race",
  { skip: !url },
  async (t) => {
    await assertDisposableNeonTestTarget(url);
    const schema = "wa_batch_" + randomUUID().replaceAll("-", "");
    const primary = neon(url);
    const secondary = neon(url);
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
      for (const statement of [
        "CREATE TYPE staff_role AS ENUM ('admin','manager','agent','viewer')",
        "CREATE TYPE deal_type AS ENUM ('sale','rent')",
        "CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,name_zh text,name_en text)",
        "CREATE TABLE staff_roles(staff_user_id uuid,role staff_role)",
        "CREATE TABLE properties(id uuid PRIMARY KEY,title_zh text,deal_type deal_type,status text,source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz)",
        "CREATE TABLE property_public_members(property_id uuid,public_listing_no text)",
        "CREATE TABLE whatsapp_staff_channels(staff_id uuid,channel_id text,eligible boolean,retired_at timestamptz,verified_at timestamptz,verification_ref text)",
        "CREATE TABLE staff_external_references(id uuid PRIMARY KEY,staff_id uuid,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz)",
        "CREATE TABLE whatsapp_tracking_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,current_version integer NOT NULL DEFAULT 1,created_by uuid,created_at timestamptz DEFAULT now())",
        "CREATE TABLE whatsapp_tracking_link_versions(link_id uuid,version integer,channel_id text,placement_source text,entry_point_type text,public_listing_no text,property_id uuid,deal_type text,requested_staff_id uuid,branch_id text,external_listing_id text,video_id text,enabled boolean,created_by uuid,placement_verified_at timestamptz,reference_mapping_id uuid,PRIMARY KEY(link_id,version))",
      ])
        await query(statement);
      const migration = splitSqlStatements(
        readFileSync("neon/migrations/20260927090000_whatsapp_link_batch_operations.sql", "utf8"),
      );
      await primary.transaction((tx) => [
        tx.query("SELECT set_config('search_path',$1,true)", [schema]),
        ...migration.map((statement) => tx.query(statement)),
      ]);
      await query(
        "INSERT INTO staff_users VALUES($1,true,'Admin',null),($2,true,'Manager',null),($3,true,'Agent',null)",
        [adminId, managerId, agentId],
      );
      await query("INSERT INTO staff_roles VALUES($1,'admin'),($2,'manager'),($3,'agent')", [
        adminId,
        managerId,
        agentId,
      ]);
      await query(
        "INSERT INTO whatsapp_staff_channels VALUES($1,'synthetic-company',true,null,now(),'synthetic')",
        [agentId],
      );
      await query(
        "INSERT INTO properties VALUES($1,'Synthetic','sale','active',now(),now(),now(),now())",
        [propertyId],
      );
      await query("INSERT INTO property_public_members VALUES($1,'SYNTHETIC-1')", [propertyId]);

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
      t.diagnostic("real Neon 50-row chunk " + Math.round(performance.now() - firstStart) + " ms");
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
      if (schemaCreated) await primary.query("DROP SCHEMA " + schema + " CASCADE");
    }
  },
);
