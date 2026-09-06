import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@neondatabase/serverless";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot as ingestService } from "./ingestion-service.mjs";
const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "T11-27 atomic ingestion on approved disposable isolated schema",
  { skip: !url },
  async (t) => {
    assert.equal(process.env.ASTRA_TEST_BRANCH_ID, "br-quiet-hat-aoxbj2ue");
    assert.notEqual(url, process.env.DATABASE_URL_UNPOOLED);
    const schema = "atomic_" + randomUUID().replaceAll("-", "");
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
      const initial = batch([
        row("123"),
        row("124", { unit: "02" }),
        row("125", { unit: "03" }),
        row("126", { unit: "04" }),
      ]);
      let response;
      await t.test("bootstrap approval is required before initial accepted writes", async () => {
        await q(
          "UPDATE mls_ingestion_policies SET bootstrap_approved_at=null,bootstrap_approved_by=null WHERE source='28hse_agent_540'",
        );
        await assert.rejects(
          () => ingestSnapshot(initial, options),
          (e) => e.status === 503 && e.code === "bootstrap_required",
        );
        assert.equal((await q("SELECT * FROM listing_sync_runs")).length, 0);
        await q(
          "UPDATE mls_ingestion_policies SET bootstrap_approved_at=now(),bootstrap_approved_by='test' WHERE source='28hse_agent_540'",
        );
      });

      await t.test("apply commits a receipt and stable internal draft properties", async () => {
        response = await ingestSnapshot(initial, options);
        assert.equal(response.status, "success");
        assert.equal(
          (await q("SELECT district_slug FROM properties LIMIT 1"))[0].district_slug,
          "test",
        );
        assert.equal(
          (await q("SELECT payload FROM listing_source_observations LIMIT 1"))[0].payload
            .schemaVersion,
          2,
        );
        assert.ok(response.receipt_id);
        assert.equal((await q("SELECT * FROM properties")).length, 4);
        assert.equal((await q("SELECT * FROM mls_source_state")).length, 4);
        assert.ok(
          (await q("SELECT * FROM properties")).every(
            (p) => p.status === "draft" && p.listing_no.startsWith("SYNC-"),
          ),
        );
      });
      await t.test("replay before disabled gate and quota returns exact receipt", async () => {
        await q("UPDATE mls_ingestion_policies SET publish_enabled=false");
        assert.deepEqual(await ingestSnapshot(initial, options), response);
        const changed = structuredClone(initial);
        changed.listings[0].price = 1;
        await assert.rejects(
          () => ingestSnapshot(changed, options),
          (e) => e.status === 409,
        );
        await q("UPDATE mls_ingestion_policies SET publish_enabled=true");
      });
      await t.test("stale timestamp and >30 percent drop leave business state intact", async () => {
        await assert.rejects(
          () => ingestSnapshot(batch(initial.listings, "2026-09-07T00:00:00.123455Z"), options),
          (e) => e.status === 409,
        );
        await assert.rejects(
          () => ingestSnapshot(batch([row("123")], "2026-09-07T00:01:00Z"), options),
          (e) => e.status === 422,
        );
        assert.equal((await q("SELECT * FROM mls_ingestion_receipts")).length, 1);
      });
      await t.test(
        "transaction failure rolls back observations canonical updates and baseline",
        async () => {
          await assert.rejects(
            () =>
              ingestSnapshot(batch(initial.listings, "2026-09-07T00:02:00Z"), {
                ...options,
                beforeCommit: () => {
                  throw Error("injected rollback");
                },
              }),
            /injected rollback/,
          );
          assert.equal((await q("SELECT * FROM mls_ingestion_receipts")).length, 1);
          assert.equal((await q("SELECT * FROM listing_source_observations")).length, 4);
        },
      );
      await t.test(
        "cross-source exact match retains primary fields and whole contact sidecar",
        async () => {
          const hk = row("hk1", {
            source_url: "https://www.property.hk/fixture/EPW/hk1",
            branch_code: "EPW",
            price: 1,
            bedrooms: 0,
            agent_name: "Secondary",
            agent_phone: "12345678",
          });
          await ingestSnapshot(batch([hk], "2026-09-07T00:03:00Z", "propertyhk"), options);
          assert.equal((await q("SELECT * FROM properties")).length, 4);
          assert.equal((await q("SELECT * FROM mls_ingestion_conflicts")).length, 1);
          const p = (
            await q(
              "SELECT p.* FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='123'",
            )
          )[0];
          assert.equal(Number(p.price), 5380000);
          assert.equal(p.bedrooms, 0);
        },
      );
      await t.test(
        "manual values and aliases survive updates and absence uses previous full baseline",
        async () => {
          const p = (
            await q(
              "SELECT p.* FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='123'",
            )
          )[0];
          await q("BEGIN");
          await q("SELECT set_config('app.admin_property_write','on',true)");
          await q("UPDATE properties SET price=777 WHERE id=$1", [p.id]);
          await q("COMMIT");
          const alias = await q("SELECT * FROM property_public_members WHERE property_id=$1", [
            p.id,
          ]);
          await ingestSnapshot(
            batch(initial.listings.slice(0, 3), "2026-09-07T00:04:00Z"),
            options,
          );
          assert.equal(
            Number((await q("SELECT price FROM properties WHERE id=$1", [p.id]))[0].price),
            777,
          );
          assert.deepEqual(
            await q("SELECT * FROM property_public_members WHERE property_id=$1", [p.id]),
            alias,
          );
          assert.equal(
            (
              await q("SELECT source_status FROM mls_source_state WHERE external_listing_id='126'")
            )[0].source_status,
            "delisted",
          );
        },
      );
      await t.test(
        "partial writes advance watermark only and prevent intermediate stale data",
        async () => {
          const before = (
            await q(
              "SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='28hse_agent_540'",
            )
          )[0];
          const partial = batch(
            [...initial.listings.slice(0, 3), row("127", { price: "invalid" })],
            "2026-09-07T00:05:00.000002Z",
          );
          const result = await ingestSnapshot(partial, options);
          assert.equal(result.status, "partial_success");
          assert.equal(result.full_snapshot, false);
          assert.deepEqual(
            (
              await q(
                "SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='28hse_agent_540'",
              )
            )[0],
            before,
          );
          await assert.rejects(
            () =>
              ingestSnapshot(
                batch(initial.listings.slice(0, 3), "2026-09-07T00:05:00.000001Z"),
                options,
              ),
            (e) => e.status === 409,
          );
        },
      );
      await t.test(
        "identity correction preserves relationship UUID and old identity while holding projection",
        async () => {
          const before = (
            await q(
              "SELECT * FROM mls_source_state WHERE source='28hse_agent_540' AND external_listing_id='123'",
            )
          )[0];
          const changed = initial.listings
            .slice(0, 3)
            .map((r) =>
              r.property_id === "123" ? { ...r, unit: "99", title: "Wrong new identity" } : r,
            );
          await ingestSnapshot(batch(changed, "2026-09-07T00:06:00Z"), options);
          const after = (
            await q(
              "SELECT * FROM mls_source_state WHERE source='28hse_agent_540' AND external_listing_id='123'",
            )
          )[0];
          assert.equal(after.property_id, before.property_id);
          assert.equal(after.unit_key, before.unit_key);
          assert.deepEqual(after.raw_identity, before.raw_identity);
          assert.equal(
            (await q("SELECT title_zh FROM properties WHERE id=$1", [before.property_id]))[0]
              .title_zh,
            "Source title",
          );
          assert.equal(
            (await q("SELECT * FROM mls_ingestion_reviews WHERE reason='identity_changed'")).length,
            1,
          );
        },
      );
      await t.test("quota blocks new batches but replay bypasses quota", async () => {
        await q(
          "UPDATE mls_ingestion_policies SET config=config||'{\"max_batches_per_hour\":1}' WHERE source='28hse_agent_540'",
        );
        await assert.rejects(
          () =>
            ingestSnapshot(batch(initial.listings.slice(0, 3), "2026-09-07T00:07:00Z"), options),
          (e) => e.status === 429 && e.details.retryAfter > 0,
        );
        assert.deepEqual(await ingestSnapshot(initial, options), response);
        await q(
          "UPDATE mls_ingestion_policies SET config=config-'max_batches_per_hour' WHERE source='28hse_agent_540'",
        );
      });
      await t.test(
        "lost COMMIT acknowledgement returns unknown outcome and exact retry recovers",
        async () => {
          const next = batch(initial.listings.slice(0, 3), "2026-09-07T00:08:00Z");
          const lostClient = (config) => {
            const client = createClient(config);
            const query = client.query.bind(client);
            client.query = async (sql, args) => {
              const result = await query(sql, args);
              if (sql === "COMMIT") throw Error("simulated lost acknowledgement");
              return result;
            };
            return client;
          };
          await assert.rejects(
            () => ingestSnapshot(next, { ...options, createClient: lostClient }),
            (e) => e.status === 503 && e.code === "OUTCOME_UNKNOWN",
          );
          const replay = await ingestSnapshot(next, options);
          assert.equal(replay.status, "success");
          assert.equal(
            (await q("SELECT * FROM mls_ingestion_receipts WHERE scraped_at=$1", [next.scraped_at]))
              .length,
            1,
          );
        },
      );
      await t.test("concurrent writers coordinate with existing global MLS lock", async () => {
        let release, entered;
        const ready = new Promise((r) => (entered = r));
        const held = new Promise((r) => (release = r));
        const next = batch(initial.listings.slice(0, 3), "2026-09-07T00:09:00Z");
        const running = ingestSnapshot(next, {
          ...options,
          beforeCommit: async () => {
            entered();
            await held;
          },
        });
        await ready;
        try {
          assert.deepEqual(await ingestSnapshot(initial, options), response);
          await assert.rejects(
            () =>
              ingestSnapshot(batch(initial.listings.slice(0, 3), "2026-09-07T00:10:00Z"), options),
            (e) => e.status === 503 && e.code === "ingestion_busy",
          );
        } finally {
          release();
        }
        await running;
        assert.deepEqual(await ingestSnapshot(next, options), await ingestSnapshot(next, options));
      });
      await t.test(
        "Property.hk first then primary adopts exact target and same-source twin stays in review",
        async () => {
          const hk = (id, unit) =>
            row(id, {
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              branch_code: "EPW",
              unit,
              price: 123,
            });
          const hks = [hk("hk1", "01"), hk("hk2", "01"), hk("hk3", "10")];
          await ingestSnapshot(batch(hks, "2026-09-07T00:11:00Z", "propertyhk"), options);
          const first = (
            await q(
              "SELECT * FROM mls_source_state WHERE source='propertyhk' AND external_listing_id='hk3'",
            )
          )[0];
          assert.ok(first.property_id);
          assert.equal(
            (await q("SELECT property_id FROM mls_source_state WHERE external_listing_id='hk2'"))[0]
              .property_id,
            null,
          );
          await ingestSnapshot(
            batch(
              [...initial.listings.slice(0, 3), row("128", { unit: "10", price: 999 })],
              "2026-09-07T00:12:00Z",
            ),
            options,
          );
          assert.equal(
            (await q("SELECT property_id FROM mls_source_state WHERE external_listing_id='128'"))[0]
              .property_id,
            first.property_id,
          );
          assert.equal(
            Number(
              (await q("SELECT price FROM properties WHERE id=$1", [first.property_id]))[0].price,
            ),
            999,
          );
        },
      );
      await t.test(
        "DB admin override effective values are recorded and media and staff remain intact",
        async () => {
          const state = (
            await q("SELECT * FROM mls_source_state WHERE external_listing_id='128'")
          )[0];
          const alias = (
            await q("SELECT public_listing_no FROM property_public_members WHERE property_id=$1", [
              state.property_id,
            ])
          )[0].public_listing_no;
          await q("INSERT INTO admin_property_overrides(property_no,sale) VALUES($1,$2)", [
            alias,
            JSON.stringify({ price: 444 }),
          ]);
          await q("BEGIN");
          await q("SELECT set_config('app.admin_property_write','on',true)");
          await q("UPDATE properties SET images=$2 WHERE id=$1", [
            state.property_id,
            ["https://owned.invalid/keep.jpg"],
          ]);
          await q("COMMIT");
          await ingestSnapshot(
            batch(
              [...initial.listings.slice(0, 3), row("128", { unit: "10", price: 888 })],
              "2026-09-07T00:13:00Z",
            ),
            options,
          );
          const p = (await q("SELECT * FROM properties WHERE id=$1", [state.property_id]))[0];
          assert.equal(Number(p.price), 444);
          assert.deepEqual(p.images, ["https://owned.invalid/keep.jpg"]);
          const field = (
            await q(
              "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name='price'",
              [state.property_id],
            )
          )[0];
          assert.equal(Number(field.last_published_value), 444);
          assert.equal(field.selection_reason, "manual_override");
          assert.equal(field.winning_observation_id, null);
        },
      );

      await t.test(
        "unknown legacy field ownership cannot be claimed merely because values currently agree",
        async () => {
          let id;
          await q("BEGIN");
          await q("SELECT set_config('app.admin_property_write','on',true)");
          id = (
            await q(
              "INSERT INTO properties(listing_no,title_zh,deal_type,district_slug,price,status) VALUES('LEGACY-UNKNOWN','Source title','sale','Test',5380000,'active') RETURNING id",
            )
          )[0].id;
          await q("COMMIT");
          const run = (await q("SELECT id FROM listing_sync_runs LIMIT 1"))[0].id;
          await q(
            "INSERT INTO property_source_links(property_id,source,external_listing_id,deal_type,match_key,link_reason,status,first_seen_at,last_seen_at,last_seen_run_id) VALUES($1,'28hse_agent_540','129','sale',null,'source_id_v2','active',now(),now(),$2)",
            [id, run],
          );
          const rows = [
            ...initial.listings.slice(0, 3),
            row("128", { unit: "10", price: 888 }),
            row("129", { unit: "11" }),
          ];
          await ingestSnapshot(batch(rows, "2026-09-07T00:14:00Z"), options);
          assert.equal(
            (
              await q(
                "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name='price'",
                [id],
              )
            ).length,
            0,
          );
          rows.at(-1).price = 111;
          await ingestSnapshot(batch(rows, "2026-09-07T00:15:00Z"), options);
          assert.equal(
            Number((await q("SELECT price FROM properties WHERE id=$1", [id]))[0].price),
            5380000,
          );
          await ingestSnapshot(batch(rows.slice(0, -1), "2026-09-07T00:15:30Z"), options);
          assert.equal(
            (await q("SELECT status FROM properties WHERE id=$1", [id]))[0].status,
            "active",
          );
        },
      );

      await t.test(
        "valid fractional money projects exactly and decimal scale does not imply staff divergence",
        async () => {
          const rows = [
            ...initial.listings.slice(0, 3),
            row("128", { unit: "10", price: 888 }),
            row("129", { unit: "11" }),
            row("130", { unit: "12", price: "125.25" }),
          ];
          await ingestSnapshot(batch(rows, "2026-09-07T00:16:00Z"), options);
          const p = (
            await q(
              "SELECT p.* FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='130'",
            )
          )[0];
          assert.equal(Number(p.price), 125.25);
          await q(
            "UPDATE property_sync_fields SET last_published_value='\"125.2500\"' WHERE property_id=$1 AND field_name='price'",
            [p.id],
          );
          rows.at(-1).price = "125.50";
          await ingestSnapshot(batch(rows, "2026-09-07T00:17:00Z"), options);
          assert.equal(
            Number((await q("SELECT price FROM properties WHERE id=$1", [p.id]))[0].price),
            125.5,
          );
        },
      );
      await t.test(
        "previously staged source creates once when publication prerequisites become complete",
        async () => {
          const hk = (id, unit, extra = {}) =>
            row(id, {
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              branch_code: "EPW",
              unit,
              price: 123,
              ...extra,
            });
          const rows = [
            hk("hk1", "01"),
            hk("hk2", "01"),
            hk("hk3", "10"),
            hk("hk4", "20", { title: null }),
          ];
          await ingestSnapshot(batch(rows, "2026-09-07T00:18:00Z", "propertyhk"), options);
          const before = (
            await q("SELECT * FROM mls_source_state WHERE external_listing_id='hk4'")
          )[0];
          assert.equal(before.property_id, null);
          rows.at(-1).title = "Completed";
          await ingestSnapshot(batch(rows, "2026-09-07T00:19:00Z", "propertyhk"), options);
          const after = (
            await q("SELECT * FROM mls_source_state WHERE external_listing_id='hk4'")
          )[0];
          assert.ok(after.property_id);
          assert.deepEqual(after.first_seen_at, before.first_seen_at);
          await ingestSnapshot(batch(rows, "2026-09-07T00:20:00Z", "propertyhk"), options);
          assert.equal(
            (await q("SELECT property_id FROM mls_source_state WHERE external_listing_id='hk4'"))[0]
              .property_id,
            after.property_id,
          );
        },
      );

      await t.test(
        "existing source URL identity mismatch is rejected without projecting or advancing full baseline",
        async () => {
          const before = (
            await q("SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='propertyhk'")
          )[0];
          const hk = (id, unit) =>
            row(id, {
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              branch_code: "EPW",
              unit,
              price: 123,
            });
          const rows = [hk("hk1", "01"), hk("hk2", "01"), hk("hk3", "10"), hk("hk4", "20")];
          rows[3].source_url = "https://www.property.hk/fixture/EPW/wrong-id";
          rows[3].title = "Unverified overwrite";
          const result = await ingestSnapshot(
            batch(rows, "2026-09-07T00:21:00Z", "propertyhk"),
            options,
          );
          assert.equal(result.status, "partial_success");
          assert.equal(result.summary.rejected_count, 1);
          assert.deepEqual(
            (
              await q("SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='propertyhk'")
            )[0],
            before,
          );
          const state = (
            await q("SELECT * FROM mls_source_state WHERE external_listing_id='hk4'")
          )[0];
          assert.equal(
            (await q("SELECT title_zh FROM properties WHERE id=$1", [state.property_id]))[0]
              .title_zh,
            "Completed",
          );
        },
      );

      await t.test(
        "partial-only historical source is not delisted by the next full baseline",
        async () => {
          const rows = [
            ...initial.listings.slice(0, 3),
            row("128", { unit: "10", price: 888 }),
            row("129", { unit: "11" }),
            row("130", { unit: "12", price: "125.50" }),
          ];
          const partial = batch(
            [...rows, row("131", { unit: "30" }), row("132", { unit: "31", price: "invalid" })],
            "2026-09-07T00:22:00Z",
          );
          assert.equal((await ingestSnapshot(partial, options)).status, "partial_success");
          await ingestSnapshot(batch(rows, "2026-09-07T00:23:00Z"), options);
          assert.equal(
            (
              await q("SELECT source_status FROM mls_source_state WHERE external_listing_id='131'")
            )[0].source_status,
            "active",
          );
        },
      );
      await t.test(
        "primary full absence deactivates owned lifecycle and secondary cannot revive it",
        async () => {
          const state = (
            await q("SELECT * FROM mls_source_state WHERE external_listing_id='128'")
          )[0];
          await q("BEGIN");
          await q("SELECT set_config('app.mls_writer_policy','no-hermes-v2',true)");
          await q("UPDATE properties SET status='active' WHERE id=$1", [state.property_id]);
          await q("COMMIT");
          await q(
            "INSERT INTO property_sync_fields(property_id,field_name,last_published_value,winning_observation_id,policy_version) VALUES($1,'status','\"active\"',$2,'no-hermes-v2')",
            [state.property_id, state.observation_id],
          );
          const rows = [
            ...initial.listings.slice(0, 3),
            row("129", { unit: "11" }),
            row("130", { unit: "12", price: "125.50" }),
          ];
          await ingestSnapshot(batch(rows, "2026-09-07T00:24:00Z"), options);
          assert.equal(
            (await q("SELECT status FROM properties WHERE id=$1", [state.property_id]))[0].status,
            "inactive",
          );
          const hk = (id, unit) =>
            row(id, {
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              branch_code: "EPW",
              unit,
              price: 123,
            });
          await ingestSnapshot(
            batch(
              [hk("hk1", "01"), hk("hk2", "01"), hk("hk3", "10"), hk("hk4", "20")],
              "2026-09-07T00:25:00Z",
              "propertyhk",
            ),
            options,
          );
          assert.equal(
            (await q("SELECT status FROM properties WHERE id=$1", [state.property_id]))[0].status,
            "inactive",
          );
        },
      );
      await t.test(
        "incomplete identity evidence cannot erase the last known identity before a correction",
        async () => {
          const before = (
            await q(
              "SELECT * FROM mls_source_state WHERE source='28hse_agent_540' AND external_listing_id='123'",
            )
          )[0];
          const rows = [
            row("123", { unit: null }),
            row("124", { unit: "02" }),
            row("125", { unit: "03" }),
            row("129", { unit: "11" }),
            row("130", { unit: "12" }),
          ];
          await ingestSnapshot(batch(rows, "2026-09-07T00:26:00Z"), options);
          rows[0].unit = "88";
          rows[0].title = "Wrong identity";
          await ingestSnapshot(batch(rows, "2026-09-07T00:27:00Z"), options);
          const after = (
            await q(
              "SELECT * FROM mls_source_state WHERE source='28hse_agent_540' AND external_listing_id='123'",
            )
          )[0];
          assert.equal(after.property_id, before.property_id);
          assert.equal(after.raw_identity.unit, before.raw_identity.unit);
          assert.equal(
            (await q("SELECT title_zh FROM properties WHERE id=$1", [before.property_id]))[0]
              .title_zh,
            "Source title",
          );
        },
      );

      await t.test(
        "default full-sync quota counts only new full batches and exact replay bypasses it",
        async () => {
          const rows = [
            row("123"),
            row("124", { unit: "02" }),
            row("125", { unit: "03" }),
            row("129", { unit: "11" }),
            row("130", { unit: "12" }),
          ];
          const full = batch(rows, "2026-09-07T00:28:00Z");
          const result = await ingestSnapshot(full, options);
          await assert.rejects(
            () => ingestService(batch(rows, "2026-09-07T00:29:00Z"), options),
            (e) => e.status === 429 && e.code === "full_sync_quota_exceeded",
          );
          assert.deepEqual(await ingestService(full, options), result);
          const partial = batch(
            [...rows, row("133", { price: "invalid" })],
            "2026-09-07T00:30:00Z",
          );
          assert.equal((await ingestService(partial, options)).status, "partial_success");
          await assert.rejects(
            () => ingestService(batch(rows, "2026-09-07T00:31:00Z"), options),
            (e) => e.status === 429 && e.details.retryAfter > 0,
          );
        },
      );
      await t.test(
        "conflict-ledger and final-receipt write failures roll back every atomic effect",
        async () => {
          const hk = (id, unit) =>
            row(id, {
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              branch_code: "EPW",
              unit,
              price: 321,
            });
          const rows = [hk("hk1", "01"), hk("hk2", "01"), hk("hk3", "10"), hk("hk4", "20")];
          await q(
            "CREATE FUNCTION injected_ingestion_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_write_failure'; END $$",
          );
          const counts = async () =>
            (
              await q(
                "SELECT (SELECT count(*) FROM listing_sync_runs)::int AS runs,(SELECT count(*) FROM listing_source_observations)::int AS observations,(SELECT count(*) FROM mls_ingestion_receipts)::int AS receipts",
              )
            )[0];
          for (const [index, table, event] of [
            [0, "mls_ingestion_conflicts", "INSERT OR UPDATE"],
            [1, "mls_ingestion_receipts", "UPDATE OF response"],
          ]) {
            const before = await counts();
            const scopes = await q("SELECT * FROM mls_ingestion_scopes ORDER BY source");
            await q(
              `CREATE TRIGGER injected_failure BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION injected_ingestion_failure()`,
            );
            try {
              await assert.rejects(
                () =>
                  ingestSnapshot(
                    batch(rows, `2026-09-07T00:3${index + 2}:00Z`, "propertyhk"),
                    options,
                  ),
                /injected_write_failure/,
              );
            } finally {
              await q(`DROP TRIGGER injected_failure ON ${table}`);
            }
            assert.deepEqual(await counts(), before);
            assert.deepEqual(await q("SELECT * FROM mls_ingestion_scopes ORDER BY source"), scopes);
          }
        },
      );
      await t.test(
        "server-owned district mappings project slugs and unknown names stage without overwriting existing slugs",
        async () => {
          const hk = (id, unit, extra = {}) =>
            row(id, {
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              branch_code: "EPW",
              unit,
              price: 321,
              ...extra,
            });
          const rows = [
            hk("hk1", "01"),
            hk("hk2", "01"),
            hk("hk3", "10"),
            hk("hk4", "20"),
            hk("hk5", "40", { district: "深井" }),
          ];
          await q(
            "UPDATE mls_ingestion_policies SET config=config-'district_slugs' WHERE source='propertyhk'",
          );
          await ingestSnapshot(batch(rows, "2026-09-07T00:34:00Z", "propertyhk"), options);
          assert.equal(
            (await q("SELECT property_id FROM mls_source_state WHERE external_listing_id='hk5'"))[0]
              .property_id,
            null,
          );
          assert.equal(
            (
              await q(
                "SELECT p.district_slug FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='hk4'",
              )
            )[0].district_slug,
            "test",
          );
          await q(
            "UPDATE mls_ingestion_policies SET config=config||$1::jsonb WHERE source='propertyhk'",
            [JSON.stringify({ district_slugs: { Test: "test", 深井: "sham-tseng" } })],
          );
          await ingestSnapshot(batch(rows, "2026-09-07T00:35:00Z", "propertyhk"), options);
          assert.equal(
            (
              await q(
                "SELECT p.district_slug FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id='hk5'",
              )
            )[0].district_slug,
            "sham-tseng",
          );
        },
      );
      await t.test(
        "nullable source clearing handles both arrival orders removal and protected ownership",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          const p = (id, unit, extra = {}) => row(id, { unit, ...extra });
          const h = (id, unit, extra = {}) =>
            row(id, {
              unit,
              branch_code: "EPW",
              source_url: `https://www.property.hk/fixture/EPW/${id}`,
              description: "Secondary description",
              ...extra,
            });
          await ingestSnapshot(batch([p("902", "B")], "2026-09-07T02:00:00Z"), options);
          await ingestSnapshot(
            batch([h("h901", "A"), h("h902", "B")], "2026-09-07T02:01:00Z", "propertyhk"),
            options,
          );
          const property = async (id) =>
            (
              await q(
                "SELECT p.* FROM properties p JOIN mls_source_state s ON s.property_id=p.id WHERE s.external_listing_id=$1",
                [id],
              )
            )[0];
          const a = await property("h901"),
            b = await property("902");
          assert.equal(a.description, "Secondary description");
          assert.equal(b.description, null);
          await ingestSnapshot(
            batch([p("901", "A"), p("902", "B")], "2026-09-07T02:02:00Z"),
            options,
          );
          assert.equal((await property("901")).description, null);
          assert.equal((await property("902")).description, null);
          const cleared = (
            await q(
              "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name='description'",
              [a.id],
            )
          )[0];
          assert.equal(cleared.selection_reason, "no_authorized_source");
          assert.equal(cleared.winning_observation_id, null);
          const present = [
            p("901", "A", { description: "Primary owned", bathrooms: 2, orientation: "East" }),
            p("902", "B", { description: "Primary owned", bathrooms: 2, orientation: "East" }),
          ];
          await ingestSnapshot(batch(present, "2026-09-07T02:03:00Z"), options);
          await q("BEGIN");
          await q("SELECT set_config('app.admin_property_write','on',true)");
          await q("UPDATE properties SET description='Manual text' WHERE id=$1", [a.id]);
          await q("UPDATE properties SET orientation='Manual direction' WHERE id=$1", [b.id]);
          await q("COMMIT");
          await q(
            "UPDATE property_sync_fields SET active_override=true,override_value='\"Manual text\"' WHERE property_id=$1 AND field_name='description'",
            [a.id],
          );
          await q(
            "DELETE FROM property_sync_fields WHERE property_id=$1 AND field_name='bathrooms'",
            [a.id],
          );
          await ingestSnapshot(
            batch(
              [p("901", "A", { title: null }), p("902", "B", { title: null })],
              "2026-09-07T02:04:00Z",
            ),
            options,
          );
          const afterA = await property("901"),
            afterB = await property("902");
          assert.equal(afterA.description, "Manual text");
          assert.equal(afterB.description, null);
          assert.equal(afterA.bathrooms, 2);
          assert.equal(afterB.bathrooms, null);
          assert.equal(afterA.orientation, null);
          assert.equal(afterB.orientation, "Manual direction");
          assert.equal(afterA.title_zh, "Source title");
          assert.equal(afterA.district_slug, "test");
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
