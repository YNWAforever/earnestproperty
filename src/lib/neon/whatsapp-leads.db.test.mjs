import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { assertDisposableNeonTestTarget } from "./disposable-test-target.mjs";
function splitSqlStatements(query) {
  const statements = [];
  let current = "",
    single = false,
    double = false,
    dollar = null;
  for (let index = 0; index < query.length; index += 1) {
    const char = query[index],
      next = query[index + 1];
    if (!single && !double && !dollar && char === "-" && next === "-") {
      const end = query.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (!double && !dollar && char === "'" && query[index - 1] !== "\\") single = !single;
    if (!single && !dollar && char === '"') double = !double;
    if (!single && !double && char === "$") {
      const match = query.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        dollar = dollar ? (dollar === tag ? null : dollar) : tag;
        current += tag;
        index += tag.length - 1;
        continue;
      }
    }
    if (!single && !double && !dollar && char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const file = "neon/migrations/20260906100000_whatsapp_inbound_leads.sql";
test(
  "WhatsApp inbound intake and history create factual leads once",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    await assertDisposableNeonTestTarget(process.env.ASTRA_TEST_DATABASE_URL);
    const db = neon(process.env.ASTRA_TEST_DATABASE_URL);
    const schema = "wa_leads_" + randomUUID().replaceAll("-", "");
    const run = async (statement, params = []) =>
      (
        await db.transaction((tx) => [
          tx.query("SELECT set_config('search_path',$1,true)", [schema + ",public"]),
          tx.query(statement, params),
        ])
      )[1];
    const migrate = async () => {
      if (existsSync(file))
        await db.transaction((tx) => [
          tx.query("SELECT set_config('search_path',$1,true)", [schema + ",public"]),
          ...splitSqlStatements(readFileSync(file, "utf8")).map((s) => tx.query(s)),
        ]);
    };
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      await run(`CREATE TABLE crm_contacts(id uuid PRIMARY KEY,assigned_agent_id uuid)`);
      await run(
        `CREATE TABLE crm_leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid REFERENCES crm_contacts(id),assigned_agent_id uuid,stage text DEFAULT 'new',intent text NOT NULL DEFAULT 'buyer',source text DEFAULT 'website',note text,budget_min numeric,property_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`,
      );
      await run(
        `CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid REFERENCES crm_contacts(id),direction text,message_type text,created_at timestamptz)`,
      );
      const ids = Array.from({ length: 5 }, () => randomUUID());
      for (const id of ids) await run("INSERT INTO crm_contacts(id) VALUES($1)", [id]);
      await run(
        `INSERT INTO crm_leads(contact_id,stage,intent,source) VALUES($1,'closed_won','seller','website')`,
        [ids[1]],
      );
      await run(
        `INSERT INTO whatsapp_messages(contact_id,direction,message_type,created_at) VALUES($1,'inbound','text','2026-08-01'),($1,'inbound','image','2026-08-02'),($2,'outbound','text','2026-08-01')`,
        [ids[0], ids[2]],
      );
      await migrate();
      const history = await run("SELECT * FROM crm_leads WHERE contact_id=$1", [ids[0]]);
      assert.equal(history.length, 1, "existing inbound messages must appear as a lead");
      assert.equal(history[0].intent, "unknown");
      assert.equal(history[0].source, "whatsapp");
      assert.equal(history[0].budget_min, null);
      assert.equal(history[0].property_id, null);
      assert.equal(new Date(history[0].created_at).toISOString(), "2026-08-01T00:00:00.000Z");
      await migrate();
      const atomicId = randomUUID();
      await run(
        `WITH c AS (INSERT INTO crm_contacts(id) VALUES($1) RETURNING id)
    INSERT INTO whatsapp_messages(contact_id,direction,message_type,created_at)
    SELECT id,'inbound','text',now() FROM c`,
        [atomicId],
      );
      assert.equal(
        (await run("SELECT * FROM crm_leads WHERE contact_id=$1", [atomicId])).length,
        1,
        "same-statement contact and message ingestion creates the lead atomically",
      );
      await Promise.all(
        [1, 2].map(() =>
          run(
            `INSERT INTO whatsapp_messages(contact_id,direction,message_type,created_at) VALUES($1,'inbound','text',now())`,
            [ids[3]],
          ),
        ),
      );
      assert.equal(
        (await run("SELECT * FROM crm_leads WHERE contact_id=$1", [ids[3]])).length,
        1,
        "concurrent messages cannot duplicate leads",
      );
      await run(
        `INSERT INTO whatsapp_messages(contact_id,direction,message_type,created_at) VALUES($1,'inbound','image',now()),($2,'outbound','text',now()),(NULL,'inbound','text',now())`,
        [ids[1], ids[2]],
      );
      const existing = await run("SELECT * FROM crm_leads WHERE contact_id=$1", [ids[1]]);
      assert.equal(existing.length, 1);
      assert.equal(existing[0].stage, "closed_won");
      assert.equal(existing[0].intent, "seller");
      assert.equal(
        (await run("SELECT * FROM crm_leads WHERE contact_id=$1", [ids[2]])).length,
        0,
        "outbound-only contacts are not enquiries",
      );
      assert.equal(
        (await run("SELECT * FROM crm_leads WHERE contact_id=$1", [ids[0]])).length,
        1,
        "backfill is repeatable",
      );
    } finally {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  },
);
