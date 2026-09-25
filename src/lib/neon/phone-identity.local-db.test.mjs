import assert from "node:assert/strict";
import pg from "pg";
import { test } from "bun:test";
import { campaignRecipientPrimarySql, marketingIdentitySafeSql } from "./phone-identity.ts";

const LOCAL_URL = "postgresql://postgres:local-audit-only@127.0.0.1:55432/postgres";
const enabled = process.env.LOCAL_POSTGRES_URL === LOCAL_URL;

(enabled ? test : test.skip)(
  "marketing gate blocks a canonical contact with a legacy opt-out",
  async () => {
    const admin = new pg.Pool({ connectionString: LOCAL_URL });
    const schema = `phone_gate_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: LOCAL_URL, options: `-c search_path=${schema}` });
    try {
      await pool.query(
        "CREATE TABLE crm_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), normalized_phone text UNIQUE, whatsapp_member_id text, opt_in_whatsapp boolean NOT NULL, opted_out_whatsapp boolean NOT NULL)",
      );
      await pool.query(
        "INSERT INTO crm_contacts(normalized_phone,opt_in_whatsapp,opted_out_whatsapp) VALUES ('69998888',false,true)",
      );
      const created = await pool.query(
        "INSERT INTO crm_contacts(normalized_phone,opt_in_whatsapp,opted_out_whatsapp) VALUES ('85269998888',true,false) RETURNING id",
      );
      const id = created.rows[0].id;
      const before = await pool.query(
        `SELECT ${marketingIdentitySafeSql("c")} AS safe FROM crm_contacts c WHERE c.id=$1`,
        [id],
      );
      assert.equal(before.rows[0].safe, false);
      await pool.query(
        "UPDATE crm_contacts SET opt_in_whatsapp=true,opted_out_whatsapp=false WHERE normalized_phone='69998888'",
      );
      const after = await pool.query(
        `SELECT ${marketingIdentitySafeSql("c")} AS safe FROM crm_contacts c WHERE c.id=$1`,
        [id],
      );
      assert.equal(after.rows[0].safe, true);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
(enabled ? test : test.skip)(
  "campaign gate selects one recipient for legacy and canonical aliases",
  async () => {
    const admin = new pg.Pool({ connectionString: LOCAL_URL });
    const schema = `phone_dedup_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: LOCAL_URL, options: `-c search_path=${schema}` });
    try {
      await pool.query(
        "CREATE TABLE crm_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), normalized_phone text UNIQUE, whatsapp_member_id text)",
      );
      await pool.query(
        "CREATE TABLE whatsapp_campaign_recipients (id uuid PRIMARY KEY, campaign_id uuid, contact_id uuid, status text, error text)",
      );
      const local = await pool.query(
        "INSERT INTO crm_contacts(normalized_phone) VALUES ('69998888') RETURNING id",
      );
      const canonical = await pool.query(
        "INSERT INTO crm_contacts(normalized_phone) VALUES ('85269998888') RETURNING id",
      );
      const campaignId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO whatsapp_campaign_recipients(id,campaign_id,contact_id,status) VALUES ($1,$2,$3,'queued'),($4,$2,$5,'queued')",
        [
          "00000000-0000-4000-8000-000000000001",
          campaignId,
          local.rows[0].id,
          "00000000-0000-4000-8000-000000000002",
          canonical.rows[0].id,
        ],
      );
      const result =
        await pool.query(`SELECT r.id, ${campaignRecipientPrimarySql("r", "c")} AS primary
      FROM whatsapp_campaign_recipients r JOIN crm_contacts c ON c.id=r.contact_id
      ORDER BY r.id`);
      assert.deepEqual(
        result.rows.map((row) => row.primary),
        [true, false],
      );
      await pool.query(
        "UPDATE whatsapp_campaign_recipients SET status='sent' WHERE id='00000000-0000-4000-8000-000000000002'",
      );
      const afterSent = await pool.query(`SELECT ${campaignRecipientPrimarySql("r", "c")} AS primary
      FROM whatsapp_campaign_recipients r JOIN crm_contacts c ON c.id=r.contact_id
      WHERE r.id='00000000-0000-4000-8000-000000000001'`);
      assert.equal(afterSent.rows[0].primary, false);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
