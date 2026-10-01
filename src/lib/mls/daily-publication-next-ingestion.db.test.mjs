import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
test(
  "next accepted ingestion preserves daily verified description",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    await assertDisposableNeonTestTarget(process.env.ASTRA_TEST_DATABASE_URL);
    const schema = "publication_next_" + randomUUID().replaceAll("-", "");
    const connectionString = process.env.ASTRA_TEST_DATABASE_URL;
    const c = new Client({ connectionString });
    await c.connect();
    const q = async (s, p = []) => (await c.query(s, p)).rows;
    const createClient = (config) => {
      const client = new Client(config);
      const connect = client.connect.bind(client);
      client.connect = async () => {
        await connect();
        await client.query(`SET search_path TO ${schema},public,pg_catalog`);
      };
      return client;
    };
    try {
      await q(`CREATE SCHEMA ${schema}`);
      await q(`SET search_path TO ${schema},public,pg_catalog`);
      await q(
        "CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS); ALTER TABLE properties ADD PRIMARY KEY(id); CREATE UNIQUE INDEX properties_listing_no_key ON properties(listing_no)",
      );
      await q(
        "CREATE TABLE media_assets(id uuid PRIMARY KEY); CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean); CREATE TABLE staff_roles(staff_user_id uuid,role text); CREATE TABLE audit_logs(actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
      );
      for (const name of [
        "20260817120000_dual_source_listing_sync.sql",
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
        "20260907120000_propertyhk_ingestion_v2.sql",
        "20260909120000_source_promotion_tiers.sql",
      ])
        await q(readFileSync("neon/migrations/" + name, "utf8"));
      await q(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'test','{"district_slugs":{"Test":"test"}}')`,
      );
      const options = { connectionString, apply: true, createClient };
      await ingestSnapshot(batch([row()]), options);
      const p = (await q("SELECT id FROM properties"))[0];
      assert.ok(p);
      await q("BEGIN");
      await q("SELECT set_config('app.admin_property_write','on',true)");
      await q("UPDATE properties SET description='Verified daily description' WHERE id=$1", [p.id]);
      await q(
        `INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,selection_reason,policy_version) SELECT property_id,'description','"Verified daily description"'::jsonb,observation_id,'operator_publication','daily-reviewed-publication-v1' FROM mls_source_state WHERE property_id=$1`,
        [p.id],
      );
      await q("COMMIT");
      await q("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours'");
      await ingestSnapshot(
        batch([row("123", { price: 5390000 })], "2026-09-07T01:00:00Z"),
        options,
      );
      const after = (await q("SELECT description,price FROM properties WHERE id=$1", [p.id]))[0];
      assert.equal(after.description, "Verified daily description");
      assert.equal(Number(after.price), 5390000);
    } finally {
      await q("ROLLBACK");
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    }
  },
);
