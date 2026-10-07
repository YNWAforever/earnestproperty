import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  listWhatsappStaffReadiness,
  inspectWhatsappStaffReadinessForDispatch,
} from "../neon/whatsapp-readiness.server.ts";

const admin = "00000000-0000-4000-8000-000000000001";
const mapped = "00000000-0000-4000-8000-000000000002";
const unmapped = "00000000-0000-4000-8000-000000000003";
const runtime = {
  channelId: "company",
  assignmentEnabled: true,
  notificationsEnabled: true,
  inboxProviderVerified: true,
  staffTransportVerified: true,
  templateContractVerified: true,
};
test("readiness reads every staff member with real enum roles and masks destination", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE staff_role AS ENUM ('admin','manager','agent','viewer');
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean,name_zh text,name_en text);
      CREATE TABLE staff_roles(staff_user_id uuid,role staff_role);
      CREATE TABLE whatsapp_staff_channels(
        id uuid PRIMARY KEY,staff_id uuid,channel_id text,inbox_user_id text,folder_id text,
        eligible boolean,verification_ref text,verified_at timestamptz,retired_at timestamptz
      );
      CREATE TABLE staff_notification_endpoints(
        id uuid PRIMARY KEY,staff_id uuid,channel_id text,transport text,
        destination_reference text,version int,enabled boolean,verified_at timestamptz,
        retired_at timestamptz,permission_granted boolean,permission_ref text,
        quiet_hours_policy jsonb,last_inbound_at timestamptz,template_name text,
        template_language text,template_verified_at timestamptz,updated_at timestamptz
      );
    `);
    await db.query(
      "INSERT INTO staff_users VALUES ($1,true,'管理員',null),($2,true,'有映射',null),($3,true,'未映射',null)",
      [admin, mapped, unmapped],
    );
    await db.query("INSERT INTO staff_roles VALUES ($1,'admin'),($2,'agent'),($3,'agent')", [
      admin,
      mapped,
      unmapped,
    ]);
    await db.query(
      "INSERT INTO whatsapp_staff_channels VALUES ('20000000-0000-4000-8000-000000000001',$1,'company','inbox-2','folder',true,'verified',now(),null)",
      [mapped],
    );
    await db.query(
      `INSERT INTO staff_notification_endpoints VALUES
      ('30000000-0000-4000-8000-000000000001',$1,'company','inbox_private_note','inbox-2',1,true,now(),null,true,'granted','{"approved":true,"allowAllHours":true}',null,null,null,null,now()),
      ('30000000-0000-4000-8000-000000000002',$1,'company','staff_whatsapp','85291234567',3,true,now(),null,true,'granted','{"approved":true,"allowAllHours":true}',now(),null,null,null,now())`,
      [mapped],
    );
    await db.exec(
      readFileSync("neon/migrations/20260927110000_staff_mapping_review_versions.sql", "utf8"),
    );
    const query = async (sql, params = []) => (await db.query(sql, params)).rows;
    const rows = await listWhatsappStaffReadiness(
      { staffId: admin, roles: ["admin"] },
      { query, runtime, checkedAt: new Date().toISOString() },
    );
    assert.equal(rows.length, 3);
    const selected = rows.find((row) => row.staffId === mapped);
    assert.equal(selected.assignment.state, "ready");
    assert.equal(selected.mappingVersion, 1);
    assert.equal(selected.inboxPrivateNote.state, "ready");
    assert.equal(selected.staffWhatsapp.state, "ready");
    assert.equal(selected.maskedDestination, "••••4567");
    assert.doesNotMatch(JSON.stringify(rows), /85291234567|inbox-2|folder/);
    assert.equal(
      rows.find((row) => row.staffId === unmapped).assignment.reasons[0].code,
      "mapping_missing",
    );
    await db.query(
      "UPDATE staff_notification_endpoints SET permission_granted=false WHERE staff_id=$1 AND transport='staff_whatsapp'",
      [mapped],
    );
    const revoked = await inspectWhatsappStaffReadinessForDispatch(mapped, { query, runtime });
    assert.equal(revoked.staffWhatsapp.state, "blocked");
    assert.ok(revoked.staffWhatsapp.reasons.some((reason) => reason.code === "permission_missing"));
    await assert.rejects(
      listWhatsappStaffReadiness({ staffId: mapped, roles: ["agent"] }, { query, runtime }),
      (error) => error instanceof Response && error.status === 403,
    );
    await db.exec("DROP TABLE staff_notification_endpoints");
    await assert.rejects(
      listWhatsappStaffReadiness({ staffId: admin, roles: ["admin"] }, { query, runtime }),
      (error) => error instanceof Response && error.status === 503,
    );
  } finally {
    await db.close();
  }
});
