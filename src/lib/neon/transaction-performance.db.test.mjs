import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildSavePerformanceQuery } from "./transaction-performance.mjs";

const migration = readFileSync(
  "neon/migrations/20260927160000_transaction_sales_attribution.sql",
  "utf8",
);
const ids = {
  tx: "00000000-0000-4000-8000-000000000001",
  a: "00000000-0000-4000-8000-000000000002",
  b: "00000000-0000-4000-8000-000000000003",
  branch: "00000000-0000-4000-8000-000000000004",
  actor: "00000000-0000-4000-8000-000000000005",
};
const base = {
  transactionId: ids.tx,
  expectedVersion: 0,
  leadId: null,
  publicListingNo: null,
  dealType: "sale",
  confirmedAt: "2026-09-20T00:00:00.000Z",
  commissionReceivable: "100000.00",
  commissionReceived: null,
  credits: [
    { staffId: ids.a, branchIdAtClose: ids.branch, shareBps: 6000 },
    { staffId: ids.b, branchIdAtClose: ids.branch, shareBps: 4000 },
  ],
  attributionStatus: "verified_attributed",
  reason: "Signed sale contract",
};
const actor = { staffId: ids.actor, roles: ["admin"] };
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE deal_type AS ENUM ('sale','rent');
    CREATE TYPE transaction_verification_state AS ENUM ('unverified','pending','verified');
    CREATE TABLE branches(id uuid PRIMARY KEY);
    CREATE TABLE staff_users(id uuid PRIMARY KEY, branch_id uuid REFERENCES branches(id));
    CREATE TABLE estates(id uuid PRIMARY KEY);
    CREATE TABLE transactions(id uuid PRIMARY KEY, deal_type deal_type NOT NULL,
      price numeric, deal_date date, verification_state transaction_verification_state NOT NULL,
      agent_id uuid REFERENCES staff_users(id), published boolean NOT NULL DEFAULT false);
    CREATE TABLE crm_leads(id uuid PRIMARY KEY);
    CREATE TABLE property_public_groups(public_listing_no text PRIMARY KEY);
    CREATE TABLE properties(id uuid PRIMARY KEY, deal_type deal_type NOT NULL, status text NOT NULL);
    CREATE TABLE property_public_members(property_id uuid PRIMARY KEY REFERENCES properties(id),
      public_listing_no text REFERENCES property_public_groups(public_listing_no));
  `);
  await db.exec(migration);
  await db.query("INSERT INTO branches(id) VALUES ($1)", [ids.branch]);
  await db.query("INSERT INTO staff_users(id,branch_id) VALUES ($1,$4),($2,$4),($3,$4)", [
    ids.a,
    ids.b,
    ids.actor,
    ids.branch,
  ]);
  await db.query(
    "INSERT INTO transactions(id,deal_type,price,deal_date,verification_state,agent_id) VALUES ($1,'sale',10000000,'2026-09-20','verified',$2)",
    [ids.tx, ids.a],
  );
  return db;
}
async function save(db, input = base, acting = actor) {
  const { statement, params } = buildSavePerformanceQuery(input, acting);
  const result = await db.query(statement, params);
  if (!result.rows[0]) throw new Response("Conflict", { status: 409 });
  return result.rows[0];
}
test("60/40 sale attribution is versioned and preserves null commission", async () => {
  const db = await fixture();
  try {
    assert.equal((await save(db)).version, 1);
    const credits = await db.query(
      "SELECT staff_id::text,branch_id_at_close::text,share_bps FROM transaction_agent_credits ORDER BY staff_id",
    );
    assert.deepEqual(
      credits.rows.map((r) => r.share_bps),
      [6000, 4000],
    );
    assert.equal(credits.rows[0].branch_id_at_close, ids.branch);
    const row = await db.query(
      "SELECT commission_received, commission_receivable::text FROM transaction_performance",
    );
    assert.equal(row.rows[0].commission_received, null);
    assert.equal(row.rows[0].commission_receivable, "100000.00");
    await db.query("UPDATE staff_users SET branch_id=NULL WHERE id=$1", [ids.a]);
    assert.equal(
      (
        await db.query(
          "SELECT branch_id_at_close::text FROM transaction_agent_credits WHERE staff_id=$1",
          [ids.a],
        )
      ).rows[0].branch_id_at_close,
      ids.branch,
    );
  } finally {
    await db.close();
  }
});
test("invalid shares, duplicate staff and overpayment fail before SQL", () => {
  for (const credits of [
    [{ ...base.credits[0], shareBps: 9999 }],
    [{ ...base.credits[0], shareBps: 10001 }],
    [base.credits[0], { ...base.credits[0], shareBps: 4000 }],
  ])
    assert.throws(() => buildSavePerformanceQuery({ ...base, credits }, actor), /credit|share/i);
  assert.throws(
    () => buildSavePerformanceQuery({ ...base, commissionReceived: "100001.00" }, actor),
    /commission/i,
  );
  assert.throws(
    () => buildSavePerformanceQuery(base, { staffId: ids.a, roles: ["agent"] }),
    /Forbidden/,
  );
});
test("CAS rejects stale correction; cancellation keeps history and zero commission is distinct", async () => {
  const db = await fixture();
  try {
    await save(db);
    await assert.rejects(save(db, { ...base, reason: "stale retry" }), (e) => e.status === 409);
    const next = {
      ...base,
      expectedVersion: 1,
      attributionStatus: "cancelled",
      commissionReceived: "0.00",
      credits: [],
      reason: "Contract rescinded",
    };
    assert.equal((await save(db, next)).version, 2);
    const rows = await db.query(
      "SELECT version,attribution_status,commission_received::text FROM transaction_performance_versions ORDER BY version",
    );
    assert.deepEqual(
      rows.rows.map((r) => r.version),
      [1, 2],
    );
    assert.equal(rows.rows[1].commission_received, "0.00");
    assert.equal(rows.rows[1].attribution_status, "cancelled");
  } finally {
    await db.close();
  }
});
test("rent mismatch and forged branch snapshot cannot be saved", async () => {
  const db = await fixture();
  try {
    await assert.rejects(save(db, { ...base, dealType: "rent" }), (e) => e.status === 409);
    await assert.rejects(
      save(db, {
        ...base,
        credits: [{ ...base.credits[0], branchIdAtClose: null, shareBps: 10000 }],
      }),
      (e) => e.status === 409,
    );
  } finally {
    await db.close();
  }
});

test("migration preserves legacy transaction rows and private fields stay out of public reader", async () => {
  const db = await fixture();
  try {
    const legacy = await db.query("SELECT count(*)::int AS n FROM transactions");
    assert.equal(legacy.rows[0].n, 1);
    const privateCount = await db.query("SELECT count(*)::int AS n FROM transaction_performance");
    assert.equal(privateCount.rows[0].n, 0);
    await save(db);
    const publicReader = readFileSync("src/lib/neon/public-data.server.ts", "utf8");
    assert.doesNotMatch(
      publicReader,
      /transaction_performance|commission_receivable|commission_received|transaction_agent_credits/,
    );
    const oldReader = await db.query(
      "SELECT id,deal_type,price,deal_date FROM transactions WHERE id=$1",
      [ids.tx],
    );
    assert.equal(oldReader.rows.length, 1);
    await assert.rejects(
      db.query(
        "UPDATE transaction_performance_versions SET reason='tampered' WHERE transaction_id=$1",
        [ids.tx],
      ),
      /append-only/,
    );
  } finally {
    await db.close();
  }
});

test("verified unattributed deals stay company-only and confirmed facts require correction", async () => {
  const db = await fixture();
  try {
    await save(db, { ...base, attributionStatus: "verified_unattributed", credits: [] });
    const company = await db.query(
      "SELECT count(*)::int AS n FROM transaction_performance WHERE attribution_status IN ('verified_attributed','verified_unattributed')",
    );
    const agents = await db.query("SELECT count(*)::int AS n FROM transaction_agent_credits");
    assert.equal(company.rows[0].n, 1);
    assert.equal(agents.rows[0].n, 0);
    await assert.rejects(
      db.query("UPDATE transactions SET price=2 WHERE id=$1", [ids.tx]),
      /reasoned correction/,
    );
  } finally {
    await db.close();
  }
});
test("manager writes only for a transaction owned by their current branch", async () => {
  const db = await fixture();
  try {
    const manager = { staffId: ids.actor, roles: ["manager"] };
    assert.equal((await save(db, base, manager)).version, 1);
    await db.query("UPDATE staff_users SET branch_id=NULL WHERE id=$1", [ids.actor]);
    await assert.rejects(
      save(db, { ...base, expectedVersion: 1, reason: "Correction" }, manager),
      (e) => e.status === 409,
    );
  } finally {
    await db.close();
  }
});
