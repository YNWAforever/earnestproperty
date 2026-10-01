import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@neondatabase/serverless";
import sharp from "sharp";
import { assertDisposableNeonTestTarget } from "../neon/disposable-test-target.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { publishDaily } from "./daily-publication.mjs";
import { prepareListingMedia } from "./media.mjs";

test(
  "Property.hk real SQL import replay owned-media publication next ingestion preserve one canonical",
  { skip: !process.env.ASTRA_TEST_DATABASE_URL },
  async () => {
    const connectionString = process.env.ASTRA_TEST_DATABASE_URL;
    await assertDisposableNeonTestTarget(connectionString);
    const schema = "hk_publication_" + randomUUID().replaceAll("-", "");
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
        "CREATE TABLE properties(LIKE public.properties INCLUDING DEFAULTS INCLUDING CONSTRAINTS);ALTER TABLE properties ADD PRIMARY KEY(id);CREATE UNIQUE INDEX properties_listing_no_key ON properties(listing_no)",
      );
      await q(
        "CREATE TABLE media_assets(LIKE public.media_assets INCLUDING DEFAULTS INCLUDING CONSTRAINTS);ALTER TABLE media_assets ADD PRIMARY KEY(id);CREATE TABLE staff_users(id uuid PRIMARY KEY,active boolean);CREATE TABLE staff_roles(staff_user_id uuid,role text);CREATE TABLE audit_logs(actor_id uuid,action text,subject_type text,subject_id uuid,metadata jsonb)",
      );
      for (const name of [
        "20260817120000_dual_source_listing_sync.sql",
        "20260906040000_property_public_identity.sql",
        "20260906090000_canonical_property_identity.sql",
        "20260906120000_admin_property_management.sql",
        "20260907120000_propertyhk_ingestion_v2.sql",
      ])
        await q(readFileSync("neon/migrations/" + name, "utf8"));
      const config = {
        district_slugs: { Test: "test" },
        estate_mappings: { "Test Estate": { estate_id: randomUUID(), district_slug: "test" } },
        source_url_identity: { verified: true, path_template: "/fixture/{branch}/{id}" },
        publication_verified: true,
        media_rights_confirmed: true,
        allowed_media_hosts_verified: true,
        allowed_media_hosts: ["media.fixture.property.hk"],
      };
      await q(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,id_scope,config) VALUES('propertyhk','branches:EPW,EPS,EPT','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'fixture','global',$1)`,
        [JSON.stringify(config)],
      );
      const stamp = new Date(Date.now() - 3600000).toISOString();
      const rows = ["P1", "P2"].map((id) =>
        row(id, {
          estate: "Test Estate",
          block: "1",
          floor: "12",
          unit: "A",
          saleable_area: "500",
          source_status: "active",
          branch_code: "EPW",
          branch_memberships: ["EPW", "EPS", "EPT"],
          source_url: "https://www.property.hk/fixture/EPW/" + id,
          publication: {
            description: "Literal synthetic detail description",
            images: ["https://media.fixture.property.hk/photo.png"],
          },
        }),
      );
      const payload = batch(rows, stamp, "propertyhk"),
        opts = { connectionString, apply: true, createClient };
      const receipt = await ingestSnapshot(payload, opts);
      assert.equal(receipt.summary.properties_created, 1);
      assert.deepEqual(await ingestSnapshot(payload, opts), receipt);
      const before = (
        await q(
          "SELECT p.id,p.status,p.canonical_property_no,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id",
        )
      )[0];
      assert.equal(before.status, "draft");
      assert.equal(before.canonical_property_no, null);
      let uploads = 0,
        fetches = 0;
      const png = await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#486e84" },
      })
        .png()
        .toBuffer();
      const blobStore = {
        put: async (input) => {
          uploads++;
          return {
            url: "https://owned.fixture.example/" + input.pathname,
            pathname: input.pathname,
            contentType: input.contentType,
            size: input.body.byteLength,
          };
        },
      };
      const prepare = (options) =>
        prepareListingMedia({
          ...options,
          resolveHost: async () => ["8.8.8.8"],
          transport: async () => {
            fetches++;
            return new Response(png, { headers: { "content-type": "image/png" } });
          },
        });
      const published = await publishDaily({ payload, client: c, apply: true, blobStore, prepare });
      assert.equal(published.published.length, 1, JSON.stringify(published));
      assert.equal(published.duplicateCanonical, 1);
      assert.equal(uploads, 1);
      assert.equal(fetches, 1);
      const after = (
        await q(
          "SELECT p.id,p.status,p.images,p.description,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id",
        )
      )[0];
      assert.equal(after.status, "active");
      assert.equal(after.id, before.id);
      assert.equal(after.public_listing_no, before.public_listing_no);
      assert.equal(after.images.length, 1);
      assert.equal((await q("SELECT count(*)::int n FROM media_assets"))[0].n, 1);
      assert.equal(
        (await publishDaily({ payload, client: c, apply: true, blobStore, prepare })).alreadyPublic,
        2,
      );
      assert.equal(uploads, 1);
      assert.equal(fetches, 1);
      await q("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours'");
      const next = batch(rows, new Date(Date.parse(stamp) + 60000).toISOString(), "propertyhk");
      await ingestSnapshot(next, opts);
      const final = (
        await q(
          "SELECT p.id,p.status,p.images,p.description,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id",
        )
      )[0];
      assert.deepEqual(final, after);
      assert.equal((await q("SELECT count(*)::int n FROM properties"))[0].n, 1);
    } finally {
      await q("ROLLBACK");
      await q("RESET search_path");
      await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await c.end();
    }
  },
);
