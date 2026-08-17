import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { types as neonTypes } from "@neondatabase/serverless";
import { Result as PgResult } from "pg";

import { createSyncRepository } from "./sync-repository.mjs";
import {
  SOURCE_28HSE,
  SOURCE_OLD_SITE,
  createObservation,
  stableObservationHash,
} from "./source-contract.mjs";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID_2 = "12121212-1212-4121-8121-121212121212";
const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";
const PROPERTY_ID_2 = "23232323-2323-4232-8232-232323232323";
const OBSERVATION_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_RECORD_ID = "45454545-4545-4454-8454-454545454545";
const EVENT_ID = "56565656-5656-4565-8565-565656565656";
const EXPECTED_UPDATED_AT = "2026-08-17T00:02:00.000000Z";

function result(rows = [], rowCount = rows.length, command = "SELECT") {
  return { rows, rowCount, command, fields: [], oid: command === "SELECT" ? 0 : null };
}

function commandResult(command, overrides = {}) {
  return {
    rows: [],
    rowCount: null,
    command,
    fields: [],
    oid: null,
    ...overrides,
  };
}

function realPgResult(command, rows = [], rowCount = rows.length) {
  const output = new PgResult();
  output.command = command;
  output.rows = rows;
  output.rowCount = rowCount;
  output.fields = [];
  output.oid = null;
  return output;
}

function compactSql(statement) {
  return String(statement).replace(/\s+/g, " ").trim();
}

function fakeClient(handler = () => result()) {
  const calls = [];
  return {
    calls,
    async query(statement, params = []) {
      assert.equal(typeof statement, "string");
      assert.ok(Array.isArray(params));
      const call = { statement: compactSql(statement), params: structuredClone(params) };
      calls.push(call);
      const answer = await handler(call, calls.length - 1);
      return answer ?? result();
    },
  };
}

function validObservation(index = 1, overrides = {}) {
  const dealType = overrides.dealType ?? "sale";
  const source = overrides.source ?? SOURCE_28HSE;
  const externalId = overrides.externalId ?? String(3972000 + index);
  const propertyNo = overrides.propertyNo ?? `EP-${String(index).padStart(4, "0")}`;
  const requiredValue =
    dealType === "sale" ? { price: 8_000_000 + index } : { rent: 20_000 + index };
  return createObservation({
    source,
    externalId,
    dealType,
    sourceUrl: `https://fixtures.invalid/${source}/${externalId}`,
    propertyNoRaw: propertyNo,
    fields: { title_zh: `Listing ${index}`, ...requiredValue, ...(overrides.fields ?? {}) },
    rawFields: overrides.rawFields ?? { sourceLabel: `Listing ${index}` },
    mediaCandidates: overrides.mediaCandidates ?? [],
    sourceUpdatedAt: overrides.sourceUpdatedAt ?? "2026-08-16",
    discoveredAt: overrides.discoveredAt ?? "2026-08-17T00:00:00.000Z",
    fetchedAt: overrides.fetchedAt ?? "2026-08-17T00:01:00.000Z",
    quarantineReasons: overrides.quarantineReasons,
    parseWarnings: overrides.parseWarnings ?? [],
  });
}

function persistedRow(observation, id = OBSERVATION_ID, overrides = {}) {
  return {
    id,
    source: observation.source,
    external_listing_id: observation.externalId,
    deal_type: observation.dealType,
    source_url: observation.sourceUrl,
    property_no_raw: observation.propertyNoRaw,
    property_no_normalized: observation.propertyNoNormalized,
    payload: {
      schemaVersion: observation.schemaVersion,
      fields: structuredClone(observation.fields),
      rawFields: structuredClone(observation.rawFields),
      sourceUpdatedAt: observation.sourceUpdatedAt,
      parseWarnings: [...observation.parseWarnings],
    },
    media_candidates: structuredClone(observation.mediaCandidates),
    content_hash: observation.contentHash,
    validation_state: observation.validationState,
    quarantine_reasons: [...observation.quarantineReasons],
    parse_warnings: [...observation.parseWarnings],
    discovered_at: observation.discoveredAt,
    fetched_at: observation.fetchedAt,
    discovered_at_matches_input: true,
    fetched_at_matches_input: true,
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function forgedObservation(observation, overrides) {
  const forged = structuredClone({ ...observation, ...overrides });
  forged.contentHash = stableObservationHash({
    schemaVersion: forged.schemaVersion,
    source: forged.source,
    externalId: forged.externalId,
    dealType: forged.dealType,
    propertyNoNormalized: forged.propertyNoNormalized,
    fields: forged.fields,
    rawFields: forged.rawFields,
    mediaCandidates: forged.mediaCandidates,
    sourceUpdatedAt: forged.sourceUpdatedAt,
  });
  return deepFreeze(forged);
}

function mediaRow(overrides = {}) {
  return {
    id: ASSET_ID,
    url: "https://owned.example/mls/hash.png",
    pathname: "mls/aa/hash.png",
    content_type: "image/png",
    size_bytes: 123,
    content_hash: "a".repeat(64),
    owner_type: "mls-shared",
    owner_id: null,
    created_by: null,
    created_at: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function ownedMediaInput(overrides = {}) {
  return {
    url: "https://owned.example/mls/new.png",
    pathname: "mls/aa/new.png",
    contentType: "image/png",
    sizeBytes: 123,
    contentHash: "a".repeat(64),
    ownerType: "mls-shared",
    ownerId: null,
    createdBy: null,
    ...overrides,
  };
}

function mediaRecordInput(overrides = {}) {
  return {
    observationId: OBSERVATION_ID,
    propertyId: PROPERTY_ID,
    sourceUrl: "https://images.28hse.test/photo.png",
    contentHash: "a".repeat(64),
    ownedMediaAssetId: ASSET_ID,
    detectedMime: "image/png",
    sizeBytes: 123,
    width: 10,
    height: 8,
    eligibility: "eligible",
    rejectionReason: null,
    ...overrides,
  };
}

function mediaRecordRow(input = mediaRecordInput(), overrides = {}) {
  return {
    id: MEDIA_RECORD_ID,
    observation_id: input.observationId,
    property_id: input.propertyId,
    source_url: input.sourceUrl,
    content_hash: input.contentHash,
    owned_media_asset_id: input.ownedMediaAssetId,
    detected_mime: input.detectedMime,
    size_bytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    eligibility: input.eligibility,
    rejection_reason: input.rejectionReason,
    ...overrides,
  };
}

function healthySourceStatus(overrides = {}) {
  return {
    [SOURCE_28HSE]: { source: SOURCE_28HSE, healthy: true, reasons: [] },
    [SOURCE_OLD_SITE]: { source: SOURCE_OLD_SITE, healthy: true, reasons: [] },
    ...overrides,
  };
}

function evaluation(overrides = {}) {
  return {
    sourceStatus: healthySourceStatus(),
    counts: {
      [SOURCE_28HSE]: { sale: 10, rent: 5 },
      [SOURCE_OLD_SITE]: { sale: 9, rent: 5 },
    },
    baselines: { maximumDropFraction: 0.3, minimumParseRate: 0.98 },
    ...overrides,
  };
}

function canonicalWrite(overrides = {}) {
  return {
    listing_no: "EP-0001",
    canonical_property_no: "EP-0001",
    title_zh: "海景兩房",
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
    images: ["https://owned.example/mls/hash.png"],
    status: "active",
    ...overrides,
  };
}

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

function reconciledFieldWrites(canonical = canonicalWrite()) {
  return RECONCILED_FIELD_NAMES.map((fieldName) => ({
    fieldName,
    lastPublishedValue: structuredClone(canonical[fieldName]),
    overrideValue: null,
    activeOverride: false,
    winningObservationId:
      canonical[fieldName] != null &&
      (!Array.isArray(canonical[fieldName]) || canonical[fieldName].length > 0)
        ? OBSERVATION_ID
        : null,
  }));
}

function publicationObservationRow(canonical = canonicalWrite(), overrides = {}) {
  const fields = {};
  for (const fieldName of [
    "title_zh",
    "title_en",
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
    "status",
  ]) {
    const value = canonical[fieldName];
    if (value != null && (!Array.isArray(value) || value.length > 0)) {
      fields[fieldName] = structuredClone(value);
    }
  }
  const mediaCandidates = canonical.images.length
    ? [
        {
          url: "https://images.28hse.test/photo.png",
          category: "listing_photo",
          isPrimary: true,
        },
      ]
    : [];
  const payload = {
    schemaVersion: 1,
    fields,
    rawFields: {},
    sourceUpdatedAt: null,
    parseWarnings: [],
  };
  const identity = {
    id: OBSERVATION_ID,
    run_id: RUN_ID,
    source: SOURCE_28HSE,
    external_listing_id: "3972001",
    deal_type: canonical.deal_type,
    property_no_normalized: canonical.canonical_property_no,
    validation_state: "valid",
    fetched_at: "2026-08-17T00:01:00.000Z",
    payload,
    media_candidates: mediaCandidates,
  };
  const row = { ...identity, ...overrides };
  row.content_hash =
    overrides.content_hash ??
    stableObservationHash({
      schemaVersion: row.payload.schemaVersion,
      source: row.source,
      externalId: row.external_listing_id,
      dealType: row.deal_type,
      propertyNoNormalized: row.property_no_normalized,
      fields: row.payload.fields,
      rawFields: row.payload.rawFields,
      mediaCandidates: row.media_candidates,
      sourceUpdatedAt: row.payload.sourceUpdatedAt,
    });
  return row;
}

function approvedBatch(overrides = {}) {
  const {
    canonical: canonicalOverride,
    proposal: proposalOverrides = {},
    ...batchOverrides
  } = overrides;
  const canonical = canonicalOverride ?? canonicalWrite();
  const proposal = {
    kind: "update",
    propertyId: PROPERTY_ID,
    expectedUpdatedAt: EXPECTED_UPDATED_AT,
    canonical,
    links: [
      {
        source: SOURCE_28HSE,
        externalId: "3972001",
        dealType: "sale",
        matchKey: "sale:EP-0001",
        observedAt: "2026-08-17T00:01:00.000Z",
      },
    ],
    fields: reconciledFieldWrites(canonical),
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
        winningObservationId: OBSERVATION_ID,
        reason: "source_value_changed",
      },
      {
        changeType: "link_change",
        fieldName: null,
        oldValue: null,
        newValue: {
          source: SOURCE_28HSE,
          externalId: "3972001",
          dealType: "sale",
          matchKey: "sale:EP-0001",
          status: "active",
        },
        winningObservationId: OBSERVATION_ID,
        reason: "source_link_activated",
      },
    ],
    ...proposalOverrides,
  };
  return {
    runId: RUN_ID,
    mode: "publish",
    publishEnabled: true,
    proposals: [proposal],
    ...batchOverrides,
  };
}

function publicationRunRow(overrides = {}) {
  return {
    id: RUN_ID,
    scheduled_for: "2026-08-17",
    started_at: "2026-08-17T04:00:00.000000Z",
    mode: "publish",
    status: "running",
    source_status: healthySourceStatus(),
    hong_kong_date: "2026-08-17",
    ...overrides,
  };
}

function approvedShadowRows(count = 7, overrides = {}) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 16 - index));
    const scheduledFor = date.toISOString().slice(0, 10);
    return {
      id: `${String(index + 60).padStart(8, "0")}-1111-4111-8111-${String(index + 60).padStart(12, "0")}`,
      scheduled_for: scheduledFor,
      started_at: `${scheduledFor}T01:00:00.000000Z`,
      status: "shadow_healthy",
      source_status: healthySourceStatus(),
      baseline_approved_at: `${scheduledFor}T02:00:00.000000Z`,
      date_rank: 1,
      ...overrides,
    };
  });
}

function fakePublicationClient(options = {}) {
  const events = [];
  const sql = [];
  const rows = options.shadowRows ?? approvedShadowRows(options.approvedShadowStreak ?? 7);
  const client = fakeClient((call) => {
    sql.push(call.statement);
    options.onQuery?.(call);
    if (call.statement === "BEGIN ISOLATION LEVEL SERIALIZABLE") {
      events.push(call.statement);
      return options.beginResult ?? commandResult("BEGIN");
    }
    if (call.statement === "COMMIT" || call.statement === "ROLLBACK") {
      events.push(call.statement);
      if (call.statement === "ROLLBACK" && options.rollbackError) throw options.rollbackError;
      if (call.statement === "COMMIT" && options.commitError) throw options.commitError;
      if (call.statement === "COMMIT" && options.commitResult) return options.commitResult;
      return commandResult(call.statement);
    }
    if (/^SELECT 1 AS alive/.test(call.statement)) {
      return options.sessionResult ?? result([{ alive: 1 }]);
    }
    if (
      /^SELECT source_status FROM listing_sync_runs WHERE id = \$1/.test(call.statement) &&
      !/FOR UPDATE/.test(call.statement)
    ) {
      return result([
        {
          source_status:
            options.preflightSourceStatus ??
            options.runRow?.source_status ??
            publicationRunRow(options.runOverrides).source_status,
        },
      ]);
    }
    if (/FROM listing_sync_runs WHERE id = \$1 .*FOR UPDATE/.test(call.statement)) {
      return result([options.runRow ?? publicationRunRow(options.runOverrides)]);
    }
    if (/publication_shadow_streak/.test(call.statement)) return result(rows);
    if (/^LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE$/.test(call.statement)) {
      return options.tableLockResult ?? commandResult("LOCK");
    }
    if (/pg_advisory_xact_lock/.test(call.statement)) {
      return result([{ acquired: 1 }]);
    }
    if (/FROM properties WHERE \(canonical_property_no/.test(call.statement)) {
      return result(options.identityConflictRows ?? []);
    }
    if (/updated_at_token/.test(call.statement) && /FROM properties/.test(call.statement)) {
      const propertyId = call.params[0];
      const canonical =
        propertyId === PROPERTY_ID_2
          ? canonicalWrite({
              listing_no: "EP-0002",
              canonical_property_no: "EP-0002",
              images: [],
            })
          : canonicalWrite();
      return result([
        options.lockedRow ?? {
          id: propertyId,
          updated_at_token: options.updatedAtConflict
            ? "2026-08-17T00:03:00.000000Z"
            : EXPECTED_UPDATED_AT,
          updated_at_matches_expected: !options.updatedAtConflict,
          ...canonical,
          price: options.unchanged ? canonical.price : 7_900_000,
        },
      ]);
    }
    if (/UPDATE properties SET/.test(call.statement)) {
      if (options.writeError) throw options.writeError;
      return options.unchanged
        ? result([], 0, "UPDATE")
        : result([{ id: call.params.at(-2) }], 1, "UPDATE");
    }
    if (/INSERT INTO properties/.test(call.statement)) {
      if (options.insertError) throw options.insertError;
      if (options.writeError) throw options.writeError;
      return result([{ id: PROPERTY_ID }], 1, "INSERT");
    }
    if (
      /FROM listing_source_observations/.test(call.statement) &&
      /FOR UPDATE/.test(call.statement)
    ) {
      return result([
        options.observationRow ??
          publicationObservationRow(options.observationCanonical ?? canonicalWrite()),
      ]);
    }
    if (/FROM property_source_links/.test(call.statement) && /FOR UPDATE/.test(call.statement)) {
      return result(options.existingLink ? [options.existingLink] : []);
    }
    if (/INSERT INTO property_source_links/.test(call.statement)) {
      return result([{ property_id: call.params[0] }], 1, "INSERT");
    }
    if (/FROM property_sync_fields/.test(call.statement) && /FOR UPDATE/.test(call.statement)) {
      return result(options.lockedFieldRows ?? []);
    }
    if (/INSERT INTO property_sync_fields/.test(call.statement)) {
      return result([{ property_id: call.params[0] }], 1, "INSERT");
    }
    if (/FROM property_sync_state/.test(call.statement) && /FOR UPDATE/.test(call.statement)) {
      return result(options.lockedLifecycleRows ?? []);
    }
    if (/INSERT INTO property_sync_state/.test(call.statement)) {
      return result([{ property_id: call.params[0] }], 1, "INSERT");
    }
    if (/FROM listing_media_records/.test(call.statement) && /FOR UPDATE/.test(call.statement)) {
      return result(
        options.mediaRows ?? [
          {
            id: MEDIA_RECORD_ID,
            observation_id: OBSERVATION_ID,
            property_id: options.mediaPropertyId ?? null,
            source_url: "https://images.28hse.test/photo.png",
            eligibility: "eligible",
            owned_media_asset_id: ASSET_ID,
            record_content_hash: "a".repeat(64),
            owned_url: "https://owned.example/mls/hash.png",
            asset_content_hash: "a".repeat(64),
          },
        ],
      );
    }
    if (/UPDATE listing_media_records/.test(call.statement)) {
      return result([{ id: MEDIA_RECORD_ID, property_id: call.params[1] }], 1, "UPDATE");
    }
    if (/INSERT INTO listing_change_events/.test(call.statement)) {
      return result([{ id: EVENT_ID }], 1, "INSERT");
    }
    throw new Error(`unexpected publication query: ${call.statement}`);
  });
  return Object.assign(client, { events, sql });
}

test("repository requires one dedicated query client and exposes the Task 9 surface", () => {
  assert.throws(() => createSyncRepository(), /client/i);
  assert.throws(() => createSyncRepository({ client: {} }), /client\.query/i);
  const repository = createSyncRepository({ client: fakeClient() });
  assert.deepEqual(Object.keys(repository).sort(), [
    "approveShadowRun",
    "assertLockSession",
    "beginRun",
    "findCanonicalCandidates",
    "findMediaByHash",
    "findMediaByUrls",
    "finishRun",
    "getApprovedHealthyShadowStreak",
    "getHealthyCountHistory",
    "getLatestRun",
    "loadEstateIdsBySlug",
    "loadFieldStates",
    "loadLifecycleStates",
    "loadSourceLinks",
    "publishBatch",
    "recordRunEvaluation",
    "registerOwnedMedia",
    "saveMediaRecord",
    "saveObservations",
    "saveProposedLinks",
  ]);
});

test("beginRun reconciles orphan running rows before inserting the new ledger row", async () => {
  const client = fakeClient((call) => {
    if (call.statement.startsWith("UPDATE listing_sync_runs")) return result([], 3);
    if (call.statement.startsWith("INSERT INTO listing_sync_runs")) return result([{ id: RUN_ID }]);
    throw new Error(`unexpected query: ${call.statement}`);
  });
  const repository = createSyncRepository({ client });

  assert.deepEqual(
    await repository.beginRun({
      scheduledFor: "2026-08-17",
      mode: "shadow",
      parserVersion: "dual-source-v1",
    }),
    { runId: RUN_ID },
  );
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[0].statement, /status = 'failed'/);
  assert.match(client.calls[0].statement, /status = 'running'/);
  assert.ok(client.calls[0].params.includes("orphaned_run_reconciled"));
  assert.match(client.calls[1].statement, /status.*'running'/);
  assert.deepEqual(client.calls[1].params, ["2026-08-17", "shadow", "dual-source-v1"]);
});

