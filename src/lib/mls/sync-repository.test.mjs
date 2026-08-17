import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { types as neonTypes } from "@neondatabase/serverless";

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

function result(rows = [], rowCount = rows.length) {
  return { rows, rowCount, command: "SELECT", fields: [], oid: 0 };
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

test("repository requires one dedicated query client and exposes the Task 8 surface", () => {
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
        updated_at: "2026-08-17T00:00:00.000Z",
      },
      {
        id: PROPERTY_ID_2,
        listing_no: "RENT-ONE",
        canonical_property_no: null,
        legacy_property_no: " ep-0002 ",
        deal_type: "rent",
        updated_at: "2026-08-17T00:00:01.000Z",
      },
      {
        id: "24242424-2424-4242-8242-242424242424",
        listing_no: "OTHER",
        canonical_property_no: "EP-9999",
        legacy_property_no: null,
        deal_type: "sale",
        updated_at: "2026-08-17T00:00:02.000Z",
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
      updated_at: "2026-08-17T00:00:01.000Z",
    },
    {
      id: PROPERTY_ID,
      listing_no: "SALE-ONE",
      canonical_property_no: "EP-0001",
      legacy_property_no: "EP-LEGACY",
      deal_type: "sale",
      updated_at: "2026-08-17T00:00:00.000Z",
    },
  ]);
  const statement = client.calls[0].statement;
  assert.match(
    statement,
    /^SELECT id, listing_no, canonical_property_no, legacy_property_no, deal_type, updated_at FROM properties/,
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
    updated_at: "2026-08-17T00:00:00.000Z",
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

test("Neon driver timestamp objects become canonical repository strings", async () => {
  const timestamp = new Date("2026-08-17T00:00:00.000Z");
  const candidateClient = fakeClient(() =>
    result([
      {
        id: PROPERTY_ID,
        listing_no: "SALE-ONE",
        canonical_property_no: "EP-0001",
        legacy_property_no: null,
        deal_type: "sale",
        updated_at: timestamp,
      },
    ]),
  );
  const [candidate] = await createSyncRepository({
    client: candidateClient,
  }).findCanonicalCandidates(["sale:EP-0001"]);
  assert.equal(candidate.updated_at, timestamp.toISOString());

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

test("Task 8 SQL never mutates canonical properties", async () => {
  const source = readFileSync(new URL("./sync-repository.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+properties\b/i);
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
  ]) {
    assert.match(declaration, marker);
  }
});
