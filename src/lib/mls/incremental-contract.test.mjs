import assert from "node:assert/strict";
import test from "node:test";
import { decodeSnapshot } from "./ingestion-contract.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { evaluateSnapshotGate } from "./source-snapshot-gates.mjs";
import { incrementalBatch, member } from "./incremental-test-fixtures.mjs";

test("index membership is complete while fresh details contain only candidates", async () => {
  const payload = incrementalBatch({
    members: [member("123"), member("124"), member("125")],
    candidates: [{ ...member("123"), reason: "changed" }],
  });
  const batch = decodeSnapshot(payload, { incremental: true });
  assert.equal(batch.records.length, 1);
  assert.equal(batch.records[0].fetchedAt, payload.listings[0].captured_at);
  const gate = evaluateSnapshotGate(
    batch,
    { fullCount: 1000 },
    { absenceEnabled: true },
    { incremental: true },
  );
  assert.deepEqual(gate, { allowed: true, full: false, inferAbsence: false, reasons: [] });
  const receipt = await ingestSnapshot(payload, { incremental: true });
  assert.equal(receipt.incremental, true);
  assert.equal(receipt.full_snapshot, false);
  assert.equal(receipt.summary.index_offer_count, 3);
  assert.equal(receipt.summary.candidate_count, 1);
  assert.equal(receipt.summary.fresh_detail_count, 1);
  assert.equal(receipt.summary.unfetched_index_offer_count, 2);
});
test("index movement may repeat an ID on distinct pages but identical pages remain loops", async () => {
  const payload = incrementalBatch({ members: [member("123"), member("124")], candidates: [] });
  const terminal = payload.meta.pages.find(
    (page) => page.scope === "sale" && page.status === "terminal",
  );
  terminal.page = 3;
  payload.meta.pages.push({
    scope: "sale",
    page: 2,
    status: "listings",
    ids: ["123"],
    details_complete: false,
  });
  assert.equal((await ingestSnapshot(payload, { incremental: true })).summary.index_offer_count, 2);
  payload.meta.pages.at(-1).ids.push("124");
  await assert.rejects(
    () => ingestSnapshot(payload, { incremental: true }),
    (error) => error.details.reasons.includes("incremental_pagination_loop"),
  );
});
test("zero changed or zero current offers succeeds without inventing fresh detail", async () => {
  for (const members of [[member()], []]) {
    const payload = incrementalBatch({ members, candidates: [] });
    const receipt = await ingestSnapshot(payload, { incremental: true });
    assert.equal(receipt.incremental, true);
    assert.equal(receipt.summary.advertisement_count, 0);
    assert.equal(receipt.summary.fresh_detail_count, 0);
    assert.equal(receipt.summary.index_offer_count, members.length);
    assert.equal(receipt.full_snapshot, false);
  }
});
test("normal full and controlled patch callers reject incremental authority before DB access", async () => {
  for (const options of [
    {},
    { controlledPatch: true },
    { incremental: "true" },
    { incremental: true, controlledPatch: true },
  ]) {
    await assert.rejects(
      () =>
        ingestSnapshot(incrementalBatch(), {
          ...options,
          apply: true,
          createClient() {
            throw Error("database touched");
          },
        }),
      (error) => ["incremental_mode_required", "invalid_incremental_envelope"].includes(error.code),
    );
  }
  const batch = decodeSnapshot(incrementalBatch(), { incremental: true });
  assert.equal(evaluateSnapshotGate(batch, null).allowed, false);
});
test("candidate proof, page scope and fresh capture cannot be forged by envelope flags", async () => {
  const variants = [
    (p) => {
      p.source = "propertyhk";
      p.meta.scope_id = "branches:EPW,EPS,EPT";
    },
    (p) => {
      p.meta.parser_version = "fixture-v2";
    },
    (p) => {
      p.meta.eligible_for_absence = true;
    },
    (p) => {
      p.meta.incremental.inferAbsence = true;
    },
    (p) => {
      p.meta.incremental.candidates = [];
    },
    (p) => {
      p.meta.incremental.candidates[0].fingerprint = "b".repeat(64);
    },
    (p) => {
      p.meta.incremental.index_membership.push(member());
    },
    (p) => {
      p.meta.pages[0].ids.push("999");
    },
    (p) => {
      p.meta.pages[0].details_complete = true;
    },
    (p) => {
      p.meta.pages.pop();
    },
    (p) => {
      p.meta.pages_failed = 1;
    },
    (p) => {
      p.meta.worker_rejected_count = 1;
    },
    (p) => {
      p.listings[0].captured_at = "2026-09-06T00:00:00Z";
    },
    (p) => {
      p.listings[0].captured_at = "2026-09-07T01:01:00.123457Z";
    },
    (p) => {
      delete p.listings[0].captured_at;
    },
    (p) => {
      p.listings[0].observation_kind = "index_only";
    },
    (p) => {
      p.listings[0].price = "invalid";
    },
    (p) => {
      p.listings[0].target_property_id = "forged";
    },
    (p) => {
      p.meta.incremental.index_started_at = "2026-09-06T00:00:00Z";
    },
  ];
  for (const mutate of variants) {
    const payload = incrementalBatch();
    mutate(payload);
    await assert.rejects(
      () => ingestSnapshot(payload, { incremental: true }),
      (error) => ["invalid_incremental_envelope", "incomplete_snapshot"].includes(error.code),
      mutate.toString(),
    );
  }
});
test("incremental replay returns the exact receipt and conflict before locking", async () => {
  const { hashPayload } = await import("./ingestion-contract.mjs");
  const payload = incrementalBatch();
  const receipt = {
    success: true,
    incremental: true,
    receipt_id: "accepted",
    full_snapshot: false,
  };
  let count = 0;
  let hash = hashPayload(payload);
  const options = {
    incremental: true,
    apply: true,
    connectionString: "synthetic-no-network",
    createClient: () => ({
      neonConfig: {},
      async connect() {},
      async end() {},
      async query(sql) {
        count++;
        assert.match(sql, /^SELECT payload_hash,response/);
        return { rows: [{ payload_hash: hash, response: receipt }] };
      },
    }),
  };
  assert.deepEqual(await ingestSnapshot(payload, options), receipt);
  assert.equal(count, 1);
  hash = "b".repeat(64);
  await assert.rejects(
    () => ingestSnapshot(payload, options),
    (error) => error.code === "receipt_conflict",
  );
});
