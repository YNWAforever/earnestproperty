import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@neondatabase/serverless";
const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "v2 database guards preserve aliases, overrides, old history and reject sequential legacy writes",
  { skip: !url },
  async () => {
    await assertDisposableNeonTestTarget(process.env.ASTRA_TEST_DATABASE_URL);
    assert.notEqual(
      url,
      process.env.DATABASE_URL_UNPOOLED,
      "must use the approved disposable target",
    );
    const c = new Client({ connectionString: url });
    c.neonConfig.webSocketConstructor = globalThis.WebSocket;
    const schema = "ingestion_" + randomUUID().replaceAll("-", "");
    await c.connect();
    try {
      await c.query(`CREATE SCHEMA ${schema}`);
      await c.query(`SET search_path TO ${schema},public,pg_catalog`);
      await c.query(
        "CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS); ALTER TABLE properties ADD PRIMARY KEY(id); CREATE UNIQUE INDEX properties_listing_no_key ON properties(listing_no)",
      );
      await c.query(
        "CREATE TABLE media_assets(id uuid PRIMARY KEY); CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean); CREATE TABLE staff_roles(staff_user_id uuid,role text); CREATE TABLE audit_logs(actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
      );
      for (const name of [
        "20260817120000_dual_source_listing_sync.sql",
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
        "20260907120000_propertyhk_ingestion_v2.sql",
      ]) {
        await c.query("BEGIN");
        try {
          await c.query(readFileSync("neon/migrations/" + name, "utf8"));
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      }
      const insert = async (no, owner = "legacy") =>
        (
          await c.query(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,price,ingestion_owner,ingestion_identity_policy) VALUES($1,'AGENCY1','Original','sale','test',500,$2,$2) RETURNING id",
            [no, owner],
          )
        ).rows[0].id;
      const original = await insert("legacy-original");
      await c.query(
        "INSERT INTO admin_property_overrides(property_no,shared) VALUES('AGENCY1','{\"title_zh\":\"Human title\"}')",
      );
      await c.query("SELECT set_config('app.mls_writer_policy','no-hermes-v2',false)");
      const separate = await insert("SYNC-FIXTURE", "no-hermes-v2");
      assert.equal(
        (
          await c.query(
            "SELECT public_listing_no FROM property_public_members WHERE property_id=$1",
            [separate],
          )
        ).rows[0].public_listing_no,
        "SYNC-FIXTURE",
      );
      assert.equal(
        (await c.query("SELECT title_zh FROM properties WHERE id=$1", [separate])).rows[0].title_zh,
        "Original",
      );
      await c.query(
        "UPDATE properties SET ingestion_owner='no-hermes-v2',ingestion_identity_policy='no-hermes-v2' WHERE id=$1",
        [original],
      );
      await c.query(
        "UPDATE properties SET canonical_property_no='CORRECTED',floor='12' WHERE id=$1",
        [original],
      );
      assert.equal(
        (
          await c.query(
            "SELECT public_listing_no FROM property_public_members WHERE property_id=$1",
            [original],
          )
        ).rows[0].public_listing_no,
        "AGENCY1",
      );
      assert.equal(
        (await c.query("SELECT title_zh FROM properties WHERE id=$1", [original])).rows[0].title_zh,
        "Human title",
      );
      await c.query("SELECT set_config('app.mls_writer_policy','',false)");
      await assert.rejects(
        c.query("UPDATE properties SET price=1 WHERE id=$1", [original]),
        /OWNERSHIP_CONFLICT/,
      );
      await assert.rejects(
        c.query("DELETE FROM properties WHERE id=$1", [original]),
        /OWNERSHIP_CONFLICT/,
      );
      await c.query("SELECT set_config('app.admin_property_write','on',false)");
      await c.query("UPDATE properties SET price=750 WHERE id=$1", [original]);
      assert.equal(
        (await c.query("SELECT price FROM properties WHERE id=$1", [original])).rows[0].price,
        "750",
      );
      // Deferred integrity is tested at COMMIT, including final receipt placeholders.
      const run = (
        await c.query(
          "INSERT INTO listing_sync_runs(scheduled_for,mode,status,parser_version) VALUES('2026-09-07','publish','running','parser1') RETURNING id",
        )
      ).rows[0].id;
      await c.query(
        "INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version) VALUES('28hse_agent_540','agent:540','v1','parser1'),('propertyhk','branches:EPW,EPS,EPT','v1','parser1')",
      );
      const receipt = async (source, scope, second, full = true, parser = "parser1") =>
        (
          await c.query(
            "INSERT INTO mls_ingestion_receipts(source,scope_id,policy_version,parser_version,scraped_at,payload_hash,run_id,response,full_snapshot) VALUES($1,$2,'v1',$3,$4,repeat('a',64),$5,'{\"summary\":{\"advertisement_count\":7}}',$6) RETURNING id",
            [source, scope, parser, `2026-09-07T01:00:${second}.000000Z`, run, full],
          )
        ).rows[0].id;
      const observation = async (source, external) =>
        (
          await c.query(
            "INSERT INTO listing_source_observations(run_id,source,external_listing_id,deal_type,source_url,payload,content_hash,validation_state,discovered_at,fetched_at) VALUES($1,$2,$3,'sale','https://example.com','{}',repeat('a',64),'valid',now(),now()) RETURNING id",
            [run, source, external],
          )
        ).rows[0].id;
      const a = await receipt("28hse_agent_540", "agent:540", "01");
      const b = await receipt("propertyhk", "branches:EPW,EPS,EPT", "02");
      const partial = await receipt("28hse_agent_540", "agent:540", "03", false);
      const oa = await observation("28hse_agent_540", "123");
      const ob = await observation("propertyhk", "other");
      const failsCommit = async (work, message) => {
        await c.query("BEGIN");
        try {
          await work();
          await assert.rejects(
            c.query("COMMIT"),
            /foreign key|MLS_INGESTION_BASELINE_CONFLICT/,
            message,
          );
        } finally {
          await c.query("ROLLBACK");
        }
      };
      await failsCommit(
        () => receipt("28hse_agent_540", "agent:540", "04", true, "wrong"),
        "receipt parser must match policy",
      );
      await failsCommit(
        () =>
          c.query(
            "INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,full_receipt_id,full_count) VALUES('28hse_agent_540','agent:540','v1',$1,7)",
            [b],
          ),
        "baseline must belong to same scope",
      );
      await failsCommit(
        () =>
          c.query(
            "INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,full_receipt_id,full_count) VALUES('28hse_agent_540','agent:540','v1',$1,7)",
            [partial],
          ),
        "partial receipt cannot establish full baseline",
      );
      await failsCommit(
        () =>
          c.query(
            "INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,full_receipt_id,full_count) VALUES('28hse_agent_540','agent:540','v1',$1,8)",
            [a],
          ),
        "baseline count must match receipt evidence",
      );
      const state = (obs, rec) =>
        c.query(
          "INSERT INTO mls_source_state(source,external_listing_id,deal_type,scope_id,policy_version,observation_id,last_receipt_id,source_status,first_seen_at,last_accepted_at) VALUES('28hse_agent_540','123','sale','agent:540','v1',$1,$2,'active',now(),now())",
          [obs, rec],
        );
      await failsCommit(() => state(ob, a), "source state observation identity must match");
      await failsCommit(() => state(oa, b), "source state receipt scope must match");
      await state(oa, a);
      await failsCommit(
        () =>
          c.query(
            "INSERT INTO mls_source_contacts(source,external_listing_id,deal_type,observation_id) VALUES('28hse_agent_540','123','sale',$1)",
            [ob],
          ),
        "contact observation identity must match",
      );
      await failsCommit(
        () =>
          c.query(
            "UPDATE mls_ingestion_policies SET parser_version='parser2' WHERE source='28hse_agent_540'",
          ),
        "policy parser cannot invalidate accepted receipts",
      );
      await c.query("BEGIN");
      const placeholder = await receipt("28hse_agent_540", "agent:540", "05");
      await c.query("UPDATE mls_ingestion_receipts SET response='{}' WHERE id=$1", [placeholder]);
      await c.query(
        "INSERT INTO mls_ingestion_scopes(source,scope_id,policy_version,full_receipt_id,full_count) VALUES('28hse_agent_540','agent:540','v1',$1,9)",
        [placeholder],
      );
      await c.query(
        'UPDATE mls_ingestion_receipts SET response=\'{"summary":{"advertisement_count":9}}\' WHERE id=$1',
        [placeholder],
      );
      await c.query("COMMIT");
      await failsCommit(
        () =>
          c.query(
            'UPDATE mls_ingestion_receipts SET response=\'{"summary":{"advertisement_count":10}}\' WHERE id=$1',
            [placeholder],
          ),
        "receipt mutation cannot invalidate stored baseline",
      );
    } finally {
      await c.query("RESET search_path");
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    }
  },
);
