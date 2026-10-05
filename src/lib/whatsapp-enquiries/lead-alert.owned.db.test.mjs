import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { withOwnedPostgres } from "../../../scripts/acceptance/owned-postgres-test.mjs";

const migrationSql = readFileSync(
  new URL("../../../neon/migrations/20261006110000_duty_manager.sql", import.meta.url),
  "utf8",
);

async function seedStaff(query) {
  const staffId = randomUUID();
  await query("INSERT INTO staff_users(id,auth_user_id,name_zh) VALUES($1,$2,$3)", [
    staffId,
    `lead-alert-${staffId}`,
    "合成同事",
  ]);
  return staffId;
}

async function seedEndpoint(query, staffId) {
  const endpointId = randomUUID();
  await query(
    "INSERT INTO staff_notification_endpoints(id,staff_id,transport,channel_id,destination_reference) VALUES($1,$2,'staff_whatsapp','owned-channel','owned-destination')",
    [endpointId, staffId],
  );
  return endpointId;
}

// Intent rows hang off a deep enquiry chain that is irrelevant here; bypass its FKs
// on one dedicated connection only for this synthetic row. The attempt FK stays enforced.
async function seedIntent(pool, staffId) {
  const intentId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("SET session_replication_role = replica");
    await client.query(
      "INSERT INTO staff_notification_intents(id,ready_event_id,cause_event_id,inquiry_id,conversation_id,assignment_version,activation_generation,recipient_staff_id,purpose,acknowledgement_required,logical_dedupe_key) VALUES($1,$2,$3,$4,$5,0,$6,$7,'fyi',false,$8)",
      [
        intentId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        staffId,
        `k-${intentId}`,
      ],
    );
    await client.query("SET session_replication_role = DEFAULT");
  } finally {
    client.release();
  }
  return intentId;
}

async function seedLead(query) {
  const [lead] = await query("INSERT INTO crm_leads(source) VALUES('website') RETURNING id");
  return lead.id;
}

test(
  "duty manager column defaults false and the migration is re-runnable",
  { timeout: 120000 },
  async () => {
    await withOwnedPostgres(async ({ query, pool }) => {
      await pool.query(migrationSql);
      await pool.query(migrationSql);
      const staffId = await seedStaff(query);
      const [row] = await query("SELECT is_duty_manager FROM staff_users WHERE id=$1", [staffId]);
      assert.equal(row.is_duty_manager, false);
      const [constraints] = await query(
        "SELECT count(*)::int n FROM pg_constraint WHERE conname='staff_attempt_one_subject'",
      );
      assert.equal(constraints.n, 1);
    });
  },
);

test("an attempt needs exactly one subject", { timeout: 120000 }, async () => {
  await withOwnedPostgres(async ({ query, pool }) => {
    const staffId = await seedStaff(query);
    const endpointId = await seedEndpoint(query, staffId);
    const leadId = await seedLead(query);
    const intentId = await seedIntent(pool, staffId);
    const insert = (notificationId, lead, key) =>
      query(
        "INSERT INTO staff_notification_attempts(notification_id,lead_id,transport,endpoint_id,attempt_key) VALUES($1,$2,'staff_whatsapp',$3,$4) RETURNING id,destination_reference_snapshot,channel_id_snapshot",
        [notificationId, lead, endpointId, key],
      );
    await assert.rejects(insert(null, null, "none"), /staff_attempt_one_subject/);
    await assert.rejects(insert(intentId, leadId, "both"), /staff_attempt_one_subject/);
    const [ok] = await insert(null, leadId, "lead-only");
    assert.equal(ok.destination_reference_snapshot, "owned-destination");
    assert.equal(ok.channel_id_snapshot, "owned-channel");
  });
});

test("existing enquiry attempts are unaffected", { timeout: 120000 }, async () => {
  await withOwnedPostgres(async ({ query, pool }) => {
    const staffId = await seedStaff(query);
    const endpointId = await seedEndpoint(query, staffId);
    const intentId = await seedIntent(pool, staffId);
    const [ok] = await query(
      "INSERT INTO staff_notification_attempts(notification_id,transport,endpoint_id,attempt_key) VALUES($1,'staff_whatsapp',$2,'enq') RETURNING lead_id",
      [intentId, endpointId],
    );
    assert.equal(ok.lead_id, null);
  });
});
