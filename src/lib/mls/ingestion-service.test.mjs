import assert from "node:assert/strict";
import test from "node:test";
import { batch, row } from "./ingestion-test-fixtures.mjs";
test("T28 dry run validates without accessing a database or connection factory", async () => {
  const module = await import("./ingestion-service.mjs").catch(() => ({}));
  assert.equal(typeof module.ingestSnapshot, "function", "atomic ingestion service must exist");
  const result = await module.ingestSnapshot(batch(), {
    createClient() {
      throw Error("database touched");
    },
  });
  assert.equal(result.status, "dry_run");
  assert.equal(result.receipt_id, null);
  assert.equal(result.summary.advertisement_count, 1);
});
test("dry run refuses invalid source and incomplete snapshots", async () => {
  const { ingestSnapshot } = await import("./ingestion-service.mjs");
  await assert.rejects(
    () => ingestSnapshot(batch(), { expectedSource: "propertyhk" }),
    (e) => e.status === 400,
  );
  const bad = batch();
  bad.meta.pages_failed = 1;
  await assert.rejects(
    () => ingestSnapshot(bad),
    (e) => e.status === 422,
  );
});
test("offline Property.hk branch-local preview counts branch identities separately", async () => {
  const { ingestSnapshot } = await import("./ingestion-service.mjs");
  const records = ["EPW", "EPS"].map((branch) =>
    row("same", {
      branch_code: branch,
      source_url: `https://www.property.hk/fixture/${branch}/same`,
    }),
  );
  const payload = batch(records, "2026-09-07T01:00:00Z", "propertyhk");
  payload.id_scope = "branch";
  const result = await ingestSnapshot(payload);
  assert.equal(result.summary.advertisement_count, 2);
});
