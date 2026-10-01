import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { updateLeadContact } from "./forwarded-enquiries.server.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture() {
  const db = new PGlite();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  await db.exec(`
    CREATE TABLE staff_users(id uuid PRIMARY KEY, active boolean, branch_id uuid,name_zh text,name_en text,email text);
    CREATE TABLE staff_roles(staff_user_id uuid,role text);
    CREATE TABLE crm_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,email text,phone text,opt_in_whatsapp boolean DEFAULT false,last_inbound_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE crm_leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,assigned_agent_id uuid,stage text DEFAULT 'new',intent text DEFAULT 'buyer',source text,note text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE crm_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,contact_id uuid,staff_user_id uuid,activity_type text,body text,due_at timestamptz,completed_at timestamptz,created_at timestamptz DEFAULT now());
  `);
  await db.exec(
    readFileSync(
      new URL(
        "../../../neon/migrations/20260929107000_whatsapp_forwarded_enquiries.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await q(
    "INSERT INTO staff_users VALUES($1,true,NULL,'合成甲',NULL,NULL),($2,true,NULL,'合成乙',NULL,NULL)",
    [id(1), id(2)],
  );
  await q("INSERT INTO staff_roles VALUES($1,'agent'),($2,'agent')", [id(1), id(2)]);
  await q(
    "INSERT INTO crm_contacts(id,name,email,phone,opt_in_whatsapp,last_inbound_at) VALUES($1,'原姓名','old@synthetic.invalid','transport-phone',true,'2026-09-30T00:00:00Z')",
    [id(10)],
  );
  await q(
    "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,source) VALUES($1,$2,$3,'whatsapp')",
    [id(20), id(10), id(1)],
  );
  return { db, q };
}
const input = () => ({
  leadId: id(20),
  name: "核實姓名",
  email: "new@synthetic.invalid",
  expectedContactId: id(10),
  expectedName: "原姓名",
  expectedEmail: "old@synthetic.invalid",
});
const status = (code) => (error) => error instanceof Response && error.status === code;

test("contact snapshot rejects stale values but an identical retry has one audit and no transport change", async () => {
  const { db, q } = await fixture();
  try {
    const saved = await updateLeadContact(input(), { staffId: id(1) }, q);
    assert.equal(saved.contactId, id(10));
    await updateLeadContact(input(), { staffId: id(1) }, q);
    assert.equal(
      (await q("SELECT count(*)::int AS n FROM audit_logs WHERE action='lead.contact.update'"))[0]
        .n,
      1,
    );
    const row = (
      await q(
        "SELECT name,email,phone,opt_in_whatsapp,last_inbound_at FROM crm_contacts WHERE id=$1",
        [id(10)],
      )
    )[0];
    assert.equal(row.name, "核實姓名");
    assert.equal(row.phone, "transport-phone");
    assert.equal(row.opt_in_whatsapp, true);
    assert.equal(new Date(row.last_inbound_at).toISOString(), "2026-09-30T00:00:00.000Z");
    await assert.rejects(
      updateLeadContact({ ...input(), name: "過期修改" }, { staffId: id(1) }, q),
      status(409),
    );
    assert.equal(
      (await q("SELECT name FROM crm_contacts WHERE id=$1", [id(10)]))[0].name,
      "核實姓名",
    );
    assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs"))[0].n, 1);
  } finally {
    await db.close();
  }
});
test("contact snapshot rechecks current actor, shared contact scope and contact pointer", async () => {
  const { db, q } = await fixture();
  try {
    await assert.rejects(updateLeadContact(input(), { staffId: id(2) }, q), status(403));
    await q(
      "INSERT INTO crm_leads(id,contact_id,assigned_agent_id,source) VALUES($1,$2,$3,'whatsapp')",
      [id(21), id(10), id(2)],
    );
    await assert.rejects(updateLeadContact(input(), { staffId: id(1) }, q), status(403));
    await q("DELETE FROM crm_leads WHERE id=$1", [id(21)]);
    await q("INSERT INTO crm_contacts(id,name,email) VALUES($1,'原姓名','old@synthetic.invalid')", [
      id(11),
    ]);
    await q("UPDATE crm_leads SET contact_id=$1 WHERE id=$2", [id(11), id(20)]);
    await assert.rejects(updateLeadContact(input(), { staffId: id(1) }, q), status(409));
    await q("UPDATE staff_users SET active=false WHERE id=$1", [id(1)]);
    await assert.rejects(updateLeadContact(input(), { staffId: id(1) }, q), status(403));
    assert.equal((await q("SELECT count(*)::int AS n FROM audit_logs"))[0].n, 0);
  } finally {
    await db.close();
  }
});
test("contact update requires a valid snapshot before any query", async () => {
  let queries = 0;
  const noQuery = async () => {
    queries++;
    throw Error("Unexpected SQL");
  };
  for (const invalid of [
    { ...input(), expectedContactId: undefined },
    { ...input(), expectedName: undefined },
    { ...input(), expectedEmail: undefined },
    { ...input(), email: "bad" },
  ])
    await assert.rejects(updateLeadContact(invalid, { staffId: id(1) }, noQuery), status(400));
  assert.equal(queries, 0);
});