test("beginRun snapshots validated evidence before orphan reconciliation awaits", async () => {
  const input = {
    scheduledFor: "2026-08-17",
    mode: "shadow",
    parserVersion: "dual-source-v1",
  };
  const client = fakeClient((call) => {
    if (call.statement.startsWith("UPDATE listing_sync_runs")) {
      input.scheduledFor = "2026-08-18";
      input.mode = "publish";
      input.parserVersion = "mutated-after-validation";
      return result();
    }
    if (call.statement.startsWith("INSERT INTO listing_sync_runs")) {
      return result([{ id: RUN_ID }]);
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });

  assert.deepEqual(await createSyncRepository({ client }).beginRun(input), { runId: RUN_ID });
  assert.deepEqual(client.calls[1].params, ["2026-08-17", "shadow", "dual-source-v1"]);
});

test("beginRun validates canonical dates, modes, parser versions, and returned UUIDs", async () => {
  const client = fakeClient(() => result([{ id: "not-a-uuid" }]));
  const repository = createSyncRepository({ client });
  for (const input of [
    { scheduledFor: "2026-02-30", mode: "shadow", parserVersion: "v1" },
    { scheduledFor: "2026-08-17", mode: "dry-run", parserVersion: "v1" },
    { scheduledFor: "2026-08-17", mode: "shadow", parserVersion: " " },
  ]) {
    await assert.rejects(repository.beginRun(input), /scheduledFor|mode|parserVersion/i);
  }
  assert.equal(client.calls.length, 0);
  await assert.rejects(
    repository.beginRun({
      scheduledFor: "2026-08-17",
      mode: "shadow",
      parserVersion: "v1",
    }),
    /run row/i,
  );
});

test("saveObservations persists complete immutable evidence in batches of at most 200", async () => {
  const observations = Array.from({ length: 201 }, (_, index) => validObservation(index + 1));
  const persisted = observations.map((observation, index) =>
    persistedRow(
      observation,
      `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    ),
  );
  let selectOffset = 0;
  const client = fakeClient((call) => {
    if (call.statement.startsWith("INSERT INTO listing_source_observations")) return result();
    if (call.statement.startsWith("SELECT id, source, external_listing_id")) {
      const batchSize = (call.params.length - 1) / 5;
      const rows = persisted.slice(selectOffset, selectOffset + batchSize);
      selectOffset += batchSize;
      return result(rows);
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });

  const refs = await createSyncRepository({ client }).saveObservations(RUN_ID, observations);

  assert.equal(refs.length, observations.length);
  assert.deepEqual(Object.keys(refs[0]), [
    "id",
    "source",
    "externalId",
    "dealType",
    "propertyNoNormalized",
    "matchKey",
    "contentHash",
  ]);
  assert.equal(Object.isFrozen(refs[0]), true);
  assert.equal(refs[0].contentHash, observations[0].contentHash);
  assert.equal(Object.hasOwn(observations[0], "id"), false);
  const inserts = client.calls.filter((call) =>
    call.statement.startsWith("INSERT INTO listing_source_observations"),
  );
  const selects = client.calls.filter((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id"),
  );
  assert.equal(inserts.length, 2);
  assert.equal(selects.length, 2);
  assert.ok(inserts.every((call) => call.params.length <= 200 * 15));
  assert.ok(selects.every((call) => call.params.length <= 1 + 200 * 5));
  assert.ok(inserts.every((call) => /ON CONFLICT .* DO NOTHING/i.test(call.statement)));
  const firstParams = inserts[0].params;
  const payload = JSON.parse(firstParams[7]);
  assert.deepEqual(payload, {
    schemaVersion: 1,
    fields: observations[0].fields,
    rawFields: observations[0].rawFields,
    sourceUpdatedAt: observations[0].sourceUpdatedAt,
    parseWarnings: observations[0].parseWarnings,
  });
  assert.deepEqual(JSON.parse(firstParams[8]), observations[0].mediaCandidates);
  assert.equal(firstParams[13], observations[0].discoveredAt);
  assert.equal(firstParams[14], observations[0].fetchedAt);
});

test("saveObservations snapshots requested order before the first awaited query", async () => {
  const first = validObservation(1);
  const second = validObservation(2);
  const observations = [first, second];
  const rows = [persistedRow(first), persistedRow(second, RUN_ID_2)];
  const client = fakeClient((call) => {
    if (call.statement.startsWith("INSERT INTO listing_source_observations")) {
      observations.reverse();
      return result();
    }
    if (call.statement.startsWith("SELECT id, source, external_listing_id")) {
      return result(rows);
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });

  const refs = await createSyncRepository({ client }).saveObservations(RUN_ID, observations);

  assert.deepEqual(
    refs.map((ref) => ref.externalId),
    [first.externalId, second.externalId],
  );
});

test("saveObservations persists valid and quarantined immutable observations", async () => {
  const valid = validObservation(1);
  const quarantined = validObservation(2, {
    fields: { price: 0 },
    quarantineReasons: ["fixture_quarantine"],
  });
  const rows = [persistedRow(valid), persistedRow(quarantined, RUN_ID_2)];
  const client = fakeClient((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id") ? result(rows) : result(),
  );

  const refs = await createSyncRepository({ client }).saveObservations(RUN_ID, [
    valid,
    quarantined,
  ]);
  assert.equal(refs.length, 2);
  const insert = client.calls.find((call) =>
    call.statement.startsWith("INSERT INTO listing_source_observations"),
  );
  assert.ok(insert.params.includes("valid"));
  assert.ok(insert.params.includes("quarantined"));
  assert.ok(
    insert.params.some((value) => Array.isArray(value) && value.includes("fixture_quarantine")),
  );
});

test("saveObservations retains quarantined evidence whose property number is missing", async () => {
  const observation = createObservation({
    source: SOURCE_28HSE,
    externalId: "3972999",
    dealType: "sale",
    sourceUrl: "https://fixtures.invalid/28hse_agent_540/3972999",
    propertyNoRaw: null,
    fields: { title_zh: "Missing number", price: 8_000_000 },
    rawFields: { sourceLabel: "Missing number" },
    mediaCandidates: [],
    sourceUpdatedAt: "2026-08-16",
    discoveredAt: "2026-08-17T00:00:00.000Z",
    fetchedAt: "2026-08-17T00:01:00.000Z",
  });
  const client = fakeClient((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id")
      ? result([persistedRow(observation)])
      : result(),
  );

  const [ref] = await createSyncRepository({ client }).saveObservations(RUN_ID, [observation]);
  assert.equal(observation.validationState, "quarantined");
  assert.equal(ref.propertyNoNormalized, null);
  assert.equal(ref.matchKey, null);
  assert.equal(Object.keys(ref).length, 7);

  const mismatched = fakeClient((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id")
      ? result([{ ...persistedRow(observation), property_no_normalized: "EP-FORGED" }])
      : result(),
  );
  await assert.rejects(
    createSyncRepository({ client: mismatched }).saveObservations(RUN_ID, [observation]),
    /persisted observation/i,
  );
});

test("saveObservations rejects mutable, forged, duplicate, or oversized evidence before SQL", async () => {
  const client = fakeClient();
  const repository = createSyncRepository({ client });
  const valid = validObservation(1);
  const mutable = { ...valid };
  const forged = Object.freeze({ ...valid, contentHash: "0".repeat(64) });
  const oversized = validObservation(2, { rawFields: { value: "x".repeat(1_100_000) } });
  for (const rows of [[mutable], [forged], [valid, valid], [oversized]]) {
    await assert.rejects(
      repository.saveObservations(RUN_ID, rows),
      /immutable|observation|duplicate|JSON/i,
    );
  }
  assert.equal(client.calls.length, 0);
});

test("saveObservations rejects every malformed nested MediaCandidate shape before SQL", async () => {
  const valid = validObservation(1);
  const baseCandidate = {
    url: "https://fixtures.invalid/listing.png",
    category: "listing_photo",
    isPrimary: true,
  };
  const cases = [];
  for (const key of ["url", "category", "isPrimary"]) {
    const candidate = { ...baseCandidate };
    delete candidate[key];
    cases.push(candidate);
  }
  const markerCases = new Map([
    ["rejected", [null, undefined, "false"]],
    ["eligible", [null, undefined, 1]],
    ["contextRejected", [null, undefined, "true"]],
    ["rejectionReason", [null, undefined, 1]],
    ["rejectionReasons", [null, undefined, "fixture_reason", ["fixture_reason", 1]]],
    ["contextRejectionMarkers", [null, undefined, "fixture_marker", ["fixture_marker", false]]],
  ]);
  for (const [key, values] of markerCases) {
    for (const value of values) cases.push({ ...baseCandidate, [key]: value });
  }
  cases.push({ ...baseCandidate, undeclaredMarker: true });

  for (const candidate of cases) {
    const observation = forgedObservation(valid, { mediaCandidates: [candidate] });
    const client = fakeClient();
    await assert.rejects(
      createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
      /media candidate|media URL|rejectionReasons|contextRejectionMarkers/i,
    );
    assert.equal(client.calls.length, 0);
  }
});

test("saveObservations rejects accessor-backed fields without invoking getters or SQL", async () => {
  const base = validObservation(1);
  let titleReads = 0;
  const fields = { ...base.fields };
  delete fields.title_zh;
  Object.defineProperty(fields, "title_zh", {
    enumerable: true,
    get() {
      titleReads += 1;
      return titleReads === 1 ? base.fields.title_zh : "drifted title";
    },
  });
  Object.freeze(fields);
  const observation = Object.freeze({ ...base, fields });
  const client = fakeClient();

  await assert.rejects(
    createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
    /SourceObservation|immutable|accessor|content hash/i,
  );
  assert.equal(titleReads, 0);
  assert.equal(client.calls.length, 0);
});

test("saveObservations rejects accessor-backed nested media arrays without getter reads or SQL", async () => {
  const candidateEvidence = {
    url: "https://fixtures.invalid/listing.png",
    category: "listing_photo",
    isPrimary: true,
    rejectionReasons: ["fixture_reason"],
  };
  const base = validObservation(1, { mediaCandidates: [candidateEvidence] });
  let reasonReads = 0;
  const rejectionReasons = [];
  Object.defineProperty(rejectionReasons, 0, {
    enumerable: true,
    get() {
      reasonReads += 1;
      return reasonReads === 1 ? "fixture_reason" : "drifted_reason";
    },
  });
  Object.freeze(rejectionReasons);
  const candidate = Object.freeze({ ...base.mediaCandidates[0], rejectionReasons });
  const observation = Object.freeze({
    ...base,
    mediaCandidates: Object.freeze([candidate]),
  });
  const client = fakeClient();

  await assert.rejects(
    createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
    /SourceObservation|immutable|accessor|content hash|media candidate/i,
  );
  assert.equal(reasonReads, 0);
  assert.equal(client.calls.length, 0);
});

test("saveObservations binds validation state to raw, normalized, and match-key identity", async () => {
  const client = fakeClient();
  const repository = createSyncRepository({ client });
  const valid = validObservation(1);
  const cases = [
    forgedObservation(valid, {
      propertyNoNormalized: null,
      matchKey: null,
      validationState: "valid",
      quarantineReasons: [],
    }),
    forgedObservation(valid, {
      propertyNoRaw: "EP-DIFFERENT",
    }),
    forgedObservation(valid, {
      propertyNoNormalized: null,
      matchKey: null,
      validationState: "quarantined",
      quarantineReasons: ["fixture_quarantine"],
    }),
  ];

  for (const observation of cases) {
    await assert.rejects(repository.saveObservations(RUN_ID, [observation]), /identity|property/i);
  }
  assert.equal(client.calls.length, 0);
});

test("saveObservations rejects non-contract scalar representations before any SQL", async () => {
  const valid = validObservation(1);
  const quarantinedNullIdentity = forgedObservation(valid, {
    propertyNoRaw: null,
    propertyNoNormalized: null,
    matchKey: null,
    validationState: "quarantined",
    quarantineReasons: ["missing_or_invalid_property_number"],
  });
  const cases = [
    forgedObservation(valid, { discoveredAt: new Date(valid.discoveredAt) }),
    forgedObservation(valid, { fetchedAt: new Date(valid.fetchedAt) }),
    forgedObservation(valid, { discoveredAt: "2026-02-30T00:00:00Z" }),
    forgedObservation(valid, { fetchedAt: "not-an-iso-timestamp" }),
    forgedObservation(valid, { sourceUpdatedAt: undefined }),
    forgedObservation(valid, { sourceUpdatedAt: "" }),
    forgedObservation(valid, { sourceUpdatedAt: "not-an-iso-date" }),
    forgedObservation(quarantinedNullIdentity, { propertyNoRaw: undefined }),
    forgedObservation(valid, { fields: { ...valid.fields, title_en: undefined } }),
  ];

  for (const observation of cases) {
    const client = fakeClient();
    await assert.rejects(
      createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
      /property number|sourceUpdatedAt|discoveredAt|fetchedAt|field/i,
    );
    assert.equal(client.calls.length, 0);
  }
});

test("saveObservations preserves supported ISO strings while normalizing only database timestamps", async () => {
  const observation = forgedObservation(validObservation(1), {
    sourceUpdatedAt: "2026-08-16T23:59:59Z",
    discoveredAt: "2026-08-17T08:00:00+08:00",
    fetchedAt: "2026-08-17T00:01:00Z",
  });
  const client = fakeClient((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id")
      ? result([
          persistedRow(observation, OBSERVATION_ID, {
            discovered_at: new Date(observation.discoveredAt),
            fetched_at: new Date(observation.fetchedAt),
          }),
        ])
      : result(),
  );

  const [ref] = await createSyncRepository({ client }).saveObservations(RUN_ID, [observation]);

  assert.equal(ref.id, OBSERVATION_ID);
  assert.equal(client.calls[0].params[13], observation.discoveredAt);
  assert.equal(client.calls[0].params[14], observation.fetchedAt);
});

test("saveObservations compares PostgreSQL microseconds before the Neon driver loses precision", async () => {
  const parseTimestamptz = neonTypes.getTypeParser(1184, "text");
  const requestedDate = parseTimestamptz("2026-08-17 00:00:00.000001+00");
  const conflictingDate = parseTimestamptz("2026-08-17 00:00:00.000999+00");
  assert.ok(requestedDate instanceof Date);
  assert.ok(conflictingDate instanceof Date);
  assert.equal(requestedDate.toISOString(), conflictingDate.toISOString());

  const observation = validObservation(1, {
    discoveredAt: "2026-08-17T00:00:00.000001Z",
    fetchedAt: "2026-08-17T00:01:00.000002Z",
  });
  const row = persistedRow(observation, OBSERVATION_ID, {
    discovered_at: conflictingDate,
    fetched_at: parseTimestamptz("2026-08-17 00:01:00.000002+00"),
    discovered_at_matches_input: false,
  });
  const client = fakeClient((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id") ? result([row]) : result(),
  );

  await assert.rejects(
    createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
    /persisted observation|immutable evidence/i,
  );
  const select = client.calls[1];
  assert.match(select.statement, /discovered_at\s*=\s*requested\.expected_discovered_at/i);
  assert.match(select.statement, /fetched_at\s*=\s*requested\.expected_fetched_at/i);
  assert.ok(select.params.includes(observation.discoveredAt));
  assert.ok(select.params.includes(observation.fetchedAt));
});

test("saveObservations fails closed on missing, duplicate, or mismatched persisted rows", async () => {
  const observation = validObservation(1);
  for (const returnedRows of [
    [],
    [persistedRow(observation), persistedRow(observation, RUN_ID_2)],
    [
      persistedRow(observation, OBSERVATION_ID),
      { ...persistedRow(observation), content_hash: "0".repeat(64) },
    ],
  ]) {
    const client = fakeClient((call) =>
      call.statement.startsWith("SELECT id, source, external_listing_id")
        ? result(returnedRows)
        : result(),
    );
    await assert.rejects(
      createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
      /persisted observation/i,
    );
  }
});

test("saveObservations conflict recovery compares every immutable evidence column", async () => {
  const observation = validObservation(1, {
    mediaCandidates: [
      { url: "https://fixtures.invalid/image.png", category: "listing_photo", isPrimary: true },
    ],
    parseWarnings: ["fixture_warning"],
  });
  const base = persistedRow(observation, OBSERVATION_ID, {
    discovered_at: new Date(observation.discoveredAt),
    fetched_at: new Date(observation.fetchedAt),
  });
  const mismatches = [
    { source_url: "https://fixtures.invalid/forged" },
    { property_no_raw: "EP-FORGED" },
    { payload: { ...base.payload, fields: { ...base.payload.fields, price: 1 } } },
    { payload: { ...base.payload, rawFields: { forged: true } } },
    { payload: { ...base.payload, sourceUpdatedAt: "2026-01-01" } },
    { payload: { ...base.payload, parseWarnings: [] } },
    { media_candidates: [] },
    { validation_state: "quarantined" },
    { quarantine_reasons: ["forged"] },
    { parse_warnings: [] },
    { discovered_at: new Date("2026-08-17T00:00:01.000Z") },
    { fetched_at: new Date("2026-08-17T00:01:01.000Z") },
  ];

  for (const mismatch of mismatches) {
    const client = fakeClient((call) =>
      call.statement.startsWith("SELECT id, source, external_listing_id")
        ? result([{ ...base, ...mismatch }])
        : result(),
    );
    await assert.rejects(
      createSyncRepository({ client }).saveObservations(RUN_ID, [observation]),
      /persisted observation/i,
    );
  }

  const exactClient = fakeClient((call) =>
    call.statement.startsWith("SELECT id, source, external_listing_id") ? result([base]) : result(),
  );
  const [ref] = await createSyncRepository({ client: exactClient }).saveObservations(RUN_ID, [
    observation,
  ]);
  assert.equal(ref.id, OBSERVATION_ID);
  assert.match(exactClient.calls[1].statement, /source_url/);
  assert.match(exactClient.calls[1].statement, /media_candidates/);
  assert.match(exactClient.calls[1].statement, /fetched_at/);
});

test("recordRunEvaluation stores serialized evidence while the run remains running", async () => {
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  await createSyncRepository({ client }).recordRunEvaluation(RUN_ID, evaluation());

  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].statement, /^UPDATE listing_sync_runs/);
  assert.match(client.calls[0].statement, /WHERE id = \$1::uuid AND status = 'running'/);
  assert.doesNotMatch(client.calls[0].statement, /SET status\s*=/i);
  assert.deepEqual(JSON.parse(client.calls[0].params[1]), evaluation().sourceStatus);
  assert.deepEqual(JSON.parse(client.calls[0].params[2]), evaluation().counts);
  assert.deepEqual(JSON.parse(client.calls[0].params[3]), evaluation().baselines);
});

test("finishRun records final evidence and stores only redacted bounded diagnostics", async () => {
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  await repository.finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary:
      "  postgres://operator:top-secret@db.example/app token=private-value ordinary detail  ",
  });

  const call = client.calls[0];
  assert.match(call.statement, /finished_at = now\(\)/i);
  assert.match(call.statement, /status = \$2/);
  assert.equal(call.params[1], "failed");
  assert.equal(call.params[5], "adapter_failed");
  assert.doesNotMatch(call.params[6], /top-secret|private-value/);
  assert.match(call.params[6], /redacted/i);
});

test("finishRun enforces healthy, degraded, and blocked source-status semantics", async () => {
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const unhealthy28 = {
    source: SOURCE_28HSE,
    healthy: false,
    reasons: ["challenge_detected"],
  };
  const unhealthyOld = {
    source: SOURCE_OLD_SITE,
    healthy: false,
    reasons: ["pagination_incomplete"],
  };
  const invalidCompletions = [
    {
      status: "healthy",
      ...evaluation({ sourceStatus: healthySourceStatus({ [SOURCE_OLD_SITE]: unhealthyOld }) }),
    },
    {
      status: "shadow_healthy",
      ...evaluation({
        sourceStatus: healthySourceStatus({
          [SOURCE_28HSE]: {
            source: SOURCE_28HSE,
            healthy: true,
            reasons: ["blocking_reason"],
          },
        }),
      }),
    },
    { status: "degraded", ...evaluation() },
    {
      status: "degraded",
      ...evaluation({ sourceStatus: healthySourceStatus({ [SOURCE_28HSE]: unhealthy28 }) }),
    },
    {
      status: "blocked",
      ...evaluation({ sourceStatus: healthySourceStatus({ [SOURCE_OLD_SITE]: unhealthyOld }) }),
    },
  ];
  for (const completion of invalidCompletions) {
    await assert.rejects(repository.finishRun(RUN_ID, completion), /status|source|health|reason/i);
  }
  assert.equal(client.calls.length, 0);

  await repository.finishRun(RUN_ID, {
    status: "degraded",
    ...evaluation({ sourceStatus: healthySourceStatus({ [SOURCE_OLD_SITE]: unhealthyOld }) }),
  });
  await repository.finishRun(RUN_ID, {
    status: "blocked",
    ...evaluation({ sourceStatus: healthySourceStatus({ [SOURCE_28HSE]: unhealthy28 }) }),
  });
  assert.equal(client.calls.length, 2);
});

test("all stored operator diagnostics redact authorization and named credentials", async () => {
  const client = fakeClient((call) =>
    call.statement.includes("baseline_approved_at = now()")
      ? result([{ id: RUN_ID, baseline_approved_at: "2026-08-16T12:00:00.000Z" }])
      : result([{ id: RUN_ID }]),
  );
  const repository = createSyncRepository({ client });
  await repository.finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary:
      "Authorization: Bearer failure-bearer Authorization=Basic ZmFpbHVyZTpwYXNz api_key=failure-key password: failure-pass token=failure-token",
  });
  await repository.approveShadowRun(RUN_ID, {
    reviewer: "Authorization: Bearer reviewer-bearer",
    note: "Authorization=Basic cmV2aWV3ZXI6cGFzcw== x-api-key=note-key password=note-pass token: note-token",
  });

  const stored = client.calls
    .flatMap((call) => call.params)
    .filter((value) => typeof value === "string");
  for (const secret of [
    "failure-bearer",
    "ZmFpbHVyZTpwYXNz",
    "failure-key",
    "failure-pass",
    "failure-token",
    "reviewer-bearer",
    "cmV2aWV3ZXI6cGFzcw==",
    "note-key",
    "note-pass",
    "note-token",
  ]) {
    assert.equal(
      stored.some((value) => value.includes(secret)),
      false,
      secret,
    );
  }
  assert.ok(stored.some((value) => /redacted/i.test(value)));
  assert.ok(client.calls[0].params[6].length <= 1_000);
  assert.ok(client.calls[1].params[1].length <= 200);
  assert.ok(client.calls[1].params[2].length <= 1_000);
});

test("operator diagnostics redact standalone and prose credentials while preserving context", async () => {
  const client = fakeClient((call) =>
    call.statement.includes("baseline_approved_at = now()")
      ? result([{ id: RUN_ID, baseline_approved_at: "2026-08-16T12:00:00.000Z" }])
      : result([{ id: RUN_ID }]),
  );
  const repository = createSyncRepository({ client });
  await repository.finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary:
      "crawl stopped after Bearer finish-bearer during retry; Basic ZmluaXNoOmJhc2lj rejected; API key finish-api expired; token is finish-token rotated; password is finish-password invalid; secret is finish-secret removed; ordinary diagnostic remains",
  });
  await repository.approveShadowRun(RUN_ID, {
    reviewer: "on-call Bearer reviewer-bearer operator",
    note: "approval context keeps API key note-api hidden; token is note-token rotated; password is note-password invalid; secret is note-secret removed; ordinary note remains",
  });

  const [finishCall, approvalCall] = client.calls;
  const stored = [finishCall.params[6], approvalCall.params[1], approvalCall.params[2]];
  for (const secret of [
    "finish-bearer",
    "ZmluaXNoOmJhc2lj",
    "finish-api",
    "finish-token",
    "finish-password",
    "finish-secret",
    "reviewer-bearer",
    "note-api",
    "note-token",
    "note-password",
    "note-secret",
  ]) {
    assert.equal(
      stored.some((value) => value.includes(secret)),
      false,
      secret,
    );
  }
  assert.match(
    finishCall.params[6],
    /crawl stopped after|during retry|ordinary diagnostic remains/,
  );
  assert.match(approvalCall.params[1], /on-call|operator/);
  assert.match(approvalCall.params[2], /approval context keeps|ordinary note remains/);
});

test("operator diagnostics redact quoted credentials and copula punctuation without losing context", async () => {
  const client = fakeClient((call) =>
    call.statement.includes("baseline_approved_at = now()")
      ? result([{ id: RUN_ID, baseline_approved_at: "2026-08-16T12:00:00.000Z" }])
      : result([{ id: RUN_ID }]),
  );
  const repository = createSyncRepository({ client });
  await repository.finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary:
      'retry context Authorization: Bearer "authquotedone authquotedtwo" remained useful; API key is: finish-api-secret expired; password was: "finish password secret" invalid; ordinary finish remains',
  });
  await repository.approveShadowRun(RUN_ID, {
    reviewer: "lead Authorization = Basic 'reviewerquotedone reviewerquotedtwo' on-call",
    note: 'approval API key was: "note key secret" rotated; password is: note-password-secret invalid; ordinary approval remains',
  });

  const [finishCall, approvalCall] = client.calls;
  const stored = [finishCall.params[6], approvalCall.params[1], approvalCall.params[2]];
  for (const secret of [
    "authquotedone",
    "authquotedtwo",
    "finish-api-secret",
    "finish password secret",
    "reviewerquotedone",
    "reviewerquotedtwo",
    "note key secret",
    "note-password-secret",
  ]) {
    assert.equal(
      stored.some((value) => value.includes(secret)),
      false,
      secret,
    );
  }
  assert.match(finishCall.params[6], /retry context|remained useful|ordinary finish remains/);
  assert.match(approvalCall.params[1], /lead|on-call/);
  assert.match(approvalCall.params[2], /approval|rotated|ordinary approval remains/);
});

test("operator diagnostics redact wrapped and colon-scheme credentials without losing context", async () => {
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  await createSyncRepository({ client }).finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary:
      'before wrapped token is: ("SENT_F SENT_H") after wrapped; before authorization Authorization: Bearer: SENT_X after authorization; before standalone Bearer: SENT_G after standalone',
  });

  const stored = client.calls[0].params[6];
  for (const secret of ["SENT_F", "SENT_H", "SENT_X", "SENT_G"]) {
    assert.equal(stored.includes(secret), false, secret);
  }
  assert.match(
    stored,
    /before wrapped|after wrapped|before authorization|after authorization|before standalone|after standalone/,
  );
});

test("operator diagnostics preserve ordinary Basic prose while redacting alternate wrappers", async () => {
  const basicCredential = "U0VOVF9CQVNJQzpzZWNyZXQ=";
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  await createSyncRepository({ client }).finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary: `ordinary basic requirements remain useful; Basic ${basicCredential} rejected; token was: ['SENT_EDGE one'] rotated`,
  });

  const stored = client.calls[0].params[6];
  assert.equal(stored.includes(basicCredential), false);
  assert.equal(stored.includes("SENT_EDGE"), false);
  assert.match(stored, /ordinary basic requirements remain useful/);
  assert.match(stored, /rejected|rotated/);
});

test("operator diagnostics redact wrapped Basic credentials and punctuation terminals", async () => {
  const credentials = Array.from({ length: 7 }, (_, index) =>
    Buffer.from(`SENT_BASIC_${index}:fixture-secret`, "utf8").toString("base64"),
  );
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  await createSyncRepository({ client }).finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary: [
      `quoted Basic "${credentials[0]}" remained useful.`,
      `wrapped Basic (${credentials[1]}) continued!`,
      `nested Basic ('${credentials[2]}') rotated.`,
      `period Basic ${credentials[3]}. next context`,
      `bang Basic ${credentials[4]}! next retry`,
      `closing Basic ${credentials[5]}) next stage`,
      `colon Basic ${credentials[6]}: next colon context`,
      "ordinary Basic requirements remain useful",
    ].join(" "),
  });

  const stored = client.calls[0].params[6];
  for (const credential of credentials) assert.equal(stored.includes(credential), false);
  assert.match(
    stored,
    /quoted|remained useful|continued|rotated|next context|next retry|next stage|next colon context/,
  );
  assert.match(stored, /ordinary Basic requirements remain useful/);
});

test("named credential labels never start inside hyphenated prose or consume the next label", async () => {
  const labels = ["token", "secret", "password", "access-token", "refresh-token", "api-key"];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const failures = [];

  for (const [index, label] of labels.entries()) {
    const nextLabel = labels[(index + 1) % labels.length];
    const firstSecret = `SENT_CHAIN_${index}_FIRST`;
    const nextSecret = `SENT_CHAIN_${index}_NEXT`;
    const adjacent = `after-${label}`;
    const trailing = `kept-context-${index}`;
    await repository.finishRun(RUN_ID, {
      status: "failed",
      ...evaluation(),
      failureCode: "adapter_failed",
      failureSummary: `${label}: ${firstSecret} ${adjacent} ${nextLabel}: ${nextSecret} ${trailing}`,
    });
    const stored = client.calls.at(-1).params[6];
    if (
      stored.includes(firstSecret) ||
      stored.includes(nextSecret) ||
      !stored.includes(adjacent) ||
      !stored.includes(trailing)
    ) {
      failures.push({ label, nextLabel, stored });
    }
  }

  assert.deepEqual(failures, []);
});

test("named credential labels never start inside Unicode identifiers", async () => {
  const firstSecret = "SENT_UNICODE_FIRST";
  const nextSecret = "SENT_UNICODE_NEXT";
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  await createSyncRepository({ client }).finishRun(RUN_ID, {
    status: "failed",
    ...evaluation(),
    failureCode: "adapter_failed",
    failureSummary: `token: ${firstSecret} 前token secret: ${nextSecret} 保留上下文`,
  });

  const stored = client.calls[0].params[6];
  assert.equal(stored.includes(firstSecret), false);
  assert.equal(stored.includes(nextSecret), false);
  assert.match(stored, /前token|保留上下文/);
});

test("named credential labels reject combining, Unicode-dash, and join-control continuations", async () => {
  const predecessors = [
    ["combining acute", "\u0301"],
    ["hyphen", "\u2010"],
    ["nonbreaking hyphen", "\u2011"],
    ["en dash", "\u2013"],
    ["zero-width non-joiner", "\u200c"],
    ["zero-width joiner", "\u200d"],
  ];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const failures = [];

  for (const [index, [name, predecessor]] of predecessors.entries()) {
    const firstSecret = `SENT_BOUNDARY_${index}_FIRST`;
    const nextSecret = `SENT_BOUNDARY_${index}_NEXT`;
    const embedded = `adjacent${predecessor}token`;
    const trailing = `boundary-context-${index}`;
    await repository.finishRun(RUN_ID, {
      status: "failed",
      ...evaluation(),
      failureCode: "adapter_failed",
      failureSummary: `secret: ${firstSecret} ${embedded} api-key: ${nextSecret} ${trailing}`,
    });
    const stored = client.calls.at(-1).params[6];
    if (
      stored.includes(firstSecret) ||
      stored.includes(nextSecret) ||
      !stored.includes(embedded) ||
      !stored.includes(trailing)
    ) {
      failures.push({ name, stored });
    }
  }

  assert.deepEqual(failures, []);
});

test("named credential grammar preserves all 18-by-18 legitimate label transitions", async () => {
  const labels = [
    "token",
    "secret",
    "password",
    "passwd",
    "access token",
    "access-token",
    "access_token",
    "accesstoken",
    "refresh token",
    "refresh-token",
    "refresh_token",
    "refreshtoken",
    "api key",
    "api-key",
    "api_key",
    "apikey",
    "x-api-key",
    "x_api_key",
  ];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const failures = [];

  assert.equal(labels.length, 18);
  for (const [leftIndex, left] of labels.entries()) {
    for (const [rightIndex, right] of labels.entries()) {
      const leftSecret = `SENT_MATRIX_${leftIndex}_${rightIndex}_LEFT`;
      const rightSecret = `SENT_MATRIX_${leftIndex}_${rightIndex}_RIGHT`;
      const trailing = `matrix-context-${leftIndex}-${rightIndex}`;
      await repository.finishRun(RUN_ID, {
        status: "failed",
        ...evaluation(),
        failureCode: "adapter_failed",
        failureSummary: `${left}: ${leftSecret};${right}: ${rightSecret} ${trailing}`,
      });
      const stored = client.calls.at(-1).params[6];
      if (
        stored.includes(leftSecret) ||
        stored.includes(rightSecret) ||
        !stored.includes(trailing)
      ) {
        failures.push({ left, right, stored });
      }
    }
  }

  assert.deepEqual(failures, []);
});

test("named credential grammar redacts every 18-by-18 colon-delimited label transition", async () => {
  const labels = [
    "token",
    "secret",
    "password",
    "passwd",
    "access token",
    "access-token",
    "access_token",
    "accesstoken",
    "refresh token",
    "refresh-token",
    "refresh_token",
    "refreshtoken",
    "api key",
    "api-key",
    "api_key",
    "apikey",
    "x-api-key",
    "x_api_key",
  ];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const failures = [];

  assert.equal(labels.length, 18);
  for (const [leftIndex, left] of labels.entries()) {
    for (const [rightIndex, right] of labels.entries()) {
      const leftSecret = `SENT_COLON_${leftIndex}_${rightIndex}_LEFT`;
      const rightSecret = `SENT_COLON_${leftIndex}_${rightIndex}_RIGHT`;
      const trailing = `colon-context-${leftIndex}-${rightIndex}`;
      await repository.finishRun(RUN_ID, {
        status: "failed",
        ...evaluation(),
        failureCode: "adapter_failed",
        failureSummary: `${left}: ${leftSecret}:${right}: ${rightSecret} ${trailing}`,
      });
      const stored = client.calls.at(-1).params[6];
      if (
        stored.includes(leftSecret) ||
        stored.includes(rightSecret) ||
        !stored.includes(trailing)
      ) {
        failures.push({ left, right, stored });
      }
    }
  }

  assert.equal(
    failures.length,
    0,
    JSON.stringify({
      transitions: labels.length ** 2,
      failures: failures.length,
      samples: failures.slice(0, 6),
    }),
  );
});

test("Authorization and Bearer colon chains redact both credentials without losing context", async () => {
  const cases = [
    "Authorization: Bearer SENT_AUTH_BEARER_FIRST:api-key: SENT_AUTH_BEARER_SECOND auth-bearer-tail",
    "Authorization=SENT_AUTH_FIRST:api-key: SENT_AUTH_SECOND auth-tail",
    "Bearer SENT_BEARER_FIRST:api-key: SENT_BEARER_SECOND bearer-tail",
  ];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const failures = [];

  for (const summary of cases) {
    await repository.finishRun(RUN_ID, {
      status: "failed",
      ...evaluation(),
      failureCode: "adapter_failed",
      failureSummary: summary,
    });
    const stored = client.calls.at(-1).params[6];
    const secrets = summary.match(/SENT_[A-Z_]+/g) ?? [];
    const trailing = summary.split(" ").at(-1);
    if (secrets.some((secret) => stored.includes(secret)) || !stored.includes(trailing)) {
      failures.push({ summary, stored });
    }
  }

  assert.deepEqual(failures, []);
});

test("colon-bearing credentials redact fully without consuming adjacent non-label prose", async () => {
  const cases = [
    {
      summary: "token: SENT_COLON_USER:user:password retained-password-context",
      secrets: ["SENT_COLON_USER", "user:password"],
      trailing: "retained-password-context",
    },
    {
      summary: "secret: SENT_COLON_NONLABEL:audit:value retained-nonlabel-context",
      secrets: ["SENT_COLON_NONLABEL", "audit:value"],
      trailing: "retained-nonlabel-context",
    },
  ];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });
  const failures = [];

  for (const value of cases) {
    await repository.finishRun(RUN_ID, {
      status: "failed",
      ...evaluation(),
      failureCode: "adapter_failed",
      failureSummary: value.summary,
    });
    const stored = client.calls.at(-1).params[6];
    if (
      value.secrets.some((secret) => stored.includes(secret)) ||
      !stored.includes(value.trailing)
    ) {
      failures.push({ summary: value.summary, stored });
    }
  }

  assert.deepEqual(failures, []);
});

test("credential redaction preserves 13 positive start, wrapper, and scheme forms", async () => {
  const basicAuthorization = Buffer.from("SENT_POSITIVE_AUTH_BASIC:secret").toString("base64");
  const standaloneBasic = Buffer.from("SENT_POSITIVE_BASIC:secret").toString("base64");
  const cases = [
    { summary: "token: SENT_POSITIVE_0 kept-0", secrets: ["SENT_POSITIVE_0"] },
    { summary: "prefix token: SENT_POSITIVE_1 kept-1", secrets: ["SENT_POSITIVE_1"] },
    { summary: "(token: (SENT_POSITIVE_2)) kept-2", secrets: ["SENT_POSITIVE_2"] },
    { summary: "[secret: ['SENT_POSITIVE_3']] kept-3", secrets: ["SENT_POSITIVE_3"] },
    { summary: "{password: {SENT_POSITIVE_4}} kept-4", secrets: ["SENT_POSITIVE_4"] },
    { summary: "prefix,api-key: SENT_POSITIVE_5 kept-5", secrets: ["SENT_POSITIVE_5"] },
    { summary: "prefix;access-token: SENT_POSITIVE_6 kept-6", secrets: ["SENT_POSITIVE_6"] },
    { summary: "prefix:refresh-token: SENT_POSITIVE_7 kept-7", secrets: ["SENT_POSITIVE_7"] },
    {
      summary: 'Authorization: Bearer "SENT_POSITIVE_8 SENT_POSITIVE_8B" kept-8',
      secrets: ["SENT_POSITIVE_8", "SENT_POSITIVE_8B"],
    },
    {
      summary: `Authorization=Basic ${basicAuthorization} kept-9`,
      secrets: [basicAuthorization],
    },
    { summary: "Bearer: (SENT_POSITIVE_10) kept-10", secrets: ["SENT_POSITIVE_10"] },
    { summary: `Basic ("${standaloneBasic}") kept-11`, secrets: [standaloneBasic] },
    {
      summary: "ordinary Basic requirements remain useful; token: SENT_POSITIVE_12 kept-12",
      secrets: ["SENT_POSITIVE_12"],
      ordinaryBasic: true,
    },
  ];
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  const repository = createSyncRepository({ client });

  assert.equal(cases.length, 13);
  for (const [index, value] of cases.entries()) {
    await repository.finishRun(RUN_ID, {
      status: "failed",
      ...evaluation(),
      failureCode: "adapter_failed",
      failureSummary: value.summary,
    });
    const stored = client.calls.at(-1).params[6];
    for (const secret of value.secrets) assert.equal(stored.includes(secret), false, secret);
    assert.match(stored, new RegExp(`kept-${index}`));
    if (value.ordinaryBasic) assert.match(stored, /ordinary Basic requirements remain useful/);
  }
});

test("run evidence rejects malformed JSON, statuses, UUIDs, and database misses", async () => {
  const client = fakeClient(() => result());
  const repository = createSyncRepository({ client });
  await assert.rejects(repository.recordRunEvaluation("bad", evaluation()), /runId/i);
  await assert.rejects(
    repository.recordRunEvaluation(RUN_ID, evaluation({ counts: { value: BigInt(1) } })),
    /JSON/i,
  );
  await assert.rejects(
    repository.recordRunEvaluation(RUN_ID, evaluation({ counts: [] })),
    /counts/i,
  );
  await assert.rejects(
    repository.recordRunEvaluation(RUN_ID, evaluation({ baselines: [] })),
    /baselines/i,
  );
  await assert.rejects(
    repository.finishRun(RUN_ID, { status: "running", ...evaluation() }),
    /status/i,
  );
  await assert.rejects(repository.recordRunEvaluation(RUN_ID, evaluation()), /running run/i);
});

test("healthy count history is source-healthy, date-collapsed, bounded, and newest first", async () => {
  const client = fakeClient(() =>
    result([
      { scheduled_for: "2026-08-16", snapshot: { sale: 10, rent: 5 } },
      { scheduled_for: "2026-08-15", snapshot: { sale: 9, rent: 4 } },
    ]),
  );
  const history = await createSyncRepository({ client }).getHealthyCountHistory(SOURCE_28HSE, 7);

  assert.deepEqual(history, [
    { sale: 10, rent: 5 },
    { sale: 9, rent: 4 },
  ]);
  const call = client.calls[0];
  assert.match(call.statement, /row_number\(\) OVER \(PARTITION BY scheduled_for/i);
  assert.match(call.statement, /healthy/i);
  assert.match(call.statement, /LIMIT \$2/);
  assert.deepEqual(call.params, [SOURCE_28HSE, 7]);
});

test("healthy count history validates source, limits, dates, and count rows", async () => {
  const badRowClient = fakeClient(() =>
    result([{ scheduled_for: "2026-02-30", snapshot: { sale: 1, rent: 1 } }]),
  );
  const repository = createSyncRepository({ client: badRowClient });
  await assert.rejects(repository.getHealthyCountHistory("third-party"), /source/i);
  await assert.rejects(repository.getHealthyCountHistory(SOURCE_28HSE, 0), /limit/i);
  await assert.rejects(repository.getHealthyCountHistory(SOURCE_28HSE), /history row/i);
});

test("approveShadowRun only approves a healthy shadow and redacts its note", async () => {
  const client = fakeClient(() =>
    result([{ id: RUN_ID, baseline_approved_at: "2026-08-16T12:00:00.000Z" }]),
  );
  await createSyncRepository({ client }).approveShadowRun(RUN_ID, {
    reviewer: "  operator@example.com  ",
    note: " token=approval-secret reviewed ",
  });

  const call = client.calls[0];
  assert.match(call.statement, /mode = 'shadow'/);
  assert.match(call.statement, /status = 'shadow_healthy'/);
  assert.match(call.statement, /28hse_agent_540/);
  assert.match(call.statement, /old_site/);
  assert.match(call.statement, /baseline_approved_at IS NULL/i);
  assert.match(call.statement, /reasons/i);
  assert.equal(call.params[1], "operator@example.com");
  assert.doesNotMatch(call.params[2], /approval-secret/);
});

test("shadow approval and streak evidence reject future timestamps", async () => {
  const futureApproval = new Date(Date.now() + 86_400_000).toISOString();
  const approvalClient = fakeClient(() =>
    result([{ id: RUN_ID, baseline_approved_at: futureApproval }]),
  );
  await assert.rejects(
    createSyncRepository({ client: approvalClient }).approveShadowRun(RUN_ID, {
      reviewer: "operator",
    }),
    /approval.*future|future.*approval/i,
  );

  const streakClient = fakeClient(() =>
    result([
      {
        id: RUN_ID,
        scheduled_for: "2026-08-16",
        finished_at: "2026-08-16T02:00:00.000Z",
        status: "shadow_healthy",
        baseline_approved_at: "2026-08-17T00:00:00.000Z",
        source_status: healthySourceStatus(),
      },
    ]),
  );
  await assert.rejects(
    createSyncRepository({ client: streakClient }).getApprovedHealthyShadowStreak("2026-08-17"),
    /approval.*date|date.*approval|future/i,
  );

  const farFutureDate = "2099-01-02";
  const wallClockFuture = new Date(Date.now() + 86_400_000).toISOString();
  const wallClockClient = fakeClient(() =>
    result([
      {
        id: RUN_ID,
        scheduled_for: "2099-01-01",
        finished_at: "2099-01-01T01:00:00.000Z",
        status: "shadow_healthy",
        baseline_approved_at: wallClockFuture,
        source_status: healthySourceStatus(),
      },
    ]),
  );
  await assert.rejects(
    createSyncRepository({ client: wallClockClient }).getApprovedHealthyShadowStreak(farFutureDate),
    /future/i,
  );
});

test("shadow approvals must strictly predate Hong Kong midnight for the publish date", async () => {
  const streakRow = (baselineApprovedAt) => ({
    id: RUN_ID,
    scheduled_for: "2026-08-16",
    finished_at: "2026-08-16T14:00:00.000Z",
    status: "shadow_healthy",
    baseline_approved_at: baselineApprovedAt,
    source_status: healthySourceStatus(),
  });
  const beforeBoundary = fakeClient(() => result([streakRow("2026-08-16T15:59:59.999Z")]));
  assert.deepEqual(
    await createSyncRepository({ client: beforeBoundary }).getApprovedHealthyShadowStreak(
      "2026-08-17",
    ),
    { length: 1, lastDate: "2026-08-16" },
  );

  const atBoundary = fakeClient(() => result([streakRow("2026-08-16T16:00:00.000Z")]));
  await assert.rejects(
    createSyncRepository({ client: atBoundary }).getApprovedHealthyShadowStreak("2026-08-17"),
    /approval.*date|date.*approval/i,
  );
});

test("approveShadowRun rejects invalid approvals and nonqualifying rows", async () => {
  const client = fakeClient(() => result());
  const repository = createSyncRepository({ client });
  await assert.rejects(repository.approveShadowRun(RUN_ID, { reviewer: " " }), /reviewer/i);
  assert.equal(client.calls.length, 0);
  await assert.rejects(
    repository.approveShadowRun(RUN_ID, { reviewer: "operator" }),
    /healthy shadow/i,
  );
});

test("approved shadow streak collapses reruns and uses consecutive scheduled dates", async () => {
  const healthy = healthySourceStatus();
  const sevenSameDate = Array.from({ length: 7 }, (_, index) => ({
    id: index % 2 ? RUN_ID : RUN_ID_2,
    scheduled_for: "2026-08-16",
    finished_at: `2026-08-16T0${index}:00:00.000Z`,
    status: "shadow_healthy",
    baseline_approved_at: `2026-08-16T${String(index + 7).padStart(2, "0")}:00:00.000Z`,
    source_status: healthy,
  }));
  const sameDateClient = fakeClient(() => result(sevenSameDate));
  assert.deepEqual(
    await createSyncRepository({ client: sameDateClient }).getApprovedHealthyShadowStreak(
      "2026-08-17",
    ),
    { length: 1, lastDate: "2026-08-16" },
  );
  assert.match(
    sameDateClient.calls[0].statement,
    /row_number\(\) OVER \(PARTITION BY scheduled_for/i,
  );

  const gapClient = fakeClient(() =>
    result([
      {
        id: RUN_ID,
        scheduled_for: "2026-08-16",
        finished_at: "2026-08-16T02:00:00.000Z",
        status: "shadow_healthy",
        baseline_approved_at: "2026-08-16T03:00:00.000Z",
        source_status: healthy,
      },
      {
        id: RUN_ID_2,
        scheduled_for: "2026-08-14",
        finished_at: "2026-08-14T02:00:00.000Z",
        status: "shadow_healthy",
        baseline_approved_at: "2026-08-14T03:00:00.000Z",
        source_status: healthy,
      },
    ]),
  );
  assert.deepEqual(
    await createSyncRepository({ client: gapClient }).getApprovedHealthyShadowStreak("2026-08-17"),
    { length: 1, lastDate: "2026-08-16" },
  );
});

test("unhealthy, unapproved, or later reruns stop the shadow streak", async () => {
  const rows = [
    {
      id: RUN_ID,
      scheduled_for: "2026-08-16",
      finished_at: "2026-08-16T04:00:00.000Z",
      status: "blocked",
      baseline_approved_at: null,
      source_status: healthySourceStatus(),
    },
    {
      id: RUN_ID_2,
      scheduled_for: "2026-08-16",
      finished_at: "2026-08-16T02:00:00.000Z",
      status: "shadow_healthy",
      baseline_approved_at: "2026-08-16T03:00:00.000Z",
      source_status: healthySourceStatus(),
    },
  ];
  const client = fakeClient(() => result(rows));
  assert.deepEqual(
    await createSyncRepository({ client }).getApprovedHealthyShadowStreak("2026-08-17"),
    { length: 0, lastDate: null },
  );
});

test("healthy flags carrying blocking reasons do not count toward the shadow streak", async () => {
  const sourceStatus = healthySourceStatus({
    [SOURCE_28HSE]: {
      source: SOURCE_28HSE,
      healthy: true,
      reasons: ["blocking_reason"],
    },
  });
  const client = fakeClient(() =>
    result([
      {
        id: RUN_ID,
        scheduled_for: "2026-08-16",
        finished_at: "2026-08-16T02:00:00.000Z",
        status: "shadow_healthy",
        baseline_approved_at: "2026-08-16T03:00:00.000Z",
        source_status: sourceStatus,
      },
    ]),
  );
  assert.deepEqual(
    await createSyncRepository({ client }).getApprovedHealthyShadowStreak("2026-08-17"),
    { length: 0, lastDate: null },
  );
});

test("candidate discovery returns only the narrow exact normalized identity projection", async () => {
  const client = fakeClient(() =>
    result([
      {
        id: PROPERTY_ID,
        listing_no: "SALE-ONE",
        canonical_property_no: " ＥＰ- ０００１ ",
        legacy_property_no: "EP-LEGACY",
        deal_type: "sale",
        updated_at: "2026-08-17T00:00:00.000000Z",
      },
      {
        id: PROPERTY_ID_2,
        listing_no: "RENT-ONE",
        canonical_property_no: null,
        legacy_property_no: " ep-0002 ",
        deal_type: "rent",
        updated_at: "2026-08-17T00:00:01.000000Z",
      },
      {
        id: "24242424-2424-4242-8242-242424242424",
        listing_no: "OTHER",
        canonical_property_no: "EP-9999",
        legacy_property_no: null,
        deal_type: "sale",
        updated_at: "2026-08-17T00:00:02.000000Z",
      },
    ]),
  );
  const rows = await createSyncRepository({ client }).findCanonicalCandidates([
    "rent:EP-0002",
    "sale:EP-0001",
  ]);

  assert.deepEqual(rows, [
    {
      id: PROPERTY_ID_2,
      listing_no: "RENT-ONE",
      canonical_property_no: "EP-0002",
      legacy_property_no: "EP-0002",
      deal_type: "rent",
      updated_at: "2026-08-17T00:00:01.000000Z",
    },
    {
      id: PROPERTY_ID,
      listing_no: "SALE-ONE",
      canonical_property_no: "EP-0001",
      legacy_property_no: "EP-LEGACY",
      deal_type: "sale",
      updated_at: "2026-08-17T00:00:00.000000Z",
    },
  ]);
  const statement = client.calls[0].statement;
  assert.match(
    statement,
    /^SELECT id, listing_no, canonical_property_no, legacy_property_no, deal_type, to_char\(updated_at/,
  );
  assert.doesNotMatch(statement, /title|description|images|price|address/i);
  assert.match(statement, /ORDER BY id ASC LIMIT \$3/);
  assert.equal(client.calls[0].params[2], 200);
});

test("candidate discovery pages deterministically and rejects malformed rows", async () => {
  const page = Array.from({ length: 200 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
    listing_no: `ROW-${index + 1}`,
    canonical_property_no: `EP-${index + 1}`,
    legacy_property_no: null,
    deal_type: "sale",
    updated_at: "2026-08-17T00:00:00.000000Z",
  }));
  const client = fakeClient((_call, index) => result(index === 0 ? page : []));
  await createSyncRepository({ client }).findCanonicalCandidates(["sale:EP-1"]);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].params[1], page.at(-1).id);

  const invalidClient = fakeClient(() => result([{ ...page[0], listing_no: " " }]));
  await assert.rejects(
    createSyncRepository({ client: invalidClient }).findCanonicalCandidates(["sale:EP-1"]),
    /candidate row/i,
  );
});

test("non-version timestamps normalize driver Dates while row versions require lossless SQL text", async () => {
  const timestamp = new Date("2026-08-17T00:00:00.000Z");
  const candidateClient = fakeClient(() =>
    result([
      {
        id: PROPERTY_ID,
        listing_no: "SALE-ONE",
        canonical_property_no: "EP-0001",
        legacy_property_no: null,
        deal_type: "sale",
        updated_at: "2026-08-17T00:00:00.000000Z",
      },
    ]),
  );
  const [candidate] = await createSyncRepository({
    client: candidateClient,
  }).findCanonicalCandidates(["sale:EP-0001"]);
  assert.equal(candidate.updated_at, "2026-08-17T00:00:00.000000Z");

  const fieldClient = fakeClient(() =>
    result([
      {
        property_id: PROPERTY_ID,
        field_name: "price",
        last_published_value: 8_000_000,
        override_value: null,
        active_override: false,
        winning_observation_id: OBSERVATION_ID,
        updated_at: timestamp,
      },
    ]),
  );
  const [field] = await createSyncRepository({ client: fieldClient }).loadFieldStates([
    PROPERTY_ID,
  ]);
  assert.equal(field.updated_at, timestamp.toISOString());

  const mediaClient = fakeClient(() => result([mediaRow({ created_at: timestamp })]));
  const media = await createSyncRepository({ client: mediaClient }).findMediaByHash("a".repeat(64));
  assert.equal(media.createdAt, timestamp.toISOString());
});

test("source-link lookup loads all statuses across both deals for each source identity", async () => {
  const links = [
    {
      property_id: PROPERTY_ID,
      source: SOURCE_28HSE,
      external_listing_id: "3972991",
      deal_type: "sale",
      match_key: "sale:EP-0001",
      link_reason: "exact_property_no_and_deal_type",
      status: "active",
    },
    {
      property_id: PROPERTY_ID_2,
      source: SOURCE_28HSE,
      external_listing_id: "3972991",
      deal_type: "rent",
      match_key: "rent:EP-0002",
      link_reason: "exact_property_no_and_deal_type",
      status: "rejected",
    },
    {
      property_id: PROPERTY_ID,
      source: SOURCE_28HSE,
      external_listing_id: "3972991",
      deal_type: "rent",
      match_key: "rent:EP-0001",
      link_reason: "exact_property_no_and_deal_type",
      status: "proposed",
    },
  ];
  const client = fakeClient(() => result(links));
  const rows = await createSyncRepository({ client }).loadSourceLinks([
    { source: SOURCE_28HSE, externalId: "3972991", dealType: "sale" },
  ]);

  assert.deepEqual(rows, links);
  const where = client.calls[0].statement.split(" WHERE ")[1];
  assert.match(where, /source, external_listing_id/);
  assert.doesNotMatch(where, /status\s*=|deal_type\s*=/i);
});

test("source-link lookup rejects malformed identities and rows", async () => {
  const client = fakeClient(() =>
    result([
      {
        property_id: PROPERTY_ID,
        source: SOURCE_28HSE,
        external_listing_id: "3972991",
        deal_type: "lease",
        match_key: "sale:EP-0001",
        link_reason: "exact_property_no_and_deal_type",
        status: "active",
      },
    ]),
  );
  const repository = createSyncRepository({ client });
  await assert.rejects(
    repository.loadSourceLinks([{ source: SOURCE_28HSE, externalId: "bad id" }]),
    /identity/i,
  );
  assert.equal(client.calls.length, 0);
  await assert.rejects(
    repository.loadSourceLinks([{ source: SOURCE_28HSE, externalId: "3972991" }]),
    /source-link row/i,
  );
});

test("saveProposedLinks verifies exact existing properties and never revives rejected links", async () => {
  const client = fakeClient((call) => {
    if (call.statement.startsWith("SELECT id, canonical_property_no")) {
      return result([
        {
          id: PROPERTY_ID,
          canonical_property_no: "EP-0001",
          legacy_property_no: "EP-0001",
          deal_type: "sale",
        },
      ]);
    }
    if (call.statement.startsWith("SELECT property_id, source, external_listing_id")) {
      return result([
        {
          property_id: PROPERTY_ID,
          source: SOURCE_28HSE,
          external_listing_id: "3972991",
          deal_type: "sale",
          match_key: "sale:EP-0001",
          link_reason: "exact_property_no_and_deal_type",
          status: "rejected",
        },
      ]);
    }
    return result();
  });
  await createSyncRepository({ client }).saveProposedLinks(RUN_ID, [
    {
      propertyId: PROPERTY_ID,
      source: SOURCE_28HSE,
      externalId: "3972991",
      dealType: "sale",
      matchKey: "sale:EP-0001",
      observedAt: "2026-08-17T00:00:00.000Z",
    },
  ]);

  const insert = client.calls.find((call) =>
    call.statement.startsWith("INSERT INTO property_source_links"),
  );
  assert.ok(insert);
  assert.match(insert.statement, /'exact_property_no_and_deal_type'/);
  assert.match(insert.statement, /'proposed'/);
  assert.match(insert.statement, /ON CONFLICT[^]*DO NOTHING/i);
  assert.doesNotMatch(insert.statement, /DO UPDATE/i);
  assert.doesNotMatch(insert.statement, /UPDATE properties|DELETE FROM properties/i);
  assert.ok(
    client.calls.some((call) =>
      call.statement.startsWith("SELECT property_id, source, external_listing_id"),
    ),
  );
});

test("saveProposedLinks accepts the exact normalized legacy fallback candidate", async () => {
  const client = fakeClient((call) => {
    if (call.statement.startsWith("SELECT id, canonical_property_no")) {
      return result([
        {
          id: PROPERTY_ID,
          canonical_property_no: null,
          legacy_property_no: " ｅｐ- ０００１ ",
          deal_type: "sale",
        },
      ]);
    }
    if (call.statement.startsWith("SELECT property_id, source, external_listing_id")) {
      return result([
        {
          property_id: PROPERTY_ID,
          source: SOURCE_28HSE,
          external_listing_id: "3972991",
          deal_type: "sale",
          match_key: "sale:EP-0001",
          link_reason: "exact_property_no_and_deal_type",
          status: "proposed",
        },
      ]);
    }
    return result();
  });

  await createSyncRepository({ client }).saveProposedLinks(RUN_ID, [
    {
      propertyId: PROPERTY_ID,
      source: SOURCE_28HSE,
      externalId: "3972991",
      dealType: "sale",
      matchKey: "sale:EP-0001",
      observedAt: "2026-08-17T00:00:00.000Z",
    },
  ]);
  assert.ok(
    client.calls.some((call) => call.statement.startsWith("INSERT INTO property_source_links")),
  );
});

test("saveProposedLinks fails closed instead of relinking a conflicting active identity", async () => {
  const client = fakeClient((call) => {
    if (call.statement.startsWith("SELECT id, canonical_property_no")) {
      return result([
        {
          id: PROPERTY_ID,
          canonical_property_no: "EP-0001",
          legacy_property_no: null,
          deal_type: "sale",
        },
      ]);
    }
    if (call.statement.startsWith("SELECT property_id, source, external_listing_id")) {
      return result([
        {
          property_id: PROPERTY_ID_2,
          source: SOURCE_28HSE,
          external_listing_id: "3972991",
          deal_type: "sale",
          match_key: "sale:EP-9999",
          link_reason: "exact_property_no_and_deal_type",
          status: "active",
        },
      ]);
    }
    return result();
  });

  await assert.rejects(
    createSyncRepository({ client }).saveProposedLinks(RUN_ID, [
      {
        propertyId: PROPERTY_ID,
        source: SOURCE_28HSE,
        externalId: "3972991",
        dealType: "sale",
        matchKey: "sale:EP-0001",
        observedAt: "2026-08-17T00:00:00.000Z",
      },
    ]),
    /conflict|existing.*link|link.*mismatch/i,
  );
});

test("saveProposedLinks rejects missing, mismatched, duplicate, and nonexisting targets", async () => {
  const client = fakeClient(() => result());
  const repository = createSyncRepository({ client });
  const link = {
    propertyId: PROPERTY_ID,
    source: SOURCE_28HSE,
    externalId: "3972991",
    dealType: "sale",
    matchKey: "sale:EP-0001",
    observedAt: "2026-08-17T00:00:00.000Z",
  };
  await assert.rejects(repository.saveProposedLinks(RUN_ID, [link, link]), /duplicate/i);
  assert.equal(client.calls.length, 0);
  await assert.rejects(repository.saveProposedLinks(RUN_ID, [link]), /canonical property/i);
  assert.equal(
    client.calls.some((call) => call.statement.startsWith("INSERT INTO property_source_links")),
    false,
  );
});

test("saveProposedLinks rejects Date evidence before SQL and preserves supported ISO offsets", async () => {
  const baseLink = {
    propertyId: PROPERTY_ID,
    source: SOURCE_28HSE,
    externalId: "3972991",
    dealType: "sale",
    matchKey: "sale:EP-0001",
    observedAt: "2026-08-17T08:00:00+08:00",
  };
  const invalidClient = fakeClient();
  await assert.rejects(
    createSyncRepository({ client: invalidClient }).saveProposedLinks(RUN_ID, [
      { ...baseLink, observedAt: new Date("2026-08-17T00:00:00.000Z") },
    ]),
  );
  assert.equal(invalidClient.calls.length, 0);

  const client = fakeClient((call) => {
    if (call.statement.startsWith("SELECT id, canonical_property_no")) {
      return result([
        {
          id: PROPERTY_ID,
          canonical_property_no: "EP-0001",
          legacy_property_no: null,
          deal_type: "sale",
        },
      ]);
    }
    if (call.statement.startsWith("SELECT property_id, source, external_listing_id")) {
      return result([
        {
          property_id: PROPERTY_ID,
          source: SOURCE_28HSE,
          external_listing_id: "3972991",
          deal_type: "sale",
          match_key: "sale:EP-0001",
          link_reason: "exact_property_no_and_deal_type",
          status: "proposed",
        },
      ]);
    }
    return result();
  });
  await createSyncRepository({ client }).saveProposedLinks(RUN_ID, [baseLink]);
  const insert = client.calls.find((call) =>
    call.statement.startsWith("INSERT INTO property_source_links"),
  );
  assert.equal(insert.params[5], baseLink.observedAt);
});

test("saveProposedLinks snapshots validated timestamp evidence before awaited SQL", async () => {
  const observedAt = "2026-08-17T08:00:00+08:00";
  const link = {
    propertyId: PROPERTY_ID,
    source: SOURCE_28HSE,
    externalId: "3972991",
    dealType: "sale",
    matchKey: "sale:EP-0001",
    observedAt,
  };
  const client = fakeClient((call) => {
    if (call.statement.startsWith("SELECT id, canonical_property_no")) {
      link.observedAt = undefined;
      return result([
        {
          id: PROPERTY_ID,
          canonical_property_no: "EP-0001",
          legacy_property_no: null,
          deal_type: "sale",
        },
      ]);
    }
    if (call.statement.startsWith("SELECT property_id, source, external_listing_id")) {
      return result([
        {
          property_id: PROPERTY_ID,
          source: SOURCE_28HSE,
          external_listing_id: "3972991",
          deal_type: "sale",
          match_key: "sale:EP-0001",
          link_reason: "exact_property_no_and_deal_type",
          status: "proposed",
        },
      ]);
    }
    return result();
  });

  await createSyncRepository({ client }).saveProposedLinks(RUN_ID, [link]);
  const insert = client.calls.find((call) =>
    call.statement.startsWith("INSERT INTO property_source_links"),
  );
  assert.equal(insert.params[5], observedAt);
});

test("estate, field-state, and lifecycle reads preserve strict repository projections", async () => {
  const fieldRows = [
    {
      property_id: PROPERTY_ID,
      field_name: "price",
      last_published_value: 8_000_000,
      override_value: null,
      active_override: false,
      winning_observation_id: OBSERVATION_ID,
      updated_at: "2026-08-17T00:00:00.000Z",
    },
    {
      property_id: PROPERTY_ID,
      field_name: "price",
      last_published_value: 8_000_000,
      override_value: null,
      active_override: false,
      winning_observation_id: OBSERVATION_ID,
      updated_at: "2026-08-17T00:00:00.000Z",
    },
  ];
  const lifecycleRows = [
    {
      property_id: PROPERTY_ID,
      consecutive_absent_healthy_runs: 2_147_483_647,
      last_evaluated_run_id: RUN_ID,
      inactive_reason: null,
      inactive_at: null,
      updated_at: "2026-08-17T00:00:00.000Z",
    },
  ];
  const client = fakeClient((call) => {
    if (call.statement.includes("FROM estates"))
      return result([{ id: PROPERTY_ID_2, slug: "bal" }]);
    if (call.statement.includes("FROM property_sync_fields")) return result(fieldRows);
    if (call.statement.includes("FROM property_sync_state")) return result(lifecycleRows);
    throw new Error(`unexpected query: ${call.statement}`);
  });
  const repository = createSyncRepository({ client });

  assert.deepEqual(
    await repository.loadEstateIdsBySlug(["bal"]),
    new Map([["bal", PROPERTY_ID_2]]),
  );
  assert.deepEqual(await repository.loadFieldStates([PROPERTY_ID]), fieldRows);
  assert.deepEqual(await repository.loadLifecycleStates([PROPERTY_ID]), lifecycleRows);
});

test("field and lifecycle row validation fails closed without silently deduplicating", async () => {
  const invalidLifecycle = fakeClient(() =>
    result([
      {
        property_id: PROPERTY_ID,
        consecutive_absent_healthy_runs: 2_147_483_648,
        last_evaluated_run_id: null,
        inactive_reason: null,
        inactive_at: null,
        updated_at: "2026-08-17T00:00:00.000Z",
      },
    ]),
  );
  await assert.rejects(
    createSyncRepository({ client: invalidLifecycle }).loadLifecycleStates([PROPERTY_ID]),
    /lifecycle row/i,
  );

  const invalidField = fakeClient(() =>
    result([
      {
        property_id: PROPERTY_ID,
        field_name: "price",
        last_published_value: 1,
        override_value: null,
        active_override: "false",
        winning_observation_id: null,
        updated_at: "2026-08-17T00:00:00.000Z",
      },
    ]),
  );
  await assert.rejects(
    createSyncRepository({ client: invalidField }).loadFieldStates([PROPERTY_ID]),
    /field-state row/i,
  );
});

test("field and lifecycle rows require exact own nullable identity columns", async () => {
  const fieldRow = () => ({
    property_id: PROPERTY_ID,
    field_name: "price",
    last_published_value: 8_000_000,
    override_value: null,
    active_override: false,
    winning_observation_id: OBSERVATION_ID,
    updated_at: "2026-08-17T00:00:00.000Z",
  });
  const lifecycleRow = () => ({
    property_id: PROPERTY_ID,
    consecutive_absent_healthy_runs: 1,
    last_evaluated_run_id: RUN_ID,
    inactive_reason: "missing_from_both_sources",
    inactive_at: null,
    updated_at: "2026-08-17T00:00:00.000Z",
  });
  const cases = [
    ["field", "winning_observation_id", "missing"],
    ["field", "winning_observation_id", undefined],
    ["field", "winning_observation_id", "not-a-uuid"],
    ["lifecycle", "last_evaluated_run_id", "missing"],
    ["lifecycle", "last_evaluated_run_id", undefined],
    ["lifecycle", "last_evaluated_run_id", "not-a-uuid"],
    ["lifecycle", "inactive_reason", "missing"],
    ["lifecycle", "inactive_reason", undefined],
    ["lifecycle", "inactive_reason", 42],
    ["lifecycle", "inactive_at", "missing"],
    ["lifecycle", "inactive_at", undefined],
    ["lifecycle", "inactive_at", "not-a-timestamp"],
  ];

  for (const [kind, field, value] of cases) {
    const row = kind === "field" ? fieldRow() : lifecycleRow();
    if (value === "missing") delete row[field];
    else row[field] = value;
    const client = fakeClient(() => result([row]));
    const repository = createSyncRepository({ client });
    await assert.rejects(
      kind === "field"
        ? repository.loadFieldStates([PROPERTY_ID])
        : repository.loadLifecycleStates([PROPERTY_ID]),
      kind === "field" ? /field-state row/i : /lifecycle row/i,
      `${kind}.${field}=${String(value)}`,
    );
  }
});

test("media lookup by hash and URL is exact and returns Task 7 metadata", async () => {
  const row = mediaRow();
  const client = fakeClient((call) => {
    if (call.statement.includes("content_hash = $1")) return result([row]);
    if (call.statement.includes("url = ANY")) return result([row]);
    throw new Error(`unexpected query: ${call.statement}`);
  });
  const repository = createSyncRepository({ client });
  const expected = {
    id: row.id,
    url: row.url,
    pathname: row.pathname,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
  assert.deepEqual(await repository.findMediaByHash("a".repeat(64)), expected);
  assert.deepEqual(await repository.findMediaByUrls([row.url]), [expected]);
  assert.match(client.calls[1].statement, /WHERE url = ANY\(\$1::text\[\]\)/);
  assert.doesNotMatch(client.calls[1].statement, /LIKE|ILIKE|origin/i);
});

test("media lookup requires explicit null or UUID ownership fields from PostgreSQL", async () => {
  for (const field of ["owner_id", "created_by"]) {
    for (const variant of ["missing", "undefined", "invalid"]) {
      const row = mediaRow();
      if (variant === "missing") delete row[field];
      else row[field] = variant === "undefined" ? undefined : "not-a-uuid";
      const client = fakeClient(() => result([row]));
      await assert.rejects(
        createSyncRepository({ client }).findMediaByHash("a".repeat(64)),
        /media row/i,
        `${field} ${variant}`,
      );
    }
  }
});

test("URL media lookup requires own nullable content columns while preserving real nulls", async () => {
  const nullRow = mediaRow({ content_type: null, content_hash: null });
  const validClient = fakeClient(() => result([nullRow]));
  const [asset] = await createSyncRepository({ client: validClient }).findMediaByUrls([
    nullRow.url,
  ]);
  assert.equal(asset.contentType, null);
  assert.equal(asset.contentHash, null);

  for (const field of ["content_type", "content_hash"]) {
    for (const variant of ["missing", "undefined"]) {
      const row = mediaRow();
      if (variant === "missing") delete row[field];
      else row[field] = undefined;
      const client = fakeClient(() => result([row]));
      await assert.rejects(
        createSyncRepository({ client }).findMediaByUrls([row.url]),
        /media row/i,
        `${field} ${variant}`,
      );
    }
  }
});

test("registerOwnedMedia inserts conflict-safely then returns the existing race winner", async () => {
  const winner = mediaRow({
    url: "https://owned.example/admin-winner.png",
    pathname: "cms/admin-winner.png",
    owner_type: "cms",
    owner_id: PROPERTY_ID,
  });
  const client = fakeClient((call) =>
    call.statement.startsWith("SELECT id, url, pathname") ? result([winner]) : result(),
  );
  const repository = createSyncRepository({ client });
  const returned = await repository.registerOwnedMedia({
    url: "https://owned.example/mls/new.png",
    pathname: "mls/aa/new.png",
    contentType: "image/png",
    sizeBytes: 123,
    contentHash: "a".repeat(64),
    ownerType: "mls-shared",
    ownerId: null,
    createdBy: null,
  });

  assert.equal(client.calls.length, 2);
  assert.match(
    client.calls[0].statement,
    /ON CONFLICT \(content_hash\) WHERE content_hash IS NOT NULL DO NOTHING/,
  );
  assert.doesNotMatch(client.calls[0].statement, /DO UPDATE/i);
  assert.deepEqual(Object.keys(returned), ["outcome", "asset"]);
  assert.equal(returned.outcome, "existing");
  assert.equal(returned.asset.url, winner.url);
  assert.equal(returned.asset.ownerType, "cms");
});

test("registerOwnedMedia proves inserted ownership and rejects winner metadata drift", async () => {
  const input = {
    url: "https://owned.example/mls/new.png",
    pathname: "mls/aa/new.png",
    contentType: "image/png",
    sizeBytes: 123,
    contentHash: "a".repeat(64),
    ownerType: "mls-shared",
    ownerId: null,
    createdBy: null,
  };
  const insertedWinner = mediaRow({ url: input.url, pathname: input.pathname });
  const insertedClient = fakeClient((call) => {
    if (call.statement.startsWith("INSERT INTO media_assets")) return result([{ id: ASSET_ID }]);
    return result([insertedWinner]);
  });
  const inserted = await createSyncRepository({ client: insertedClient }).registerOwnedMedia(input);
  assert.equal(inserted.outcome, "inserted");
  assert.equal(inserted.asset.id, ASSET_ID);
  assert.match(insertedClient.calls[0].statement, /RETURNING id/i);

  for (const winner of [
    mediaRow({ content_type: "image/jpeg" }),
    mediaRow({ size_bytes: 124 }),
    mediaRow({ owner_type: "cms" }),
  ]) {
    const client = fakeClient((call) =>
      call.statement.startsWith("INSERT INTO media_assets")
        ? result([{ id: ASSET_ID }])
        : result([winner]),
    );
    await assert.rejects(
      createSyncRepository({ client }).registerOwnedMedia(input),
      /registered media|winner|ownership|match/i,
    );
  }
});

test("registerOwnedMedia requires every declared nullable field before issuing SQL", async () => {
  for (const field of ["contentType", "sizeBytes", "ownerId", "createdBy"]) {
    for (const variant of ["omitted", "undefined"]) {
      const input = ownedMediaInput();
      if (variant === "omitted") delete input[field];
      else input[field] = undefined;
      const client = fakeClient();
      await assert.rejects(
        createSyncRepository({ client }).registerOwnedMedia(input),
        /owned media|registered media/i,
        `${field} ${variant}`,
      );
      assert.equal(client.calls.length, 0, `${field} ${variant}`);
    }
  }
});

test("registerOwnedMedia snapshots validated nullable fields across awaited SQL", async () => {
  const input = ownedMediaInput();
  const expected = structuredClone(input);
  const client = fakeClient((call) => {
    if (call.statement.startsWith("INSERT INTO media_assets")) {
      input.contentType = undefined;
      input.ownerId = undefined;
      return result([{ id: ASSET_ID }]);
    }
    return result([mediaRow({ url: expected.url, pathname: expected.pathname })]);
  });

  const registered = await createSyncRepository({ client }).registerOwnedMedia(input);
  assert.equal(registered.outcome, "inserted");
  assert.equal(registered.asset.contentType, "image/png");
  assert.equal(registered.asset.ownerId, null);
});

test("saveMediaRecord is conflict-safe on the observation and source URL identity", async () => {
  const input = mediaRecordInput();
  const client = fakeClient((call) => {
    if (call.statement.includes("FROM media_assets")) return result([mediaRow()]);
    if (call.statement.startsWith("INSERT INTO listing_media_records")) {
      return result([{ id: MEDIA_RECORD_ID }]);
    }
    if (call.statement.includes("FROM listing_media_records")) {
      return result([mediaRecordRow(input)]);
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });
  await createSyncRepository({ client }).saveMediaRecord(input);

  assert.match(client.calls[0].statement, /FROM media_assets/);
  assert.match(client.calls[1].statement, /^INSERT INTO listing_media_records/);
  assert.match(client.calls[1].statement, /ON CONFLICT \(observation_id, source_url\) DO NOTHING/);
  assert.match(client.calls[2].statement, /FROM listing_media_records/);
});

test("saveMediaRecord verifies owned assets and exact existing provenance", async () => {
  const input = mediaRecordInput();
  for (const scenario of [
    { asset: mediaRow({ content_hash: "b".repeat(64) }), existing: null },
    {
      asset: mediaRow(),
      existing: mediaRecordRow(input, {
        eligibility: "upload_failed",
        rejection_reason: "prior_failure",
      }),
    },
    {
      asset: mediaRow(),
      existing: mediaRecordRow(input, { owned_media_asset_id: RUN_ID_2 }),
    },
  ]) {
    const client = fakeClient((call) => {
      if (call.statement.includes("FROM media_assets")) return result([scenario.asset]);
      if (call.statement.startsWith("INSERT INTO listing_media_records")) return result();
      if (call.statement.includes("FROM listing_media_records")) {
        return result(scenario.existing ? [scenario.existing] : []);
      }
      throw new Error(`unexpected query: ${call.statement}`);
    });
    await assert.rejects(
      createSyncRepository({ client }).saveMediaRecord(input),
      /media asset|media record|provenance|persisted/i,
    );
  }
});

test("saveMediaRecord binds a successful insert to the selected authoritative row", async () => {
  const input = mediaRecordInput();
  const client = fakeClient((call) => {
    if (call.statement.includes("FROM media_assets")) return result([mediaRow()]);
    if (call.statement.startsWith("INSERT INTO listing_media_records")) {
      return result([{ id: MEDIA_RECORD_ID }]);
    }
    if (call.statement.includes("FROM listing_media_records")) {
      return result([mediaRecordRow(input, { id: RUN_ID_2 })]);
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });

  await assert.rejects(
    createSyncRepository({ client }).saveMediaRecord(input),
    /insert|authoritative|media record/i,
  );
});

test("saveMediaRecord observes cancellation after asset lookup before any record write", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel media record after lookup exactly");
  const client = fakeClient((call) => {
    controller.abort(reason);
    return result([mediaRow()]);
  });

  await assert.rejects(
    createSyncRepository({ client }).saveMediaRecord(mediaRecordInput(), {
      signal: controller.signal,
    }),
    (error) => error === reason,
  );
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].statement, /FROM media_assets/);
  assert.doesNotMatch(client.calls[0].statement, /^INSERT/i);
});

test("saveMediaRecord requires every declared nullable field before issuing SQL", async () => {
  const nullableInput = mediaRecordInput({
    propertyId: null,
    contentHash: null,
    ownedMediaAssetId: null,
    detectedMime: null,
    sizeBytes: null,
    width: null,
    height: null,
    eligibility: "rejected",
    rejectionReason: null,
  });
  for (const field of [
    "propertyId",
    "contentHash",
    "ownedMediaAssetId",
    "detectedMime",
    "sizeBytes",
    "width",
    "height",
    "rejectionReason",
  ]) {
    for (const variant of ["omitted", "undefined"]) {
      const input = { ...nullableInput };
      if (variant === "omitted") delete input[field];
      else input[field] = undefined;
      const client = fakeClient();
      await assert.rejects(
        createSyncRepository({ client }).saveMediaRecord(input),
        /media/i,
        `${field} ${variant}`,
      );
      assert.equal(client.calls.length, 0, `${field} ${variant}`);
    }
  }
});

test("saveMediaRecord snapshots validated nullable fields across awaited SQL", async () => {
  const input = mediaRecordInput();
  const expected = structuredClone(input);
  const client = fakeClient((call) => {
    if (call.statement.includes("FROM media_assets")) {
      input.width = undefined;
      input.rejectionReason = undefined;
      return result([mediaRow()]);
    }
    if (call.statement.startsWith("INSERT INTO listing_media_records")) {
      return result([{ id: MEDIA_RECORD_ID }]);
    }
    if (call.statement.includes("FROM listing_media_records")) {
      return result([mediaRecordRow(expected)]);
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });

  await createSyncRepository({ client }).saveMediaRecord(input);
  const insert = client.calls.find((call) =>
    call.statement.startsWith("INSERT INTO listing_media_records"),
  );
  assert.equal(insert.params[7], expected.width);
  assert.equal(insert.params[10], expected.rejectionReason);
});

test("media methods reject malformed inputs and mismatched database rows", async () => {
  const client = fakeClient(() => result([mediaRow({ content_hash: "b".repeat(64) })]));
  const repository = createSyncRepository({ client });
  await assert.rejects(repository.findMediaByHash("A".repeat(64)), /hash/i);
  await assert.rejects(repository.findMediaByUrls(["https://user:secret@owned.example/a"]), /URL/i);
  await assert.rejects(repository.findMediaByHash("a".repeat(64)), /media row/i);
  await assert.rejects(
    repository.saveMediaRecord({
      observationId: OBSERVATION_ID,
      propertyId: null,
      sourceUrl: "https://images.28hse.test/photo.png",
      contentHash: null,
      ownedMediaAssetId: null,
      detectedMime: null,
      sizeBytes: null,
      width: null,
      height: null,
      eligibility: "eligible",
      rejectionReason: null,
    }),
    /eligible media/i,
  );
});

test("assertLockSession and every repository method use the injected dedicated client", async () => {
  const client = fakeClient(() => result([{ alive: 1 }]));
  await createSyncRepository({ client }).assertLockSession();
  assert.deepEqual(client.calls[0].params, []);
  assert.match(client.calls[0].statement, /^SELECT 1 AS alive/);

  const dead = fakeClient(() => result([{ alive: "1" }]));
  await assert.rejects(createSyncRepository({ client: dead }).assertLockSession(), /lock session/i);
});

test("getLatestRun returns one validated ledger row or null", async () => {
  const run = {
    id: RUN_ID,
    scheduled_for: "2026-08-17",
    started_at: "2026-08-17T00:00:00.000Z",
    finished_at: null,
    mode: "shadow",
    status: "running",
    parser_version: "dual-source-v1",
    source_status: {},
    counts: {},
    baselines: {},
    failure_code: null,
    failure_summary: null,
    baseline_approved_at: null,
    baseline_approved_by: null,
    baseline_approval_note: null,
    created_at: "2026-08-17T00:00:00.000Z",
  };
  const client = fakeClient(() => result([run]));
  assert.deepEqual(await createSyncRepository({ client }).getLatestRun(), run);
  assert.match(client.calls[0].statement, /ORDER BY started_at DESC, id DESC LIMIT 1/);

  const empty = fakeClient(() => result());
  assert.equal(await createSyncRepository({ client: empty }).getLatestRun(), null);
});

test("observation selects cannot satisfy one batch with rows requested by another", async () => {
  const observations = Array.from({ length: 201 }, (_, index) => validObservation(index + 1));
  const persisted = observations.map((observation, index) =>
    persistedRow(
      observation,
      `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    ),
  );
  let selectIndex = 0;
  const client = fakeClient((call) => {
    if (call.statement.startsWith("INSERT INTO listing_source_observations")) return result();
    if (call.statement.startsWith("SELECT id, source, external_listing_id")) {
      selectIndex += 1;
      return result(selectIndex === 1 ? [persisted[200]] : persisted.slice(0, 200));
    }
    throw new Error(`unexpected query: ${call.statement}`);
  });

  await assert.rejects(
    createSyncRepository({ client }).saveObservations(RUN_ID, observations),
    /persisted observation/i,
  );
});

