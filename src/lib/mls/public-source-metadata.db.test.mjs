import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { readPublicSourceMetadata } from "./public-source-metadata.mjs";
const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "public group metadata requires current contact provenance on real SQL",
  { skip: !url },
  async () => {
    assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
    assert.notEqual(url, process.env.DATABASE_URL_UNPOOLED);
    const client = new Client({ connectionString: url });
    client.neonConfig.webSocketConstructor = globalThis.WebSocket;
    const schema = "source_meta_" + randomUUID().replaceAll("-", "");
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema},pg_catalog`);
      await client.query(`CREATE TABLE property_public_members(property_id text,public_listing_no text);
 CREATE TABLE listing_source_observations(id text,payload jsonb);
 CREATE TABLE mls_source_state(source text,scope_id text,policy_version text,external_listing_id text,deal_type text,property_id text,observation_id text,source_status text,last_accepted_at timestamptz);
 CREATE TABLE mls_source_contacts(source text,external_listing_id text,deal_type text,observation_id text,contact jsonb);
 CREATE TABLE mls_ingestion_policies(source text,scope_id text,policy_version text,config jsonb);`);
      await client.query(`INSERT INTO property_public_members VALUES('representative','public-id'),('other-offering','public-id');
 INSERT INTO listing_source_observations VALUES('current','{"holdProjection":false}');
 INSERT INTO mls_source_state VALUES('28hse_agent_540','agent:540','no-hermes-v2','123','sale','other-offering','current','active','2026-09-07T12:00:00.123456Z');
 INSERT INTO mls_source_contacts VALUES('28hse_agent_540','123','sale','old','{"name":"Old","phone":"12345678"}');
 INSERT INTO mls_ingestion_policies VALUES('28hse_agent_540','agent:540','no-hermes-v2','{"public_contacts_enabled":true}');`);
      const query = async (statement, params) => (await client.query(statement, params)).rows;
      const read = () =>
        readPublicSourceMetadata(query, "representative", { now: "2026-09-07T13:00:00Z" });
      let result = await read();
      assert.equal(result.source_contact, null);
      assert.equal(result.source_freshness.length, 1);
      assert.equal(result.source_freshness[0].observed_at, "2026-09-07T12:00:00.123456Z");
      await client.query(
        `UPDATE mls_source_contacts SET observation_id='current',contact='{"name":"Current","phone":"87654321"}'`,
      );
      result = await read();
      assert.equal(result.source_contact.contact.name, "Current");
      assert.equal(result.source_contact.observationId, "current");
      await client.query(
        `UPDATE listing_source_observations SET payload='{"holdProjection":true}'`,
      );
      assert.equal((await read()).source_contact, null);
      await client.query(`UPDATE mls_ingestion_policies SET config='{}'`);
      assert.equal((await read()).source_contact, null);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    }
  },
);
