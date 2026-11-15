import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dbTargetOrOwned } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { applyMigrations, isolatedDatabase } from "../../../scripts/acceptance/migrated-schema.mjs";
import { MIGRATION_VERSIONS } from "../control-plane/migration-versions.js";
import { persistWebsiteInquiry } from "./website-inquiry.js";

// Use the complete real schema so mandatory intake columns, functions, constraints and triggers
// reach this fixture automatically. An owned target uses a fresh database; an explicit disposable
// TEST_DATABASE_URL retains its existing confirmation guard and gets a unique isolated schema.
async function withMigratedWebsiteFixture(prefix, run) {
  await dbTargetOrOwned(async (target) => {
    if (!target.owned) {
      assert.equal(process.env.CRM_TEST_DATABASE_CONFIRMED, "true");
      assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
      assert.notEqual(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL_UNPOOLED);
    }
    const { sql, end } = await isolatedDatabase(target);
    const schema = prefix + "_" + randomUUID().replaceAll("-", "");
    const query = async (statement, params = []) =>
      (
        await sql.transaction((q) => [
          q.query("SELECT set_config('search_path',$1,true)", [schema]),
          q.query(statement, params),
        ])
      )[1];
    try {
      await sql.query(`CREATE SCHEMA ${schema}`);
      await applyMigrations(sql, schema, MIGRATION_VERSIONS);
      await run(query);
    } finally {
      try {
        await sql.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await end();
      }
    }
  });
}

test("concurrent public retry creates one linked contact, lead and inquiry", async () => {
  await withMigratedWebsiteFixture("astra_intake", async (query) => {
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
    for (const table of ["crm_contacts", "crm_leads", "inquiries", "website_inquiry_submissions"]) {
      assert.equal(Number((await query("SELECT count(*) AS n FROM " + table))[0].n), 1);
    }
    const [row] = await query(
      "SELECT i.crm_lead_id, l.id, l.enquiry_routing_context FROM inquiries i JOIN crm_leads l ON l.id=i.crm_lead_id",
    );
    assert.equal(row.crm_lead_id, row.id);
    assert.equal(row.enquiry_routing_context.kind, "general");
    await assert.rejects(
      persistWebsiteInquiry(query, { ...input, message: "Different" }),
      (error) => error.code === "INQUIRY_SUBMISSION_CONFLICT",
    );
    assert.equal(Number((await query("SELECT count(*) AS n FROM inquiries"))[0].n), 1);
  });
});

test("a listing enquiry routes to the correspondent agent the visitor picked", async () => {
  await withMigratedWebsiteFixture("astra_agents", async (query) => {
    const propertyId = randomUUID();
    const listingAgent = randomUUID();
    const correspondent = randomUUID();
    const outsider = randomUUID();
    for (const id of [listingAgent, correspondent, outsider]) {
      await query(
        "INSERT INTO staff_users (id, name_zh, active, show_on_website) VALUES ($1,'Synthetic agent',true,true)",
        [id],
      );
    }
    await query(
      "INSERT INTO properties (id, agent_id, deal_type, status, listing_no, title_zh, district_slug) VALUES ($1,$2,'sale','active','A700001','Synthetic listing','sham-tseng')",
      [propertyId, listingAgent],
    );
    await query(
      "INSERT INTO property_agents (property_id, position, staff_id, source) VALUES ($1,1,$2,'owned-website-fixture')",
      [propertyId, correspondent],
    );
    const base = {
      name: "Synthetic",
      phone: "85261110000",
      normalizedPhone: "85261110000",
      email: null,
      message: "Synthetic",
      consentWhatsapp: false,
      propertyId,
    };

    // The visitor's chosen correspondent agent gets the lead and its notification context.
    const selected = await persistWebsiteInquiry(query, {
      ...base,
      submissionId: randomUUID(),
      agentId: correspondent,
    });
    const [chosen] = await query(
      "SELECT l.assigned_agent_id,l.enquiry_routing_context FROM crm_leads l JOIN inquiries i ON i.crm_lead_id=l.id WHERE i.id=$1",
      [selected.id],
    );
    assert.equal(chosen.assigned_agent_id, correspondent);
    assert.equal(chosen.enquiry_routing_context.kind, "property");
    assert.equal(chosen.enquiry_routing_context.selectedAgentId, correspondent);

    // A staff member who is not a correspondent agent of this listing is ignored.
    await persistWebsiteInquiry(query, {
      ...base,
      submissionId: randomUUID(),
      phone: "85262220000",
      normalizedPhone: "85262220000",
      agentId: outsider,
    });
    const leads = await query("SELECT assigned_agent_id FROM crm_leads ORDER BY assigned_agent_id");
    assert.deepEqual(
      leads.map((row) => row.assigned_agent_id).sort(),
      [listingAgent, correspondent].sort(),
    );
  });
});