test("count history ranks the latest rerun before filtering its health", async () => {
  const client = fakeClient(() => result());
  await createSyncRepository({ client }).getHealthyCountHistory(SOURCE_28HSE);

  const statement = client.calls[0].statement;
  const rankedCte = statement.slice(0, statement.indexOf(") SELECT scheduled_for"));
  assert.doesNotMatch(rankedCte, /source_status .* healthy/i);
  assert.match(statement, /date_rank = 1 AND health[^)]*healthy/i);
});

test("shadow reviewer identity is bounded and secret-redacted like its note", async () => {
  const client = fakeClient(() =>
    result([{ id: RUN_ID, baseline_approved_at: "2026-08-16T12:00:00.000Z" }]),
  );
  await createSyncRepository({ client }).approveShadowRun(RUN_ID, {
    reviewer: "postgres://operator:review-secret@db.example/app token=review-token",
    note: "approved",
  });

  assert.doesNotMatch(client.calls[0].params[1], /review-secret|review-token/);
  assert.match(client.calls[0].params[1], /redacted/i);
});

test("duplicate exact-URL database ownership evidence fails closed", async () => {
  const first = mediaRow();
  const duplicateUrls = fakeClient(() =>
    result([first, { ...first, id: "45454545-4545-4454-8454-454545454545" }]),
  );
  await assert.rejects(
    createSyncRepository({ client: duplicateUrls }).findMediaByUrls([first.url]),
    /duplicate media URL/i,
  );
});

