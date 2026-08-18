import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Client } from "@neondatabase/serverless";

import { PublicationConflictError, createSyncRepository } from "./sync-repository.mjs";
import { stableObservationHash } from "./source-contract.mjs";

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
  const targetOverrideParameters = new Set([
    "host",
    "hostaddr",
    "port",
    "user",
    "database",
    "db",
    "dbname",
    "service",
  ]);
  for (const key of parsed.searchParams.keys()) {
    if (targetOverrideParameters.has(key.toLowerCase())) {
      throw new Error(
        `${label} must not identify a database target through query override parameters.`,
      );
    }
  }
  const parserUrl = new URL(parsed);
  parserUrl.search = "";
  parserUrl.hash = "";
  let connectionParameters;
  try {
    connectionParameters = new Client(parserUrl.toString()).connectionParameters;
  } catch {
    throw new Error(`${label} contains an invalid PostgreSQL target.`);
  }
  if (
    typeof connectionParameters?.user !== "string" ||
    typeof connectionParameters.host !== "string" ||
    !Number.isInteger(connectionParameters.port) ||
    typeof connectionParameters.database !== "string"
  ) {
    throw new Error(`${label} resolved to an invalid PostgreSQL target.`);
  }
  return {
    username: connectionParameters.user,
    hostname: connectionParameters.host.toLowerCase().replace(/\.$/, ""),
    port: String(connectionParameters.port),
    pathname: connectionParameters.database,
  };
}

