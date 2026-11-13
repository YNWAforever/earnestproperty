import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeIncrementalPayload,
  acceptedMarkers,
  validateAcceptance,
  safeSummary,
  runProcess,
  reconcileUnknownReceipt,
  publicationRetryPairs,
  cacheWithPublicationRetries,
} from "./incremental-daily.mjs";
import { hashPayload } from "../../src/lib/mls/ingestion-contract.mjs";
import { incrementalBatch } from "../../src/lib/mls/incremental-test-fixtures.mjs";
import { ingestSnapshot } from "../../src/lib/mls/ingestion-service.mjs";
import { publishDaily } from "../../src/lib/mls/daily-publication.mjs";

function collectorPayload({ empty = false } = {}) {
  const payload = incrementalBatch(empty ? { candidates: [], listings: [] } : {});
  const old = payload.meta.incremental;
  payload.meta.full_snapshot = false;
  payload.meta.incremental = {
    mode: old.mode,
    index_complete: true,
    index_seen_at: old.index_started_at,
    index_started_at: old.index_started_at,
    index_finished_at: old.index_finished_at,
    index_membership: old.index_membership.map((row) => ({
      property_id: row.property_id,
      deal_type: row.deal_type,
      index_fingerprint: row.fingerprint,
    })),
    selected_candidates: old.candidates.map((row) => ({
      property_id: row.property_id,
      deal_type: row.deal_type,
      index_fingerprint: row.fingerprint,
      reasons: ["changed"],
      status: "fetched",
    })),
    pending_candidates: [],
  };
  payload.listings.forEach((row) => {
    row.detail_fetched_at = row.captured_at;
  });
  return payload;
}

test("lost apply responses keep uncertainty and reconcile only the exact committed receipt", async () => {
  await assert.rejects(
    runProcess(process.execPath, [
      "-e",
      "console.error(JSON.stringify({success:false,error:'OUTCOME_UNKNOWN',status:503}));process.exit(1)",
    ]),
    (error) => error.code === "OUTCOME_UNKNOWN",
  );
  const payload = normalizeIncrementalPayload(collectorPayload());
  const response = {
    receipt_id: "native",
    success: true,
    incremental: true,
    incremental_mode: "index-delta-v1",
    full_snapshot: false,
  };
  let reads = 0;
  const receipt = await reconcileUnknownReceipt(payload, {
    read: async (id, request) => {
      reads++;
      assert.equal(id, null);
      assert.equal(request, payload);
      return { id: "native", payload_hash: hashPayload(payload), response, full_snapshot: false };
    },
  });
  assert.equal(reads, 1);
  assert.equal(receipt.reconciled, true);
  await assert.rejects(
    reconcileUnknownReceipt(payload, {
      read: async () => {
        throw Error("read unavailable");
      },
    }),
    /OUTCOME_UNKNOWN/,
  );
  await assert.rejects(
    reconcileUnknownReceipt(payload, {
      read: async () => ({
        id: "native",
        payload_hash: "other",
        response,
        full_snapshot: false,
      }),
    }),
    /OUTCOME_UNKNOWN/,
  );
});

test("publication budget carries retry IDs forward without changing verified cache facts", () => {
  const cache = {
    entries: {
      "28hse:agent:540:sale:123": {
        property_id: "123",
        deal_type: "sale",
        detail_fetched_at: "2026-11-01T00:00:00Z",
        detail_record: { price: 5000000 },
        pending_retry: false,
      },
    },
  };
  const pairs = publicationRetryPairs({
    held: [
      { sourceId: "123", dealType: "sale", reason: "daily_publication_limit" },
      { sourceId: "456", dealType: "sale", reason: "staff_or_source_review" },
    ],
  });
  assert.equal(pairs.length, 1);
  const next = cacheWithPublicationRetries(cache, pairs);
  assert.equal(next.entries["28hse:agent:540:sale:123"].pending_retry, true);
  assert.equal(cache.entries["28hse:agent:540:sale:123"].pending_retry, false);
  assert.equal(
    next.entries["28hse:agent:540:sale:123"].detail_fetched_at,
    cache.entries["28hse:agent:540:sale:123"].detail_fetched_at,
  );
  assert.deepEqual(next.entries["28hse:agent:540:sale:123"].detail_record, { price: 5000000 });
});

test("Python evidence normalizes to a guarded partial request without modifying original data", async () => {
  const original = collectorPayload(),
    before = structuredClone(original);
  const wire = normalizeIncrementalPayload(original);
  assert.deepEqual(original, before);
  assert.equal(wire.listings[0].captured_at, original.listings[0].detail_fetched_at);
  const receipt = await ingestSnapshot(wire, { incremental: true });
  assert.equal(receipt.full_snapshot, false);
  assert.equal(receipt.incremental, true);
  assert.equal(receipt.summary.fresh_detail_count, 1);
  await assert.rejects(ingestSnapshot(wire), /incremental_mode_required/);
});

test("complete unchanged membership produces zero fresh rows rather than copying cached details", async () => {
  const wire = normalizeIncrementalPayload(collectorPayload({ empty: true }));
  const receipt = await ingestSnapshot(wire, { incremental: true });
  assert.equal(wire.listings.length, 0);
  assert.equal(receipt.summary.fresh_detail_count, 0);
  assert.equal(receipt.summary.index_offer_count, 1);
  assert.equal(receipt.full_snapshot, false);
});

test("partial index, failed candidates, pending required details, and stale reused captures are rejected", () => {
  for (const edit of [
    (payload) => {
      payload.meta.incremental.index_complete = false;
    },
    (payload) => {
      payload.meta.incremental.selected_candidates[0].status = "error";
    },
    (payload) => {
      payload.meta.incremental.pending_candidates = [{ property_id: "456" }];
    },
    (payload) => {
      payload.listings[0].detail_fetched_at = "2026-09-06T01:00:00Z";
    },
  ]) {
    const payload = collectorPayload();
    edit(payload);
    assert.throws(() => normalizeIncrementalPayload(payload));
  }
});

