import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { mockOwnedServerDb, repoRoot } from "../../../scripts/acceptance/owned-postgres-test.mjs";

const sql = (file) => readFileSync(new URL("neon/migrations/" + file, repoRoot), "utf8");
const BASE = [
  "20260622060000_public_content.sql",
  "20260623090000_neon_admin_crm_whatsapp.sql",
  "20260830160000_branches_entity.sql",
].map(sql);
// Real column: 20260912130000_whatsapp_enquiry_episodes.sql:42-43. Needed only because the access
// migration's SQL functions are validated at CREATE time; nothing here reads inquiries.
const SHIM =
  "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES whatsapp_conversations(id);";
const ACCESS = sql("20260929104000_whatsapp_enquiry_access.sql");

let db;
let queryCount = 0;
const query = async (statement, params = []) => {
  queryCount += 1;
  return (await db.query(statement, params)).rows;
};
const transaction = async (statements) =>
  db.transaction(async (tx) => {
    const out = [];
    for (const { statement, params = [] } of statements)
      out.push((await tx.query(statement, params)).rows);
    return out;
  });
await mockOwnedServerDb(mock, query, transaction);
const adminData = await import("./admin-data.server.ts");

async function freshDb() {
  db = new PGlite({ extensions: { pgcrypto } });
  for (const statement of [...BASE, SHIM, ACCESS]) await db.exec(statement);
  queryCount = 0;
}

// Seeding talks to PGlite directly so it never counts as a production read.
const run = async (statement, params = []) => (await db.query(statement, params)).rows;
const one = async (statement, params = []) => (await run(statement, params))[0];

async function addActivity(leadId, staffId, type, minutesAgo) {
  await run(
    `INSERT INTO crm_activities (lead_id, staff_user_id, activity_type, created_at)
     VALUES ($1, $2, $3, now() - make_interval(mins => $4::int))`,
    [leadId, staffId, type, minutesAgo],
  );
}

async function addMessage(conversationId, direction, minutesAgo) {
  await run(
    `INSERT INTO whatsapp_messages (conversation_id, direction, message_type, created_at)
     VALUES ($1, $2, 'text', now() - make_interval(mins => $3::int))`,
    [conversationId, direction, minutesAgo],
  );
}

async function addLead(stage, assignee, minutesAgo) {
  const row = await one(
    `INSERT INTO crm_leads (stage, assigned_agent_id, created_at)
     VALUES ($1, $2, now() - make_interval(mins => $3::int)) RETURNING id`,
    [stage, assignee, minutesAgo],
  );
  return row.id;
}

async function seed() {
  const branchId = async (slug) =>
    (await one("SELECT id FROM branches WHERE slug = $1", [slug])).id;
  const lido = await branchId("lido");
  const rhine = await branchId("rhine");
  const actors = {};
  for (const [key, role, branch] of [
    ["admin", "admin", null],
    ["managerLido", "manager", lido],
    ["agentA", "agent", lido],
    ["agentB", "agent", rhine],
  ]) {
    const authUserId = "attention-" + key;
    const { id } = await one(
      "INSERT INTO staff_users (auth_user_id, email, branch_id) VALUES ($1, $2, $3) RETURNING id",
      [authUserId, authUserId + "@example.invalid", branch],
    );
    await run("INSERT INTO staff_roles (staff_user_id, role) VALUES ($1, $2)", [id, role]);
    actors[key] = {
      staffId: id,
      authUserId,
      email: null,
      name: null,
      roles: [role],
      bootstrap: false,
    };
  }
  const { agentA, agentB } = actors;

  const leads = {
    L1: await addLead("new", null, 300),
    L2: await addLead("new", agentA.staffId, 240),
    L3: await addLead("new", agentA.staffId, 240),
    L4: await addLead("new", agentB.staffId, 60),
    L5: await addLead("contacted", null, 600),
    L6: await addLead("closed_lost", null, 600),
    L7: await addLead("new", agentB.staffId, 180),
  };
  await addActivity(leads.L3, agentA.staffId, "note", 30);
  await addActivity(leads.L7, null, "follow_up", 180);

  const contact = async (name, phone) =>
    (
      await one("INSERT INTO crm_contacts (name, phone) VALUES ($1, $2) RETURNING id", [
        name,
        phone,
      ])
    ).id;
  const conversation = async (status, assignee, contactId = null) =>
    (
      await one(
        "INSERT INTO whatsapp_conversations (status, assigned_agent_id, contact_id) VALUES ($1, $2, $3) RETURNING id",
        [status, assignee, contactId],
      )
    ).id;
  const conversations = {
    C1: await conversation("open", agentA.staffId, await contact("合成客戶甲", null)),
    C2: await conversation("open", agentA.staffId),
    C3: await conversation("open", agentB.staffId),
    C4: await conversation("closed", agentA.staffId),
    C5: await conversation("open", null, await contact("", "61234567")),
    C6: await conversation("open", agentA.staffId),
  };
  await addMessage(conversations.C1, "inbound", 360);
  await addMessage(conversations.C2, "inbound", 300);
  await addMessage(conversations.C2, "outbound", 290);
  await addMessage(conversations.C3, "inbound", 30);
  await addMessage(conversations.C4, "inbound", 20);
  await addMessage(conversations.C5, "inbound", 120);

  return { actors, leads, conversations };
}

async function withSeed(fn) {
  await freshDb();
  try {
    await fn(await seed());
  } finally {
    await db.close();
  }
}