test("media rows normalize safe PostgreSQL BIGINT text without losing precision", async () => {
  const client = fakeClient(() => result([mediaRow({ size_bytes: "123" })]));
  const asset = await createSyncRepository({ client }).findMediaByHash("a".repeat(64));
  assert.equal(asset.sizeBytes, 123);
  assert.equal(typeof asset.sizeBytes, "number");
});

test("pre-aborted media operations preserve the exact reason and issue no SQL", async () => {
  const client = fakeClient();
  const controller = new AbortController();
  const reason = new Error("repository cancelled exactly");
  controller.abort(reason);

  await assert.rejects(
    createSyncRepository({ client }).saveMediaRecord(
      {
        observationId: OBSERVATION_ID,
        propertyId: PROPERTY_ID,
        sourceUrl: "https://images.28hse.test/photo.png",
        contentHash: "a".repeat(64),
        ownedMediaAssetId: ASSET_ID,
        detectedMime: "image/png",
        sizeBytes: 123,
        width: 10,
        height: 8,
        eligibility: "eligible",
        rejectionReason: null,
      },
      { signal: controller.signal },
    ),
    (error) => error === reason,
  );
  assert.equal(client.calls.length, 0);
});

test("publish requires exact mode, enabled gate, a running healthy run, and seven approved dates", async () => {
  const disabled = fakePublicationClient();
  await assert.rejects(
    createSyncRepository({ client: disabled }).publishBatch({
      ...approvedBatch(),
      publishEnabled: false,
    }),
    /publication is not enabled/i,
  );
  assert.equal(disabled.calls.length, 0);

  const shadow = fakePublicationClient();
  await assert.rejects(
    createSyncRepository({ client: shadow }).publishBatch({ ...approvedBatch(), mode: "shadow" }),
    /publish mode/i,
  );
  assert.equal(shadow.calls.length, 0);

  const shortStreak = fakePublicationClient({ approvedShadowStreak: 6 });
  await assert.rejects(
    createSyncRepository({ client: shortStreak }).publishBatch(approvedBatch()),
    /seven approved healthy shadow runs/i,
  );
  assert.deepEqual(shortStreak.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);

  const unhealthy = fakePublicationClient({
    runOverrides: {
      source_status: healthySourceStatus({
        [SOURCE_28HSE]: { source: SOURCE_28HSE, healthy: false, reasons: ["parse_rate"] },
      }),
    },
  });
  await assert.rejects(
    createSyncRepository({ client: unhealthy }).publishBatch(approvedBatch()),
    /28Hse evaluation is not healthy/i,
  );
  assert.deepEqual(unhealthy.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);
});

