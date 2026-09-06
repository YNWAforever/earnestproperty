import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@neondatabase/serverless";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot as ingestService } from "./ingestion-service.mjs";
const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "daily difference and source lifecycle on approved disposable isolated schema",
  { skip: !url },
  async (t) => {
    assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
    assert.notEqual(url, process.env.DATABASE_URL_UNPOOLED);
    const schema = "daily_" + randomUUID().replaceAll("-", "");
    const c = new Client({ connectionString: url });
    c.neonConfig.webSocketConstructor = globalThis.WebSocket;
    await c.connect();
    const createClient = (config) => {
      const client = new Client(config);
      const connect = client.connect.bind(client);
      client.connect = async () => {
        await connect();
        await client.query(`SET search_path TO ${schema},public,pg_catalog`);
      };
      return client;
    };
    const options = { connectionString: url, apply: true, createClient };
    const q = async (sql, args = []) => (await c.query(sql, args)).rows;
    // Simulate an hourly cadence without changing source scraped_at chronology.
    const ingestSnapshot = async (payload, opts) => {
      await q(
        "UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours' WHERE full_snapshot",
      );
      return ingestService(payload, opts);
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
      ]) {
        await q("BEGIN");
        await q(readFileSync("neon/migrations/" + name, "utf8"));
        await q("COMMIT");
      }
      await q(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,id_scope,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'test',null,'{"absence_enabled":true,"district_slugs":{"Test":"test"}}'),('propertyhk','branches:EPW,EPS,EPT','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'test','global','{"district_slugs":{"Test":"test"},"source_url_identity":{"verified":true,"path_template":"/fixture/{branch}/{id}"}}')`,
      );

      await t.test(
        "identical next-day snapshot executes no canonical UPDATE and changed rows count actual fields",
        async () => {
          const rows = [row("801"), row("802", { unit: "02" })];
          const first = await ingestSnapshot(batch(rows), options);
          assert.equal(first.summary.properties_created, 2);
          await q("CREATE TABLE canonical_updates(property_id uuid)");
          await q(
            "CREATE FUNCTION count_canonical_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO canonical_updates VALUES(NEW.id); RETURN NEW; END $$",
          );
          await q(
            "CREATE TRIGGER count_canonical_update AFTER UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION count_canonical_update()",
          );
          const before = await q("SELECT id,updated_at FROM properties ORDER BY id");
          const unchanged = await ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), options);
          assert.deepEqual(await q("SELECT id,updated_at FROM properties ORDER BY id"), before);
          assert.equal((await q("SELECT * FROM canonical_updates")).length, 0);
          assert.deepEqual(
            Object.fromEntries(
              [
                "properties_created",
                "properties_changed",
                "fields_changed",
                "unchanged_properties",
              ].map((k) => [k, unchanged.summary[k]]),
            ),
            {
              properties_created: 0,
              properties_changed: 0,
              fields_changed: 0,
              unchanged_properties: 2,
            },
          );
          assert.equal(
            (
              await q(
                "SELECT e.* FROM listing_change_events e JOIN mls_ingestion_receipts r ON r.run_id=e.run_id WHERE r.id=$1",
                [unchanged.receipt_id],
              )
            ).length,
            0,
          );
          rows[0].price = 5200000;
          const changed = await ingestSnapshot(batch(rows, "2026-09-09T00:00:00Z"), options);
          assert.equal(changed.summary.properties_created, 0);
          assert.equal(changed.summary.properties_changed, 1);
          assert.equal(changed.summary.fields_changed, 1);
          assert.equal(changed.summary.unchanged_properties, 1);
          assert.equal((await q("SELECT * FROM canonical_updates")).length, 1);
          const events = await q(
            "SELECT e.* FROM listing_change_events e JOIN mls_ingestion_receipts r ON r.run_id=e.run_id WHERE r.id=$1",
            [changed.receipt_id],
          );
          assert.equal(events.length, 1);
          assert.equal(events[0].field_name, "price");
          assert.deepEqual(
            (
              await q("SELECT response FROM mls_ingestion_receipts WHERE id=$1", [
                changed.receipt_id,
              ])
            )[0].response,
            changed,
          );
          await q("DROP TRIGGER count_canonical_update ON properties");
        },
      );
      await t.test(
        "explicit sold and rented deactivate owned status while preserving manual status and source identity",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          const rows = [
            row("811"),
            row("812", {
              unit: "02",
              deal_type: "rent",
              source_url: "https://www.28hse.com/rent/example/property-812",
              price: null,
              rent: 18000,
            }),
            row("813", { unit: "03" }),
          ];
          await ingestSnapshot(batch(rows), options);
          await q("BEGIN");
          await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
          await q("UPDATE properties SET status='active'");
          await q("COMMIT");
          await q(
            "INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,policy_version) SELECT property_id,'status','\"active\"',observation_id,'no-hermes-v2' FROM mls_source_state",
          );
          await q(
            "UPDATE property_sync_fields SET active_override=true WHERE field_name='status' AND property_id=(SELECT property_id FROM mls_source_state WHERE external_listing_id='813')",
          );
          const ids = await q(
            "SELECT external_listing_id,property_id FROM mls_source_state ORDER BY external_listing_id",
          );
          for (const r of rows) {
            r.source_status = "delisted";
            r.source_status_reason = r.deal_type === "rent" ? "rented" : "sold";
          }
          const terminal = await ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), options);
          assert.equal(terminal.summary.properties_changed, 2);
          const result = await q(
            "SELECT s.external_listing_id,s.source_status,p.status,ps.inactive_reason FROM mls_source_state s JOIN properties p ON p.id=s.property_id LEFT JOIN property_sync_state ps ON ps.property_id=p.id ORDER BY s.external_listing_id",
          );
          assert.deepEqual(
            result.map((r) => [r.source_status, r.status, r.inactive_reason]),
            [
              ["delisted", "inactive", "explicit_source_sold"],
              ["delisted", "inactive", "explicit_source_rented"],
              ["delisted", "active", null],
            ],
          );
          assert.deepEqual(
            await q(
              "SELECT external_listing_id,property_id FROM mls_source_state ORDER BY external_listing_id",
            ),
            ids,
          );
          assert.equal(
            (
              await q(
                "SELECT payload FROM listing_source_observations WHERE run_id=(SELECT run_id FROM mls_ingestion_receipts WHERE id=$1) AND external_listing_id='812'",
                [terminal.receipt_id],
              )
            )[0].payload.sourceStatusReason,
            "rented",
          );
          const hk = row("h811", {
            branch_code: "EPW",
            source_url: "https://www.property.hk/fixture/EPW/h811",
          });
          await ingestSnapshot(batch([hk], "2026-09-09T00:00:00Z", "propertyhk"), options);
          assert.equal(
            (
              await q(
                "SELECT p.status FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='811'",
              )
            )[0].status,
            "inactive",
          );
        },
      );
      await t.test(
        "accepted absence and explicit terminal keep distinct reasons in one atomic receipt",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          const rows = [
            row("831"),
            row("832", { unit: "02" }),
            row("833", { unit: "03" }),
            row("834", { unit: "04" }),
          ];
          await ingestSnapshot(batch(rows), options);
          await q("BEGIN");
          await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
          await q("UPDATE properties SET status='active'");
          await q("COMMIT");
          await q(
            "INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,policy_version) SELECT property_id,'status','\"active\"',observation_id,'no-hermes-v2' FROM mls_source_state",
          );
          rows.pop();
          rows[0].source_status = "delisted";
          rows[0].source_status_reason = "sold";
          const result = await ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), options);
          const reasons = await q(
            "SELECT s.external_listing_id,ps.inactive_reason FROM mls_source_state s JOIN property_sync_state ps ON ps.property_id=s.property_id ORDER BY s.external_listing_id",
          );
          assert.deepEqual(reasons, [
            { external_listing_id: "831", inactive_reason: "explicit_source_sold" },
            { external_listing_id: "834", inactive_reason: "accepted_full_28hse_absence" },
          ]);
          assert.equal(result.summary.properties_changed, 2);
          assert.equal(result.summary.fields_changed, 2);
          const before = await q("SELECT id,price,updated_at FROM properties ORDER BY id");
          const receipts = await q("SELECT id,response FROM mls_ingestion_receipts ORDER BY id");
          const scopes = await q("SELECT * FROM mls_ingestion_scopes");
          rows[1].price = 12;
          await assert.rejects(
            () =>
              ingestSnapshot(batch(rows, "2026-09-09T00:00:00Z"), {
                ...options,
                beforeCommit() {
                  throw Error("daily_receipt_rollback");
                },
              }),
            /daily_receipt_rollback/,
          );
          assert.deepEqual(
            await q("SELECT id,price,updated_at FROM properties ORDER BY id"),
            before,
          );
          assert.deepEqual(
            await q("SELECT id,response FROM mls_ingestion_receipts ORDER BY id"),
            receipts,
          );
          assert.deepEqual(await q("SELECT * FROM mls_ingestion_scopes"), scopes);
          // Explicit terminal evidence must supersede a prior absence before any later active observation.
          rows[1].price = 5380000;
          rows.push(
            row("834", { unit: "04", source_status: "delisted", source_status_reason: "sold" }),
          );
          await q(
            "UPDATE property_sync_fields SET active_override=true WHERE field_name='status' AND property_id=(SELECT property_id FROM mls_source_state WHERE external_listing_id='834')",
          );
          await ingestSnapshot(batch(rows, "2026-09-09T00:00:00Z"), options);
          const reason = async () =>
            (
              await q(
                "SELECT ps.inactive_reason FROM property_sync_state ps JOIN mls_source_state s ON s.property_id=ps.property_id WHERE s.external_listing_id='834'",
              )
            )[0].inactive_reason;
          assert.equal(await reason(), "accepted_full_28hse_absence");
          await q(
            "UPDATE property_sync_fields SET active_override=false WHERE field_name='status' AND property_id=(SELECT property_id FROM mls_source_state WHERE external_listing_id='834')",
          );
          const stable = await q("SELECT id,status,updated_at FROM properties ORDER BY id");
          const escalated = await ingestSnapshot(batch(rows, "2026-09-10T00:00:00Z"), options);
          assert.equal(await reason(), "explicit_source_sold");
          assert.deepEqual(
            await q("SELECT id,status,updated_at FROM properties ORDER BY id"),
            stable,
          );
          assert.equal(escalated.summary.properties_changed, 0);
          assert.equal(escalated.summary.fields_changed, 0);
          assert.equal(
            (
              await q(
                "SELECT e.* FROM listing_change_events e JOIN mls_ingestion_receipts r ON r.run_id=e.run_id WHERE r.id=$1",
                [escalated.receipt_id],
              )
            ).length,
            0,
          );
          rows.at(-1).source_status = "active";
          rows.at(-1).source_status_reason = null;
          await ingestSnapshot(batch(rows, "2026-09-11T00:00:00Z"), options);
          assert.equal(
            (
              await q(
                "SELECT p.status FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='834'",
              )
            )[0].status,
            "inactive",
          );
          assert.equal(await reason(), "explicit_source_sold");
        },
      );
      await t.test(
        "terminal and negotiable new observations stage without invented offers and manual prices survive",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          const rows = [
            row("821", { price: null }),
            row("822", { source_status: "delisted", source_status_reason: "sold" }),
            row("823", { unit: "03" }),
          ];
          await ingestSnapshot(batch(rows), options);
          assert.equal((await q("SELECT * FROM properties")).length, 1);
          assert.equal(
            (
              await q("SELECT source_status FROM mls_source_state WHERE external_listing_id='822'")
            )[0].source_status,
            "delisted",
          );
          await q("UPDATE property_sync_fields SET active_override=true WHERE field_name='price'");
          rows[2].price = null;
          await ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), options);
          assert.equal(Number((await q("SELECT price FROM properties"))[0].price), 5380000);
          await q("UPDATE property_sync_fields SET active_override=false WHERE field_name='price'");
          await ingestSnapshot(batch(rows, "2026-09-09T00:00:00Z"), options);
          assert.equal((await q("SELECT price FROM properties"))[0].price, null);
        },
      );
    } finally {
      await c.query("ROLLBACK");
      await c.query("RESET search_path");
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    }
  },
);
