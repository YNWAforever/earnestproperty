import assert from "node:assert/strict";
import test from "node:test";
import { resolveEnquiry } from "./enquiry-resolution.server.ts";

test("correction input requires reason and an explicit changed field", async () => {
  const actor = { staffId: "11111111-1111-4111-8111-111111111111", roles: ["admin"] };
  await assert.rejects(() =>
    resolveEnquiry(
      { inquiryId: "22222222-2222-4222-8222-222222222222", expectedVersion: 0, reason: "ok" },
      actor,
      async () => [],
    ),
  );
});

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadEnquiryAccess } from "./enquiry-access.server.ts";

const ids = {
  inquiry: "11111111-1111-4111-8111-111111111111",
  conversation: "22222222-2222-4222-8222-222222222222",
  branchA: "33333333-3333-4333-8333-333333333333",
  branchB: "44444444-4444-4444-8444-444444444444",
  s1: "55555555-5555-4555-8555-555555555555",
  s2: "66666666-6666-4666-8666-666666666666",
  managerA: "77777777-7777-4777-8777-777777777777",
  managerB: "88888888-8888-4888-8888-888888888888",
  admin: "99999999-9999-4999-8999-999999999999",
  inactive: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  p1: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  p2: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  mapping: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  interpretation: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  event: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};