test("migrations and the real wa_can_read_conversation load on PGlite", async () => {
  await withSeed(async ({ actors, conversations }) => {
    const canRead = async (actor, conversationId) =>
      (await one("SELECT wa_can_read_conversation($1, $2) AS ok", [actor.staffId, conversationId]))
        .ok;
    assert.equal(await canRead(actors.admin, conversations.C5), true);
    assert.equal(await canRead(actors.managerLido, conversations.C5), false);
    assert.equal(await canRead(actors.managerLido, conversations.C1), true);
    assert.equal(await canRead(actors.managerLido, conversations.C3), false);
  });
});

const counts = (actor) => adminData.getAdminAttentionCounts(actor);
const tasks = (actor) => adminData.getAdminTodayTasks(actor);

test("counts follow each role's read scope", async () => {
  await withSeed(async ({ actors }) => {
    // admin: C1, C3, C5 · unassigned L1, L5 · stale L1, L2, L7 · distinct L1, L2, L5, L7.
    assert.deepEqual(await counts(actors.admin), {
      unansweredConversations: 3,
      unassignedLeads: 2,
      staleNewLeads: 3,
      leadsNeedingAttention: 4,
    });
    // manager: C1 only; C3 is another branch and C5 is unassigned. Leads are unscoped.
    assert.deepEqual(await counts(actors.managerLido), {
      unansweredConversations: 1,
      unassignedLeads: 2,
      staleNewLeads: 3,
      leadsNeedingAttention: 4,
    });
    // agentA: C1 · L2; never C3, C5, L1 or L7.
    assert.deepEqual(await counts(actors.agentA), {
      unansweredConversations: 1,
      unassignedLeads: 0,
      staleNewLeads: 1,
      leadsNeedingAttention: 1,
    });
    // agentB: C3 · L7.
    assert.deepEqual(await counts(actors.agentB), {
      unansweredConversations: 1,
      unassignedLeads: 0,
      staleNewLeads: 1,
      leadsNeedingAttention: 1,
    });
  });
});

test("a lead that is both unassigned and stale counts once in leadsNeedingAttention", async () => {
  await withSeed(async ({ actors, leads }) => {
    // L1 is new, unassigned and 300 minutes old, so it is in both parts.
    const before = await counts(actors.admin);
    assert.equal(before.unassignedLeads + before.staleNewLeads, 5);
    assert.equal(before.leadsNeedingAttention, 4);
    // Closing L1 removes it from both parts, but only one lead from the distinct total.
    await run("UPDATE crm_leads SET stage = 'closed_lost' WHERE id = $1", [leads.L1]);
    const after = await counts(actors.admin);
    assert.equal(after.unassignedLeads + after.staleNewLeads, 3);
    assert.equal(after.leadsNeedingAttention, 3);
  });
});

test("a conversation counts as unanswered only while its latest message is inbound", async () => {
  await withSeed(async ({ actors, conversations }) => {
    await addMessage(conversations.C1, "outbound", 0);
    assert.equal((await counts(actors.admin)).unansweredConversations, 2);
    assert.equal((await counts(actors.agentA)).unansweredConversations, 0);
    await addMessage(conversations.C2, "inbound", 0);
    assert.equal((await counts(actors.admin)).unansweredConversations, 3);
  });
});

test("any activity in the last 2 hours keeps a new lead off the stale count", async () => {
  await withSeed(async ({ actors, leads }) => {
    await addActivity(leads.L2, actors.agentA.staffId, "note", 0);
    assert.equal((await counts(actors.agentA)).staleNewLeads, 0);
    assert.equal((await counts(actors.admin)).staleNewLeads, 2);
  });
});

test("each read is a single statement", async () => {
  await withSeed(async ({ actors }) => {
    queryCount = 0;
    await counts(actors.agentA);
    assert.equal(queryCount, 1);
    await tasks(actors.agentA);
    assert.equal(queryCount, 2);
    for (const read of [counts, tasks])
      await assert.rejects(
        read(null),
        (error) => error instanceof Response && error.status === 403,
      );
    assert.equal(queryCount, 2);
  });
});

test("today's tasks follow the same scope, oldest first, at most 10", async () => {
  await withSeed(async ({ actors, leads, conversations }) => {
    const name = new Map(
      [...Object.entries(conversations), ...Object.entries(leads)].map(([key, id]) => [id, key]),
    );
    const sequence = (list) => list.map((task) => `${task.kind}:${name.get(task.id) ?? "?"}`);
    const admin = await tasks(actors.admin);
    assert.deepEqual(sequence(admin), [
      "conversation:C1",
      "lead:L1",
      "lead:L2",
      "lead:L7",
      "conversation:C5",
      "conversation:C3",
    ]);
    assert.deepEqual(sequence(await tasks(actors.managerLido)), [
      "conversation:C1",
      "lead:L1",
      "lead:L2",
      "lead:L7",
    ]);
    assert.deepEqual(sequence(await tasks(actors.agentA)), ["conversation:C1", "lead:L2"]);
    assert.deepEqual(sequence(await tasks(actors.agentB)), ["lead:L7", "conversation:C3"]);

    const title = (id) => admin.find((task) => task.id === id)?.title;
    assert.equal(title(conversations.C1), "合成客戶甲");
    assert.equal(title(conversations.C5), "61234567");
    assert.equal(title(conversations.C3), "WhatsApp 客戶");
    assert.equal(title(leads.L1), "未命名客戶");
    for (const task of admin)
      assert.ok(Number.isFinite(Date.parse(task.waitingSince)), task.waitingSince);

    for (let n = 0; n < 12; n += 1) await addLead("new", null, 210);
    const capped = await tasks(actors.admin);
    assert.equal(capped.length, 10);
    assert.deepEqual(sequence(capped.slice(0, 3)), ["conversation:C1", "lead:L1", "lead:L2"]);
    assert.ok(capped.slice(3).every((task) => task.kind === "lead"));
  });
});
