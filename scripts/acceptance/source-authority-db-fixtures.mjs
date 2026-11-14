import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { withOwnedPostgres } from "./owned-postgres-test.mjs";
import { MIGRATION_VERSIONS } from "../../src/lib/control-plane/migration-versions.js";
import { incrementalBatch, member } from "../../src/lib/mls/incremental-test-fixtures.mjs";
import { row } from "../../src/lib/mls/ingestion-test-fixtures.mjs";
import { applyIngestion } from "../../src/lib/mls/ingestion-repository.mjs";
import { SOURCE_28HSE } from "../../src/lib/mls/source-contract.mjs";
import { SOURCE_AUTHORITY_POLICY } from "../../src/lib/mls/source-authority-policy.mjs";
import { hashPayload } from "../../src/lib/mls/ingestion-contract.mjs";

export const AUTHORITY_MIGRATION = "20261114040000_property_source_authority.sql";
export const AUTHORITY_HOST = "owned-authority.public.blob.vercel-storage.com";
export const AUTHORITY_NOW = Date.parse("2026-11-14T06:00:00Z");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let sequence = 0;

// All text and provider bytes are generated offline. This is a prepare seam:
// media validation is tested elsewhere; these tests exercise real persistence,
// observation/property/asset FKs and atomic publication after validation succeeds.
export async function prepareAuthorityMedia({
  observation,
  observationId,
  propertyId,
  repository,
}) {
  for (const candidate of observation.mediaCandidates) {
    const hash = sha("owned-test-image:" + candidate.url);
    const pathname = `mls/${hash.slice(0, 2)}/${hash}.jpg`;
    const { asset } = await repository.registerOwnedMedia({
      url: `https://${AUTHORITY_HOST}/${pathname}`,
      pathname,
      contentType: "image/jpeg",
      sizeBytes: 256,
      contentHash: hash,
      ownerType: "property",
      ownerId: propertyId,
      createdBy: null,
    });
    await repository.saveMediaRecord({
      observationId,
      propertyId,
      sourceUrl: candidate.url,
      contentHash: hash,
      ownedMediaAssetId: asset.id,
      detectedMime: "image/jpeg",
      sizeBytes: 256,
      width: 400,
      height: 300,
      eligibility: "eligible",
      rejectionReason: null,
    });
  }
  return { publishable: true, uploadCount: observation.mediaCandidates.length };
}

export function authorityCapture(entries) {
  const base = Date.parse("2026-11-14T03:00:00Z") + sequence++ * 60000;
  const evidence = { errors: [], selected_candidates: [], requests: [], provider_requests: [] };
  const listings = entries.map((entry, index) => {
    const id = entry.id;
    const deal = entry.deal ?? "sale";
    const captured = new Date(base + index * 1000).toISOString();
    const url = `https://www.28hse.com/${deal === "sale" ? "buy" : "rent"}/apartment/property-${id}`;
    const html = `<!doctype html><html><head><title>Offline ${id}</title></head><body><h1>Authority fixture ${id}</h1><p>4 房</p></body></html>`;
    const digest = sha(html);
    const provider = Buffer.from(
      JSON.stringify({
        success: true,
        data: {
          rawHtml: html,
          metadata: { url, sourceURL: url, statusCode: 200, proxyUsed: "basic" },
        },
      }),
    );
    const result = row(id, {
      source_url: url,
      agency_property_no: entry.ref,
      deal_type: deal,
      title: `Current source ${id}`,
      district: "Authority Test District",
      estate: "Authority Test Estate",
      block: null,
      floor: "12/F",
      unit: null,
      saleable_area: 500,
      gross_area: 600,
      bedrooms: 4,
      bathrooms: 2,
      orientation: "East",
      price: deal === "sale" ? 7300000 : null,
      rent: deal === "rent" ? 20000 : null,
      source_status: "active",
      agent_name: "Offline source agent",
      agent_phone: "12345678",
      promotion_tier_raw: "黃金",
      captured_at: captured,
      detail_fetched_at: captured,
      source_updated_at: null,
      publication: {
        description: `Current captured description ${id}`,
        images: entry.noGallery ? [] : [`https://i1.28hse.com/authority-${id}.jpg`],
      },
      ...entry.values,
    });
    result.raw_payload = {
      detail_fields: { bedrooms: String(result.bedrooms), price: String(result.price) },
      source_conflicts: entry.domConflict
        ? [
            {
              field: "bedrooms",
              dom: result.bedrooms,
              json_ld: 1,
              resolution: "dom",
              status: "review",
            },
          ]
        : [],
      incremental: {
        mode: "index-delta-v1",
        detail_fetched_at: captured,
        detail_body_sha256: digest,
      },
    };
    evidence.selected_candidates.push({
      property_id: id,
      deal_type: deal,
      source_url: url,
      status: "fetched",
      detail_fetched_at: captured,
      detail_body_sha256: digest,
    });
    evidence.requests.push({ url, status: 200, html });
    evidence.provider_requests.push({
      request: { url, proxy: "basic" },
      provider_status: 200,
      body_base64: provider.toString("base64"),
      body_sha256: sha(provider),
    });
    return result;
  });
  const payload = incrementalBatch({
    members: entries.map((entry) => member(entry.id, entry.deal ?? "sale")),
    listings,
    stamp: new Date(base + entries.length * 1000 + 5000).toISOString(),
  });
  payload.meta.run_id = randomUUID();
  payload.meta.incremental.index_started_at = new Date(base - 10000).toISOString();
  payload.meta.incremental.index_finished_at = new Date(base - 5000).toISOString();
  return { payload, evidence };
}

