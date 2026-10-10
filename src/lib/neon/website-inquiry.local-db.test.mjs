import assert from "node:assert/strict";
import pg from "pg";
import { test } from "bun:test";
import { persistWebsiteInquiry } from "./website-inquiry.js";

const LOCAL_URL = "postgresql://postgres:local-audit-only@127.0.0.1:55432/postgres";
const enabled = process.env.LOCAL_POSTGRES_URL === LOCAL_URL;

(enabled ? test : test.skip)(
  "website inquiry reuses a legacy HK phone without changing consent",
  async () => {
    const admin = new pg.Pool({ connectionString: LOCAL_URL });
    const schema = `website_phone_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({ connectionString: LOCAL_URL, options: `-c search_path=${schema}` });
    const query = async (statement, params = []) => (await pool.query(statement, params)).rows;
    try {
      for (const ddl of [
        "CREATE TABLE staff_users (id uuid PRIMARY KEY, active boolean)",
        "CREATE TABLE properties (id uuid PRIMARY KEY, agent_id uuid, deal_type text, status text, listing_no text)",
        "CREATE TABLE crm_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text, normalized_phone text UNIQUE, email text, source text, opt_in_whatsapp boolean DEFAULT false, opted_out_whatsapp boolean DEFAULT false, updated_at timestamptz DEFAULT now())",
        "CREATE TABLE crm_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, property_id uuid, assigned_agent_id uuid, stage text, intent text, source text, note text)",
        "CREATE TABLE inquiries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), crm_lead_id uuid, marketing_consent_requested boolean, consent_copy_version text, source text, property_id uuid, intent text, name text, phone text, email text, message text, assigned_agent_id uuid, crm_contact_id uuid, public_listing_no text)",
        "CREATE TABLE website_inquiry_submissions (submission_id uuid PRIMARY KEY, payload_hash text, inquiry_id uuid DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now())",
      ])
        await pool.query(ddl);
      const [legacy] = await query(
        "INSERT INTO crm_contacts(name, phone, normalized_phone, source, opt_in_whatsapp, opted_out_whatsapp) VALUES ('Existing', '6999 8888', '69998888', 'whatsapp', false, true) RETURNING id",
      );
      const input = {
        submissionId: crypto.randomUUID(),
        name: "Visitor",
        phone: "+852 6999 8888",
        normalizedPhone: "85269998888",
        email: "visitor@example.test",
        message: "Viewing",
        consentWhatsapp: true,
      };
      const first = await persistWebsiteInquiry(query, input);
      const replay = await persistWebsiteInquiry(query, input);
      assert.equal(replay.id, first.id);
      const [state] = await query(
        "SELECT count(*)::int AS total, count(*) FILTER (WHERE id=$1)::int AS legacy_count FROM crm_contacts",
        [legacy.id],
      );
      const [linked] = await query("SELECT crm_contact_id FROM inquiries LIMIT 1");
      const [contact] = await query(
        "SELECT name, opt_in_whatsapp, opted_out_whatsapp FROM crm_contacts WHERE id=$1",
        [legacy.id],
      );
      assert.equal(state.total, 1);
      assert.equal(state.legacy_count, 1);
      assert.equal(linked.crm_contact_id, legacy.id);
      assert.equal((await query("SELECT count(*)::int AS count FROM inquiries"))[0].count, 1);
      assert.deepEqual(contact, {
        name: "Existing",
        opt_in_whatsapp: false,
        opted_out_whatsapp: true,
      });
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
