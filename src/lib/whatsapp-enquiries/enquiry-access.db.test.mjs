import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { loadEnquiryAccess, readEnquiryMessages } from "./enquiry-access.server.ts";

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
  viewer: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  inactive: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

async function withDb(fn) {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean NOT NULL,branch_id uuid);
      CREATE TABLE staff_roles(staff_user_id uuid,role text);
      CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,assigned_agent_id uuid,confirmed_staff_id uuid);
      CREATE TABLE inquiries(id uuid PRIMARY KEY,source text,conversation_id uuid,link_open_id uuid,attribution_method text,association_review boolean NOT NULL DEFAULT true);`);
    await db.exec(`CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,direction text,text text,created_at timestamptz);
      CREATE TABLE whatsapp_enquiry_messages(message_id uuid,event_id uuid,inquiry_id uuid);
      CREATE TABLE whatsapp_enquiry_reference_links(event_id uuid,inquiry_id uuid);`);
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20260929104000_whatsapp_enquiry_access.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // FX-06: the current wa_can_read_conversation (managers org-wide).
    await db.exec(
      readFileSync(
        new URL(
          "../../../neon/migrations/20261007100000_wa_access_unassigned.sql",
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
      [ids.viewer, ids.branchB, "viewer", true],
      [ids.inactive, ids.branchB, "agent", false],
    ]) {
      await query("INSERT INTO staff_users VALUES($1,$2,$3)", [id, active, branch]);
      await query("INSERT INTO staff_roles VALUES($1,$2)", [id, role]);
    }
    await query("INSERT INTO whatsapp_conversations VALUES($1,$2,$2)", [ids.conversation, ids.s1]);
    await query(
      "INSERT INTO inquiries(id,source,conversation_id,attribution_method,enquiry_owner_staff_id) VALUES($1,'whatsapp',$2,'explicit_customer_statement',$3)",
      [ids.inquiry, ids.conversation, ids.s2],
    );
    await fn({ query });
  } finally {
    await db.close();
  }
}

test("direct SQL list/detail predicates reject wrong branch, viewer and inactive staff", async () => {
  await withDb(async ({ query }) => {
    const read = async (id) =>
      (await query("SELECT wa_can_read_enquiry($1,$2) AS allowed", [id, ids.inquiry]))[0].allowed;
    assert.equal(await read(ids.admin), true);
    assert.equal(await read(ids.managerB), true);
    // FX-06 (owner decision): managers read every enquiry, so wrong-branch manager A
    // now reads it. Correction below stays branch-scoped.
    assert.equal(await read(ids.managerA), true);
    assert.equal(
      (
        await query("SELECT wa_can_correct_enquiry($1,$2) AS allowed", [ids.managerA, ids.inquiry])
      )[0].allowed,
      false,
    );
    assert.equal(await read(ids.s2), true);
    assert.equal(await read(ids.s1), true);
    assert.equal(await read(ids.viewer), false);
    assert.equal(await read(ids.inactive), false);
    assert.equal(
      (await query("SELECT wa_can_correct_enquiry($1,$2) AS allowed", [ids.s2, ids.inquiry]))[0]
        .allowed,
      false,
    );
    assert.equal(
      (
        await query("SELECT wa_can_correct_enquiry($1,$2) AS allowed", [ids.managerB, ids.inquiry])
      )[0].allowed,
      true,
    );
    // FX-06: the whole conversation is readable by every active manager, company-wide.
    // The conversation is assigned to S1 (branch A), so manager B is the wrong branch.
    const readConversation = async (id) =>
      (await query("SELECT wa_can_read_conversation($1,$2) AS allowed", [id, ids.conversation]))[0]
        .allowed;
    assert.equal(await readConversation(ids.managerB), true);
    assert.equal(await readConversation(ids.managerA), true);
    assert.equal(await readConversation(ids.admin), true);
    assert.equal(await readConversation(ids.viewer), false);
    assert.equal(await readConversation(ids.inactive), false);
  });
});

test("S2 can read its enquiry but cannot fetch S1 whole conversation", async () => {
  await withDb(async ({ query }) => {
    const s2 = await loadEnquiryAccess({ staffId: ids.s2 }, ids.inquiry, query);
    assert.equal(s2.canRead, true);
    assert.equal(s2.historyScope, "enquiry");
    assert.equal(s2.canReply, false);
    assert.equal(
      (
        await query("SELECT wa_can_read_conversation($1,$2) AS allowed", [ids.s2, ids.conversation])
      )[0].allowed,
      false,
    );
    assert.equal(
      (
        await query("SELECT wa_can_read_conversation($1,$2) AS allowed", [ids.s1, ids.conversation])
      )[0].allowed,
      true,
    );
  });
});

test("second owner reads only linked inbound enquiry evidence, including a second reference", async () => {
  await withDb(async ({ query }) => {
    const eventA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const eventB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const linked = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const unrelated = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await query(
      "INSERT INTO whatsapp_messages VALUES($1,'inbound','第二盤查詢',now()),($2,'inbound','S1 舊歷史',now())",
      [linked, unrelated],
    );
    await query("INSERT INTO whatsapp_enquiry_messages VALUES($1,$2,NULL),($3,$4,NULL)", [
      linked,
      eventA,
      unrelated,
      eventB,
    ]);
    await query("INSERT INTO whatsapp_enquiry_reference_links VALUES($1,$2)", [
      eventA,
      ids.inquiry,
    ]);
    const messages = await readEnquiryMessages({ staffId: ids.s2 }, ids.inquiry, query);
    assert.deepEqual(
      messages.map((message) => message.text),
      ["第二盤查詢"],
    );
    await assert.rejects(
      readEnquiryMessages({ staffId: ids.viewer }, ids.inquiry, query),
      (error) => error.status === 403,
    );
  });
});
