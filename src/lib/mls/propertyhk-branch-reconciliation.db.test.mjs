import assert from "node:assert/strict";
import test from "node:test";
import {
  withOwnedPostgres,
  ownedMlsPorts,
} from "../../../scripts/acceptance/owned-postgres-test.mjs";
import { batch, row } from "./ingestion-test-fixtures.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import sharp from "sharp";
import { publishDaily } from "./daily-publication.mjs";
import { prepareListingMedia } from "./media.mjs";
import { canonicalListingCte } from "../neon/public-listing-query.js";

test("EP-09/10 owned full schema reconciles branch aliases, dual offers and incomplete evidence without inventing authority", async (t) => {
  await withOwnedPostgres(async ({ pool, query }) => {
    const ports = { ...ownedMlsPorts(pool), apply: true };
    await query(`INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,id_scope,config)
    VALUES('propertyhk','branches:EPW,EPS,EPT','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'synthetic-owned','global','{"district_slugs":{"Test":"test"},"source_url_identity":{"verified":true,"path_template":"/fixture/{branch}/{id}"}}')`);
    const rows = [
      row("000123", {
        unit: "A",
        branch_code: "EPS",
        branch_memberships: ["EPS", "EPT", "EPW"],
        source_url: "https://www.property.hk/fixture/EPS/000123",
      }),
      row("000123", {
        unit: "A",
        deal_type: "rent",
        price: null,
        rent: 22000,
        branch_code: "EPS",
        branch_memberships: ["EPS", "EPT", "EPW"],
        source_url: "https://www.property.hk/fixture/EPS/000123",
      }),
      row("000124", {
        unit: "B",
        branch_code: "EPT",
        branch_memberships: ["EPS", "EPT", "EPW"],
        source_url: "https://www.property.hk/fixture/EPT/000124",
      }),
    ];
    const payload = batch(rows, new Date(Date.now() - 3600000).toISOString(), "propertyhk");
    await t.test(
      "dry run has no writes; persisted replay preserves distinct sale/rent and leading zero IDs",
      async () => {
        const dry = await ingestSnapshot(payload);
        assert.equal(dry.status, "dry_run");
        assert.equal((await query("SELECT count(*)::int n FROM properties"))[0].n, 0);
        const result = await ingestSnapshot(payload, ports);
        assert.equal(result.full_snapshot, true);
        assert.equal(result.summary.advertisement_count, 2);
        assert.equal(result.summary.offer_count, 3);
        assert.deepEqual(await ingestSnapshot(payload, ports), result);
        assert.deepEqual(
          (
            await query(
              "SELECT external_listing_id,deal_type::text FROM mls_source_state ORDER BY external_listing_id,deal_type::text",
            )
          ).map((s) => [s.external_listing_id, s.deal_type]),
          [
            ["000123", "rent"],
            ["000123", "sale"],
            ["000124", "sale"],
          ],
        );
        assert.equal((await query("SELECT count(*)::int n FROM properties"))[0].n, 3);
        assert.equal((await query("SELECT count(*)::int n FROM mls_ingestion_receipts"))[0].n, 1);
      },
    );
    await t.test(
      "missing branch/detail/page or failed acquisition cannot replace the accepted baseline",
      async () => {
        const before = await query(
          "SELECT source,scope_id,full_receipt_id FROM mls_ingestion_scopes",
        );
        const inventoryBefore = await query(
          "SELECT id,md5(row_to_json(p)::text) AS fingerprint FROM properties p ORDER BY id",
        );
        const receiptsBefore = await query(
          "SELECT id,payload_hash,response FROM mls_ingestion_receipts ORDER BY id",
        );
        const authorityFlags = [
          "full_snapshot",
          "details_verified",
          "id_scope_verified",
          "full_branch_scope_verified",
        ];
        for (const variant of [
          "branch",
          "detail",
          "page",
          "http403",
          "index_only",
          ...authorityFlags.flatMap((flag) => [`meta:${flag}`, `envelope:${flag}`]),
        ]) {
          const partial = structuredClone(payload);
          partial.scraped_at = new Date(Date.parse(payload.scraped_at) + 1000).toISOString();
          if (variant === "branch") {
            partial.meta.completed_branches = ["EPS", "EPT"];
            partial.branches = ["EPS", "EPT"];
          }
          if (variant === "detail")
            partial.meta.pages.find((p) => p.status === "listings").details_complete = false;
          if (variant === "page")
            partial.meta.pages.find((p) => p.scope === "EPS" && p.status === "terminal").page = 3;
          if (variant === "http403") {
            partial.meta.crawl_complete = false;
            partial.meta.pages_failed = 1;
          }
          if (variant === "index_only") partial.listings[0].observation_kind = "index_only";
          if (variant.includes(":")) {
            const [location, flag] = variant.split(":");
            (location === "meta" ? partial.meta : partial)[flag] = false;
          }
          await assert.rejects(
            ingestSnapshot(partial, ports),
            (e) => e.code === "incomplete_snapshot" || e.status === 422 || e.status === 400,
          );
          assert.deepEqual(
            await query("SELECT source,scope_id,full_receipt_id FROM mls_ingestion_scopes"),
            before,
          );
          assert.deepEqual(
            await query(
              "SELECT id,md5(row_to_json(p)::text) AS fingerprint FROM properties p ORDER BY id",
            ),
            inventoryBefore,
          );
          assert.deepEqual(
            await query("SELECT id,payload_hash,response FROM mls_ingestion_receipts ORDER BY id"),
            receiptsBefore,
          );
        }
        assert.equal(
          (await query("SELECT count(*)::int n FROM properties WHERE status='inactive'"))[0].n,
          0,
        );
      },
    );
  });
});