test("cache selection only considers immutable acceptance markers and authority must exactly match", () => {
  assert.deepEqual(
    acceptedMarkers([
      { name: "incremental-bundle-20-1.tar.gz" },
      { name: "incremental-accepted-10-1.json", createdAt: "2026-11-10T00:00:00Z" },
      { name: "incremental-accepted-20-1.json", createdAt: "2026-11-11T00:00:00Z" },
    ]).map((row) => row.name),
    ["incremental-accepted-20-1.json", "incremental-accepted-10-1.json"],
  );
  const authority = {
    incremental_receipt_id: "inc",
    receipt_id: "full",
    last_incremental_scraped_at: "2026-11-10T00:00:00.000000Z",
  };
  const marker = {
    kind: "28hse-incremental-accepted-v1",
    receipt_id: "inc",
    full_receipt_id: "full",
    bundle_asset: "incremental-bundle-20-1.tar.gz",
    bundle_sha256: "a".repeat(64),
    scraped_at: authority.last_incremental_scraped_at,
  };
  assert.doesNotThrow(() => validateAcceptance(marker, authority));
  for (const patch of [
    { receipt_id: "old" },
    { full_receipt_id: "other" },
    { bundle_asset: "../../cache.json" },
    { bundle_sha256: "invalid" },
  ])
    assert.throws(
      () => validateAcceptance({ ...marker, ...patch }, authority),
      /AUTHORITY_MISMATCH/,
    );
});

test("publication requires a current accepted incremental receipt and keeps inactive targets held", async () => {
  const payload = normalizeIncrementalPayload(collectorPayload());
  const now = () => Date.parse("2026-09-07T02:00:00Z");
  let calls = 0;
  const missing = {
    query: async () => {
      calls++;
      return { rows: [] };
    },
  };
  await assert.rejects(
    publishDaily({ payload, client: missing, now }),
    /incremental_mode_required/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    publishDaily({ payload, client: missing, now, incremental: true }),
    /ACCEPTED_CURRENT_INCREMENTAL_RECEIPT_REQUIRED/,
  );
  const client = {
    query: async (sql) => ({
      rows: sql.includes("SELECT r.id FROM mls_ingestion_receipts")
        ? [{ id: "receipt" }]
        : [{ status: "inactive" }],
    }),
  };
  const report = await publishDaily({ payload, client, now, incremental: true, apply: true });
  assert.equal(report.published.length, 0);
  assert.equal(report.held[0].reason, "not_imported_draft");
});

test("public artifact contains counts and evidence references, never private raw report contents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ep-incremental-summary-"));
  try {
    const bundle = join(directory, "bundle");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(bundle);
    await writeFile(
      join(bundle, "report.json"),
      JSON.stringify({
        success: true,
        index_complete: true,
        membership_count: 256,
        sale_ids_seen: 206,
        rent_ids_seen: 50,
        index_pages_verified: 20,
        candidate_counts: {
          new: 0,
          changed: 0,
          retry: 0,
          cache_expired: 0,
          contact: "PRIVATE PHONE",
        },
        selected_count: 0,
        fetched_count: 0,
        unchanged_count: 256,
        privateAddress: "PRIVATE HOME",
        errors: [{ contact: "PRIVATE PHONE" }],
      }),
    );
    await safeSummary(directory);
    const text = await readFile(join(directory, "summary.json"), "utf8");
    assert.doesNotMatch(text, /PRIVATE HOME|PRIVATE PHONE|privateAddress|contact/);
    const summary = JSON.parse(text);
    assert.equal(summary.unchangedSkipped, 256);
    assert.equal(summary.saleIdsSeen, 206);
    assert.equal(summary.rentIdsSeen, 50);
    assert.equal(summary.indexPagesVerified, 20);
    assert.equal(summary.newCandidates, 0);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "ep-incremental-summary-")));
    await rm(directory, { recursive: true, force: true });
  }
});

test("incremental scheduling isolates paid collection from DB credentials and legacy full ingestion", async () => {
  const { createRequire } = await import("node:module");
  const yaml = createRequire(import.meta.url)("js-yaml");
  const workflow = yaml.load(
    await readFile(
      new URL("../../.github/workflows/property-sync-daily.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.match(workflow.jobs.incremental.if, /PROPERTY_SYNC_28HSE_INCREMENTAL_ENABLED/);
  assert.match(workflow.jobs.incremental.if, /incremental-shadow/);
  assert.match(workflow.jobs.collect.if, /!startsWith\(inputs.mode, 'incremental-'\)/);
  assert.match(workflow.jobs.ingest.if, /!startsWith\(inputs.mode, 'incremental-'\)/);
  const job = workflow.jobs.incremental;
  assert.equal(job.env.DATABASE_URL_UNPOOLED, undefined);
  const collect = job.steps.find((step) => step.id === "incremental-collect");
  assert.ok(collect.env.FIRECRAWL_API_KEY);
  assert.equal(collect.env.DATABASE_URL_UNPOOLED, undefined);
  assert.equal(collect.env.BLOB_READ_WRITE_TOKEN, undefined);
  for (const step of job.steps.filter((step) => step.env?.DATABASE_URL_UNPOOLED))
    assert.equal(step.env.FIRECRAWL_API_KEY, undefined);
  const publication = job.steps.find((step) => step.id === "incremental-publish");
  assert.equal(publication.if, "env.INCREMENTAL_APPLY == 'true'");
  assert.ok(publication.env.BLOB_READ_WRITE_TOKEN);
});
