import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildAdminPageQuery } from "../neon/admin-pagination-query.ts";
import { encodeAdminCursor } from "../neon/admin-pagination.ts";

const actor = { staffId: "11111111-1111-4111-8111-111111111111", roles: ["agent"] };
const other = "22222222-2222-4222-8222-222222222222";
const conv = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
];
const inquiry = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function fixture(fn) {
  const db = new PGlite();
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    await db.exec(`
      CREATE TABLE staff_users(id uuid PRIMARY KEY,name_zh text,name_en text);
      CREATE TABLE crm_contacts(id uuid PRIMARY KEY,name text,phone text,opted_out_whatsapp boolean);
      CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,contact_id uuid,status text,
        assigned_agent_id uuid,last_message_at timestamptz,last_inbound_at timestamptz,
        created_at timestamptz,updated_at timestamptz);
      CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,conversation_id uuid,text text,
        direction text,created_at timestamptz);
      CREATE TABLE inquiries(id uuid PRIMARY KEY,conversation_id uuid,source text,status text,
        public_listing_no text,placement_source text,requested_staff_id uuid,
        enquiry_owner_staff_id uuid,first_human_response_at timestamptz,
        association_review boolean,provider_thread_review boolean,updated_at timestamptz);
      CREATE TABLE whatsapp_enquiry_reference_links(event_id uuid,ref_index int,conversation_id uuid,
        inquiry_id uuid,source text,external_listing_id text,created_at timestamptz);
      CREATE FUNCTION wa_can_read_conversation(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=$2 AND assigned_agent_id=$1) $$;
      CREATE FUNCTION wa_can_reply_enquiry(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT $2 IS NOT NULL $$;
      CREATE FUNCTION wa_can_correct_enquiry(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT false $$;
    `);
    await query("INSERT INTO staff_users VALUES($1,'鄧錦雄','Terence Tang')", [actor.staffId]);
    await query(
      "INSERT INTO crm_contacts VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','客戶甲','61234567',false)",
    );
    await query(
      `INSERT INTO whatsapp_conversations VALUES
      ($1,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','open',$4,'2026-09-30 10:00+08','2026-09-30 10:00+08','2026-01-01','2026-09-30'),
      ($2,NULL,'open',$4,NULL,NULL,'2026-09-29','2026-09-29'),
      ($3,NULL,'open',$5,'2026-10-01',NULL,'2026-09-28','2026-10-01')`,
      [...conv, actor.staffId, other],
    );
    await query(
      `INSERT INTO inquiries VALUES($1,$2,'whatsapp','new','A074714','28hse',$3,$3,NULL,false,false,'2026-09-30')`,
      [inquiry, conv[0], actor.staffId],
    );
    await query(
      `INSERT INTO whatsapp_messages VALUES
      ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',$1,'第一則舊訊息','inbound','2026-09-29'),
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,'最新跟進內容','inbound','2026-09-30')`,
      [conv[0]],
    );
    await query(
      `INSERT INTO whatsapp_enquiry_reference_links VALUES
      ('ffffffff-ffff-4fff-8fff-ffffffffffff',0,$1,$2,'28hse','4033349','2026-09-30')`,
      [conv[0], inquiry],
    );
    await fn(query);
  } finally {
    await db.close();
  }
}
const page = async (query, input) => {
  const built = buildAdminPageQuery({ resource: "conversations", ...input }, actor);
  return (await query(built.statement, built.params))[0];
};

test("activity order, exact count, authorized search and cursor are consistent", async () => {
  await fixture(async (query) => {
    const first = await page(query, { limit: 1 });
    assert.equal(first.total, 2);
    assert.equal(first.rows[0].id, conv[0]);
    assert.equal(first.rows[0].customer_display_name, "客戶甲");
    assert.equal(first.rows[0].public_listing_no, "A074714");
    assert.equal(first.rows[0].external_listing_id, "4033349");
    assert.equal(first.rows[0].requested_staff_name, "鄧錦雄");
    const token = encodeAdminCursor(
      { at: first.rows[0]._cursor_at, id: conv[0] },
      buildAdminPageQuery({ resource: "conversations", limit: 1 }, actor).binding,
    );
    const second = await page(query, { limit: 1, cursor: token });
    assert.deepEqual(
      second.rows.map((row) => row.id),
      [conv[1]],
    );
    // The fast unfiltered path must match the full filtered path, including
    // the exact authorized count, row details, cursor and private-row denial.
    for (const status of [undefined, "all", "open"]) {
      const filter = status ? { status } : {};
      const ownFirst = await page(query, { ...filter, limit: 1 });
      const ownCursor = encodeAdminCursor(
        { at: ownFirst.rows[0]._cursor_at, id: conv[0] },
        buildAdminPageQuery({ resource: "conversations", ...filter, limit: 1 }, actor).binding,
      );
      const ownSecond = await page(query, { ...filter, limit: 1, cursor: ownCursor });
      assert.deepEqual(ownFirst, first);
      assert.deepEqual(ownSecond, second);
    }
    for (const needle of ["4033349", "A074714", "第一則舊訊息", "客戶甲"]) {
      const match = await page(query, { q: needle });
      assert.equal(match.total, 1, needle);
      assert.deepEqual(
        match.rows.map((row) => row.id),
        [conv[0]],
        needle,
      );
    }
    assert.equal((await page(query, { q: "other secret" })).total, 0);
  });
});

test("attention and awaiting filters count only authorized rows, including unassigned triage", async () => {
  await fixture(async (query) => {
    assert.equal((await page(query, { status: "mine" })).total, 2);
    assert.equal((await page(query, { status: "unassigned" })).total, 0);
    assert.equal((await page(query, { status: "awaiting" })).total, 1);
    assert.equal((await page(query, { status: "attention" })).total, 1);
  });
});
