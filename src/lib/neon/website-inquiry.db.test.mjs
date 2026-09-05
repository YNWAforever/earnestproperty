import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { persistWebsiteInquiry } from "./website-inquiry.js";

const enabled = Boolean(
  process.env.TEST_DATABASE_URL && process.env.CRM_TEST_DATABASE_CONFIRMED === "true",
);
test(
  "concurrent public retry creates one linked contact, lead and inquiry",
  { skip: !enabled },
  async () => {
    assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
    assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
    const sql = neon(process.env.TEST_DATABASE_URL);
    const schema = "astra_intake_" + randomUUID().replaceAll("-", "");
    const tables =
      /\b(website_inquiry_submissions|properties|staff_users|crm_contacts|crm_leads|inquiries)\b/g;
    const query = (text, params = []) =>
      sql.query(text.replace(tables, '"' + schema + '".$1'), params);
    await sql.query('CREATE SCHEMA "' + schema + '"');
    try {
      for (const statement of [
        "CREATE TABLE staff_users (id uuid PRIMARY KEY, active boolean)",
        "CREATE TABLE properties (id uuid PRIMARY KEY, agent_id uuid, deal_type text, status text, listing_no text)",
        "CREATE TABLE crm_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, phone text, normalized_phone text UNIQUE, email text, source text, opt_in_whatsapp boolean DEFAULT false, updated_at timestamptz DEFAULT now())",
        "CREATE TABLE crm_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid, property_id uuid, assigned_agent_id uuid, stage text, intent text, source text, note text)",
        "CREATE TABLE inquiries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), crm_lead_id uuid, marketing_consent_requested boolean, consent_copy_version text, source text, property_id uuid, intent text, name text, phone text, email text, message text, assigned_agent_id uuid, crm_contact_id uuid)",
        "CREATE TABLE website_inquiry_submissions (submission_id uuid PRIMARY KEY, payload_hash text, inquiry_id uuid DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now())",
      ])
        await query(statement);
      const input = {
        submissionId: randomUUID(),
        name: "Synthetic",
        phone: "85260000000",
        normalizedPhone: "85260000000",
        email: null,
        message: "Synthetic",
        consentWhatsapp: true,
      };
      const [first, second] = await Promise.all([
        persistWebsiteInquiry(query, input),
        persistWebsiteInquiry(query, input),
      ]);
      assert.equal(first.id, second.id);
      for (const table of ["crm_contacts", "crm_leads", "inquiries"]) {
        assert.equal(Number((await query("SELECT count(*) AS n FROM " + table))[0].n), 1);
      }
      const [row] = await query(
        "SELECT i.crm_lead_id, l.id FROM inquiries i JOIN crm_leads l ON l.id=i.crm_lead_id",
      );
      assert.equal(row.crm_lead_id, row.id);
      await assert.rejects(
        persistWebsiteInquiry(query, { ...input, message: "Different" }),
        (error) => error.code === "INQUIRY_SUBMISSION_CONFLICT",
      );
      assert.equal(Number((await query("SELECT count(*) AS n FROM inquiries"))[0].n), 1);
    } finally {
      await sql.query('DROP SCHEMA "' + schema + '" CASCADE');
    }
  },
);