test("canonical, link, field, lifecycle, media, and event writes share one transaction", async () => {
  const client = fakePublicationClient();
  const resultValue = await createSyncRepository({ client }).publishBatch(approvedBatch());

  assert.deepEqual(resultValue, { inserted: 0, updated: 1, events: 2 });
  assert.equal(client.events[0], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  assert.equal(client.events.at(-1), "COMMIT");
  for (const table of [
    "properties",
    "property_source_links",
    "property_sync_fields",
    "property_sync_state",
    "listing_media_records",
    "listing_change_events",
  ]) {
    assert.ok(
      client.sql.some((statement) => statement.includes(table)),
      table,
    );
  }
  assert.equal(
    client.sql.some((statement) => /(?:INSERT|UPDATE|DELETE).*media_assets/i.test(statement)),
    false,
  );
});

test("row-version conflicts roll back and expose a stable typed PublicationConflictError", async () => {
  const client = fakePublicationClient({ updatedAtConflict: true });
  await assert.rejects(createSyncRepository({ client }).publishBatch(approvedBatch()), (error) => {
    assert.equal(error.name, "PublicationConflictError");
    assert.equal(error.code, "MLS_PUBLICATION_CONFLICT");
    assert.equal(error.propertyId, PROPERTY_ID);
    return true;
  });
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(client.events.includes("COMMIT"), false);
  assert.equal(
    client.sql.some((statement) => /UPDATE properties SET/.test(statement)),
    false,
  );
});

test("publication preserves the primary write error when rollback also fails", async () => {
  const primary = new Error("primary persistence failure");
  const rollback = new Error("rollback transport failure");
  const client = fakePublicationClient({ writeError: primary, rollbackError: rollback });

  await assert.rejects(createSyncRepository({ client }).publishBatch(approvedBatch()), (error) => {
    assert.equal(error.name, "PublicationError");
    assert.equal(error.code, "MLS_PUBLICATION_FAILED");
    assert.equal(error.cause, primary);
    assert.deepEqual(error.cleanupErrors, [rollback]);
    return true;
  });
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(client.events.includes("COMMIT"), false);
});

test("unchanged canonical proposals neither touch updated_at nor emit caller-claimed changes", async () => {
  const client = fakePublicationClient({
    unchanged: true,
    existingLink: {
      property_id: PROPERTY_ID,
      match_key: "sale:EP-0001",
      status: "active",
      first_seen_at: "2026-08-16T00:01:00.000Z",
      last_seen_at: "2026-08-17T00:01:00.000Z",
      last_seen_run_id: RUN_ID,
    },
  });
  const batch = approvedBatch();
  batch.proposals[0].events = [];
  const outcome = await createSyncRepository({ client }).publishBatch(batch);

  assert.deepEqual(outcome, { inserted: 0, updated: 0, events: 0 });
  assert.equal(
    client.sql.some((statement) => /INSERT INTO listing_change_events/.test(statement)),
    false,
  );
  const update = client.sql.find((statement) => /UPDATE properties SET/.test(statement));
  assert.match(update, /IS DISTINCT FROM/);
  assert.match(update, /updated_at = now\(\)/);
});

test("publication sorts update locks by UUID and new inserts by listing number", async () => {
  const client = fakePublicationClient({ unchanged: true });
  const first = approvedBatch().proposals[0];
  first.events = first.events.filter((event) => event.changeType === "link_change");
  const second = structuredClone(first);
  second.propertyId = PROPERTY_ID_2;
  second.canonical.listing_no = "EP-0002";
  second.canonical.canonical_property_no = "EP-0002";
  second.links = [];
  second.fields = second.fields.map((field) => ({ ...field, winningObservationId: null }));
  second.canonical.images = [];
  second.fields.find((field) => field.fieldName === "images").lastPublishedValue = [];
  second.events = [];
  const batch = approvedBatch({ proposals: [second, first] });

  await createSyncRepository({ client }).publishBatch(batch);
  const lockIds = client.calls
    .filter(
      (call) => /updated_at_token/.test(call.statement) && /FROM properties/.test(call.statement),
    )
    .map((call) => call.params[0]);
  assert.deepEqual(lockIds, [PROPERTY_ID, PROPERTY_ID_2]);
});

test("the whole batch is snapshotted before the first awaited session check", async () => {
  let releaseSession;
  const sessionBarrier = new Promise((resolve) => {
    releaseSession = resolve;
  });
  const client = fakePublicationClient();
  const originalQuery = client.query.bind(client);
  client.query = async (statement, params = []) => {
    if (/^SELECT 1 AS alive/.test(compactSql(statement))) await sessionBarrier;
    return originalQuery(statement, params);
  };
  const batch = approvedBatch();
  const publishing = createSyncRepository({ client }).publishBatch(batch);
  batch.proposals[0].canonical.title_zh = "MUTATED AFTER CALL";
  batch.proposals[0].canonical.images.push("https://mutated.invalid/image.png");
  batch.proposals[0].fields[0].fieldName = "MUTATED_FIELD";
  releaseSession();

  await publishing;
  const serializedParams = JSON.stringify(client.calls.map((call) => call.params));
  assert.doesNotMatch(serializedParams, /MUTATED/);
  assert.doesNotMatch(serializedParams, /mutated\.invalid/);
});

test("locked canonical array evidence is snapshotted before later transaction awaits", async () => {
  const oldImages = ["https://owned.example/mls/old.png"];
  const current = canonicalWrite({ price: 7_900_000, images: oldImages });
  const batch = approvedBatch();
  batch.proposals[0].events.splice(1, 0, {
    changeType: "changed",
    fieldName: "images",
    oldValue: [...oldImages],
    newValue: structuredClone(batch.proposals[0].canonical.images),
    winningObservationId: OBSERVATION_ID,
    reason: "source_media_changed",
  });
  const client = fakePublicationClient({
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...current,
    },
    onQuery(call) {
      if (/WHERE run_id = \$1::uuid AND source = \$2/.test(call.statement)) {
        oldImages[0] = "https://mutated.invalid/after-lock.png";
      }
    },
  });

  assert.deepEqual(await createSyncRepository({ client }).publishBatch(batch), {
    inserted: 0,
    updated: 1,
    events: 3,
  });
  const eventParams = client.calls
    .filter((call) => /INSERT INTO listing_change_events/.test(call.statement))
    .map((call) => call.params);
  assert.doesNotMatch(JSON.stringify(eventParams), /mutated\.invalid/);
});