test("EP-10 synthetic detail and real image bytes publish once, preserve source aliases and survive the next ingestion", async () => {
  await withOwnedPostgres(async ({ pool, query }) => {
    const client = await pool.connect();
    try {
      const [estate] = await query(
        "INSERT INTO estates(slug,name_zh,district_slug) VALUES('qa-propertyhk','合成屋苑','sham-tseng') RETURNING id",
      );
      const config = {
        district_slugs: { Test: "sham-tseng" },
        estate_mappings: { "Test Estate": { estate_id: estate.id, district_slug: "sham-tseng" } },
        source_url_identity: { verified: true, path_template: "/fixture/{branch}/{id}" },
        publication_verified: true,
        media_rights_confirmed: true,
        allowed_media_hosts_verified: true,
        allowed_media_hosts: ["media.fixture.property.hk"],
      };
      await query(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,id_scope,config)
         VALUES('propertyhk','branches:EPW,EPS,EPT','no-hermes-v2','fixture-v2','no-hermes-v2',true,now(),'synthetic-owned','global',$1)`,
        [JSON.stringify(config)],
      );
      const rows = ["000123", "000124"].map((id) =>
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
            description: "Synthetic owned detail, not provider evidence",
            images: ["https://media.fixture.property.hk/photo.png"],
          },
        }),
      );
      const stamp = new Date(Date.now() - 3600000).toISOString();
      const payload = batch(rows, stamp, "propertyhk");
      const ports = { ...ownedMlsPorts(pool), apply: true };
      const receipt = await ingestSnapshot(payload, ports);
      assert.equal(receipt.summary.properties_created, 1);
      const [before] = await query(
        "SELECT p.id,p.status,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id",
      );
      assert.equal(before.status, "draft");
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
      const result = await publishDaily({ payload, client, apply: true, blobStore, prepare });
      assert.equal(result.published.length, 1, JSON.stringify(result));
      assert.equal(result.duplicateCanonical, 1);
      assert.equal(uploads, 1);
      assert.equal(fetches, 1);
      const [after] = await query(
        "SELECT p.id,p.status,p.images,p.description,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id",
      );
      assert.equal(after.status, "active");
      assert.equal(after.id, before.id);
      assert.equal(after.public_listing_no, before.public_listing_no);
      assert.equal(after.images.length, 1);
      assert.equal((await query("SELECT count(*)::int n FROM media_assets"))[0].n, 1);
      assert.equal(
        (await query(canonicalListingCte("TRUE") + " SELECT count(*)::int n FROM canonical"))[0].n,
        1,
      );
      assert.equal((await query("SELECT count(*)::int n FROM mls_source_state"))[0].n, 2);
      assert.equal(
        (await publishDaily({ payload, client, apply: true, blobStore, prepare })).alreadyPublic,
        2,
      );
      assert.equal(uploads, 1);
      assert.equal(fetches, 1);
      await query("UPDATE mls_ingestion_receipts SET accepted_at=now()-interval '2 hours'");
      await ingestSnapshot(
        batch(rows, new Date(Date.parse(stamp) + 60000).toISOString(), "propertyhk"),
        ports,
      );
      assert.deepEqual(
        (
          await query(
            "SELECT p.id,p.status,p.images,p.description,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id",
          )
        )[0],
        after,
      );
    } finally {
      client.release();
    }
  });
});
