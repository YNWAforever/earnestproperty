import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildRecordPerformanceEventQuery } from "./performance-events.mjs";

const migration = readFileSync(
  "neon/migrations/20260927170000_performance_event_quality.sql",
  "utf8",
);
const ids = {
  branch: "00000000-0000-4000-8000-000000000001",
  staff: "00000000-0000-4000-8000-000000000002",
  lead: "00000000-0000-4000-8000-000000000003",
  activity: "00000000-0000-4000-8000-000000000004",
  conversation: "00000000-0000-4000-8000-000000000005",
  assignment: "00000000-0000-4000-8000-000000000006",
  inquiry: "00000000-0000-4000-8000-000000000007",
  transaction: "00000000-0000-4000-8000-000000000008",
};
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE branches(id uuid PRIMARY KEY);
    CREATE TABLE staff_users(id uuid PRIMARY KEY,branch_id uuid REFERENCES branches(id));
    CREATE TABLE crm_leads(id uuid PRIMARY KEY);
    CREATE TABLE crm_activities(id uuid PRIMARY KEY,lead_id uuid,staff_user_id uuid,
      activity_type text,completed_at timestamptz);
    CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY);
    CREATE TABLE inquiries(id uuid PRIMARY KEY,conversation_id uuid,source text,created_at timestamptz,
      first_human_response_at timestamptz,first_human_response_staff_id uuid,service_policy_id uuid);
    CREATE TABLE whatsapp_assignment_requests(id uuid PRIMARY KEY,conversation_id uuid,desired_staff_id uuid,
      state text,finished_at timestamptz);
    CREATE TABLE transaction_performance_versions(transaction_id uuid,version int,attribution_status text,
      lead_id uuid,changed_by uuid,confirmed_at timestamptz,changed_at timestamptz);
  `);
  await db.exec(migration);
  await db.query("INSERT INTO branches VALUES ($1)", [ids.branch]);
  await db.query("INSERT INTO staff_users VALUES ($1,$2)", [ids.staff, ids.branch]);
  await db.query("INSERT INTO crm_leads VALUES ($1)", [ids.lead]);
  await db.query("INSERT INTO whatsapp_conversations VALUES ($1)", [ids.conversation]);
  await db.query(
    "INSERT INTO inquiries(id,conversation_id,source,created_at) VALUES ($1,$2,'whatsapp','2026-09-26T15:58:00Z')",
    [ids.inquiry, ids.conversation],
  );
  return db;
}
test("authoritative changes project one event per source, preserve HK midnight and offline time", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO crm_activities VALUES ($1,$2,$3,'viewing',NULL)", [
      ids.activity,
      ids.lead,
      ids.staff,
    ]);
    await db.query("UPDATE crm_activities SET completed_at='2026-09-26T16:01:00Z' WHERE id=$1", [
      ids.activity,
    ]);
    await db.query("UPDATE crm_activities SET completed_at='2026-09-26T16:01:00Z' WHERE id=$1", [
      ids.activity,
    ]);
    await db.query("INSERT INTO whatsapp_assignment_requests VALUES ($1,$2,$3,'pending',NULL)", [
      ids.assignment,
      ids.conversation,
      ids.staff,
    ]);
    await db.query(
      "UPDATE whatsapp_assignment_requests SET state='confirmed',finished_at='2026-09-26T16:02:00Z' WHERE id=$1",
      [ids.assignment],
    );
    await db.query("UPDATE whatsapp_assignment_requests SET state='confirmed' WHERE id=$1", [
      ids.assignment,
    ]);
    await db.query(
      "UPDATE inquiries SET first_human_response_at='2026-09-26T16:03:00Z',first_human_response_staff_id=$2 WHERE id=$1",
      [ids.inquiry, ids.staff],
    );
    await db.query(
      "INSERT INTO transaction_performance_versions VALUES ($1,1,'verified_attributed',$2,$3,'2026-09-26T16:04:00Z',now())",
      [ids.transaction, ids.lead, ids.staff],
    );
    await db.query(
      "INSERT INTO transaction_performance_versions VALUES ($1,2,'cancelled',$2,$3,NULL,now())",
      [ids.transaction, ids.lead, ids.staff],
    );
    const rows = await db.query(
      "SELECT event_type,occurred_at,quality FROM performance_event_records ORDER BY event_type",
    );
    assert.deepEqual(
      rows.rows.map((r) => r.event_type),
      [
        "assignment_confirmed",
        "deal_cancelled",
        "deal_confirmed",
        "human_response",
        "viewing_completed",
      ],
    );
    assert.equal(rows.rows.filter((r) => r.event_type === "viewing_completed").length, 1);
    assert.equal(
      new Date(
        rows.rows.find((r) => r.event_type === "viewing_completed").occurred_at,
      ).toISOString(),
      "2026-09-26T16:01:00.000Z",
    );
    assert.ok(rows.rows.every((r) => r.quality === "unknown"));
    assert.ok(
      new Date(rows.rows.find((r) => r.event_type === "deal_cancelled").occurred_at).getTime() >
        new Date(rows.rows.find((r) => r.event_type === "deal_confirmed").occurred_at).getTime(),
    );
  } finally {
    await db.close();
  }
});
test("unfinished or cancelled viewing and pending assignment do not count", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO crm_activities VALUES ($1,$2,$3,'viewing',NULL)", [
      ids.activity,
      ids.lead,
      ids.staff,
    ]);
    await db.query("INSERT INTO whatsapp_assignment_requests VALUES ($1,$2,$3,'pending',NULL)", [
      ids.assignment,
      ids.conversation,
      ids.staff,
    ]);
    await db.query("UPDATE whatsapp_assignment_requests SET state='failed' WHERE id=$1", [
      ids.assignment,
    ]);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM performance_event_records")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("quality correction is audited, effective immediately, and history cannot be erased", async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO crm_lead_qualifications(lead_id,qualified_at,evidence,qualified_by) VALUES ($1,'2026-09-26T16:00:00Z','Qualified by staff interview',$2)",
      [ids.lead, ids.staff],
    );
    const key = "lead_qualified:" + ids.lead;
    await db.query(
      "INSERT INTO performance_event_quality_revisions(event_key,quality,reason,changed_by) VALUES ($1,'test','Internal test lead',$2)",
      [key, ids.staff],
    );
    await db.query(
      "INSERT INTO performance_event_quality_revisions(event_key,quality,reason,changed_by) VALUES ($1,'production','Verified customer identity',$2)",
      [key, ids.staff],
    );
    assert.equal(
      (await db.query("SELECT quality FROM performance_event_records WHERE event_key=$1", [key]))
        .rows[0].quality,
      "production",
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM performance_event_quality_revisions WHERE event_key=$1",
          [key],
        )
      ).rows[0].n,
      2,
    );
    await assert.rejects(
      db.query("DELETE FROM performance_event_quality_revisions WHERE event_key=$1", [key]),
      /append-only/,
    );
    await assert.rejects(
      db.query("DELETE FROM performance_events WHERE event_key=$1", [key]),
      /append-only/,
    );
  } finally {
    await db.close();
  }
});
test("earlier verified response revises event occurrence without losing audit", async () => {
  const db = await fixture();
  try {
    await db.query(
      "UPDATE inquiries SET first_human_response_at='2026-09-26T16:03:00Z',first_human_response_staff_id=$2 WHERE id=$1",
      [ids.inquiry, ids.staff],
    );
    await db.query(
      "UPDATE inquiries SET first_human_response_at='2026-09-26T16:01:00Z' WHERE id=$1",
      [ids.inquiry],
    );
    const row = (
      await db.query(
        "SELECT occurred_at FROM performance_event_records WHERE event_type='human_response'",
      )
    ).rows[0];
    assert.equal(new Date(row.occurred_at).toISOString(), "2026-09-26T16:01:00.000Z");
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM performance_event_occurrence_revisions"))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("server reconciliation cannot manufacture an uncompleted viewing", async () => {
  const db = await fixture();
  try {
    await db.query("INSERT INTO crm_activities VALUES ($1,$2,$3,'viewing',NULL)", [
      ids.activity,
      ids.lead,
      ids.staff,
    ]);
    const event = {
      type: "viewing_completed",
      source: "crm_activity:" + ids.activity,
      leadId: ids.lead,
      quality: "unknown",
      occurredAt: "2026-09-26T16:01:00Z",
    };
    const query = buildRecordPerformanceEventQuery(event);
    await db.query(query.statement, query.params);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM performance_events")).rows[0].n,
      0,
    );
    await db.query("UPDATE crm_activities SET completed_at='2026-09-26T16:01:00Z' WHERE id=$1", [
      ids.activity,
    ]);
    await db.query(query.statement, query.params);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM performance_events")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
test("ambiguous assignment cannot pick a lead inquiry by recency", async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO inquiries(id,conversation_id,source,created_at) VALUES ($1,$2,'whatsapp','2026-09-26T15:59:00Z')",
      [ids.activity, ids.conversation],
    );
    await db.query("INSERT INTO whatsapp_assignment_requests VALUES ($1,$2,$3,'pending',NULL)", [
      ids.assignment,
      ids.conversation,
      ids.staff,
    ]);
    await db.query(
      "UPDATE whatsapp_assignment_requests SET state='confirmed',finished_at='2026-09-26T16:02:00Z' WHERE id=$1",
      [ids.assignment],
    );
    const row = (
      await db.query(
        "SELECT inquiry_id FROM performance_event_records WHERE event_type='assignment_confirmed'",
      )
    ).rows[0];
    assert.equal(row.inquiry_id, null);
  } finally {
    await db.close();
  }
});