test("publication rejects accessor, duplicate, and extraneous nested evidence before SQL", async () => {
  let getterReads = 0;
  const accessorBatch = approvedBatch();
  Object.defineProperty(accessorBatch.proposals[0].canonical, "title_zh", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "forged";
    },
  });
  const accessorClient = fakePublicationClient();
  await assert.rejects(
    createSyncRepository({ client: accessorClient }).publishBatch(accessorBatch),
    /accessor/i,
  );
  assert.equal(getterReads, 0);
  assert.equal(accessorClient.calls.length, 0);

  const duplicateFields = approvedBatch();
  duplicateFields.proposals[0].fields[1].fieldName = "title_zh";
  const duplicateClient = fakePublicationClient();
  await assert.rejects(
    createSyncRepository({ client: duplicateClient }).publishBatch(duplicateFields),
    /field.*exactly once|duplicate.*field/i,
  );
  assert.equal(duplicateClient.calls.length, 0);

  const extra = approvedBatch();
  extra.proposals[0].links[0].untrusted = true;
  const extraClient = fakePublicationClient();
  await assert.rejects(
    createSyncRepository({ client: extraClient }).publishBatch(extra),
    /unexpected key/i,
  );
  assert.equal(extraClient.calls.length, 0);
});

test("degraded publication resets lifecycle and forbids inactivity events", async () => {
  const sourceStatus = healthySourceStatus({
    [SOURCE_OLD_SITE]: { source: SOURCE_OLD_SITE, healthy: false, reasons: ["fetch_failed"] },
  });
  const client = fakePublicationClient({ runOverrides: { source_status: sourceStatus } });
  const batch = approvedBatch({
    canonical: canonicalWrite({ status: "inactive" }),
    proposal: {
      lifecycle: {
        consecutiveAbsentHealthyRuns: 2,
        inactiveReason: "absent_two_healthy_runs",
        inactiveAt: "2026-08-17T04:00:00.000000Z",
      },
      events: [
        {
          changeType: "inactive",
          fieldName: "status",
          oldValue: "active",
          newValue: "inactive",
          winningObservationId: null,
          reason: "absent_two_healthy_runs",
        },
      ],
    },
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(batch),
    /degraded.*counter zero.*no inactivity event/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
});

test("media attachment is limited to the current-run images winner and rejects cross-property rows", async () => {
  const client = fakePublicationClient({ mediaPropertyId: PROPERTY_ID_2 });
  await assert.rejects(createSyncRepository({ client }).publishBatch(approvedBatch()), (error) => {
    assert.equal(error.name, "PublicationConflictError");
    assert.equal(error.code, "MLS_PUBLICATION_CONFLICT");
    return true;
  });
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(
    client.sql.some((statement) => /UPDATE listing_media_records/.test(statement)),
    false,
  );

  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const attachmentSource = source.slice(
    source.indexOf("async function attachImageMedia"),
    source.indexOf("function eventIsReal"),
  );
  assert.doesNotMatch(attachmentSource, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+media_assets\b/i);
});

test("approval evidence is strictly before the publish run and consecutive through the prior HK date", async () => {
  const equalApproval = fakePublicationClient({
    shadowRows: approvedShadowRows(7).map((row, index) =>
      index === 0 ? { ...row, baseline_approved_at: "2026-08-17T04:00:00.000000Z" } : row,
    ),
  });
  await assert.rejects(
    createSyncRepository({ client: equalApproval }).publishBatch(approvedBatch()),
    /approval.*strictly before/i,
  );

  const gapRows = approvedShadowRows(7);
  gapRows[3] = { ...gapRows[3], scheduled_for: "2026-08-12" };
  const gap = fakePublicationClient({ shadowRows: gapRows });
  await assert.rejects(
    createSyncRepository({ client: gap }).publishBatch(approvedBatch()),
    /seven approved healthy shadow runs/i,
  );
});

test("publication database rows require exact own result shapes", async () => {
  const client = fakePublicationClient({ runOverrides: { unexpected: "row drift" } });
  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch()),
    /unexpected key|publication run row/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
});

test("publication rejects explicit undefined nullable values before SQL", async () => {
  for (const mutate of [
    (batch) => {
      batch.proposals[0].canonical.title_en = undefined;
    },
    (batch) => {
      batch.proposals[0].canonical.estate_id = undefined;
    },
    (batch) => {
      batch.proposals[0].lifecycle.inactiveAt = undefined;
    },
    (batch) => {
      batch.proposals[0].events[0].winningObservationId = undefined;
    },
  ]) {
    const batch = approvedBatch();
    mutate(batch);
    const client = fakePublicationClient();
    await assert.rejects(
      createSyncRepository({ client }).publishBatch(batch),
      /null|nullable|timestamp|UUID|unsupported/i,
    );
    assert.equal(client.calls.length, 0);
  }
});

test("one current-run winning observation cannot publish two canonical properties", async () => {
  const client = fakePublicationClient({ unchanged: true });
  const first = approvedBatch().proposals[0];
  const second = structuredClone(first);
  second.propertyId = PROPERTY_ID_2;
  second.canonical.listing_no = "EP-0002";
  second.canonical.canonical_property_no = "EP-0002";
  second.links = [];
  second.canonical.images = [];
  second.fields.find((field) => field.fieldName === "images").lastPublishedValue = [];
  second.events = [];

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [first, second] })),
    /winning observation.*multiple|observation.*property/i,
  );
  assert.equal(client.calls.length, 0);
});

test("new image-bearing proposals require a current-run images winner", async () => {
  const proposal = structuredClone(approvedBatch().proposals[0]);
  proposal.kind = "new";
  delete proposal.propertyId;
  delete proposal.expectedUpdatedAt;
  proposal.fields.find((field) => field.fieldName === "images").winningObservationId = null;
  proposal.events = [
    {
      changeType: "new",
      fieldName: null,
      oldValue: null,
      newValue: { listing_no: proposal.canonical.listing_no },
      winningObservationId: OBSERVATION_ID,
      reason: "new_listing",
    },
  ];
  const client = fakePublicationClient();

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    /images.*winning observation|current-run.*images/i,
  );
  assert.equal(client.calls.length, 0);
});

test("a fulfilled malformed BEGIN result is rolled back before the session is reused", async () => {
  const malformed = { rows: "not-an-array", rowCount: null };
  const client = fakePublicationClient({ beginResult: malformed });

  await assert.rejects(createSyncRepository({ client }).publishBatch(approvedBatch()), (error) => {
    assert.equal(error.name, "PublicationError");
    assert.match(error.message, /malformed database result/i);
    assert.deepEqual(error.cleanupErrors, []);
    return true;
  });
  assert.deepEqual(client.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);
});

test("empty primary error messages cannot displace the primary or rollback error", async () => {
  const primary = new Error("");
  const rollback = new Error("rollback failed after empty primary");
  const client = fakePublicationClient({ writeError: primary, rollbackError: rollback });

  await assert.rejects(createSyncRepository({ client }).publishBatch(approvedBatch()), (error) => {
    assert.equal(error.name, "PublicationError");
    assert.equal(error.cause, primary);
    assert.deepEqual(error.cleanupErrors, [rollback]);
    return true;
  });
});

