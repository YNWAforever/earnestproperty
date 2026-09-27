import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  BACKLOG_SQL,
  BACKLOG_ROWS_SQL,
  CREDIT_ROWS_SQL,
  DEAL_ROWS_SQL,
  EVENT_ROWS_SQL,
  INQUIRY_ROWS_SQL,
  LEGACY_TRANSACTION_SQL,
  reportParams,
} from "./sales-performance.queries.mjs";
import { parsePerformanceFilters } from "./sales-performance.mjs";
const qualityMigration = readFileSync("neon/migrations/20260927171000_inquiry_quality.sql", "utf8");
const ids = {
  branch: "00000000-0000-4000-8000-000000000001",
  other: "00000000-0000-4000-8000-000000000002",
  staff: "00000000-0000-4000-8000-000000000003",
  agent: "00000000-0000-4000-8000-000000000004",
  lead: "00000000-0000-4000-8000-000000000005",
  inquiry: "00000000-0000-4000-8000-000000000006",
  second: "00000000-0000-4000-8000-000000000007",
  deal: "00000000-0000-4000-8000-000000000008",
  property: "00000000-0000-4000-8000-000000000009",
  legacy: "00000000-0000-4000-8000-00000000000a",
};
async function fixture() {
  const db = new PGlite();
  await db.exec(`
 CREATE TABLE branches(id uuid PRIMARY KEY);
 CREATE TABLE staff_users(id uuid PRIMARY KEY,branch_id uuid);
 CREATE TABLE properties(id uuid PRIMARY KEY,deal_type text);
 CREATE TABLE inquiries(id uuid PRIMARY KEY,crm_lead_id uuid,created_at timestamptz,
  customer_message_at timestamptz,webhook_received_at timestamptz,response_due_at timestamptz,
  service_policy_id uuid,assigned_agent_id uuid,placement_source text,source text,
  property_id uuid,status text);
 CREATE TABLE performance_event_records(event_type text,inquiry_id uuid,lead_id uuid,
  transaction_id uuid,staff_id uuid,branch_id_at_event uuid,occurred_at timestamptz,
  quality text,event_key text);
 CREATE TABLE transactions(id uuid PRIMARY KEY,price numeric,deal_type text,agent_id uuid,verification_state text,deal_date date);
 CREATE TABLE transaction_performance(transaction_id uuid PRIMARY KEY,version int,
  attribution_status text,lead_id uuid,confirmed_at timestamptz,commission_receivable numeric);
 CREATE TABLE transaction_agent_credits(transaction_id uuid,version int,staff_id uuid,
  branch_id_at_close uuid,share_bps int);
 `);
  await db.exec(qualityMigration);
  await db.query("INSERT INTO branches VALUES ($1),($2)", [ids.branch, ids.other]);
  await db.query("INSERT INTO staff_users VALUES ($1,$3),($2,$3)", [
    ids.staff,
    ids.agent,
    ids.branch,
  ]);
  await db.query("INSERT INTO properties VALUES ($1,'sale')", [ids.property]);
  await db.query(
    `INSERT INTO inquiries VALUES
   ($1,$3,'2026-05-31T15:59:59Z',NULL,NULL,NULL,NULL,$4,'website','website',$5,'new'),
   ($2,$3,'2026-05-31T16:00:00Z',NULL,NULL,NULL,NULL,$4,'website','website',$5,'new')`,
    [ids.inquiry, ids.second, ids.lead, ids.agent, ids.property],
  );
  await db.query(
    `INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by)
    VALUES ($1,'production','Verified customer',$2),($3,'test','Internal test data',$2)`,
    [ids.second, ids.staff, ids.inquiry],
  );
  await db.query(
    "INSERT INTO transactions VALUES ($1,10000000,'sale',$2,'verified','2026-06-20')",
    [ids.deal, ids.agent],
  );
  await db.query("INSERT INTO transactions VALUES ($1,5000000,'sale',$2,'verified','2026-06-21')", [
    ids.legacy,
    ids.agent,
  ]);
  await db.query(
    "INSERT INTO transaction_performance VALUES ($1,1,'verified_attributed',$2,'2026-06-20T00:00:00Z',100000)",
    [ids.deal, ids.lead],
  );
  await db.query(
    `INSERT INTO performance_event_records VALUES
    ('deal_confirmed',NULL,$2::uuid,$1::uuid,$3::uuid,$4::uuid,'2026-06-20T00:00:00Z','production','deal_confirmed:'||$1::text||':1')`,
    [ids.deal, ids.lead, ids.staff, ids.branch],
  );
  await db.query(
    "INSERT INTO transaction_agent_credits VALUES ($1,1,$2,$4,6000),($1,1,$3,$4,4000)",
    [ids.deal, ids.staff, ids.agent, ids.branch],
  );
  return db;
}
const filter = parsePerformanceFilters({
  start: "2026-06-01",
  end: "2026-06-30",
  cohortWindowDays: 90,
});
test("HK inclusive date bounds and earliest production lead identity apply before cohort filtering", async () => {
  const db = await fixture();
  try {
    const rows = await db.query(INQUIRY_ROWS_SQL, reportParams(filter, ids.branch).slice(0, 6));
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].id, ids.second);
    assert.equal(rows.rows[0].firstLeadInquiryId, ids.second);
    assert.equal(rows.rows[0].quality, "production");
    const outside = await db.query(INQUIRY_ROWS_SQL, reportParams(filter, ids.other).slice(0, 6));
    assert.equal(outside.rows.length, 0);
  } finally {
    await db.close();
  }
});
test("deal and credits remain one company deal with scoped staff slices", async () => {
  const db = await fixture();
  try {
    const params = reportParams(filter, ids.branch);
    const deals = await db.query(DEAL_ROWS_SQL, params);
    assert.equal(deals.rows.length, 1);
    assert.equal(deals.rows[0].quality, "production");
    await db.query("UPDATE staff_users SET branch_id=$2 WHERE id=$1", [ids.agent, ids.other]);
    const historic = await db.query(DEAL_ROWS_SQL, params);
    assert.equal(historic.rows.length, 1);
    await db.query("UPDATE staff_users SET branch_id=$2 WHERE id=$1", [ids.agent, ids.branch]);
    const credits = await db.query(CREDIT_ROWS_SQL, [[ids.deal], ids.branch, null]);
    assert.deepEqual(
      credits.rows.map((r) => r.shareBps),
      [6000, 4000],
    );
    const restricted = await db.query(CREDIT_ROWS_SQL, [[ids.deal], ids.other, null]);
    assert.equal(restricted.rows.length, 0);
    const wrongStaff = await db.query(
      DEAL_ROWS_SQL,
      reportParams({ ...filter, staffId: ids.inquiry }, ids.branch),
    );
    assert.equal(wrongStaff.rows.length, 0);
    const legacy = await db.query(LEGACY_TRANSACTION_SQL, params.slice(0, 6));
    assert.equal(legacy.rows[0].count, 1);
    const backlogDetails = await db.query(BACKLOG_ROWS_SQL, params.slice(2, 6));
    assert.equal(backlogDetails.rows.length, 2);
    const backlog = await db.query(BACKLOG_SQL, params.slice(2, 6));
    assert.equal(backlog.rows[0].openInquiries, 2);
    assert.equal(backlog.rows[0].unknownQuality, 0);
    const ev = await db.query(EVENT_ROWS_SQL, [[ids.second], [ids.lead]]);
    assert.equal(ev.rows.length, 0);
  } finally {
    await db.close();
  }
});
test("inquiry quality corrections are append-only", async () => {
  const db = await fixture();
  try {
    await db.query(
      "INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by) VALUES ($1,'production','Customer verified after review',$2)",
      [ids.inquiry, ids.staff],
    );
    const corrected = await db.query(
      "SELECT quality FROM inquiry_quality_records WHERE inquiry_id=$1",
      [ids.inquiry],
    );
    assert.equal(corrected.rows[0].quality, "production");
    await assert.rejects(
      db.query("DELETE FROM inquiry_quality_revisions WHERE inquiry_id=$1", [ids.second]),
      /append-only/,
    );
  } finally {
    await db.close();
  }
});
