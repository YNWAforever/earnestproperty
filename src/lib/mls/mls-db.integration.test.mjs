import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Client } from "@neondatabase/serverless";

import { PublicationConflictError, createSyncRepository } from "./sync-repository.mjs";

const SOURCE_28HSE = "28hse_agent_540";
const SOURCE_OLD_SITE = "old_site";
const RECONCILED_FIELD_NAMES = [
  "title_zh",
  "title_en",
  "estate_id",
  "district_slug",
  "address",
  "price",
  "rent",
  "saleable_area",
  "gross_area",
  "bedrooms",
  "bathrooms",
  "floor",
  "orientation",
  "features",
  "description",
  "images",
  "status",
];

function databaseTarget(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${label} must be a PostgreSQL URL.`);
  }
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error(`${label} contains an invalid database pathname.`);
  }
  return {
    username: decodeURIComponent(parsed.username),
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
    pathname,
  };
}

function assertDisposableDatabase(testUrl) {
  if (process.env.MLS_TEST_DATABASE_CONFIRMED !== "true") {
    throw new Error(
      "MLS_TEST_DATABASE_CONFIRMED=true is required before connecting to the test database.",
    );
  }
  const testTarget = databaseTarget(testUrl, "DATABASE_URL_TEST");
  const liveUrl = process.env.DATABASE_URL_UNPOOLED;
  if (liveUrl) {
    const liveTarget = databaseTarget(liveUrl, "DATABASE_URL_UNPOOLED");
    if (
      testTarget.username === liveTarget.username &&
      testTarget.hostname === liveTarget.hostname &&
      testTarget.port === liveTarget.port &&
      testTarget.pathname === liveTarget.pathname
    ) {
      throw new Error("DATABASE_URL_TEST must not identify the DATABASE_URL_UNPOOLED target.");
    }
  }
}

function sourceStatus() {
  return {
    [SOURCE_28HSE]: { source: SOURCE_28HSE, healthy: true, reasons: [] },
    [SOURCE_OLD_SITE]: { source: SOURCE_OLD_SITE, healthy: true, reasons: [] },
  };
}

function subtractUtcDays(dateText, count) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

test(
  "publishBatch is atomic against an explicitly confirmed disposable migrated database",
  { skip: !process.env.DATABASE_URL_TEST },
  async () => {
    const databaseUrl = process.env.DATABASE_URL_TEST;
    assert.equal(typeof databaseUrl, "string");
    assertDisposableDatabase(databaseUrl);

    const client = new Client(databaseUrl);
    const runId = randomUUID();
    const propertyId = randomUUID();
    const observationId = randomUUID();
    const mediaAssetId = randomUUID();
    const mediaRecordId = randomUUID();
    const shadowRunIds = Array.from({ length: 7 }, () => randomUUID());
    const tag = randomUUID();
    const publishDate = "2077-06-15";
    const publishStartedAt = `${publishDate}T04:00:00.000Z`;
    const listingNo = `MLS-IT-${tag}`;
    const externalId = `MLS-IT-${tag}`;
    const imageUrl = `https://integration.invalid/${tag}.png`;
    const hash = tag.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
    let connected = false;
    let connectionAttempted = false;
    let primaryError = null;

    try {
      connectionAttempted = true;
      await client.connect();
      connected = true;
      for (let index = 0; index < shadowRunIds.length; index += 1) {
        const scheduledFor = subtractUtcDays(publishDate, index + 1);
        await client.query(
          `INSERT INTO listing_sync_runs (
             id, scheduled_for, started_at, finished_at, mode, status, parser_version,
             source_status, baseline_approved_at, baseline_approved_by
           ) VALUES ($1, $2::date, $3::timestamptz, $4::timestamptz, 'shadow',
             'shadow_healthy', 'integration-test', $5::jsonb, $6::timestamptz, $7)`,
          [
            shadowRunIds[index],
            scheduledFor,
            `${scheduledFor}T01:00:00.000Z`,
            `${scheduledFor}T01:30:00.000Z`,
            JSON.stringify(sourceStatus()),
            `${scheduledFor}T02:00:00.000Z`,
            `integration-${tag}`,
          ],
        );
      }
      await client.query(
        `INSERT INTO listing_sync_runs (
           id, scheduled_for, started_at, mode, status, parser_version, source_status
         ) VALUES ($1, $2::date, $3::timestamptz, 'publish', 'running',
           'integration-test', $4::jsonb)`,
        [runId, publishDate, publishStartedAt, JSON.stringify(sourceStatus())],
      );
      const propertyRows = await client.query(
        `INSERT INTO properties (
           id, listing_no, canonical_property_no, title_zh, deal_type, district_slug,
           price, images, status, featured, legacy_detail_id
         ) VALUES ($1, $2, $2, 'Before publication', 'sale', 'sham-tseng',
           7900000, ARRAY[$3]::text[], 'active', false, $4)
         RETURNING updated_at`,
        [propertyId, listingNo, imageUrl, `legacy-${tag}`],
      );
      const expectedUpdatedAt = new Date(propertyRows.rows[0].updated_at).toISOString();
      await client.query(
        `INSERT INTO listing_source_observations (
           id, run_id, source, external_listing_id, deal_type, source_url,
           property_no_raw, property_no_normalized, payload, media_candidates,
           content_hash, validation_state, discovered_at, fetched_at
         ) VALUES ($1, $2, $3, $4, 'sale', $5, $6, $6, '{}'::jsonb,
           '[]'::jsonb, $7, 'valid', $8::timestamptz, $8::timestamptz)`,
        [
          observationId,
          runId,
          SOURCE_28HSE,
          externalId,
          `https://integration.invalid/listing/${tag}`,
          listingNo,
          hash,
          `${publishDate}T00:01:00.000Z`,
        ],
      );
      await client.query(
        `INSERT INTO media_assets (
           id, url, pathname, content_type, size_bytes, owner_type, content_hash
         ) VALUES ($1, $2, $3, 'image/png', 123, 'mls-shared', $4)`,
        [mediaAssetId, imageUrl, `mls/integration/${tag}.png`, hash],
      );
      await client.query(
        `INSERT INTO listing_media_records (
           id, observation_id, source_url, content_hash, owned_media_asset_id,
           detected_mime, size_bytes, width, height, eligibility
         ) VALUES ($1, $2, $3, $4, $5, 'image/png', 123, 10, 8, 'eligible')`,
        [mediaRecordId, observationId, imageUrl, hash, mediaAssetId],
      );

      const canonical = {
        listing_no: listingNo,
        canonical_property_no: listingNo,
        title_zh: "After publication",
        title_en: null,
        deal_type: "sale",
        estate_id: null,
        district_slug: "sham-tseng",
        address: null,
        price: 8_000_001,
        rent: null,
        saleable_area: 500,
        gross_area: null,
        bedrooms: 2,
        bathrooms: 1,
        floor: null,
        orientation: null,
        features: [],
        description: null,
        images: [imageUrl],
        status: "active",
      };
      const fields = RECONCILED_FIELD_NAMES.map((fieldName) => ({
        fieldName,
        lastPublishedValue: canonical[fieldName],
        overrideValue: null,
        activeOverride: false,
        winningObservationId: observationId,
      }));
      const batch = {
        runId,
        mode: "publish",
        publishEnabled: true,
        proposals: [
          {
            kind: "update",
            propertyId,
            expectedUpdatedAt,
            canonical,
            links: [
              {
                source: SOURCE_28HSE,
                externalId,
                dealType: "sale",
                matchKey: `sale:${listingNo}`,
                observedAt: `${publishDate}T00:01:00.000Z`,
              },
            ],
            fields,
            lifecycle: {
              consecutiveAbsentHealthyRuns: 0,
              inactiveReason: null,
              inactiveAt: null,
            },
            events: [
              {
                changeType: "changed",
                fieldName: "price",
                oldValue: 7_900_000,
                newValue: canonical.price,
                winningObservationId: observationId,
                reason: "source_value_changed",
              },
            ],
          },
        ],
      };

      assert.deepEqual(await createSyncRepository({ client }).publishBatch(batch), {
        inserted: 0,
        updated: 1,
        events: 1,
      });
      const stateRows = await client.query(
        `SELECT
           p.title_zh, p.price::text AS price, p.legacy_detail_id,
           (SELECT count(*)::int FROM property_source_links WHERE property_id = p.id) AS links,
           (SELECT count(*)::int FROM property_sync_fields WHERE property_id = p.id) AS fields,
           (SELECT count(*)::int FROM property_sync_state WHERE property_id = p.id) AS states,
           (SELECT count(*)::int FROM listing_media_records WHERE property_id = p.id) AS media,
           (SELECT count(*)::int FROM listing_change_events WHERE property_id = p.id) AS events,
           p.updated_at
         FROM properties p WHERE p.id = $1`,
        [propertyId],
      );
      const published = stateRows.rows[0];
      assert.equal(published.title_zh, "After publication");
      assert.equal(Number(published.price), canonical.price);
      assert.equal(published.legacy_detail_id, `legacy-${tag}`);
      assert.deepEqual(
        {
          links: Number(published.links),
          fields: Number(published.fields),
          states: Number(published.states),
          media: Number(published.media),
          events: Number(published.events),
        },
        { links: 1, fields: RECONCILED_FIELD_NAMES.length, states: 1, media: 1, events: 1 },
      );
      const [linkRows, fieldRows, lifecycleRows, mediaRows, eventRows, assetRows] =
        await Promise.all([
          client.query(
            `SELECT property_id, source, external_listing_id, deal_type, match_key, status,
                    last_seen_run_id
               FROM property_source_links WHERE property_id = $1`,
            [propertyId],
          ),
          client.query(
            `SELECT property_id, field_name, last_published_value, active_override,
                    winning_observation_id
               FROM property_sync_fields
              WHERE property_id = $1 AND field_name = 'price'`,
            [propertyId],
          ),
          client.query(
            `SELECT property_id, consecutive_absent_healthy_runs, last_evaluated_run_id,
                    inactive_reason, inactive_at
               FROM property_sync_state WHERE property_id = $1`,
            [propertyId],
          ),
          client.query(
            `SELECT id, observation_id, property_id, source_url, owned_media_asset_id, eligibility
               FROM listing_media_records WHERE id = $1`,
            [mediaRecordId],
          ),
          client.query(
            `SELECT property_id, run_id, change_type, field_name, old_value, new_value,
                    winning_observation_id, reason
               FROM listing_change_events WHERE property_id = $1 AND run_id = $2`,
            [propertyId, runId],
          ),
          client.query("SELECT owner_type, owner_id FROM media_assets WHERE id = $1", [
            mediaAssetId,
          ]),
        ]);
      assert.deepEqual(linkRows.rows, [
        {
          property_id: propertyId,
          source: SOURCE_28HSE,
          external_listing_id: externalId,
          deal_type: "sale",
          match_key: `sale:${listingNo}`,
          status: "active",
          last_seen_run_id: runId,
        },
      ]);
      assert.deepEqual(fieldRows.rows, [
        {
          property_id: propertyId,
          field_name: "price",
          last_published_value: canonical.price,
          active_override: false,
          winning_observation_id: observationId,
        },
      ]);
      assert.deepEqual(lifecycleRows.rows, [
        {
          property_id: propertyId,
          consecutive_absent_healthy_runs: 0,
          last_evaluated_run_id: runId,
          inactive_reason: null,
          inactive_at: null,
        },
      ]);
      assert.deepEqual(mediaRows.rows, [
        {
          id: mediaRecordId,
          observation_id: observationId,
          property_id: propertyId,
          source_url: imageUrl,
          owned_media_asset_id: mediaAssetId,
          eligibility: "eligible",
        },
      ]);
      assert.deepEqual(eventRows.rows, [
        {
          property_id: propertyId,
          run_id: runId,
          change_type: "changed",
          field_name: "price",
          old_value: 7_900_000,
          new_value: canonical.price,
          winning_observation_id: observationId,
          reason: "source_value_changed",
        },
      ]);
      assert.deepEqual(assetRows.rows, [{ owner_type: "mls-shared", owner_id: null }]);
      const captured = structuredClone(published);

      const conflicting = structuredClone(batch);
      conflicting.proposals[0].canonical.price += 1;
      conflicting.proposals[0].fields.find(
        (field) => field.fieldName === "price",
      ).lastPublishedValue += 1;
      await assert.rejects(
        createSyncRepository({ client }).publishBatch(conflicting),
        PublicationConflictError,
      );
      const afterConflictRows = await client.query(
        `SELECT
           p.title_zh, p.price::text AS price, p.legacy_detail_id,
           (SELECT count(*)::int FROM property_source_links WHERE property_id = p.id) AS links,
           (SELECT count(*)::int FROM property_sync_fields WHERE property_id = p.id) AS fields,
           (SELECT count(*)::int FROM property_sync_state WHERE property_id = p.id) AS states,
           (SELECT count(*)::int FROM listing_media_records WHERE property_id = p.id) AS media,
           (SELECT count(*)::int FROM listing_change_events WHERE property_id = p.id) AS events,
           p.updated_at
         FROM properties p WHERE p.id = $1`,
        [propertyId],
      );
      assert.deepEqual(afterConflictRows.rows[0], captured);
      const assetAfterConflict = await client.query(
        "SELECT owner_type, owner_id FROM media_assets WHERE id = $1",
        [mediaAssetId],
      );
      assert.deepEqual(assetAfterConflict.rows, [{ owner_type: "mls-shared", owner_id: null }]);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      const cleanupErrors = [];
      if (connected) {
        const cleanupSteps = [
          () => client.query("DELETE FROM listing_change_events WHERE run_id = $1", [runId]),
          () => client.query("DELETE FROM listing_media_records WHERE id = $1", [mediaRecordId]),
          () =>
            client.query("DELETE FROM property_sync_fields WHERE property_id = $1", [propertyId]),
          () =>
            client.query("DELETE FROM property_sync_state WHERE property_id = $1", [propertyId]),
          () =>
            client.query("DELETE FROM property_source_links WHERE property_id = $1", [propertyId]),
          () =>
            client.query("DELETE FROM listing_source_observations WHERE id = $1", [observationId]),
          () => client.query("DELETE FROM properties WHERE id = $1", [propertyId]),
          () => client.query("DELETE FROM media_assets WHERE id = $1", [mediaAssetId]),
          () =>
            client.query("DELETE FROM listing_sync_runs WHERE id = ANY($1::uuid[])", [
              [runId, ...shadowRunIds],
            ]),
        ];
        for (const cleanup of cleanupSteps) {
          try {
            await cleanup();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
      }
      if (connectionAttempted) {
        try {
          await client.end();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        if (primaryError instanceof Error && Object.isExtensible(primaryError)) {
          Object.defineProperty(primaryError, "integrationCleanupErrors", {
            enumerable: false,
            value: Object.freeze(cleanupErrors),
          });
        } else if (primaryError == null) {
          throw new AggregateError(cleanupErrors, "Disposable database cleanup failed.");
        }
      }
    }
  },
);