test("malformed or accessor-backed publication rows fail closed without reading getters", async () => {
  const malformedLink = {
    property_id: PROPERTY_ID,
    match_key: "sale:EP-0001",
    status: "mystery",
    first_seen_at: "2026-08-16T00:01:00.000Z",
    last_seen_at: "2026-08-17T00:01:00.000Z",
    last_seen_run_id: RUN_ID,
  };
  const linkClient = fakePublicationClient({ existingLink: malformedLink });
  await assert.rejects(
    createSyncRepository({ client: linkClient }).publishBatch(approvedBatch()),
    /source-link row.*invalid|source link.*invalid/i,
  );
  assert.equal(linkClient.events.at(-1), "ROLLBACK");

  let getterReads = 0;
  const runRow = publicationRunRow();
  Object.defineProperty(runRow, "status", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "running";
    },
  });
  const accessorClient = fakePublicationClient({ runRow });
  await assert.rejects(
    createSyncRepository({ client: accessorClient }).publishBatch(approvedBatch()),
    /accessor|data propert/i,
  );
  assert.equal(getterReads, 0);
  assert.equal(accessorClient.events.at(-1), "ROLLBACK");
});

test("change events must describe a field that actually changed from the locked canonical row", async () => {
  const current = canonicalWrite({ title_zh: "Old title", price: 8_000_001 });
  const client = fakePublicationClient({
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...current,
    },
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch()),
    /change event.*current|event.*real change|locked canonical|changed canonical field|event coverage/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(client.events.includes("COMMIT"), false);
});

test("a baseline-required source decision cannot count toward the approved publication streak", async () => {
  const shadowRows = approvedShadowRows(7);
  shadowRows[3] = {
    ...shadowRows[3],
    source_status: healthySourceStatus({
      [SOURCE_28HSE]: {
        source: SOURCE_28HSE,
        healthy: true,
        reasons: [],
        baselineRequired: true,
      },
    }),
  };
  const client = fakePublicationClient({ shadowRows });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch()),
    /seven approved healthy shadow runs|baseline/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
});

test("semantic duplicate events are rejected independent of object key insertion order", async () => {
  const batch = approvedBatch();
  const event = batch.proposals[0].events[0];
  batch.proposals[0].events.push({
    reason: event.reason,
    winningObservationId: event.winningObservationId,
    newValue: event.newValue,
    oldValue: event.oldValue,
    fieldName: event.fieldName,
    changeType: event.changeType,
  });
  const client = fakePublicationClient();

  await assert.rejects(createSyncRepository({ client }).publishBatch(batch), /duplicate event/i);
  assert.equal(client.calls.length, 0);
});

test("inactive and reactivated events must publish the exact canonical status", async () => {
  const batch = approvedBatch();
  batch.proposals[0].canonical.status = "inactive";
  batch.proposals[0].fields.find((field) => field.fieldName === "status").lastPublishedValue =
    "inactive";
  batch.proposals[0].lifecycle = {
    consecutiveAbsentHealthyRuns: 2,
    inactiveReason: "absent_two_healthy_runs",
    inactiveAt: "2026-08-17T04:00:00.000000Z",
  };
  batch.proposals[0].events = [
    {
      changeType: "inactive",
      fieldName: "status",
      oldValue: "active",
      newValue: "sold",
      winningObservationId: null,
      reason: "absent_two_healthy_runs",
    },
  ];
  const client = fakePublicationClient();

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(batch),
    /canonical status|inactive.*newValue/i,
  );
  assert.equal(client.calls.length, 0);
});

test("publication SQL selects and verifies current-run identity on every winning observation", async () => {
  const client = fakePublicationClient();
  await createSyncRepository({ client }).publishBatch(approvedBatch());

  const winnerSelect = client.sql.find(
    (statement) =>
      /FROM listing_source_observations/.test(statement) && /WHERE id = \$1::uuid/.test(statement),
  );
  assert.match(winnerSelect, /SELECT id, run_id, source/);
  assert.match(winnerSelect, /run_id = \$2::uuid/);
});

test("image-bearing publication fails closed when eligible owned media evidence is absent", async () => {
  const client = fakePublicationClient({ mediaRows: [] });
  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch()),
    /eligible owned current-run media records/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(client.events.includes("COMMIT"), false);
});