function assertDisposableDatabase(
  testUrl,
  {
    confirmed = process.env.MLS_TEST_DATABASE_CONFIRMED,
    liveUrl = process.env.DATABASE_URL_UNPOOLED,
  } = {},
) {
  if (confirmed !== true && confirmed !== "true") {
    throw new Error(
      "MLS_TEST_DATABASE_CONFIRMED=true is required before connecting to the test database.",
    );
  }
  const testTarget = databaseTarget(testUrl, "DATABASE_URL_TEST");
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

function finishIntegrationCleanup({ hasPrimaryError, primaryError, cleanupErrors }) {
  if (cleanupErrors.length === 0) return;
  if (hasPrimaryError) {
    if (primaryError instanceof Error && Object.isExtensible(primaryError)) {
      Object.defineProperty(primaryError, "integrationCleanupErrors", {
        enumerable: false,
        value: Object.freeze([...cleanupErrors]),
      });
    }
    return;
  }
  throw new AggregateError(cleanupErrors, "Disposable database cleanup failed.");
}

test("disposable database guard rejects target overrides before client construction", () => {
  const liveUrl = "postgresql://live_user:live_password@live.invalid:5432/live_database";
  const overridingTargets = [
    "postgresql://live_user:test_password@other.invalid:5432/live_database?host=live.invalid",
    "postgresql://other_user:test_password@live.invalid:5432/live_database?user=live_user",
    "postgresql://live_user:test_password@live.invalid:6543/live_database?port=5432",
    "postgresql://live_user:test_password@live.invalid:5432/other_database?database=live_database",
  ];

  for (const testUrl of overridingTargets) {
    assert.throws(
      () =>
        assertDisposableDatabase(testUrl, {
          confirmed: true,
          liveUrl,
        }),
      /must not identify.*target/i,
    );
  }
  assert.doesNotThrow(() =>
    assertDisposableDatabase(
      "postgresql://test_user:test_password@test.invalid:5432/test_database?application_name=mls-test",
      { confirmed: true, liveUrl },
    ),
  );
});

test("integration cleanup never displaces a thrown null or undefined primary", () => {
  const cleanupError = new Error("cleanup failed");
  for (const primaryError of [null, undefined]) {
    assert.doesNotThrow(() =>
      finishIntegrationCleanup({
        hasPrimaryError: true,
        primaryError,
        cleanupErrors: [cleanupError],
      }),
    );
  }
  assert.throws(
    () =>
      finishIntegrationCleanup({
        hasPrimaryError: false,
        primaryError: undefined,
        cleanupErrors: [cleanupError],
      }),
    AggregateError,
  );
});

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
    const newObservationId = randomUUID();
    const mediaAssetId = randomUUID();
    const mediaRecordId = randomUUID();
    const newMediaAssetId = randomUUID();
    const newMediaRecordId = randomUUID();
    const shadowRunIds = Array.from({ length: 7 }, () => randomUUID());
    const tag = randomUUID();
    const publishDate = "2077-06-15";
    const publishStartedAt = `${publishDate}T04:00:00.000Z`;
    const listingNo = `MLS-IT-${tag}`;
    const externalId = `MLS-IT-${tag}`;
    const newListingNo = `MLS-IT-NEW-${tag}`;
    const newExternalId = `MLS-IT-OLD-${tag}`;
    const newLegacyUrl = `https://legacy.integration.invalid/${tag}`;
    const sourceImageUrl = `https://upstream.integration.invalid/${tag}.png`;
    const ownedImageUrl = `https://owned.integration.invalid/${tag}.png`;
    const newSourceImageUrl = `https://upstream.integration.invalid/new-${tag}.png`;
    const newOwnedImageUrl = `https://owned.integration.invalid/new-${tag}.png`;
    const observationMediaCandidates = [
      { url: sourceImageUrl, category: "listing_photo", isPrimary: true },
    ];
    const newObservationMediaCandidates = [
      { url: newSourceImageUrl, category: "listing_photo", isPrimary: true },
    ];
    const observationFields = {
      title_zh: "After publication",
      district_slug: "sham-tseng",
      price: 8_000_001,
      saleable_area: 500,
      bedrooms: 2,
      bathrooms: 1,
      status: "active",
    };
    const observationPayload = {
      schemaVersion: 1,
      fields: observationFields,
      rawFields: {},
      sourceUpdatedAt: null,
      parseWarnings: [],
    };
    const observationHash = stableObservationHash({
      schemaVersion: 1,
      source: SOURCE_28HSE,
      externalId,
      dealType: "sale",
      propertyNoNormalized: listingNo,
      fields: observationFields,
      rawFields: {},
      mediaCandidates: observationMediaCandidates,
      sourceUpdatedAt: null,
    });
    const mediaHash = "a".repeat(64);
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
      images: [ownedImageUrl],
      status: "active",
    };
    const newObservationFields = {
      title_zh: "New dual-source publication",
      district_slug: "sham-tseng",
      price: 6_000_001,
      saleable_area: 420,
      bedrooms: 2,
      bathrooms: 1,
      status: "active",
    };
    const newObservationPayload = {
      schemaVersion: 1,
      fields: newObservationFields,
      rawFields: {},
      sourceUpdatedAt: null,
      parseWarnings: [],
    };
    const newObservationHash = stableObservationHash({
      schemaVersion: 1,
      source: SOURCE_OLD_SITE,
      externalId: newExternalId,
      dealType: "sale",
      propertyNoNormalized: newListingNo,
      fields: newObservationFields,
      rawFields: {},
      mediaCandidates: newObservationMediaCandidates,
      sourceUpdatedAt: null,
    });
    const newMediaHash = "b".repeat(64);
    const newCanonical = {
      listing_no: newListingNo,
      canonical_property_no: newListingNo,
      title_zh: newObservationFields.title_zh,
      title_en: null,
      deal_type: "sale",
      estate_id: null,
      district_slug: newObservationFields.district_slug,
      address: null,
      price: newObservationFields.price,
      rent: null,
      saleable_area: newObservationFields.saleable_area,
      gross_area: null,
      bedrooms: newObservationFields.bedrooms,
      bathrooms: newObservationFields.bathrooms,
      floor: null,
      orientation: null,
      features: [],
      description: null,
      images: [newOwnedImageUrl],
      status: "active",
      featured: false,
      management_fee: null,
      video_url: null,
      floorplan_url: null,
      source_site: "dual-source-mls",
    };
    const effectiveNewCanonical = {
      ...newCanonical,
      legacy_detail_id: newExternalId,
      legacy_property_no: newListingNo,
      legacy_url: newLegacyUrl,
    };
    let connected = false;
    let connectionAttempted = false;
    let hasPrimaryError = false;
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
           id, listing_no, canonical_property_no, title_zh, title_en, deal_type,
           estate_id, district_slug, address, price, rent, saleable_area, gross_area,
           bedrooms, bathrooms, floor, orientation, features, description, images,
           status, featured, legacy_detail_id
         ) VALUES ($1, $2, $2, $3, $4, 'sale', $5::uuid, $6, $7, 7900000, $8,
           $9, $10, $11, $12, $13, $14, $15::text[], $16, $17::text[], $18,
           false, $19)
         RETURNING to_char(updated_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
        [
          propertyId,
          listingNo,
          canonical.title_zh,
          canonical.title_en,
          canonical.estate_id,
          canonical.district_slug,
          canonical.address,
          canonical.rent,
          canonical.saleable_area,
          canonical.gross_area,
          canonical.bedrooms,
          canonical.bathrooms,
          canonical.floor,
          canonical.orientation,
          canonical.features,
          canonical.description,
          canonical.images,
          canonical.status,
          `legacy-${tag}`,
        ],
      );
      const expectedUpdatedAt = propertyRows.rows[0].updated_at;
      assert.match(expectedUpdatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
      await client.query(
        `INSERT INTO property_sync_fields (
           property_id, field_name, last_published_value, override_value,
           active_override, winning_observation_id
         ) VALUES ($1, 'price', $2::jsonb, NULL, false, NULL)`,
        [propertyId, JSON.stringify(7_900_000)],
      );
      await client.query(
        `INSERT INTO listing_source_observations (
           id, run_id, source, external_listing_id, deal_type, source_url,
           property_no_raw, property_no_normalized, payload, media_candidates,
           content_hash, validation_state, discovered_at, fetched_at
         ) VALUES ($1, $2, $3, $4, 'sale', $5, $6, $6, $7::jsonb,
           $8::jsonb, $9, 'valid', $10::timestamptz, $10::timestamptz)`,
        [
          observationId,
          runId,
          SOURCE_28HSE,
          externalId,
          `https://integration.invalid/listing/${tag}`,
          listingNo,
          JSON.stringify(observationPayload),
          JSON.stringify(observationMediaCandidates),
          observationHash,
          `${publishDate}T00:01:00.000Z`,
        ],
      );
      await client.query(
        `INSERT INTO listing_source_observations (
           id, run_id, source, external_listing_id, deal_type, source_url,
           property_no_raw, property_no_normalized, payload, media_candidates,
           content_hash, validation_state, discovered_at, fetched_at
         ) VALUES ($1, $2, $3, $4, 'sale', $5, $6, $6, $7::jsonb,
           $8::jsonb, $9, 'valid', $10::timestamptz, $10::timestamptz)`,
        [
          newObservationId,
          runId,
          SOURCE_OLD_SITE,
          newExternalId,
          newLegacyUrl,
          newListingNo,
          JSON.stringify(newObservationPayload),
          JSON.stringify(newObservationMediaCandidates),
          newObservationHash,
          `${publishDate}T00:02:00.000Z`,
        ],
      );
      await client.query(
        `INSERT INTO media_assets (
           id, url, pathname, content_type, size_bytes, owner_type, owner_id,
           content_hash, archived_at
         ) VALUES ($1, $2, $3, 'image/png', 123, 'mls-shared', NULL, $4, NULL)`,
        [mediaAssetId, ownedImageUrl, `mls/integration/${tag}.png`, mediaHash],
      );
      await client.query(
        `INSERT INTO listing_media_records (
           id, observation_id, source_url, content_hash, owned_media_asset_id,
           detected_mime, size_bytes, width, height, eligibility, rejection_reason
         ) VALUES ($1, $2, $3, $4, $5, 'image/png', 123, 10, 8, 'eligible', NULL)`,
        [mediaRecordId, observationId, sourceImageUrl, mediaHash, mediaAssetId],
      );
      await client.query(
        `INSERT INTO media_assets (
           id, url, pathname, content_type, size_bytes, owner_type, owner_id,
           content_hash, archived_at
         ) VALUES ($1, $2, $3, 'image/png', 123, 'mls-shared', NULL, $4, NULL)`,
        [newMediaAssetId, newOwnedImageUrl, `mls/integration/new-${tag}.png`, newMediaHash],
      );
      await client.query(
        `INSERT INTO listing_media_records (
           id, observation_id, source_url, content_hash, owned_media_asset_id,
           detected_mime, size_bytes, width, height, eligibility, rejection_reason
         ) VALUES ($1, $2, $3, $4, $5, 'image/png', 123, 10, 8, 'eligible', NULL)`,
        [newMediaRecordId, newObservationId, newSourceImageUrl, newMediaHash, newMediaAssetId],
      );
      const fields = RECONCILED_FIELD_NAMES.map((fieldName) => ({
        fieldName,
        lastPublishedValue: canonical[fieldName],
        overrideValue: null,
        activeOverride: false,
        winningObservationId:
          fieldName === "images" || Object.hasOwn(observationFields, fieldName)
            ? observationId
            : null,
      }));
      const newFields = RECONCILED_FIELD_NAMES.map((fieldName) => ({
        fieldName,
        lastPublishedValue: newCanonical[fieldName],
        overrideValue: null,
        activeOverride: false,
        winningObservationId:
          newCanonical[fieldName] != null &&
          (!Array.isArray(newCanonical[fieldName]) || newCanonical[fieldName].length > 0)
            ? newObservationId
            : null,
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
              {
                changeType: "link_change",
                fieldName: null,
                oldValue: null,
                newValue: {
                  source: SOURCE_28HSE,
                  externalId,
                  dealType: "sale",
                  matchKey: `sale:${listingNo}`,
                  status: "active",
                },
                winningObservationId: observationId,
                reason: "source_link_activated",
              },
            ],
          },
          {
            kind: "new",
            canonical: newCanonical,
            links: [
              {
                source: SOURCE_OLD_SITE,
                externalId: newExternalId,
                dealType: "sale",
                matchKey: `sale:${newListingNo}`,
                observedAt: `${publishDate}T00:02:00.000Z`,
              },
            ],
            fields: newFields,
            lifecycle: {
              consecutiveAbsentHealthyRuns: 0,
              inactiveReason: null,
              inactiveAt: null,
            },
            events: [
              {
                changeType: "new",
                fieldName: null,
                oldValue: null,
                newValue: effectiveNewCanonical,
                winningObservationId: newObservationId,
                reason: "new_listing",
              },
              {
                changeType: "link_change",
                fieldName: null,
                oldValue: null,
                newValue: {
                  source: SOURCE_OLD_SITE,
                  externalId: newExternalId,
                  dealType: "sale",
                  matchKey: `sale:${newListingNo}`,
                  status: "active",
                },
                winningObservationId: newObservationId,
                reason: "source_link_activated",
              },
            ],
          },
        ],
      };

      assert.deepEqual(await createSyncRepository({ client }).publishBatch(batch), {
        inserted: 1,
        updated: 1,
        events: 4,
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
        { links: 1, fields: RECONCILED_FIELD_NAMES.length, states: 1, media: 1, events: 2 },
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
            `SELECT id, observation_id, property_id, source_url, owned_media_asset_id,
                    eligibility, rejection_reason
               FROM listing_media_records WHERE id = $1`,
            [mediaRecordId],
          ),
          client.query(
            `SELECT property_id, run_id, change_type, field_name, old_value, new_value,
                    winning_observation_id, reason
               FROM listing_change_events WHERE property_id = $1 AND run_id = $2
              ORDER BY change_type, field_name NULLS FIRST`,
            [propertyId, runId],
          ),
          client.query(
            "SELECT url, owner_type, owner_id, archived_at FROM media_assets WHERE id = $1",
            [mediaAssetId],
          ),
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
          source_url: sourceImageUrl,
          owned_media_asset_id: mediaAssetId,
          eligibility: "eligible",
          rejection_reason: null,
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
        {
          property_id: propertyId,
          run_id: runId,
          change_type: "link_change",
          field_name: null,
          old_value: null,
          new_value: {
            source: SOURCE_28HSE,
            externalId,
            dealType: "sale",
            matchKey: `sale:${listingNo}`,
            status: "active",
          },
          winning_observation_id: observationId,
          reason: "source_link_activated",
        },
      ]);
      assert.deepEqual(assetRows.rows, [
        {
          url: ownedImageUrl,
          owner_type: "mls-shared",
          owner_id: null,
          archived_at: null,
        },
      ]);
      const newPropertyRows = await client.query(
        `SELECT id, listing_no, canonical_property_no, images, source_site,
                legacy_detail_id, legacy_property_no, legacy_url
           FROM properties
          WHERE listing_no = $1`,
        [newListingNo],
      );
      assert.equal(newPropertyRows.rows.length, 1);
      const newProperty = newPropertyRows.rows[0];
      assert.deepEqual(
        {
          listing_no: newProperty.listing_no,
          canonical_property_no: newProperty.canonical_property_no,
          images: newProperty.images,
          source_site: newProperty.source_site,
          legacy_detail_id: newProperty.legacy_detail_id,
          legacy_property_no: newProperty.legacy_property_no,
          legacy_url: newProperty.legacy_url,
        },
        {
          listing_no: newListingNo,
          canonical_property_no: newListingNo,
          images: [newOwnedImageUrl],
          source_site: "dual-source-mls",
          legacy_detail_id: newExternalId,
          legacy_property_no: newListingNo,
          legacy_url: newLegacyUrl,
        },
      );
      const [newEventRows, newMediaRows, newAssetRows] = await Promise.all([
        client.query(
          `SELECT change_type, old_value, new_value, winning_observation_id
             FROM listing_change_events
            WHERE property_id = $1 AND run_id = $2 AND change_type = 'new'`,
          [newProperty.id, runId],
        ),
        client.query(
          `SELECT id, observation_id, property_id, source_url, owned_media_asset_id,
                  eligibility, rejection_reason
             FROM listing_media_records WHERE id = $1`,
          [newMediaRecordId],
        ),
        client.query(
          "SELECT url, owner_type, owner_id, archived_at FROM media_assets WHERE id = $1",
          [newMediaAssetId],
        ),
      ]);
      assert.deepEqual(newEventRows.rows, [
        {
          change_type: "new",
          old_value: null,
          new_value: effectiveNewCanonical,
          winning_observation_id: newObservationId,
        },
      ]);
      assert.deepEqual(newMediaRows.rows, [
        {
          id: newMediaRecordId,
          observation_id: newObservationId,
          property_id: newProperty.id,
          source_url: newSourceImageUrl,
          owned_media_asset_id: newMediaAssetId,
          eligibility: "eligible",
          rejection_reason: null,
        },
      ]);
      assert.deepEqual(newAssetRows.rows, [
        {
          url: newOwnedImageUrl,
          owner_type: "mls-shared",
          owner_id: null,
          archived_at: null,
        },
      ]);
      const captured = structuredClone(published);

      const conflicting = structuredClone(batch);
      conflicting.proposals = [conflicting.proposals[0]];
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
        "SELECT url, owner_type, owner_id, archived_at FROM media_assets WHERE id = $1",
        [mediaAssetId],
      );
      assert.deepEqual(assetAfterConflict.rows, [
        {
          url: ownedImageUrl,
          owner_type: "mls-shared",
          owner_id: null,
          archived_at: null,
        },
      ]);
    } catch (error) {
      hasPrimaryError = true;
      primaryError = error;
      throw error;
    } finally {
      const cleanupErrors = [];
      if (connected) {
        const cleanupSteps = [
          () => client.query("DELETE FROM listing_change_events WHERE run_id = $1", [runId]),
          () => client.query("DELETE FROM listing_media_records WHERE id = $1", [mediaRecordId]),
          () => client.query("DELETE FROM listing_media_records WHERE id = $1", [newMediaRecordId]),
          () =>
            client.query("DELETE FROM property_sync_fields WHERE property_id = $1", [propertyId]),
          () =>
            client.query(
              "DELETE FROM property_sync_fields WHERE property_id IN (SELECT id FROM properties WHERE listing_no = $1)",
              [newListingNo],
            ),
          () =>
            client.query("DELETE FROM property_sync_state WHERE property_id = $1", [propertyId]),
          () =>
            client.query(
              "DELETE FROM property_sync_state WHERE property_id IN (SELECT id FROM properties WHERE listing_no = $1)",
              [newListingNo],
            ),
          () =>
            client.query("DELETE FROM property_source_links WHERE property_id = $1", [propertyId]),
          () =>
            client.query(
              "DELETE FROM property_source_links WHERE property_id IN (SELECT id FROM properties WHERE listing_no = $1)",
              [newListingNo],
            ),
          () =>
            client.query("DELETE FROM listing_source_observations WHERE id = $1", [observationId]),
          () =>
            client.query("DELETE FROM listing_source_observations WHERE id = $1", [
              newObservationId,
            ]),
          () => client.query("DELETE FROM properties WHERE listing_no = $1", [newListingNo]),
          () => client.query("DELETE FROM properties WHERE id = $1", [propertyId]),
          () => client.query("DELETE FROM media_assets WHERE id = $1", [mediaAssetId]),
          () => client.query("DELETE FROM media_assets WHERE id = $1", [newMediaAssetId]),
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
      finishIntegrationCleanup({ hasPrimaryError, primaryError, cleanupErrors });
    }
  },
);
