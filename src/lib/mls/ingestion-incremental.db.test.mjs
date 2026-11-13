import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onDbTarget, targetClientPorts } from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { incrementalBatch, member } from "./incremental-test-fixtures.mjs";
import { readSyncAuthority } from "../../../scripts/mls/read-sync-authority.mjs";

test(
  "owned PostgreSQL incremental receipts preserve full authority, missing inventory and staff guards",
  onDbTarget(async (target, t) => {
    assert.equal(target.owned, true, "incremental acceptance must use owned PostgreSQL");
    const { connectionString: url, createClient: newClient } = await targetClientPorts(target);
    const schema = "incremental_" + randomUUID().replaceAll("-", "");
    const c = newClient({ connectionString: url });
    c.neonConfig.webSocketConstructor = globalThis.WebSocket;
    await c.connect();
    const q = async (sql, args = []) => (await c.query(sql, args)).rows;
    const createClient = (config) => {
      const client = newClient({ ...config, connectionString: url });
      const connect = client.connect.bind(client);
      client.connect = async () => {
        await connect();
        await client.query(`SET search_path TO ${schema},public,pg_catalog`);
      };
      return client;
    };
    const options = { apply: true, connectionString: url, createClient };
    const incOptions = { ...options, incremental: true };
    const ownedRows = ["1", "2", "3", "4"].map((id) =>
      row(id, { unit: id, agency_property_no: `A00000${id}` }),
    );
    const delta = (listings, members, stamp = "2026-09-07T01:01:00.123456Z") =>
      incrementalBatch({
        members,
        candidates: listings.map((r) => ({
          ...member(r.property_id, r.deal_type),
          reason: "changed",
        })),
        listings: listings.map((r) => ({ ...r, captured_at: "2026-09-07T01:00:10.123456Z" })),
        stamp,
      });
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
      ]) {
        await q("BEGIN");
        await q(readFileSync("neon/migrations/" + name, "utf8"));
        await q("COMMIT");
      }
      await q(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','python-v2.2','no-hermes-v2',true,now(),'test','{"absence_enabled":true,"district_slugs":{"Test":"test"},"company_number_identity":{"approved":true,"version":"company-number-v1","approved_by":"test"}}')`,
      );
      const initial = batch(ownedRows);
      initial.meta.parser_version = "python-v2.2";
      const full = await ingestSnapshot(initial, options);
      assert.equal(full.full_snapshot, true);
      await q(
        "UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '40 hours' WHERE full_snapshot",
      );
      const fullScope = (await q("SELECT full_receipt_id,full_count FROM mls_ingestion_scopes"))[0];
      const stateBefore = await q(
        "SELECT external_listing_id,observation_id,source_status FROM mls_source_state ORDER BY external_listing_id",
      );
      const property = (
        await q(
          "SELECT p.* FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='1'",
        )
      )[0];
      await q("BEGIN");
      await q("SELECT set_config('app.admin_property_write','on',true)");
      await q(
        "UPDATE properties SET price=777,status='inactive',title_zh='Staff title' WHERE id=$1",
        [property.id],
      );
      await q("COMMIT");
      const aliases = await q("SELECT * FROM property_public_members ORDER BY property_id");
      let receipt;
      const payload = delta([{ ...ownedRows[0], price: 9000000 }], [member("1"), member("2")]);
      await t.test(
        "subset details never sweep missing index or cached members and never advance full baseline",
        async () => {
          receipt = await ingestSnapshot(payload, incOptions);
          assert.equal(receipt.incremental, true);
          assert.equal(receipt.full_snapshot, false);
          assert.equal(receipt.status, "partial_success");
          assert.ok(receipt.accepted_at);
          assert.equal(receipt.summary.fresh_detail_count, 1);
          assert.equal(receipt.summary.index_offer_count, 2);
          assert.deepEqual(
            (await q("SELECT full_receipt_id,full_count FROM mls_ingestion_scopes"))[0],
            fullScope,
          );
          const states = await q(
            "SELECT external_listing_id,observation_id,source_status FROM mls_source_state ORDER BY external_listing_id",
          );
          assert.notEqual(states[0].observation_id, stateBefore[0].observation_id);
          assert.deepEqual(states.slice(1), stateBefore.slice(1));
          assert.equal(
            (
              await q(
                "SELECT count(*)::int n FROM listing_change_events WHERE reason='accepted_full_28hse_absence'",
              )
            )[0].n,
            0,
          );
          const stored = (
            await q(
              "SELECT r.full_snapshot,r.response,s.status,s.source_status FROM mls_ingestion_receipts r JOIN listing_sync_runs s ON s.id=r.run_id WHERE r.id=$1",
              [receipt.receipt_id],
            )
          )[0];
          assert.equal(stored.status, "healthy");
          assert.equal(stored.source_status["28hse_agent_540"].incremental, true);
          assert.deepEqual(stored.response, receipt);
        },
      );
      await t.test(
        "manual values, inactive status, public aliases and company number remain protected",
        async () => {
          const actual = (await q("SELECT * FROM properties WHERE id=$1", [property.id]))[0];
          assert.equal(Number(actual.price), 777);
          assert.equal(actual.status, "inactive");
          assert.equal(actual.title_zh, "Staff title");
          assert.equal(actual.canonical_property_no, property.canonical_property_no);
          assert.deepEqual(
            await q("SELECT * FROM property_public_members ORDER BY property_id"),
            aliases,
          );
          const changed = delta(
            [{ ...ownedRows[0], agency_property_no: "B000001", price: 1 }],
            [member("1")],
            "2026-09-07T01:02:00Z",
          );
          await ingestSnapshot(changed, incOptions);
          assert.deepEqual(
            (await q("SELECT * FROM properties WHERE id=$1", [property.id]))[0],
            actual,
          );
          assert.ok(
            (await q("SELECT * FROM mls_ingestion_reviews WHERE reason='company_number_changed'"))
              .length,
          );
        },
      );
      await t.test(
        "owned ordinary fields update while cached and missing index members stay unchanged",
        async () => {
          const before = await q(
            "SELECT s.external_listing_id,s.observation_id,p.price,p.status FROM mls_source_state s JOIN properties p ON p.id=s.property_id WHERE s.external_listing_id IN ('2','3','4') ORDER BY s.external_listing_id",
          );
          const payload = delta(
            [{ ...ownedRows[1], price: 6500000 }],
            [member("2"), member("3")],
            "2026-09-07T01:02:30Z",
          );
          const result = await ingestSnapshot(payload, incOptions);
          assert.equal(result.summary.properties_changed, 1);
          assert.equal(result.summary.fields_changed, 1);
          assert.equal(result.summary.unfetched_index_offer_count, 1);
          const after = await q(
            "SELECT s.external_listing_id,s.observation_id,p.price,p.status FROM mls_source_state s JOIN properties p ON p.id=s.property_id WHERE s.external_listing_id IN ('2','3','4') ORDER BY s.external_listing_id",
          );
          assert.equal(Number(after[0].price), 6500000);
          assert.equal(after[0].status, "draft");
          assert.notEqual(after[0].observation_id, before[0].observation_id);
          assert.deepEqual(after.slice(1), before.slice(1));
        },
      );
      await t.test(
        "zero-change receipt advances only accepted watermark and replays exactly while disabled",
        async () => {
          const zero = incrementalBatch({
            members: [member("1"), member("2")],
            candidates: [],
            stamp: "2026-09-07T01:03:00Z",
          });
          const observations = (
            await q("SELECT count(*)::int n FROM listing_source_observations")
          )[0].n;
          const properties = await q("SELECT * FROM properties ORDER BY id");
          const result = await ingestSnapshot(zero, incOptions);
          assert.equal(result.summary.fresh_detail_count, 0);
          assert.equal(result.incremental, true);
          assert.deepEqual(await q("SELECT * FROM properties ORDER BY id"), properties);
          assert.equal(
            (await q("SELECT count(*)::int n FROM listing_source_observations"))[0].n,
            observations,
          );
          assert.deepEqual(
            (await q("SELECT full_receipt_id,full_count FROM mls_ingestion_scopes"))[0],
            fullScope,
          );
          await q("UPDATE mls_ingestion_policies SET publish_enabled=false");
          assert.deepEqual(await ingestSnapshot(zero, incOptions), result);
          const conflict = structuredClone(zero);
          conflict.meta.run_id = "different";
          await assert.rejects(
            () => ingestSnapshot(conflict, incOptions),
            (error) => error.code === "receipt_conflict",
          );
          await assert.rejects(
            () => ingestSnapshot(zero, options),
            (error) => error.code === "incremental_mode_required",
          );
          await q("UPDATE mls_ingestion_policies SET publish_enabled=true");
        },
      );
      await t.test(
        "latest incremental authority is independent from forty-hour-old full authority",
        async () => {
          const authority = await readSyncAuthority({
            env: {
              DATABASE_URL_UNPOOLED: "postgres://u:p@owned.neon.tech/neondb",
              PROPERTY_SYNC_EXPECTED_DATABASE_HOST: "owned.neon.tech",
            },
            createClient,
          });
          assert.equal(authority.receipt_id, full.receipt_id);
          assert.notEqual(authority.incremental_receipt_id, full.receipt_id);
          assert.equal(authority.incremental_summary.fresh_detail_count, 0);
          assert.ok(
            Date.parse(authority.last_incremental_accepted_at) > Date.parse(authority.accepted_at),
          );
        },
      );
      await t.test(
        "new incremental properties remain drafts and failed validation leaves no receipt",
        async () => {
          const fresh = delta(
            [row("5", { unit: "5", agency_property_no: "A000005" })],
            [member("5")],
            "2026-09-07T01:04:00Z",
          );
          const result = await ingestSnapshot(fresh, incOptions);
          assert.equal(result.summary.properties_created, 1);
          assert.equal(
            (
              await q(
                "SELECT p.status FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='5'",
              )
            )[0].status,
            "draft",
          );
          const before = (await q("SELECT count(*)::int n FROM mls_ingestion_receipts"))[0].n;
          const invalid = structuredClone(fresh);
          invalid.scraped_at = "2026-09-07T01:05:00Z";
          invalid.listings[0].captured_at = "2026-09-06T00:00:00Z";
          await assert.rejects(
            () => ingestSnapshot(invalid, incOptions),
            (error) => error.code === "incomplete_snapshot",
          );
          assert.equal(
            (await q("SELECT count(*)::int n FROM mls_ingestion_receipts"))[0].n,
            before,
          );
          assert.deepEqual(
            (await q("SELECT full_receipt_id,full_count FROM mls_ingestion_scopes"))[0],
            fullScope,
          );
        },
      );
      await t.test(
        "deal type remains part of source identity and a new rent offer remains draft",
        async () => {
          const rent = row("1", {
            unit: "1",
            agency_property_no: "A000001",
            deal_type: "rent",
            source_url: "https://www.28hse.com/rent/example/property-1",
            price: null,
            rent: 20000,
          });
          const payload = delta([rent], [member("1", "rent")], "2026-09-07T01:05:00Z");
          const result = await ingestSnapshot(payload, incOptions);
          assert.equal(result.summary.properties_created, 1);
          const offers = await q(
            "SELECT s.deal_type,p.id,p.status,p.price,p.rent FROM mls_source_state s JOIN properties p ON p.id=s.property_id WHERE s.external_listing_id='1' ORDER BY s.deal_type",
          );
          const sale = offers.find((offer) => offer.deal_type === "sale");
          const rental = offers.find((offer) => offer.deal_type === "rent");
          assert.equal(sale.id, property.id);
          assert.equal(sale.status, "inactive");
          assert.equal(Number(sale.price), 777);
          assert.notEqual(rental.id, property.id);
          assert.equal(rental.status, "draft");
          assert.equal(Number(rental.rent), 20000);
        },
      );
      await t.test(
        "incremental commit failure rolls back receipt, observation, run and accepted watermark",
        async () => {
          const tables = [
            "mls_ingestion_receipts",
            "listing_source_observations",
            "listing_sync_runs",
            "mls_ingestion_scopes",
            "properties",
          ];
          const snapshot = async () => {
            const rows = [];
            for (const table of tables)
              rows.push(
                await q(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`),
              );
            return rows;
          };
          const before = await snapshot();
          const payload = delta(
            [row("6", { unit: "6", agency_property_no: "A000006" })],
            [member("6")],
            "2026-09-07T01:06:00Z",
          );
          await assert.rejects(
            () =>
              ingestSnapshot(payload, {
                ...incOptions,
                beforeCommit() {
                  throw Error("rollback incremental");
                },
              }),
            /rollback incremental/,
          );
          assert.deepEqual(await snapshot(), before);
        },
      );
    } finally {
      await c.query("ROLLBACK");
      await c.query("RESET search_path");
      await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    }
  }),
);
