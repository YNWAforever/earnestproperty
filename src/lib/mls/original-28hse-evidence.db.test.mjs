import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { openSyncTestDatabase } from "./sync-test-database.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";

const path = process.env.PROPERTY_SYNC_PRIVATE_REGRESSION_REQUEST;
test(
  "original private 28Hse request exact-byte disposable replay preserves receipts and aliases",
  { skip: !path || !process.env.ASTRA_TEST_DATABASE_URL, timeout: 1200000 },
  async () => {
    const bytes = readFileSync(path);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      "b458d085b60aeb241006daf0f11919a54a5e9ef490528854b594d522cac3bd55",
    );
    const payload = JSON.parse(bytes);
    assert.equal(payload.scraped_at, "2026-10-01T02:50:22.963602Z");
    assert.equal(payload.listings.length, 286);
    const db = await openSyncTestDatabase();
    try {
      // Synthetic mapping approvals exist only in this isolated random schema.
      // They are not production mapping verification or a publication qualification.
      const district_slugs = Object.fromEntries(
        [...new Set(payload.listings.map((r) => r.district).filter(Boolean))].map((name, i) => [
          name,
          `fixture-district-${i}`,
        ]),
      );
      const estate_mappings = Object.fromEntries(
        [...new Set(payload.listings.map((r) => r.estate).filter(Boolean))].map((name) => [
          name,
          {
            estate_id: randomUUID(),
            district_slug: district_slugs[payload.listings.find((r) => r.estate === name).district],
          },
        ]),
      );
      const config = {
        absence_enabled: false,
        district_slugs,
        estate_mappings,
        company_number_identity: {
          approved: true,
          version: "company-number-v1",
          approved_by: "disposable synthetic fixture only",
        },
      };
      await db.query(
        `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,id_scope,config) VALUES('28hse_agent_540','agent:540','no-hermes-v2','python-v2.2','no-hermes-v2',true,now(),'disposable fixture',NULL,$1)`,
        [JSON.stringify(config)],
      );
      const options = {
        connectionString: db.connectionString,
        apply: true,
        createClient: db.createClient,
      };
      const receipt = await ingestSnapshot(payload, options);
      assert.equal(receipt.status, "success");
      assert.equal(receipt.full_snapshot, true);
      assert.equal(receipt.summary.advertisement_count, 286);
      const canonical = await db.query(
        "SELECT p.id,p.status,p.canonical_property_no,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id ORDER BY p.id",
      );
      const samples = await db.query(
        `SELECT l.external_listing_id,p.canonical_property_no,m.public_listing_no FROM property_source_links l JOIN properties p ON p.id=l.property_id JOIN property_public_members m ON m.property_id=p.id WHERE l.external_listing_id=ANY($1::text[]) ORDER BY l.external_listing_id`,
        [["4033913", "4034357", "4034591"]],
      );
      assert.deepEqual(
        samples.map((r) => [r.external_listing_id, r.canonical_property_no]),
        [
          ["4033913", "A072390"],
          ["4034357", "B059410"],
          ["4034591", "A057717"],
        ],
      );
      for (const sample of samples)
        assert.equal(sample.public_listing_no, sample.canonical_property_no);
      const counts = await db.query(
        "SELECT (SELECT count(*) FROM properties)::int AS canonical,(SELECT count(*) FROM listing_source_observations)::int AS observations,(SELECT count(*) FROM property_source_links)::int AS links,(SELECT count(*) FROM mls_ingestion_receipts)::int AS receipts,(SELECT count(*) FROM properties WHERE status='inactive')::int AS inactive",
      );
      assert.ok(counts[0].canonical <= 286 && counts[0].canonical > 0);
      assert.equal(counts[0].observations, 286);
      assert.equal(counts[0].receipts, 1);
      assert.equal(counts[0].inactive, 0);
      const again = await ingestSnapshot(JSON.parse(readFileSync(path, "utf8")), options);
      assert.deepEqual(again, receipt);
      assert.deepEqual(
        await db.query(
          "SELECT p.id,p.status,p.canonical_property_no,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id ORDER BY p.id",
        ),
        canonical,
      );
      assert.deepEqual(
        await db.query(
          "SELECT (SELECT count(*) FROM properties)::int AS canonical,(SELECT count(*) FROM listing_source_observations)::int AS observations,(SELECT count(*) FROM property_source_links)::int AS links,(SELECT count(*) FROM mls_ingestion_receipts)::int AS receipts,(SELECT count(*) FROM properties WHERE status='inactive')::int AS inactive",
        ),
        counts,
      );
      assert.equal(readFileSync(path).compare(bytes), 0);
      if (process.env.PROPERTY_SYNC_PRIVATE_REGRESSION_REPORT)
        writeFileSync(
          process.env.PROPERTY_SYNC_PRIVATE_REGRESSION_REPORT,
          JSON.stringify(
            {
              status: "PASS",
              environment: "disposable Neon random schema",
              syntheticMappingApprovals: true,
              requestSha256: createHash("sha256").update(bytes).digest("hex"),
              scrapedAt: payload.scraped_at,
              receiptId: receipt.receipt_id,
              counts: counts[0],
              actualWrites: receipt.summary,
              samples,
              replayIdentical: true,
              productionWrites: 0,
            },
            null,
            2,
          ),
        );
    } finally {
      await db.close();
    }
  },
);
