import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { maybePrepareNoLinkFollowup } from "./no-link-rollout.server.ts";

const event = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const activation = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const receipt = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const staff = "44444444-4444-4444-8444-444444444444";
const env = {
  EP_WA_NO_LINK_EFFECTS_ENABLED: "true",
  EP_WA_COMPANY_CHANNEL_ID: "company",
  EP_WA_NO_LINK_CANARY_CHANNEL_ID: "company",
  EP_WA_ACTIVATION_ID: activation,
  EP_WA_NO_LINK_CANARY_ACTIVATION_ID: activation,
  EP_WA_NO_LINK_CANARY_STAFF_IDS: staff,
};

test("PGlite reads durable active receipt and verified cohort before one effect decision", async () => {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`
      CREATE TABLE whatsapp_enquiry_events(id uuid PRIMARY KEY,app_id text,channel_id text,
        member_id text,external_message_id text,kind text,origin text,capture_mode text,
        effects_eligible boolean,evidence jsonb,occurred_at timestamptz,timing text,
        identity_quality text,activation_id uuid);
      CREATE TABLE whatsapp_inbound_receipts(id uuid PRIMARY KEY,provider text,origin text,event_kind text,app_id text,channel_id text,
        member_id text,identity_key text,capture_mode text,activation_id uuid,
        received_at timestamptz);
      CREATE TABLE whatsapp_enquiry_activations(id uuid PRIMARY KEY,cutover_at timestamptz,
        ended_at timestamptz);
      CREATE TABLE whatsapp_enquiry_reference_links(event_id uuid,ref_index int,
        resolution jsonb,property_id uuid,scope_id text);
      CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean);
      CREATE TABLE staff_roles(staff_user_id uuid,role text);
      CREATE TABLE whatsapp_staff_channels(staff_id uuid,channel_id text,eligible boolean,
        retired_at timestamptz,review_enforced boolean,review_basis text);
      CREATE TABLE effect_calls(event_id uuid);
      CREATE FUNCTION wa_prepare_no_link_followup(uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO effect_calls VALUES($1);
        RETURN jsonb_build_object('decision','assignment_pending'); END $$;
    `);
    await query("INSERT INTO whatsapp_enquiry_activations VALUES($1,'2026-09-30T00:00:00Z',NULL)", [
      activation,
    ]);
    await query(
      `INSERT INTO whatsapp_enquiry_events VALUES
      ($1,'app','company','member','identity','customer_message','live_webhook',
      'active',true,$3::jsonb,
      '2026-09-30T00:00:30Z','fresh','provider_id',$2)`,
      [
        event,
        activation,
        JSON.stringify({ noLinkEffectsEligible: true, noLinkCanaryStaffIds: [staff] }),
      ],
    );
    await query(
      `INSERT INTO whatsapp_inbound_receipts VALUES
      ($1,'woztell','live_webhook','customer_message','app','company','member','identity','active',$2,'2026-09-30T00:01:00Z')`,
      [receipt, activation],
    );
    await query(
      `INSERT INTO whatsapp_enquiry_reference_links VALUES
      ($1,0,$2::jsonb,$3,'agent:540')`,
      [
        event,
        JSON.stringify({
          status: "resolved",
          reasons: [],
          requestedStaffId: staff,
          publicationOwnerId: staff,
        }),
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ],
    );
    await query("INSERT INTO staff_users VALUES($1,true)", [staff]);
    await query("INSERT INTO staff_roles VALUES($1,'agent')", [staff]);
    await query(
      `INSERT INTO whatsapp_staff_channels VALUES
      ($1,'company',true,NULL,true,'provider_verified')`,
      [staff],
    );
    let wakes = 0;
    const ports = {
      env,
      wake: () => {
        wakes++;
      },
    };
    const first = await maybePrepareNoLinkFollowup(event, "active", query, ports);
    assert.equal(first.allowed, true);
    assert.equal(first.prepared.decision, "assignment_pending");
    assert.equal(wakes, 1);
    assert.equal((await query("SELECT count(*)::int n FROM effect_calls"))[0].n, 1);
    await query("UPDATE whatsapp_inbound_receipts SET capture_mode='observe' WHERE id=$1", [
      receipt,
    ]);
    const old = await maybePrepareNoLinkFollowup(event, "active", query, ports);
    assert.equal(old.allowed, false);
    assert.ok(old.reasons.includes("capture_snapshot_not_active"));
    assert.equal(wakes, 1);
    assert.equal((await query("SELECT count(*)::int n FROM effect_calls"))[0].n, 1);
    await query(
      "UPDATE whatsapp_inbound_receipts SET capture_mode='active',origin='history_import' WHERE id=$1",
      [receipt],
    );
    const history = await maybePrepareNoLinkFollowup(event, "active", query, ports);
    assert.equal(history.allowed, false);
    assert.equal((await query("SELECT count(*)::int n FROM effect_calls"))[0].n, 1);
  } finally {
    await db.close();
  }
});
