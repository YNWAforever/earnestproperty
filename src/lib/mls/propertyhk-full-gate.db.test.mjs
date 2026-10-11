import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { onDbTarget, targetClientPorts } from "../../../scripts/acceptance/owned-postgres-test.mjs";

// Owned Docker Postgres by default; ASTRA_TEST_DATABASE_URL (behind the disposable guard) keeps
// the on-demand Neon run of property-sync-acceptance.yml. In CI a missing database fails.
const neonRun = { urlVar: "ASTRA_TEST_DATABASE_URL" };

test(
  "Property.hk branch collapse cannot bypass full gate on real SQL",
  onDbTarget(async (target) => {
    const { connectionString, createClient: newClient } = await targetClientPorts(target);
    const schema = "branch_gate_" + randomUUID().replaceAll("-", "");
    const client = newClient({ connectionString });
    await client.connect();
    const q = async (s, p = []) => (await client.query(s, p)).rows;
    const createClient = (config) => {
      const c = newClient(config);
      const connect = c.connect.bind(c);
      c.connect = async () => {
        await connect();
        await c.query(`SET search_path TO ${schema},public,pg_catalog`);
      };
      return c;
    };
    const options = { connectionString, apply: true, createClient };
    try {
      await q(`CREATE SCHEMA ${schema}`);
      await q(`SET search_path TO ${schema},public,pg_catalog`);
      await q(
        "CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS); ALTER TABLE properties ADD PRIMARY KEY(id); CREATE UNIQUE INDEX properties_listing_no_key ON properties(listing_no)",
      );
      await q(
        "CREATE TABLE media_assets(id uuid PRIMARY KEY);CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean);CREATE TABLE staff_roles(staff_user_id uuid,role text);CREATE TABLE audit_logs(actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
      );
      for (const name of [
        "20260817120000_dual_source_listing_sync.sql",
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
        "20260907120000_propertyhk_ingestion_v2.sql",
      ])
        await q(readFileSync("neon/migrations/" + name, "utf8"));
      await q(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,id_scope,config) VALUES('propertyhk','branches:EPW,EPS,EPT','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'fixture','global','{"district_slugs":{"Test":"test"},"source_url_identity":{"verified":true,"path_template":"/fixture/{branch}/{id}"}}')`,
      );
      const rows = Array.from({ length: 4 }, (_, i) =>
        row("hk" + i, {
          unit: String(i + 1),
          branch_code: "EPW",
          branch_memberships: ["EPW", "EPS", "EPT"],
          source_url: `https://www.property.hk/fixture/EPW/hk${i}`,
        }),
      );
      const payload = batch(rows, "2026-09-29T00:00:00Z", "propertyhk");
      const first = await ingestSnapshot(payload, options);
      assert.equal(first.full_snapshot, true);
      assert.equal(first.summary.properties_created, 4);
      assert.deepEqual(await ingestSnapshot(payload, options), first);
      await q("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours'");
      const before = await q(
        "SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='propertyhk'",
      );
      const collapsed = batch(
        rows.map((r) => ({ ...r, branch_memberships: ["EPW", "EPT"] })),
        "2026-09-30T00:00:00Z",
        "propertyhk",
      );
      await assert.rejects(
        ingestSnapshot(collapsed, options),
        (e) =>
          e.code === "incomplete_snapshot" && e.details.reasons.includes("branch_count_drop_EPS"),
      );
      assert.deepEqual(
        await q("SELECT full_receipt_id FROM mls_ingestion_scopes WHERE source='propertyhk'"),
        before,
      );
      assert.equal((await q("SELECT count(*)::int n FROM mls_ingestion_receipts"))[0].n, 1);
      assert.equal((await q("SELECT count(*)::int n FROM properties"))[0].n, 4);
      const partial = batch(rows, "2026-09-30T00:00:00Z", "propertyhk");
      partial.meta.worker_rejected_count = 1;
      partial.meta.rejected_records = [
        { scope: "EPS", property_id: "missing", reason: "invalid_record" },
      ];
      partial.meta.pages.find((p) => p.scope === "EPS").ids.push("missing");
      await assert.rejects(
        ingestSnapshot(partial, options),
        (e) =>
          e.code === "incomplete_snapshot" &&
          e.details.reasons.includes("incomplete_branch_details"),
      );
      assert.equal((await q("SELECT count(*)::int n FROM mls_ingestion_receipts"))[0].n, 1);
    } finally {
      await q("ROLLBACK");
      await q("RESET search_path");
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  }, neonRun),
);
