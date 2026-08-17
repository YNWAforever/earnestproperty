import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createSyncRepository } from "./sync-repository.mjs";
import { SOURCE_28HSE, SOURCE_OLD_SITE, createObservation } from "./source-contract.mjs";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID_2 = "12121212-1212-4121-8121-121212121212";
const PROPERTY_ID = "22222222-2222-4222-8222-222222222222";
const PROPERTY_ID_2 = "23232323-2323-4232-8232-232323232323";
const OBSERVATION_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";

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

function persistedRow(observation, id = OBSERVATION_ID) {
  return {
    id,
    source: observation.source,
    external_listing_id: observation.externalId,
    deal_type: observation.dealType,
    property_no_normalized: observation.propertyNoNormalized,
    content_hash: observation.contentHash,
  };
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
      const batchSize = (call.params.length - 1) / 3;
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
  assert.ok(selects.every((call) => call.params.length <= 1 + 200 * 3));
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
  const client = fakeClient(() => result([{ id: RUN_ID }]));
  await createSyncRepository({ client }).approveShadowRun(RUN_ID, {
    reviewer: "  operator@example.com  ",
    note: " token=approval-secret reviewed ",
  });

  const call = client.calls[0];
  assert.match(call.statement, /mode = 'shadow'/);
  assert.match(call.statement, /status = 'shadow_healthy'/);
  assert.match(call.statement, /28hse_agent_540/);
  assert.match(call.statement, /old_site/);
  assert.equal(call.params[1], "operator@example.com");
  assert.doesNotMatch(call.params[2], /approval-secret/);
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
    baseline_approved_at: `2026-08-16T1${index}:00:00.000Z`,
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
  assert.match(insert.statement, /WHERE property_source_links\.status <> 'rejected'/);
  assert.doesNotMatch(insert.statement, /UPDATE properties|DELETE FROM properties/i);
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
  assert.equal(returned.url, winner.url);
  assert.equal(returned.ownerType, "cms");
});

test("saveMediaRecord is conflict-safe on the observation and source URL identity", async () => {
  const client = fakeClient();
  await createSyncRepository({ client }).saveMediaRecord({
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
  });

  assert.match(client.calls[0].statement, /^INSERT INTO listing_media_records/);
  assert.match(client.calls[0].statement, /ON CONFLICT \(observation_id, source_url\) DO NOTHING/);
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
  const client = fakeClient(() => result([{ id: RUN_ID }]));
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
    /registerOwnedMedia/,
    /saveMediaRecord/,
    /interface RepositoryOperation/,
    /signal\?:\s*AbortSignal/,
    /getApprovedHealthyShadowStreak/,
  ]) {
    assert.match(declaration, marker);
  }
});
