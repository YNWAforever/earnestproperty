import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  previewWhatsappLinkBatch,
  commitWhatsappLinkChunk,
  getWhatsappLinkBatchResult,
} from "../neon/whatsapp-link-batches.server.ts";

const adminId = "00000000-0000-4000-8000-000000000001";
const managerId = "00000000-0000-4000-8000-000000000002";
const agentId = "00000000-0000-4000-8000-000000000003";
const propertyId = "00000000-0000-4000-8000-000000000004";
const admin = { staffId: adminId, roles: ["admin"] };
const manager = { staffId: managerId, roles: ["manager"] };
const makeRow = (i, patch = {}) => ({
  rowKey: randomUUID(),
  placementId: `website:test-${i}`,
  input: {
    placementSource: "website",
    entryPointType: "sales",
    publicListingNo: "A074714",
    propertyId,
    dealType: "sale",
    requestedStaffId: agentId,
    placementVerified: true,
    enabled: true,
    ...patch,
  },
});

test("batch migration commits 50+10, returns lost responses, and rejects changed facts atomically", async () => {
  const db = new PGlite();
  const previous = process.env.EP_WA_COMPANY_CHANNEL_ID;
  process.env.EP_WA_COMPANY_CHANNEL_ID = "company";
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`
      CREATE TYPE staff_role AS ENUM ('admin','manager','agent','viewer');
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,name_zh text,name_en text);
      CREATE TABLE staff_roles(staff_user_id uuid,role staff_role);
      CREATE TABLE properties(id uuid PRIMARY KEY,title_zh text,deal_type text,status text,source_updated_at timestamptz,last_seen_at timestamptz,updated_at timestamptz,created_at timestamptz);
      CREATE TABLE property_public_members(property_id uuid,public_listing_no text);
      CREATE TABLE whatsapp_staff_channels(staff_id uuid,channel_id text,eligible boolean,retired_at timestamptz,verified_at timestamptz,verification_ref text,version integer NOT NULL DEFAULT 1);
      CREATE TABLE staff_external_references(id uuid PRIMARY KEY,namespace text,staff_id uuid,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);
      CREATE TABLE whatsapp_tracking_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,current_version integer NOT NULL DEFAULT 1,created_by uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE whatsapp_tracking_link_versions(link_id uuid,version integer,channel_id text,placement_source text,entry_point_type text,public_listing_no text,property_id uuid,deal_type text,requested_staff_id uuid,branch_id text,external_listing_id text,video_id text,enabled boolean,created_by uuid,placement_verified_at timestamptz,reference_mapping_id uuid,PRIMARY KEY(link_id,version));
    `);
    await db.exec(
      readFileSync("neon/migrations/20260927090000_whatsapp_link_batch_operations.sql", "utf8"),
    );
    await db.exec(
      readFileSync("neon/migrations/20260927150000_whatsapp_link_batch_mapping_guard.sql", "utf8"),
    );
    await query(
      "INSERT INTO staff_users VALUES($1,true,'管理員',null),($2,true,'經理',null),($3,true,'代理',null)",
      [adminId, managerId, agentId],
    );
    await query("INSERT INTO staff_roles VALUES($1,'admin'),($2,'manager'),($3,'agent')", [
      adminId,
      managerId,
      agentId,
    ]);
    await query(
      "INSERT INTO whatsapp_staff_channels VALUES($1,'company',true,null,now(),'synthetic')",
      [agentId],
    );
    await query(
      "INSERT INTO properties VALUES($1,'合成測試樓盤','sale','active',now(),now(),now(),now())",
      [propertyId],
    );
    await query("INSERT INTO property_public_members VALUES($1,'A074714')", [propertyId]);
    const rows = Array.from({ length: 60 }, (_, i) => makeRow(i));
    const batchId = randomUUID();
    const preview = await previewWhatsappLinkBatch({ batchId, rows }, admin, query);
    assert.deepEqual(preview.counts, { create: 60, reuse: 0, blocked: 0 });
    assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 0);
    const chunkId = randomUUID();
    const first = await commitWhatsappLinkChunk(
      { batchId, chunkId, previewToken: preview.previewToken, rows: rows.slice(0, 50) },
      admin,
      query,
    );
    assert.equal(first.state, "committed");
    assert.equal(first.rows.length, 50);
    assert.ok(first.rows.every((r) => r.outcome === "created" && r.code));
    const retry = await commitWhatsappLinkChunk(
      { batchId, chunkId, previewToken: preview.previewToken, rows: rows.slice(0, 50) },
      admin,
      query,
    );
    assert.deepEqual(retry, first);
    assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 50);
    await assert.rejects(
      commitWhatsappLinkChunk(
        { batchId, chunkId, previewToken: preview.previewToken, rows: rows.slice(1, 50) },
        admin,
        query,
      ),
      (error) => error instanceof Response && error.status === 409,
    );
    const second = await commitWhatsappLinkChunk(
      { batchId, chunkId: randomUUID(), previewToken: preview.previewToken, rows: rows.slice(50) },
      admin,
      query,
    );
    assert.equal(second.state, "committed");
    assert.equal(second.rows.length, 10);
    assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 60);
    const history = await getWhatsappLinkBatchResult(batchId, admin, query);
    assert.equal(history.operations.length, 2);
    await assert.rejects(
      getWhatsappLinkBatchResult(batchId, { staffId: agentId, roles: ["agent"] }, query),
      (error) => error instanceof Response && error.status === 403,
    );
    const stale = makeRow("withdrawn");
    const stalePreview = await previewWhatsappLinkBatch(
      { batchId: randomUUID(), rows: [stale] },
      admin,
      query,
    );
    await query("UPDATE properties SET status='withdrawn' WHERE id=$1", [propertyId]);
    const rejected = await commitWhatsappLinkChunk(
      {
        batchId: stalePreview.batchId,
        chunkId: randomUUID(),
        previewToken: stalePreview.previewToken,
        rows: [stale],
      },
      admin,
      query,
    );
    assert.equal(rejected.state, "rejected");
    assert.equal(rejected.rows[0].reasonCode, "WA_LINK_PUBLIC_OFFER_UNAVAILABLE");
    assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 60);
    await query("UPDATE properties SET status='active' WHERE id=$1", [propertyId]);
    const revoked = makeRow("revoked");
    const revokedPreview = await previewWhatsappLinkBatch(
      { batchId: randomUUID(), rows: [revoked] },
      admin,
      query,
    );
    await query("UPDATE whatsapp_staff_channels SET eligible=false WHERE staff_id=$1", [agentId]);
    const blocked = await commitWhatsappLinkChunk(
      {
        batchId: revokedPreview.batchId,
        chunkId: randomUUID(),
        previewToken: revokedPreview.previewToken,
        rows: [revoked],
      },
      admin,
      query,
    );
    assert.equal(blocked.state, "rejected");
    assert.equal(blocked.rows[0].reasonCode, "WA_LINK_STAFF_NOT_READY");
    assert.equal((await query("SELECT count(*)::int n FROM whatsapp_tracking_links"))[0].n, 60);
    await query("UPDATE whatsapp_staff_channels SET eligible=true WHERE staff_id=$1", [agentId]);
    const changedMapping = makeRow("mapping-changed");
    const changedPreview = await previewWhatsappLinkBatch(
      { batchId: randomUUID(), rows: [changedMapping] },
      admin,
      query,
    );
    await query("UPDATE whatsapp_staff_channels SET version=version+1 WHERE staff_id=$1", [
      agentId,
    ]);
    await assert.rejects(
      commitWhatsappLinkChunk(
        {
          batchId: changedPreview.batchId,
          chunkId: randomUUID(),
          previewToken: changedPreview.previewToken,
          rows: [changedMapping],
        },
        admin,
        query,
      ),
      (error) => error instanceof Response && error.status === 409,
    );
    const changedAgain = await previewWhatsappLinkBatch(
      { batchId: randomUUID(), rows: [changedMapping] },
      admin,
      query,
    );
    await assert.rejects(
      commitWhatsappLinkChunk(
        {
          batchId: changedAgain.batchId,
          chunkId: randomUUID(),
          previewToken: changedPreview.previewToken,
          rows: [changedMapping],
        },
        admin,
        query,
      ),
      (error) => error instanceof Response && error.status === 409,
    );
    const rival = makeRow("rival");
    const rivalA = await previewWhatsappLinkBatch(
      { batchId: randomUUID(), rows: [rival] },
      admin,
      query,
    );
    const rivalBRow = { ...rival, rowKey: randomUUID() };
    const rivalB = await previewWhatsappLinkBatch(
      { batchId: randomUUID(), rows: [rivalBRow] },
      manager,
      query,
    );
    const winner = await commitWhatsappLinkChunk(
      {
        batchId: rivalA.batchId,
        chunkId: randomUUID(),
        previewToken: rivalA.previewToken,
        rows: [rival],
      },
      admin,
      query,
    );
    const loser = await commitWhatsappLinkChunk(
      {
        batchId: rivalB.batchId,
        chunkId: randomUUID(),
        previewToken: rivalB.previewToken,
        rows: [rivalBRow],
      },
      manager,
      query,
    );
    assert.equal(winner.state, "committed");
    assert.equal(loser.state, "committed");
    assert.equal(loser.rows[0].outcome, "reused");
    assert.equal(winner.rows[0].linkId, loser.rows[0].linkId);
  } finally {
    if (previous === undefined) delete process.env.EP_WA_COMPANY_CHANNEL_ID;
    else process.env.EP_WA_COMPANY_CHANNEL_ID = previous;
    await db.close();
  }
});
