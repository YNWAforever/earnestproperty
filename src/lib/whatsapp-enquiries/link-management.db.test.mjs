import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listWhatsappTrackingLinksPage } from "../neon/whatsapp-link-management.server.ts";
import { saveTrackingLink } from "../neon/whatsapp-enquiries.server.ts";
import {
  prepareWhatsappLinkExport,
  readWhatsappLinkExportPage,
} from "../admin/whatsapp-link-export.server.ts";

const actorId = "00000000-0000-4000-8000-000000000001";
const staffId = "00000000-0000-4000-8000-000000000002";
const actor = { staffId: actorId, roles: ["admin"] };

test("650 current links page without duplicates; disable expired reference preserves identity and version", async () => {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const transaction = async (statements) => {
    await db.exec("BEGIN");
    try {
      const result = [];
      for (const item of statements) result.push(await query(item.statement, item.params ?? []));
      await db.exec("COMMIT");
      return result;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  };
  try {
    await db.exec(`
      CREATE TYPE staff_role AS ENUM ('admin','manager','agent','viewer');
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,name_zh text,name_en text);
      CREATE TABLE staff_roles(staff_user_id uuid,role staff_role);
      CREATE TABLE staff_external_references(id uuid PRIMARY KEY,staff_id uuid,valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);
      CREATE TABLE whatsapp_tracking_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,current_version integer DEFAULT 1,created_by uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE whatsapp_tracking_link_versions(link_id uuid,version integer,channel_id text,placement_source text,entry_point_type text,public_listing_no text,property_id uuid,deal_type text,requested_staff_id uuid,branch_id text,external_listing_id text,video_id text,enabled boolean,created_by uuid,placement_verified_at timestamptz,reference_mapping_id uuid,created_at timestamptz DEFAULT now(),PRIMARY KEY(link_id,version));
      CREATE TABLE whatsapp_tracking_link_placements(placement_key text PRIMARY KEY,placement_id text,link_id uuid);
      CREATE TABLE whatsapp_link_opens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),link_id uuid);
      CREATE TABLE inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),link_open_id uuid,source text);
    `);
    await db.exec(
      readFileSync("neon/migrations/20260927093000_whatsapp_link_management_indexes.sql", "utf8"),
    );
    await query("INSERT INTO staff_users VALUES($1,true,'管理員',null),($2,true,'同事',null)", [
      actorId,
      staffId,
    ]);
    await query("INSERT INTO staff_roles VALUES($1,'admin'),($2,'agent')", [actorId, staffId]);
    await query(
      `INSERT INTO whatsapp_tracking_links(code,created_by)
      SELECT 'code-'||lpad(g::text,27,'0'),$1::uuid FROM generate_series(1,650) g`,
      [actorId],
    );
    await query(
      `INSERT INTO whatsapp_tracking_link_versions(link_id,version,channel_id,placement_source,entry_point_type,public_listing_no,requested_staff_id,enabled,created_by,placement_verified_at)
      SELECT l.id,1,'company',CASE WHEN right(l.code,1)::int%2=0 THEN 'website' ELSE 'youtube' END,'sales','A074714',$1::uuid,true,$2::uuid,now()
      FROM whatsapp_tracking_links l`,
      [staffId, actorId],
    );
    const [target] = await query(
      "SELECT id FROM whatsapp_tracking_links ORDER BY created_at DESC,id DESC LIMIT 1",
    );
    const [opened] = await query(
      "INSERT INTO whatsapp_link_opens(link_id) VALUES($1) RETURNING id",
      [target.id],
    );
    await query("INSERT INTO whatsapp_link_opens(link_id) VALUES($1)", [target.id]);
    await query("INSERT INTO inquiries(link_open_id,source) VALUES($1,'whatsapp')", [opened.id]);
    let cursor,
      all = [];
    do {
      const result = await listWhatsappTrackingLinksPage({ pageSize: 50, cursor }, actor, query);
      assert.equal(result.total, 650);
      all.push(...result.items);
      cursor = result.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(all.length, 650);
    assert.equal(new Set(all.map((row) => row.id)).size, 650);
    const counted = all.find((row) => row.id === target.id);
    assert.equal(counted.opens, 2);
    assert.equal(counted.enquiries, 1);
    assert.equal(counted.readiness, "unknown");
    const filtered = await listWhatsappTrackingLinksPage(
      { pageSize: 25, source: "website", staffId, enabled: true },
      actor,
      query,
    );
    assert.equal(filtered.total, 325);
    assert.equal(filtered.items.length, 25);
    assert.ok(filtered.items.every((row) => row.placementSource === "website"));
    assert.equal((await listWhatsappTrackingLinksPage({ q: "%" }, actor, query)).total, 0);
    await assert.rejects(
      listWhatsappTrackingLinksPage({ cursor: "garbage" }, actor, query),
      (error) => error instanceof Response && error.status === 400,
    );
    await assert.rejects(
      listWhatsappTrackingLinksPage({}, { staffId, roles: ["agent"] }, query),
      (error) => error instanceof Response && error.status === 403,
    );
    const allExport = await prepareWhatsappLinkExport(
      { scope: "all", filter: { enabled: true } },
      actor,
      query,
    );
    assert.equal(allExport.total, 650);
    const exportA = await readWhatsappLinkExportPage(
      { snapshotId: allExport.snapshotId, offset: 0 },
      actor,
      query,
    );
    assert.equal(exportA.nextOffset, 500);
    assert.equal(exportA.csv.charCodeAt(0), 0xfeff);
    const exportB = await readWhatsappLinkExportPage(
      { snapshotId: allExport.snapshotId, offset: 500 },
      actor,
      query,
    );
    assert.equal(exportB.nextOffset, null);
    assert.equal((exportA.csv + exportB.csv).split("\r\n").length, 652);
    const selectedExport = await prepareWhatsappLinkExport(
      { scope: "selected", selectedIds: [target.id], filter: {} },
      actor,
      query,
    );
    assert.equal(selectedExport.total, 1);
    await assert.rejects(
      prepareWhatsappLinkExport(
        { scope: "selected", selectedIds: [randomUUID()], filter: {} },
        actor,
        query,
      ),
      (error) => error instanceof Response && error.status === 409,
    );
    await assert.rejects(
      prepareWhatsappLinkExport({ scope: "all", filter: {} }, { staffId, roles: ["agent"] }, query),
      (error) => error instanceof Response && error.status === 403,
    );
    const refId = randomUUID();
    await query(
      "INSERT INTO staff_external_references VALUES($1,$2,now()-interval '2 days',now()-interval '1 day',now()-interval '2 days')",
      [refId, staffId],
    );
    await query(
      "UPDATE whatsapp_tracking_link_versions SET reference_mapping_id=$1 WHERE link_id=$2",
      [refId, target.id],
    );
    const link = all.find((row) => row.id === target.id);
    const disabled = await saveTrackingLink(
      { ...link, referenceMappingId: refId, enabled: false, id: target.id, expectedVersion: 1 },
      actor,
      { query, transaction },
    );
    assert.equal(disabled.version, 2);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.code, link.code);
    assert.equal(disabled.referenceMappingId, refId);
    const snapRow = await readWhatsappLinkExportPage(
      { snapshotId: selectedExport.snapshotId, offset: 0 },
      actor,
      query,
    );
    assert.match(snapRow.csv, /"1","可用"/);

    await assert.rejects(
      saveTrackingLink({ ...disabled, enabled: true, id: target.id, expectedVersion: 2 }, actor, {
        query,
        transaction,
      }),
      /STAFF_REFERENCE_CONFLICT_OR_EXPIRED/,
    );
    await assert.rejects(
      saveTrackingLink({ ...link, enabled: false, id: target.id, expectedVersion: 1 }, actor, {
        query,
        transaction,
      }),
      /WA_LINK_VERSION_CONFLICT/,
    );
  } finally {
    await db.close();
  }
});