async function withDb(fn) {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean NOT NULL,branch_id uuid);
      CREATE TABLE staff_roles(staff_user_id uuid,role text);
      CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,assigned_agent_id uuid,confirmed_staff_id uuid);
      CREATE TABLE properties(id uuid PRIMARY KEY,status text);
      CREATE TABLE inquiries(id uuid PRIMARY KEY,source text,conversation_id uuid,link_open_id uuid,
        attribution_method text,property_id uuid,requested_staff_id uuid,status text DEFAULT 'new',
        association_review boolean DEFAULT true,updated_at timestamptz DEFAULT now());
      CREATE TABLE whatsapp_enquiry_reference_links(inquiry_id uuid,event_id uuid,ref_index integer,
        source text,scope_id text,external_listing_id text,deal_type text,
        interpretation_id uuid,created_at timestamptz DEFAULT now());
      CREATE TABLE mls_source_state(source text,scope_id text,external_listing_id text,deal_type text,
        property_id uuid,source_status text,last_accepted_at timestamptz);
      CREATE TABLE staff_external_references(id uuid,mapping_version integer,staff_id uuid,
        valid_from timestamptz,valid_until timestamptz,verified_at timestamptz);
      CREATE TABLE whatsapp_portal_interpretations(id uuid,resolution jsonb);`);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929104000_whatsapp_enquiry_access.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const [id, branch, role, active] of [
      [ids.s1, ids.branchA, "agent", true],
      [ids.s2, ids.branchB, "agent", true],
      [ids.managerA, ids.branchA, "manager", true],
      [ids.managerB, ids.branchB, "manager", true],
      [ids.admin, null, "admin", true],
      [ids.inactive, ids.branchB, "agent", false],
    ]) {
      await query("INSERT INTO staff_users VALUES($1,$2,$3)", [id, active, branch]);
      await query("INSERT INTO staff_roles VALUES($1,$2)", [id, role]);
    }
    await query("INSERT INTO whatsapp_conversations VALUES($1,$2,$2)", [ids.conversation, ids.s1]);
    await query("INSERT INTO properties VALUES($1,'active'),($2,'active')", [ids.p1, ids.p2]);
    await query(
      "INSERT INTO inquiries(id,source,conversation_id,attribution_method,property_id,requested_staff_id) VALUES($1,'whatsapp',$2,'explicit_customer_statement',$3,$4)",
      [ids.inquiry, ids.conversation, ids.p1, ids.s1],
    );
    await fn({ query });
  } finally {
    await db.close();
  }
}
const command = (change = {}) => ({
  inquiryId: ids.inquiry,
  expectedVersion: 0,
  reason: "已核實查詢負責人",
  ...change,
});
const actor = (staffId, role) => ({ staffId, roles: [role] });

test("admin correction updates only enquiry; duplicate/stale does not write again", async () => {
  await withDb(async ({ query }) => {
    const result = await resolveEnquiry(
      command({ ownerStaffId: ids.s2 }),
      actor(ids.admin, "admin"),
      query,
    );
    assert.equal(result.version, 1);
    assert.equal(result.ownerStaffId, ids.s2);
    assert.equal(result.providerThreadReview, true);
    const [row] = await query(
      "SELECT property_id,requested_staff_id,enquiry_owner_staff_id,enquiry_version FROM inquiries WHERE id=$1",
      [ids.inquiry],
    );
    assert.equal(row.property_id, ids.p1);
    assert.equal(row.requested_staff_id, ids.s1);
    assert.equal(row.enquiry_owner_staff_id, ids.s2);
    assert.equal(
      (
        await query("SELECT assigned_agent_id FROM whatsapp_conversations WHERE id=$1", [
          ids.conversation,
        ])
      )[0].assigned_agent_id,
      ids.s1,
    );
    await assert.rejects(
      () => resolveEnquiry(command({ ownerStaffId: ids.s2 }), actor(ids.admin, "admin"), query),
      (error) => error.status === 409,
    );
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_enquiry_revisions"))[0].n,
      1,
    );
    assert.equal(
      (await loadEnquiryAccess({ staffId: ids.s2 }, ids.inquiry, query)).historyScope,
      "enquiry",
    );
    assert.equal(
      (await loadEnquiryAccess({ staffId: ids.s1 }, ids.inquiry, query)).historyScope,
      "conversation",
    );
  });
});

test("direct wrong-branch manager and inactive owner are rejected", async () => {
  await withDb(async ({ query }) => {
    await assert.rejects(
      () =>
        resolveEnquiry(command({ ownerStaffId: ids.s2 }), actor(ids.managerB, "manager"), query),
      (error) => error.status === 403,
    );
    await assert.rejects(
      () =>
        resolveEnquiry(command({ ownerStaffId: ids.s2 }), actor(ids.managerA, "manager"), query),
      (error) => error.status === 409,
    );
    await assert.rejects(
      () =>
        resolveEnquiry(command({ ownerStaffId: ids.inactive }), actor(ids.admin, "admin"), query),
      (error) => error.status === 409,
    );
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_enquiry_revisions"))[0].n,
      0,
    );
  });
});

test("stale source publication and changed staff mapping cannot be committed", async () => {
  await withDb(async ({ query }) => {
    await query(
      "INSERT INTO whatsapp_enquiry_reference_links VALUES($1,$2,0,'28hse','agent:540','4033349','sale',$3,now())",
      [ids.inquiry, ids.event, ids.interpretation],
    );
    await query(
      "INSERT INTO mls_source_state VALUES('28hse_agent_540','agent:540','4033349','sale',$1,'delisted',now())",
      [ids.p2],
    );
    await assert.rejects(
      () => resolveEnquiry(command({ propertyId: ids.p2 }), actor(ids.admin, "admin"), query),
      (error) => error.status === 409,
    );
    await assert.rejects(
      () => resolveEnquiry(command({ ownerStaffId: ids.s1 }), actor(ids.admin, "admin"), query),
      (error) => error.status === 409,
    );
    await query("INSERT INTO whatsapp_portal_interpretations VALUES($1,$2::jsonb)", [
      ids.interpretation,
      JSON.stringify([{ snapshot: { mappingId: ids.mapping, mappingVersion: 1 } }]),
    ]);
    await query(
      "INSERT INTO staff_external_references VALUES($1,1,$2,now()-interval '2 days',now()-interval '1 day',now()-interval '2 days')",
      [ids.mapping, ids.s1],
    );
    await query("UPDATE mls_source_state SET property_id=$1,source_status='active'", [ids.p1]);
    await assert.rejects(
      () => resolveEnquiry(command({ requestedStaffId: ids.s1 }), actor(ids.admin, "admin"), query),
      (error) => error.status === 409,
    );
    await assert.rejects(
      () => resolveEnquiry(command({ ownerStaffId: ids.s1 }), actor(ids.admin, "admin"), query),
      (error) => error.status === 409,
    );
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM whatsapp_enquiry_revisions"))[0].n,
      0,
    );
  });
});

test("reviewed no-link enquiry becomes reply-capable only for confirmed owner", async () => {
  await withDb(async ({ query }) => {
    const before = await loadEnquiryAccess({ staffId: ids.s1 }, ids.inquiry, query);
    assert.equal(before.canReply, false);
    const corrected = await resolveEnquiry(
      command({ ownerStaffId: ids.s1 }),
      actor(ids.admin, "admin"),
      query,
    );
    assert.equal(corrected.associationReview, false);
    assert.equal(corrected.providerThreadReview, false);
    const after = await loadEnquiryAccess({ staffId: ids.s1 }, ids.inquiry, query);
    assert.equal(after.canReply, true);
    const other = await loadEnquiryAccess({ staffId: ids.s2 }, ids.inquiry, query);
    assert.equal(other.canReply, false);
  });
});