export async function withAuthorityDatabase(run) {
  // Never accepts Root.env, DATABASE_URL, TEST_DATABASE_URL or a caller URL.
  // Every object and FK comes from the complete real migration chain in a new
  // loopback-only Docker container owned and verified by the repository harness.
  const versions = MIGRATION_VERSIONS.includes(AUTHORITY_MIGRATION)
    ? MIGRATION_VERSIONS
    : [...MIGRATION_VERSIONS, AUTHORITY_MIGRATION];
  return withOwnedPostgres(
    async ({ pool, query }) => {
      assert.equal(pool.options.host, "127.0.0.1");
      const client = await pool.connect();
      const q = async (sql, params = []) => (await client.query(sql, params)).rows;
      try {
        await q(
          "INSERT INTO districts(slug,name_zh,name_en) VALUES('authority-test','Authority Test District','Authority Test District')",
        );
        const estateId = (
          await q(
            "INSERT INTO estates(slug,name_zh,name_en,district_slug) VALUES('authority-test-estate','Authority Test Estate','Authority Test Estate','authority-test') RETURNING id",
          )
        )[0].id;
        const config = {
          absence_enabled: false,
          max_batches_per_hour: 1000,
          public_contacts_enabled: true,
          district_slugs: { "Authority Test District": "authority-test" },
          estate_mappings: {
            "Authority Test Estate": { estate_id: estateId, district_slug: "authority-test" },
          },
          company_number_identity: {
            approved: true,
            version: "company-number-v1",
            approved_by: "owned-db-fixture",
          },
          source_authority: {
            version: SOURCE_AUTHORITY_POLICY,
            approved: true,
            approval_ref: "owned-db:source-authority",
          },
        };
        await q(
          `INSERT INTO mls_ingestion_policies(source,scope_id,policy_version,parser_version,owner,publish_enabled,bootstrap_approved_at,bootstrap_approved_by,config)
        VALUES($1,'agent:540','no-hermes-v2','python-v2.2','no-hermes-v2',true,now(),'owned-db-fixture',$2)
        ON CONFLICT(source,scope_id,policy_version) DO UPDATE SET parser_version=EXCLUDED.parser_version,owner=EXCLUDED.owner,publish_enabled=true,bootstrap_approved_at=EXCLUDED.bootstrap_approved_at,bootstrap_approved_by=EXCLUDED.bootstrap_approved_by,config=EXCLUDED.config`,
          [SOURCE_28HSE, JSON.stringify(config)],
        );
        const accept = (capture) =>
          applyIngestion(client, capture.payload, {
            incremental: true,
            expectedSource: SOURCE_28HSE,
          });
        const seedProperty = async (ref, values = {}) => {
          const fields = {
            listing_no: `FIXTURE-${ref}-${randomUUID()}`,
            canonical_property_no: ref,
            title_zh: "Historical fixture",
            deal_type: "sale",
            estate_id: estateId,
            district_slug: "authority-test",
            price: 8000000,
            saleable_area: 500,
            gross_area: 600,
            bedrooms: 4,
            bathrooms: 2,
            floor: "12/F",
            images: ["https://imgs.property.hk/largePhotos/offline-existing.jpg"],
            status: "active",
            source_site: "earnestproperty-old-site",
            source_updated_at: "2026-11-13T16:00:00Z",
            ...values,
          };
          return (
            await q(
              `INSERT INTO properties(${Object.keys(fields).join(",")}) VALUES(${Object.keys(fields)
                .map((_, index) => `$${index + 1}`)
                .join(",")}) RETURNING *`,
              Object.values(fields),
            )
          )[0];
        };
        const adminWrite = async (work) => {
          await q("BEGIN");
          try {
            await q("SELECT set_config('app.admin_property_write','on',true)");
            const result = await work(q);
            await q("COMMIT");
            return result;
          } catch (error) {
            await q("ROLLBACK");
            throw error;
          }
        };
        const options = (capture, receipt, extra = {}) => ({
          receiptId: receipt.receipt_id,
          evidence: capture.evidence,
          blobStore: {},
          expectedHost: AUTHORITY_HOST,
          prepare: prepareAuthorityMedia,
          // Only the generated fixture payload crosses this test seam. Native
          // offline HTML reparsing is covered by its own Python/bridge suite.
          verifyFacts: async ({ payload }) => ({
            payloadHash: hashPayload(payload),
            parserVersion: payload.meta.parser_version,
          }),
          now: () => AUTHORITY_NOW,
          ...extra,
        });
        const snapshot = async () => {
          const tables = [
            "properties",
            "mls_source_state",
            "property_source_links",
            "listing_source_observations",
            "mls_ingestion_receipts",
            "mls_ingestion_scopes",
            "listing_sync_runs",
            "media_assets",
            "listing_media_records",
            "audit_logs",
            "property_sync_fields",
            "admin_property_overrides",
            "property_sync_state",
            "listing_change_events",
            "mls_source_contacts",
            "mls_source_promotion_tiers",
          ];
          const result = {};
          for (const table of tables)
            result[table] = await q(
              `SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`,
            );
          return result;
        };
        await run({
          client,
          q,
          pool,
          query,
          estateId,
          config,
          accept,
          seedProperty,
          adminWrite,
          options,
          snapshot,
        });
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
    { migrationVersions: versions },
  );
}