test("same-HK-date shadow approval is accepted only when it predates the publish run", async () => {
  const sameDayRows = approvedShadowRows(7).map((row) => {
    const date = new Date(`${row.scheduled_for}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    const scheduledFor = date.toISOString().slice(0, 10);
    return {
      ...row,
      scheduled_for: scheduledFor,
      started_at: `${scheduledFor}T01:00:00.000000Z`,
      baseline_approved_at: `${scheduledFor}T02:00:00.000000Z`,
    };
  });
  const client = fakePublicationClient({ shadowRows: sameDayRows });
  assert.deepEqual(await createSyncRepository({ client }).publishBatch(approvedBatch()), {
    inserted: 0,
    updated: 1,
    events: 2,
  });
});

test("pre-publication repository methods still never mutate canonical properties", async () => {
  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const beforePublication = source.split(/function exactPublicationRow\b/)[0];
  assert.doesNotMatch(beforePublication, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+properties\b/i);
  assert.doesNotMatch(source, /legacy_detail_id\s*=\s*EXCLUDED\.legacy_detail_id/i);
});

test("real pg and class-shaped QueryResult instances are accepted without relaxing row access", async () => {
  class DriverResult {
    constructor(rows) {
      this.rows = rows;
      this.rowCount = rows.length;
      this.command = "SELECT";
      this.fields = [];
      this.oid = null;
    }
  }

  for (const queryResult of [
    new DriverResult([{ alive: 1 }]),
    realPgResult("SELECT", [{ alive: 1 }]),
  ]) {
    const repository = createSyncRepository({
      client: { query: async () => queryResult },
    });
    await repository.assertLockSession();
  }
});

test("publication session and nested health rows reject accessors without invoking them", async () => {
  let sessionReads = 0;
  const sessionRow = {};
  Object.defineProperty(sessionRow, "alive", {
    enumerable: true,
    get() {
      sessionReads += 1;
      return 1;
    },
  });
  const sessionClient = fakePublicationClient({ sessionResult: result([sessionRow]) });
  await assert.rejects(
    createSyncRepository({ client: sessionClient }).publishBatch(approvedBatch()),
    /accessor|data propert/i,
  );
  assert.equal(sessionReads, 0);
  assert.equal(sessionClient.events.length, 0);

  let healthReads = 0;
  const nestedStatus = healthySourceStatus();
  Object.defineProperty(nestedStatus[SOURCE_28HSE], "healthy", {
    enumerable: true,
    get() {
      healthReads += 1;
      return true;
    },
  });
  const healthClient = fakePublicationClient({
    runOverrides: { source_status: nestedStatus },
  });
  await assert.rejects(
    createSyncRepository({ client: healthClient }).publishBatch(approvedBatch()),
    /accessor|data propert/i,
  );
  assert.equal(healthReads, 0);
  assert.equal(healthClient.events.length, 0);
});

test("publication validates command and rowCount and accepts a real pg BEGIN result", async () => {
  const realBegin = fakePublicationClient({
    beginResult: realPgResult("BEGIN", [], null),
  });
  await createSyncRepository({ client: realBegin }).publishBatch(approvedBatch());

  const wrongCommand = fakePublicationClient({
    beginResult: commandResult("SELECT"),
  });
  await assert.rejects(
    createSyncRepository({ client: wrongCommand }).publishBatch(approvedBatch()),
    /BEGIN|command|database result/i,
  );
  assert.deepEqual(wrongCommand.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);

  const inconsistentCount = fakePublicationClient({
    sessionResult: result([{ alive: 1 }], 0),
  });
  await assert.rejects(
    createSyncRepository({ client: inconsistentCount }).publishBatch(approvedBatch()),
    /rowCount|database result/i,
  );
  assert.equal(inconsistentCount.events.length, 0);
});

test("canonical images are resolved through the owned media asset URL, not the upstream source URL", () => {
  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const attachmentSource = source.slice(
    source.indexOf("async function attachImageMedia"),
    source.indexOf("function eventIsReal"),
  );
  assert.match(attachmentSource, /JOIN\s+media_assets/i);
  assert.match(attachmentSource, /owned_media_asset_id/i);
  assert.match(attachmentSource, /(?:media_assets|\bma\b)\.url\s*=\s*ANY/i);
  assert.doesNotMatch(attachmentSource, /source_url\s*=\s*ANY/i);
});

test("owned image records must originate from an exact candidate in the winning observation", async () => {
  const client = fakePublicationClient({
    mediaRows: [
      {
        id: MEDIA_RECORD_ID,
        observation_id: OBSERVATION_ID,
        property_id: null,
        source_url: "https://images.28hse.test/not-in-observation.png",
        eligibility: "eligible",
        owned_media_asset_id: ASSET_ID,
        record_content_hash: "a".repeat(64),
        owned_url: "https://owned.example/mls/hash.png",
        asset_content_hash: "a".repeat(64),
      },
    ],
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch()),
    /media.*candidate|upstream.*observation|winning observation.*media/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
  assert.equal(
    client.sql.some((statement) => /UPDATE listing_media_records/.test(statement)),
    false,
  );
});

test("active overrides publish the staff value while retaining an independent automated baseline", async () => {
  const canonical = canonicalWrite({ price: 12_000_000 });
  const batch = approvedBatch({ canonical });
  const price = batch.proposals[0].fields.find((field) => field.fieldName === "price");
  price.lastPublishedValue = 10_000_000;
  price.overrideValue = 12_000_000;
  price.activeOverride = true;
  price.winningObservationId = null;
  batch.proposals[0].events = batch.proposals[0].events.filter(
    (event) => event.changeType === "link_change",
  );
  const client = fakePublicationClient({
    unchanged: true,
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonical,
    },
    lockedFieldRows: [
      {
        property_id: PROPERTY_ID,
        field_name: "price",
        last_published_value: 10_000_000,
        override_value: 11_000_000,
        active_override: true,
        winning_observation_id: null,
      },
    ],
  });

  await createSyncRepository({ client }).publishBatch(batch);
});

test("candidate row versions preserve PostgreSQL microseconds and updates prove SQL timestamp equality", async () => {
  const parseTimestamptz = neonTypes.getTypeParser(1184, "text");
  const first = parseTimestamptz("2026-08-17 00:02:00.000001+00");
  const second = parseTimestamptz("2026-08-17 00:02:00.000999+00");
  assert.equal(first.toISOString(), second.toISOString());

  const lossless = "2026-08-17T00:02:00.000001Z";
  const candidateClient = fakeClient(() =>
    result([
      {
        id: PROPERTY_ID,
        listing_no: "EP-0001",
        canonical_property_no: "EP-0001",
        legacy_property_no: null,
        deal_type: "sale",
        updated_at: lossless,
      },
    ]),
  );
  const [candidate] = await createSyncRepository({
    client: candidateClient,
  }).findCanonicalCandidates(["sale:EP-0001"]);
  assert.equal(candidate.updated_at, lossless);
  assert.match(candidateClient.calls[0].statement, /to_char\s*\(\s*updated_at/i);
  assert.match(candidateClient.calls[0].statement, /\.US/);

  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const publication = source.slice(source.indexOf("async function writeCanonicalProperty"));
  assert.match(
    publication,
    /updated_at\s*=\s*\$\d+::timestamptz\s+AS\s+updated_at_matches_expected/i,
  );
  assert.match(publication, /AND\s+updated_at\s*=\s*\$\d+::timestamptz/i);
});

test("winning observations load normalized payload and content evidence and events use the field winner", async () => {
  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const winnerLoader = source.slice(
    source.indexOf("async function loadWinningObservations"),
    source.indexOf("const CANONICAL_PARAMS"),
  );
  assert.match(winnerLoader, /payload/);
  assert.match(winnerLoader, /content_hash/);
  assert.match(winnerLoader, /media_candidates/);

  const batch = approvedBatch();
  batch.proposals[0].events[0].winningObservationId = null;
  await assert.rejects(
    createSyncRepository({ client: fakePublicationClient() }).publishBatch(batch),
    /event.*winner|field.*winner|provenance/i,
  );
});

test("new proposals with no links, winners, or owned primary image fail before session SQL", async () => {
  const proposal = structuredClone(approvedBatch().proposals[0]);
  proposal.kind = "new";
  delete proposal.propertyId;
  delete proposal.expectedUpdatedAt;
  proposal.canonical.images = [];
  proposal.links = [];
  proposal.fields = proposal.fields.map((field) => ({
    ...field,
    lastPublishedValue: structuredClone(proposal.canonical[field.fieldName]),
    winningObservationId: null,
  }));
  proposal.events = [
    {
      changeType: "new",
      fieldName: null,
      oldValue: null,
      newValue: structuredClone(proposal.canonical),
      winningObservationId: null,
      reason: "new_listing",
    },
  ];
  const client = fakePublicationClient();

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    /new.*(?:link|winner|image)|owned primary image/i,
  );
  assert.equal(client.calls.length, 0);
});

test("canonical property number plus deal type is deduplicated before SQL", async () => {
  const first = structuredClone(approvedBatch().proposals[0]);
  first.links = [];
  first.canonical.images = [];
  first.fields = first.fields.map((field) => ({
    ...field,
    lastPublishedValue: structuredClone(first.canonical[field.fieldName]),
    winningObservationId: null,
  }));
  first.events = [];
  const second = structuredClone(first);
  second.propertyId = PROPERTY_ID_2;
  second.canonical.listing_no = "EP-0002";
  const client = fakePublicationClient();

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [first, second] })),
    /duplicate canonical identity|property number.*deal type/i,
  );
  assert.equal(client.calls.length, 0);
});

test("new identities are transaction-serialized and updates cannot mutate locked identity", async () => {
  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const canonicalWriter = source.slice(
    source.indexOf("async function assertNewIdentityAvailable"),
    source.indexOf("async function writeSourceLinks"),
  );
  assert.match(canonicalWriter, /pg_advisory_xact_lock/i);
  assert.match(canonicalWriter, /canonical_property_no\s*=\s*\$\d+/i);
  assert.match(canonicalWriter, /deal_type\s*=\s*\$\d+::deal_type/i);

  const proposal = structuredClone(approvedBatch().proposals[0]);
  proposal.canonical.canonical_property_no = "EP-CHANGED";
  proposal.links = [];
  proposal.canonical.images = [];
  proposal.fields = proposal.fields.map((field) => ({
    ...field,
    lastPublishedValue: structuredClone(proposal.canonical[field.fieldName]),
    winningObservationId: null,
  }));
  proposal.events = [];
  await assert.rejects(
    createSyncRepository({ client: fakePublicationClient() }).publishBatch(
      approvedBatch({ proposals: [proposal] }),
    ),
    (error) => error?.name === "PublicationConflictError",
  );
});

test("a new proposal locks both identities and publishes one exact new plus link event", async () => {
  const proposal = structuredClone(approvedBatch().proposals[0]);
  proposal.kind = "new";
  delete proposal.propertyId;
  delete proposal.expectedUpdatedAt;
  proposal.events = [
    {
      changeType: "new",
      fieldName: null,
      oldValue: null,
      newValue: structuredClone(proposal.canonical),
      winningObservationId: OBSERVATION_ID,
      reason: "new_listing",
    },
    proposal.events.find((event) => event.changeType === "link_change"),
  ];
  const client = fakePublicationClient();

  assert.deepEqual(
    await createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    { inserted: 1, updated: 0, events: 2 },
  );
  assert.equal(client.sql.filter((statement) => /pg_advisory_xact_lock/.test(statement)).length, 2);
  assert.equal(
    client.sql.some(
      (statement) => /FROM properties/.test(statement) && /canonical_property_no/.test(statement),
    ),
    true,
  );
  assert.equal(
    client.sql.some((statement) => /UPDATE properties SET/.test(statement)),
    false,
  );
});

test("every changed field and real link delta requires one exact semantic event", async () => {
  const canonical = canonicalWrite({ title_zh: "全新標題" });
  const missingField = approvedBatch({ canonical });
  missingField.proposals[0].fields.find(
    (field) => field.fieldName === "title_zh",
  ).lastPublishedValue = canonical.title_zh;
  await assert.rejects(
    createSyncRepository({
      client: fakePublicationClient({ observationCanonical: canonical }),
    }).publishBatch(missingField),
    /every changed field|missing.*event|event coverage/i,
  );

  const missingLink = approvedBatch();
  missingLink.proposals[0].events = missingLink.proposals[0].events.filter(
    (event) => event.changeType !== "link_change",
  );
  await assert.rejects(
    createSyncRepository({ client: fakePublicationClient() }).publishBatch(missingLink),
    /link.*event|event coverage/i,
  );
});

test("status transitions cannot hide as changed and lifecycle evidence is bound to inactive state", async () => {
  const current = canonicalWrite({ status: "active" });
  const canonical = canonicalWrite({ status: "inactive" });
  const generic = approvedBatch({
    canonical,
    proposal: {
      lifecycle: {
        consecutiveAbsentHealthyRuns: 2,
        inactiveReason: "absent_two_healthy_runs",
        inactiveAt: "2026-08-17T04:00:00.000000Z",
      },
      events: [
        {
          changeType: "changed",
          fieldName: "status",
          oldValue: "active",
          newValue: "inactive",
          winningObservationId: null,
          reason: "absent_two_healthy_runs",
        },
      ],
    },
  });
  const statusField = generic.proposals[0].fields.find((field) => field.fieldName === "status");
  statusField.lastPublishedValue = "inactive";
  statusField.winningObservationId = null;
  await assert.rejects(
    createSyncRepository({
      client: fakePublicationClient({
        lockedRow: { id: PROPERTY_ID, updated_at: EXPECTED_UPDATED_AT, ...current },
      }),
    }).publishBatch(generic),
    /inactive event|status transition/i,
  );

  const wrongCounter = structuredClone(generic);
  wrongCounter.proposals[0].events[0].changeType = "inactive";
  wrongCounter.proposals[0].lifecycle.consecutiveAbsentHealthyRuns = 1;
  await assert.rejects(
    createSyncRepository({
      client: fakePublicationClient({
        lockedRow: { id: PROPERTY_ID, updated_at: EXPECTED_UPDATED_AT, ...current },
      }),
    }).publishBatch(wrongCounter),
    /two healthy|counter|lifecycle/i,
  );
});

test("inactive lifecycle effective time must equal the locked publish-run start", async () => {
  const current = canonicalWrite({ status: "active" });
  const canonical = canonicalWrite({ status: "inactive" });
  const proposal = approvedBatch({ canonical }).proposals[0];
  proposal.links = [];
  proposal.fields = proposal.fields.map((field) => ({ ...field, winningObservationId: null }));
  proposal.lifecycle = {
    consecutiveAbsentHealthyRuns: 2,
    inactiveReason: "absent_two_healthy_runs",
    inactiveAt: "2026-08-18T04:00:00.000000Z",
  };
  proposal.events = [
    {
      changeType: "inactive",
      fieldName: "status",
      oldValue: "active",
      newValue: "inactive",
      winningObservationId: null,
      reason: "absent_two_healthy_runs",
    },
  ];
  const client = fakePublicationClient({
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...current,
    },
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    /inactive.*time|effective.*run|run.*start/i,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
});

test("a new event contains the exact inserted canonical row", async () => {
  const proposal = structuredClone(approvedBatch().proposals[0]);
  proposal.kind = "new";
  delete proposal.propertyId;
  delete proposal.expectedUpdatedAt;
  proposal.events = [
    {
      changeType: "new",
      fieldName: null,
      oldValue: null,
      newValue: { listing_no: proposal.canonical.listing_no },
      winningObservationId: OBSERVATION_ID,
      reason: "new_listing",
    },
  ];
  await assert.rejects(
    createSyncRepository({ client: fakePublicationClient() }).publishBatch(
      approvedBatch({ proposals: [proposal] }),
    ),
    /new event.*exact|exact.*canonical/i,
  );
});

test("COMMIT ambiguity is typed and never followed by an illegal rollback", async () => {
  const commitFailure = new Error("connection ended while awaiting COMMIT");
  const client = fakePublicationClient({ commitError: commitFailure });
  await assert.rejects(createSyncRepository({ client }).publishBatch(approvedBatch()), (error) => {
    assert.equal(error.name, "PublicationOutcomeUnknownError");
    assert.equal(error.code, "MLS_PUBLICATION_OUTCOME_UNKNOWN");
    assert.equal(error.cause, commitFailure);
    return true;
  });
  assert.deepEqual(client.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT"]);

  const malformedCommit = fakePublicationClient({
    commitResult: commandResult("UPDATE"),
  });
  await assert.rejects(
    createSyncRepository({ client: malformedCommit }).publishBatch(approvedBatch()),
    (error) => error?.name === "PublicationOutcomeUnknownError",
  );
  assert.deepEqual(malformedCommit.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT"]);
});

test("publication cancellation preserves the exact abort reason and rolls back only an open transaction", async () => {
  const preController = new AbortController();
  const preReason = Object.freeze({ code: "pre-abort" });
  preController.abort(preReason);
  const preClient = fakePublicationClient();
  await assert.rejects(
    createSyncRepository({ client: preClient }).publishBatch({
      ...approvedBatch(),
      signal: preController.signal,
    }),
    (error) => error === preReason,
  );
  assert.equal(preClient.calls.length, 0);

  const midController = new AbortController();
  const midReason = Object.freeze({ code: "mid-transaction-abort" });
  const midClient = fakePublicationClient({
    onQuery(call) {
      if (/FROM listing_sync_runs/.test(call.statement) && /FOR UPDATE/.test(call.statement)) {
        midController.abort(midReason);
      }
    },
  });
  await assert.rejects(
    createSyncRepository({ client: midClient }).publishBatch({
      ...approvedBatch(),
      signal: midController.signal,
    }),
    (error) => error === midReason,
  );
  assert.deepEqual(midClient.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);
});

test("an abort observed after a publication query beats a malformed local result", async () => {
  const controller = new AbortController();
  const reason = Object.freeze({ code: "abort-after-query" });
  const client = fakePublicationClient({
    sessionResult: commandResult("UPDATE"),
    onQuery(call) {
      if (/^SELECT 1 AS alive/.test(call.statement)) controller.abort(reason);
    },
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch({
      ...approvedBatch(),
      signal: controller.signal,
    }),
    (error) => error === reason,
  );
  assert.equal(client.events.length, 0);
});

test("publication snapshots reject every non-index, hidden, symbol, or accessor array key before SQL", async () => {
  const cases = [
    (array) => Object.defineProperty(array, "hidden", { value: true }),
    (array) => Object.defineProperty(array, "visible", { enumerable: true, value: true }),
    (array) => Object.defineProperty(array, Symbol("evidence"), { value: true }),
    (array, reads) =>
      Object.defineProperty(array, "accessor", {
        get() {
          reads.count += 1;
          return true;
        },
      }),
  ];
  for (const mutate of cases) {
    const batch = approvedBatch();
    const reads = { count: 0 };
    mutate(batch.proposals, reads);
    const client = fakePublicationClient();
    await assert.rejects(
      createSyncRepository({ client }).publishBatch(batch),
      /array|hidden|symbol|accessor|unexpected/i,
    );
    assert.equal(reads.count, 0);
    assert.equal(client.calls.length, 0);
  }
});

function newPublicationProposal() {
  const proposal = structuredClone(approvedBatch().proposals[0]);
  proposal.kind = "new";
  delete proposal.propertyId;
  delete proposal.expectedUpdatedAt;
  proposal.events = [
    {
      changeType: "new",
      fieldName: null,
      oldValue: null,
      newValue: structuredClone(proposal.canonical),
      winningObservationId: OBSERVATION_ID,
      reason: "new_listing",
    },
    proposal.events.find((event) => event.changeType === "link_change"),
  ];
  return proposal;
}

function activeOverrideBatch({ canonicalPrice = 12_000_000, baseline = 10_000_000 } = {}) {
  const canonical = canonicalWrite({ price: canonicalPrice });
  const batch = approvedBatch({ canonical });
  const price = batch.proposals[0].fields.find((field) => field.fieldName === "price");
  price.lastPublishedValue = baseline;
  price.overrideValue = canonicalPrice;
  price.activeOverride = true;
  price.winningObservationId = null;
  batch.proposals[0].events = batch.proposals[0].events.filter(
    (event) => event.changeType === "link_change",
  );
  return batch;
}

test("baselineRequired is an exact boolean and either current source can block publication", async () => {
  const malformed = evaluation();
  malformed.sourceStatus[SOURCE_28HSE].baselineRequired = "true";
  const evaluationClient = fakeClient();
  await assert.rejects(
    createSyncRepository({ client: evaluationClient }).recordRunEvaluation(RUN_ID, malformed),
    /baselineRequired|sourceStatus/i,
  );
  assert.equal(evaluationClient.calls.length, 0);

  const oldSiteBaselinePending = healthySourceStatus({
    [SOURCE_OLD_SITE]: {
      source: SOURCE_OLD_SITE,
      healthy: true,
      reasons: [],
      baselineRequired: true,
    },
  });
  const publicationClient = fakePublicationClient({
    runOverrides: { source_status: oldSiteBaselinePending },
    preflightSourceStatus: oldSiteBaselinePending,
  });
  await assert.rejects(
    createSyncRepository({ client: publicationClient }).publishBatch(approvedBatch()),
    /baseline.*required|publication.*baseline/i,
  );
  assert.equal(publicationClient.events.includes("BEGIN ISOLATION LEVEL SERIALIZABLE"), false);
  assert.equal(publicationClient.events.includes("COMMIT"), false);
});

test("the transaction rechecks a baseline requirement that appears after preflight", async () => {
  const baselinePending = healthySourceStatus({
    [SOURCE_OLD_SITE]: {
      source: SOURCE_OLD_SITE,
      healthy: true,
      reasons: [],
      baselineRequired: true,
    },
  });
  const client = fakePublicationClient({
    preflightSourceStatus: healthySourceStatus(),
    runOverrides: { source_status: baselinePending },
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch()),
    /baseline.*required/i,
  );
  assert.deepEqual(client.events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);
});

test("new proposals reject active staff overrides before any session SQL", async () => {
  const proposal = newPublicationProposal();
  const price = proposal.fields.find((field) => field.fieldName === "price");
  price.lastPublishedValue = 10_000_000;
  price.overrideValue = proposal.canonical.price;
  price.activeOverride = true;
  price.winningObservationId = null;
  const client = fakePublicationClient();

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    /new.*active override|active override.*new/i,
  );
  assert.equal(client.calls.length, 0);
});

test("active overrides cannot overwrite a different locked staff canonical value", async () => {
  const batch = activeOverrideBatch();
  batch.proposals[0].events.unshift({
    changeType: "changed",
    fieldName: "price",
    oldValue: 11_000_000,
    newValue: 12_000_000,
    winningObservationId: null,
    reason: "forged_override",
  });
  const client = fakePublicationClient({
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonicalWrite({ price: 11_000_000 }),
    },
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(batch),
    /active override|staff value|publication conflict/i,
  );
  assert.equal(
    client.sql.some((statement) => /UPDATE properties SET/.test(statement)),
    false,
  );
  assert.equal(client.events.at(-1), "ROLLBACK");
});

test("active overrides lock field history and preserve the automated baseline", async () => {
  const batch = activeOverrideBatch();
  const client = fakePublicationClient({
    unchanged: true,
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonicalWrite({ price: 12_000_000 }),
    },
    lockedFieldRows: [
      {
        property_id: PROPERTY_ID,
        field_name: "price",
        last_published_value: 10_000_000,
        override_value: 11_000_000,
        active_override: true,
        winning_observation_id: null,
      },
    ],
  });

  assert.deepEqual(await createSyncRepository({ client }).publishBatch(batch), {
    inserted: 0,
    updated: 0,
    events: 1,
  });
  const lock = client.sql.find(
    (statement) => /FROM property_sync_fields/.test(statement) && /FOR UPDATE/.test(statement),
  );
  assert.match(lock, /field_name\s*=\s*ANY/i);
});

test("active override history accepts real pg-decoded JSON string scalars", async () => {
  const canonical = canonicalWrite({ title_zh: "Staff title" });
  const batch = approvedBatch({ canonical });
  const title = batch.proposals[0].fields.find((field) => field.fieldName === "title_zh");
  title.lastPublishedValue = "Automated title";
  title.overrideValue = "Staff title";
  title.activeOverride = true;
  title.winningObservationId = null;
  batch.proposals[0].events = batch.proposals[0].events.filter(
    (event) => event.changeType === "link_change",
  );
  const client = fakePublicationClient({
    unchanged: true,
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonical,
    },
    lockedFieldRows: [
      {
        property_id: PROPERTY_ID,
        field_name: "title_zh",
        last_published_value: "Automated title",
        override_value: "Previous staff title",
        active_override: true,
        winning_observation_id: null,
      },
    ],
  });

  assert.deepEqual(await createSyncRepository({ client }).publishBatch(batch), {
    inserted: 0,
    updated: 0,
    events: 1,
  });
});

test("caller-forged active override history is rejected before field or canonical writes", async () => {
  const batch = activeOverrideBatch();
  const client = fakePublicationClient({
    unchanged: true,
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonicalWrite({ price: 12_000_000 }),
    },
    lockedFieldRows: [
      {
        property_id: PROPERTY_ID,
        field_name: "price",
        last_published_value: 9_000_000,
        override_value: 11_000_000,
        active_override: true,
        winning_observation_id: null,
      },
    ],
  });

  await assert.rejects(
    createSyncRepository({ client }).publishBatch(batch),
    /override.*baseline|field history|publication conflict/i,
  );
  assert.equal(
    client.sql.some((statement) => /UPDATE properties SET/.test(statement)),
    false,
  );
  assert.equal(
    client.sql.some((statement) => /INSERT INTO property_sync_fields/.test(statement)),
    false,
  );
});

test("inactive lifecycle uses lossless run time only on the active-to-inactive transition", async () => {
  const current = canonicalWrite({ status: "active" });
  const canonical = canonicalWrite({ status: "inactive" });
  const proposal = approvedBatch({ canonical }).proposals[0];
  proposal.fields.find((field) => field.fieldName === "status").winningObservationId = null;
  proposal.lifecycle = {
    consecutiveAbsentHealthyRuns: 2,
    inactiveReason: "absent_two_healthy_runs",
    inactiveAt: "2026-08-17T04:00:00.123456Z",
  };
  proposal.events = [
    {
      changeType: "inactive",
      fieldName: "status",
      oldValue: "active",
      newValue: "inactive",
      winningObservationId: null,
      reason: "absent_two_healthy_runs",
    },
    approvedBatch().proposals[0].events.find((event) => event.changeType === "link_change"),
  ];
  const client = fakePublicationClient({
    runOverrides: { started_at: "2026-08-17T04:00:00.123456Z" },
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...current,
    },
    lockedLifecycleRows: [
      {
        property_id: PROPERTY_ID,
        consecutive_absent_healthy_runs: 1,
        last_evaluated_run_id: RUN_ID_2,
        inactive_reason: null,
        inactive_at_token: null,
      },
    ],
    observationCanonical: canonical,
  });

  assert.deepEqual(
    await createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    { inserted: 0, updated: 1, events: 2 },
  );
  assert.match(
    client.sql.find(
      (statement) => /FROM listing_sync_runs/.test(statement) && /FOR UPDATE/.test(statement),
    ),
    /to_char\s*\(\s*started_at[\s\S]*\.US/i,
  );
});

test("already-inactive history is locked and preserved without a repeated inactive event", async () => {
  const historicalInactiveAt = "2026-08-10T04:00:00.654321Z";
  const canonical = canonicalWrite({ status: "inactive" });
  const proposal = approvedBatch({ canonical }).proposals[0];
  proposal.fields.find((field) => field.fieldName === "status").winningObservationId = null;
  proposal.lifecycle = {
    consecutiveAbsentHealthyRuns: 2,
    inactiveReason: "absent_two_healthy_runs",
    inactiveAt: historicalInactiveAt,
  };
  proposal.events = proposal.events.filter((event) => event.changeType === "link_change");
  const client = fakePublicationClient({
    unchanged: true,
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonical,
    },
    lockedLifecycleRows: [
      {
        property_id: PROPERTY_ID,
        consecutive_absent_healthy_runs: 2,
        last_evaluated_run_id: RUN_ID_2,
        inactive_reason: "absent_two_healthy_runs",
        inactive_at_token: historicalInactiveAt,
      },
    ],
    observationCanonical: canonical,
  });

  assert.deepEqual(
    await createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    { inserted: 0, updated: 0, events: 1 },
  );
  assert.ok(
    client.sql.some(
      (statement) => /FROM property_sync_state/.test(statement) && /FOR UPDATE/.test(statement),
    ),
  );
  const eventCalls = client.calls.filter((call) =>
    /INSERT INTO listing_change_events/.test(call.statement),
  );
  assert.equal(
    eventCalls.some((call) => call.params[2] === "inactive"),
    false,
  );
});

test("reactivation locks prior inactive lifecycle history and clears it once", async () => {
  const canonical = canonicalWrite({ status: "active" });
  const proposal = approvedBatch({ canonical }).proposals[0];
  proposal.fields.find((field) => field.fieldName === "status").winningObservationId = null;
  proposal.events = [
    {
      changeType: "reactivated",
      fieldName: "status",
      oldValue: "inactive",
      newValue: "active",
      winningObservationId: null,
      reason: "seen_again",
    },
    approvedBatch().proposals[0].events.find((event) => event.changeType === "link_change"),
  ];
  const client = fakePublicationClient({
    lockedRow: {
      id: PROPERTY_ID,
      updated_at_token: EXPECTED_UPDATED_AT,
      updated_at_matches_expected: true,
      ...canonicalWrite({ status: "inactive" }),
    },
    lockedLifecycleRows: [
      {
        property_id: PROPERTY_ID,
        consecutive_absent_healthy_runs: 2,
        last_evaluated_run_id: RUN_ID_2,
        inactive_reason: "absent_two_healthy_runs",
        inactive_at_token: "2026-08-10T04:00:00.654321Z",
      },
    ],
  });

  assert.deepEqual(
    await createSyncRepository({ client }).publishBatch(approvedBatch({ proposals: [proposal] })),
    { inserted: 0, updated: 1, events: 2 },
  );
  assert.ok(client.sql.some((statement) => /FROM property_sync_state/.test(statement)));
});

test("new identities take a table writer lock and translate database identity races", async () => {
  const successClient = fakePublicationClient({
    tableLockResult: realPgResult("LOCK", [], null),
  });
  await createSyncRepository({ client: successClient }).publishBatch(
    approvedBatch({ proposals: [newPublicationProposal()] }),
  );
  const tableLockIndex = successClient.sql.findIndex(
    (statement) => statement === "LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE",
  );
  const identityReadIndex = successClient.sql.findIndex((statement) =>
    /FROM properties WHERE \(canonical_property_no/.test(statement),
  );
  assert.ok(tableLockIndex >= 0 && tableLockIndex < identityReadIndex);

  const malformedLock = fakePublicationClient({ tableLockResult: commandResult("SELECT") });
  await assert.rejects(
    createSyncRepository({ client: malformedLock }).publishBatch(
      approvedBatch({ proposals: [newPublicationProposal()] }),
    ),
    /LOCK|command|database result/i,
  );
  assert.equal(
    malformedLock.sql.some((statement) => /INSERT INTO properties/.test(statement)),
    false,
  );
  assert.equal(malformedLock.events.at(-1), "ROLLBACK");

  for (const code of ["23505", "23P01"]) {
    const race = Object.assign(new Error("concurrent identity writer"), { code });
    const client = fakePublicationClient({ insertError: race });
    await assert.rejects(
      createSyncRepository({ client }).publishBatch(
        approvedBatch({ proposals: [newPublicationProposal()] }),
      ),
      (error) => {
        assert.equal(error.name, "PublicationConflictError");
        assert.equal(error.code, "MLS_PUBLICATION_CONFLICT");
        assert.equal(error.cause, race);
        return true;
      },
    );
    assert.equal(client.events.at(-1), "ROLLBACK");
  }
});

test("an older source sighting cannot touch link updated_at only because its run UUID differs", () => {
  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  const linkWriter = source.slice(
    source.indexOf("async function writeSourceLinks"),
    source.indexOf("async function writeFieldStates"),
  );
  assert.match(
    linkWriter,
    /OR\s*\(\s*EXCLUDED\.last_seen_at\s*>=\s*property_source_links\.last_seen_at\s+AND\s+property_source_links\.last_seen_run_id\s+IS\s+DISTINCT\s+FROM\s+EXCLUDED\.last_seen_run_id\s*\)/i,
  );
});

test("a lossless shadow approval one microsecond before the publish run is accepted", async () => {
  const rows = approvedShadowRows(7).map((row) => {
    const date = new Date(`${row.scheduled_for}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    const scheduledFor = date.toISOString().slice(0, 10);
    return {
      ...row,
      scheduled_for: scheduledFor,
      started_at: `${scheduledFor}T01:00:00.000000Z`,
      baseline_approved_at: `${scheduledFor}T02:00:00.000000Z`,
    };
  });
  rows[0] = {
    ...rows[0],
    baseline_approved_at: "2026-08-17T04:00:00.000000Z",
  };
  const client = fakePublicationClient({
    runOverrides: { started_at: "2026-08-17T04:00:00.000001Z" },
    shadowRows: rows,
  });

  assert.deepEqual(await createSyncRepository({ client }).publishBatch(approvedBatch()), {
    inserted: 0,
    updated: 1,
    events: 2,
  });
});

test("Task 9 declarations expose cancellation and unknown publication outcomes", () => {
  const declaration = readFileSync(new URL("./sync-repository.d.mts", import.meta.url), "utf8");
  assert.match(declaration, /class PublicationOutcomeUnknownError/);
  assert.match(declaration, /MLS_PUBLICATION_OUTCOME_UNKNOWN/);
  assert.match(declaration, /interface PublicationBatchInput[\s\S]*signal\?:\s*AbortSignal/);
});

test("declarations preserve strict Task 6, 7, 9, and 10 handoffs", () => {
  const declaration = readFileSync(new URL("./sync-repository.d.mts", import.meta.url), "utf8");
  for (const marker of [
    /interface PersistedObservationRef/,
    /id:\s*string/,
    /source:\s*MlsSource/,
    /externalId:\s*string/,
    /dealType:\s*DealType/,
    /propertyNoNormalized:\s*string/,
    /matchKey:\s*string/,
    /contentHash:\s*string/,
    /saveObservations\([^)]*SourceObservation\[\],?\s*\):\s*Promise<PersistedObservationRef\[\]>/s,
    /loadFieldStates\([^)]*\):\s*Promise<PropertySyncField\[\]>/s,
    /loadLifecycleStates\([^)]*\):\s*Promise<PropertySyncState\[\]>/s,
    /findMediaByHash/,
    /interface OwnedMediaRegistration/,
    /outcome:\s*"inserted"\s*\|\s*"existing"/,
    /asset:\s*MediaAsset/,
    /registerOwnedMedia/,
    /registerOwnedMedia\([^)]*\):\s*Promise<OwnedMediaRegistration>/s,
    /saveMediaRecord/,
    /interface RepositoryOperation/,
    /signal\?:\s*AbortSignal/,
    /getApprovedHealthyShadowStreak/,
    /class PublicationConflictError/,
    /publishBatch\([^)]*PublicationBatchInput[^)]*\):\s*Promise<PublicationBatchResult>/s,
    /interface CanonicalPropertyWrite/,
    /interface ReconciledFieldWrite/,
    /interface PropertySyncStateWrite/,
    /interface ListingChangeEventWrite/,
  ]) {
    assert.match(declaration, marker);
  }
});
