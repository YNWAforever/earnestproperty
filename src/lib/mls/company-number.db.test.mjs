import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@neondatabase/serverless";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot as ingestService } from "./ingestion-service.mjs";
const url = process.env.ASTRA_TEST_DATABASE_URL;
test(
  "company-number ingestion on approved disposable isolated schema",
  { skip: !url },
  async (t) => {
    await assertDisposableNeonTestTarget(process.env.ASTRA_TEST_DATABASE_URL);
    assert.notEqual(url, process.env.DATABASE_URL_UNPOOLED);
    const schema = "company_" + randomUUID().replaceAll("-", "");
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

      await q(
        "UPDATE mls_ingestion_policies SET config=config || $1::jsonb WHERE source='28hse_agent_540'",
        [
          JSON.stringify({
            company_number_identity: {
              approved: true,
              version: "company-number-v1",
              approved_by: "test",
            },
          }),
        ],
      );
      await t.test(
        "historical admin winner keeps identity, multi-ad links converge and sale/rent share issued group",
        async () => {
          await q(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,source_updated_at) VALUES('OLD-1','A034601','Old','sale','test','active','2026-01-01'),('OLD-2','A034601','Authoritative','sale','test','active','2026-02-01')",
          );
          const before = await q(
            "SELECT p.id,p.listing_no,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id ORDER BY p.listing_no",
          );
          const rows = [
            row("1", { agency_property_no: "A034601" }),
            row("2", { agency_property_no: "A034601" }),
            row("3", {
              agency_property_no: "A034601",
              deal_type: "rent",
              source_url: "https://www.28hse.com/rent/example/property-3",
              price: null,
              rent: 18000,
            }),
            row("4", { agency_property_no: "B123456" }),
          ];
          const result = await ingestSnapshot(batch(rows), options);
          assert.equal(result.summary.properties_created, 2);
          const links = await q(
            "SELECT external_listing_id,property_id FROM property_source_links ORDER BY external_listing_id",
          );
          assert.equal(links[0].property_id, before[1].id);
          assert.equal(links[1].property_id, before[1].id);
          assert.deepEqual(
            await q(
              "SELECT p.id,p.listing_no,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE p.listing_no LIKE 'OLD-%' ORDER BY p.listing_no",
            ),
            before,
          );
          assert.equal(
            (
              await q(
                "SELECT count(*)::int n FROM property_public_members WHERE public_listing_no='A034601'",
              )
            )[0].n,
            3,
          );
          assert.equal(
            (
              await q(
                "SELECT count(*)::int n FROM property_public_groups g WHERE NOT EXISTS(SELECT 1 FROM property_public_members m WHERE m.public_listing_no=g.public_listing_no)",
              )
            )[0].n,
            0,
          );
          assert.equal(
            (await q("SELECT count(*)::int n FROM properties WHERE status='draft'"))[0].n,
            2,
          );
          assert.deepEqual(await ingestService(batch(rows), options), result);
          rows[1].price = 9999999;
          await ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), options);
          assert.ok(
            (await q("SELECT * FROM mls_ingestion_conflicts WHERE field_name='price'")).length,
          );
          rows[0].agency_property_no = "B123456";
          await ingestSnapshot(batch(rows, "2026-09-09T00:00:00Z"), options);
          assert.equal(
            (
              await q("SELECT property_id FROM property_source_links WHERE external_listing_id='1'")
            )[0].property_id,
            before[1].id,
          );
          assert.ok(
            (await q("SELECT * FROM mls_ingestion_reviews WHERE reason='company_number_changed'"))
              .length,
          );
        },
      );
      await t.test(
        "approved legacy baselines exclude all overrides and unknown ownership; rollback remains atomic",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          await q(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status,source_updated_at,source_url,price,description,floor) VALUES('BASE','C123456','Legacy','sale','test','active','2026-01-01','https://legacy.example/property/1',100,'Manual text','9')",
          );
          const p = (await q("SELECT * FROM properties WHERE listing_no='BASE'"))[0];
          await q("INSERT INTO admin_property_overrides(property_no,shared) VALUES('C123456',$1)", [
            JSON.stringify({ description: "Manual text" }),
          ]);
          await q(
            "INSERT INTO property_sync_fields(property_id,field_name,last_published_value,selection_reason,policy_version) VALUES($1,'floor',$2,'manual_override','no-hermes-v2')",
            [p.id, JSON.stringify("9")],
          );
          const rule = {
            approved: true,
            version: "company-number-v1",
            approved_by: "test",
            legacy_field_ownership: {
              approved: true,
              baselines: {
                [p.id]: {
                  price: p.price,
                  description: p.description,
                  floor: p.floor,
                  status: p.status,
                },
              },
            },
          };
          await q(
            "UPDATE mls_ingestion_policies SET config=jsonb_set(config,'{company_number_identity}',$1::jsonb) WHERE source='28hse_agent_540'",
            [JSON.stringify(rule)],
          );
          const rows = [
            row("50", {
              agency_property_no: "C123456",
              price: 200,
              description: "Source changed",
              floor: "10",
            }),
          ];
          await ingestSnapshot(batch(rows), options);
          const after = (await q("SELECT * FROM properties WHERE id=$1", [p.id]))[0];
          assert.equal(Number(after.price), 200);
          assert.equal(after.description, "Manual text");
          assert.equal(after.floor, "9");
          assert.equal(after.title_zh, "Legacy");
          assert.equal(
            (
              await q(
                "SELECT * FROM property_sync_fields WHERE property_id=$1 AND field_name='description'",
                [p.id],
              )
            ).length,
            0,
          );
          assert.equal(
            (
              await q(
                "SELECT selection_reason FROM property_sync_fields WHERE property_id=$1 AND field_name='floor'",
                [p.id],
              )
            )[0].selection_reason,
            "manual_override",
          );
          rows[0].price = 300;
          await assert.rejects(() =>
            ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), {
              ...options,
              beforeCommit: () => {
                throw new Error("rollback-company");
              },
            }),
          );
          assert.equal(
            Number((await q("SELECT price FROM properties WHERE id=$1", [p.id]))[0].price),
            200,
          );
          assert.equal((await q("SELECT count(*)::int n FROM mls_ingestion_receipts"))[0].n, 1);
        },
      );
      await t.test(
        "new offer stays draft when group carries an active status override",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          await q(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status) VALUES('DRAFT-BASE','D123456','Existing','sale','test','active')",
          );
          await q("INSERT INTO admin_property_overrides(property_no,shared) VALUES('D123456',$1)", [
            JSON.stringify({ status: "active" }),
          ]);
          const rows = [
            row("60", {
              agency_property_no: "D123456",
              deal_type: "rent",
              source_url: "https://www.28hse.com/rent/example/property-60",
              price: null,
              rent: 18000,
            }),
          ];
          await ingestSnapshot(batch(rows), options);
          assert.equal(
            (await q("SELECT status FROM properties WHERE deal_type='rent'"))[0].status,
            "draft",
          );
          assert.ok(
            (
              await q(
                "SELECT * FROM mls_ingestion_reviews WHERE reason='draft_status_override_requires_review'",
              )
            ).length,
          );
          await ingestSnapshot(batch(rows, "2026-09-08T00:00:00Z"), options);
          assert.equal(
            (await q("SELECT status FROM properties WHERE deal_type='rent'"))[0].status,
            "draft",
          );
        },
      );
      await t.test(
        "verified estate map assigns new drafts and issued legacy aliases block company collisions",
        async () => {
          await q("TRUNCATE properties,listing_sync_runs CASCADE");
          const estateId = randomUUID();
          await q(
            "UPDATE mls_ingestion_policies SET config=config || $1::jsonb WHERE source='28hse_agent_540'",
            [
              JSON.stringify({
                estate_mappings: {
                  "Estate Phase 1": { estate_id: estateId, district_slug: "tsing-lung-tau" },
                },
                district_slugs: { Test: "sham-tseng" },
              }),
            ],
          );
          await q(
            "INSERT INTO properties(listing_no,canonical_property_no,title_zh,deal_type,district_slug,status) VALUES('E123456','F123456','Issued legacy alias','sale','test','active')",
          );
          const rows = [
            row("70", { agency_property_no: "G123456" }),
            row("71", { agency_property_no: "E123456" }),
          ];
          await ingestSnapshot(batch(rows), options);
          const draft = (
            await q("SELECT * FROM properties WHERE canonical_property_no='G123456'")
          )[0];
          assert.equal(draft.estate_id, estateId);
          assert.equal(draft.district_slug, "tsing-lung-tau");
          assert.equal(
            (await q("SELECT * FROM properties WHERE canonical_property_no='E123456'")).length,
            0,
          );
          assert.ok(
            (await q("SELECT * FROM mls_ingestion_reviews WHERE reason='company_group_ambiguous'"))
              .length,
          );
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
