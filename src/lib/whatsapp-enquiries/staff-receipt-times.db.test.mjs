import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("accepted, delivered and read timestamps remain separate and duplicate receipts are stable", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE staff_notification_attempts(
        id uuid PRIMARY KEY, claim_id uuid, dispatch_state text,
        evidence_kind text, provider_operation_id text, safe_error text,
        finished_at timestamptz, updated_at timestamptz
      );
      INSERT INTO staff_notification_attempts(id,claim_id,dispatch_state)
      VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','dispatching');
    `);
    await db.exec(
      readFileSync("neon/migrations/20260927080000_staff_notification_receipt_times.sql", "utf8"),
    );
    const send = readFileSync("src/lib/whatsapp-enquiries/staff-notifications.server.ts", "utf8");
    const acceptedSql = send
      .match(/"UPDATE staff_notification_attempts SET dispatch_state=\$3,[^"]+"/)?.[0]
      .slice(1, -1);
    assert.ok(acceptedSql);
    const id = "00000000-0000-4000-8000-000000000001";
    const claim = "00000000-0000-4000-8000-000000000002";
    await db.query(acceptedSql, [id, claim, "accepted", "provider_accepted", "synthetic-op"]);
    const source = readFileSync(
      "src/lib/whatsapp-enquiries/staff-event-isolation.server.ts",
      "utf8",
    );
    const receipts = [
      ...source.matchAll(
        /"UPDATE staff_notification_attempts SET dispatch_state='delivered'[^"]+"/g,
      ),
    ].map((match) => match[0].slice(1, -1));
    assert.equal(receipts.length, 2);
    const [readSql, deliveredSql] = receipts;
    const before = (await db.query("SELECT * FROM staff_notification_attempts WHERE id=$1", [id]))
      .rows[0];
    assert.ok(before.provider_accepted_at);
    assert.equal(before.provider_delivered_at, null);
    assert.equal(before.provider_read_at, null);
    await db.query(deliveredSql, [id, "2026-09-27T08:01:00Z", "signed_webhook_event_time"]);
    await db.query(readSql, [id, "2026-09-27T08:02:00Z", "signed_webhook_event_time"]);
    await db.query(readSql, [id, "2026-09-27T09:02:00Z", "signed_webhook_event_time"]);
    const after = (await db.query("SELECT * FROM staff_notification_attempts WHERE id=$1", [id]))
      .rows[0];
    assert.equal(after.provider_delivered_at.toISOString(), "2026-09-27T08:01:00.000Z");
    assert.equal(after.provider_read_at.toISOString(), "2026-09-27T08:02:00.000Z");
    assert.equal(after.provider_acceptance_source, "woztell_send_responses");
    assert.equal(after.provider_delivery_source, "signed_webhook_event_time");
    assert.equal(after.provider_read_source, "signed_webhook_event_time");
    assert.equal(after.dispatch_state, "delivered");
  } finally {
    await db.close();
  }
});
