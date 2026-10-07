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
  for (const key of [
    "properties_created",
    "properties_changed",
    "fields_changed",
    "unchanged_properties",
  ])
    assert.equal(result.summary[key], 0);
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

test("Property.hk index evidence cannot be promoted by a complete-looking snapshot envelope", async () => {
  const { ingestSnapshot } = await import("./ingestion-service.mjs");
  const completeLooking = () =>
    batch(
      [
        row("000123", {
          branch_code: "EPS",
          branch_memberships: ["EPS", "EPT", "EPW"],
          source_url: "https://www.property.hk/fixture/EPS/000123",
        }),
      ],
      "2026-09-07T01:00:00Z",
      "propertyhk",
    );
  const variants = [
    (payload) => {
      payload.listings[0].observation_kind = "index_only";
    },
    ...["meta", "envelope"].flatMap((location) =>
      ["full_snapshot", "details_verified", "id_scope_verified", "full_branch_scope_verified"].map(
        (flag) => (payload) => {
          (location === "meta" ? payload.meta : payload)[flag] = false;
        },
      ),
    ),
  ];
  for (const markIndexEvidence of variants) {
    const payload = completeLooking();
    markIndexEvidence(payload);
    await assert.rejects(
      () =>
        ingestSnapshot(payload, {
          createClient() {
            throw Error("database touched");
          },
        }),
      (error) =>
        error.code === "incomplete_snapshot" &&
        error.details.reasons.includes("index_only_source_evidence"),
    );
  }
});
