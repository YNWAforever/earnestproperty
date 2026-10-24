import test from "node:test";
import assert from "node:assert/strict";
import { assertPatchTarget } from "./controlled-patch-guards.mjs";
import { decodeSnapshot, hashPayload } from "./ingestion-contract.mjs";
import { ingestSnapshot } from "./ingestion-service.mjs";
import { reviewFixture } from "./controlled-review-fixtures.mjs";
import {
  validateReviewPlan,
  rejectedHistoricalReviewKeys,
  reviewDecisionAudit,
} from "./controlled-review-plan.mjs";

const decode = (f) => decodeSnapshot(f.payload, { controlledPatch: true });
const seal = (f) => {
  delete f.payload.meta.controlled_patch.review_plan_hash;
  f.plan.payload_hash = hashPayload(f.payload);
  const hash = hashPayload(f.plan);
  f.payload.meta.controlled_patch.review_plan_hash = hash;
  f.options.reviewPlanHash = hash;
};

test("exact server-approved DOM decision retains raw conflict and draft", () => {
  const f = reviewFixture();
  const record = decodeSnapshot(f.payload, { controlledPatch: true }).records[0];
  const before = structuredClone(record.raw);
  assert.doesNotThrow(() =>
    assertPatchTarget({
      record,
      state: f.state,
      relation: f.relation,
      property: f.property,
      link: f.link,
      pendingReview: false,
      reviewPlan: f.plan,
    }),
  );
  assert.deepEqual(record.raw, before);
  assert.equal(record.raw.raw_payload.source_conflicts[0].status, "review");
  assert.equal(record.unitKey, null);
  assert.equal(f.property.status, "draft");
});

test("scraped review-plan hash cannot grant itself server authority", async () => {
  const f = reviewFixture();
  let clients = 0;
  await assert.rejects(
    () =>
      ingestSnapshot(f.payload, {
        controlledPatch: true,
        createClient() {
          clients++;
          throw Error("NO_DB");
        },
      }),
    (e) => e.code === "patch_review_plan_unapproved",
  );
  assert.equal(clients, 0);
});

test("approved dry-run validates without constructing a client or resolving a review", async () => {
  const f = reviewFixture();
  const result = await ingestSnapshot(f.payload, {
    ...f.options,
    createClient() {
      assert.fail("no DB");
    },
  });
  assert.equal(result.status, "dry_run");
  assert.equal(result.full_snapshot, false);
  assert.equal(result.receipt_id, null);
});

test("reference, server approval and frozen payload must all agree", () => {
  for (const change of [
    (f) => (f.options.reviewPlanHash = "e".repeat(64)),
    (f) => (f.plan.approval_ref = "tampered"),
    (f) => (f.payload.listings[0].price = 1),
  ]) {
    const f = reviewFixture();
    change(f);
    assert.throws(
      () => validateReviewPlan(decode(f), f.options),
      (e) => ["patch_review_plan_hash_mismatch", "invalid_patch_review_plan"].includes(e.code),
    );
  }
});

for (const [name, change] of [
  ["unknown authority", (f) => (f.plan.allowAll = true)],
  ["blank approval reference", (f) => (f.plan.approval_ref = "")],
  ["wrong scope", (f) => (f.plan.scope_id = "agent:541")],
  ["wrong policy", (f) => (f.plan.policy_version = "other")],
  ["duplicate target", (f) => f.plan.targets.push(structuredClone(f.plan.targets[0]))],
  [
    "wrong canonical",
    (f) => (f.plan.targets[0].property_id = "44444444-4444-4444-8444-444444444444"),
  ],
  ["wrong agency", (f) => (f.plan.targets[0].agency_property_no = "A999999")],
  [
    "accept identity instead of rejecting reassignment",
    (f) => (f.plan.targets[0].historical[0].decision = "accept_identity"),
  ],
  [
    "historical source is current target",
    (f) => (f.plan.targets[0].historical[0].external_id = "123"),
  ],
  [
    "historical source is current canonical",
    (f) => (f.plan.targets[0].historical[0].bound_property_id = f.plan.targets[0].property_id),
  ],
  [
    "duplicate historical decision",
    (f) => f.plan.targets[0].historical.push(structuredClone(f.plan.targets[0].historical[0])),
  ],
  ["missing actual review-row hash", (f) => (f.plan.targets[0].historical[0].row_hash = null)],
  ["partial evidence promoted to full", (f) => (f.payload.meta.full_snapshot = true)],
  [
    "extra unapproved source",
    (f) => {
      f.payload.listings.push({
        ...structuredClone(f.payload.listings[0]),
        property_id: "999",
        source_url: "https://www.28hse.com/buy/example/property-999",
      });
      f.payload.meta.controlled_patch.record_count = 2;
      f.payload.meta.controlled_patch.expectations.push({
        ...f.payload.meta.controlled_patch.expectations[0],
        external_id: "999",
      });
      f.payload.meta.controlled_patch.atomic_guards.sources.push({
        external_id: "999",
        deal_type: "sale",
        contact: null,
        promotion: null,
      });
    },
  ],
])
  test("plan rejects " + name, () => {
    const f = reviewFixture();
    change(f);
    seal(f);
    assert.throws(
      () => validateReviewPlan(decode(f), f.options),
      (e) => e.code.startsWith("invalid_patch_") || e.code.startsWith("patch_review_plan_"),
    );
  });

for (const [name, change] of [
  ["content hash", (r) => (r.raw.raw_payload.provider_provenance.contentSha256 = "e".repeat(64))],
  ["capture timestamp", (r) => (r.fetchedAt = "2026-09-06T00:00:00Z")],
  ["DOM value", (r) => (r.fields.bedrooms = 1)],
  ["bathrooms conflict", (r) => (r.raw.raw_payload.source_conflicts[0].field = "bathrooms")],
  [
    "second conflict",
    (r) => r.raw.raw_payload.source_conflicts.push({ field: "price", status: "review" }),
  ],
  [
    "duplicate occurrence with different evidence",
    (r) => {
      r.sourceOccurrences = structuredClone(r.sourceOccurrences);
      r.sourceOccurrences[0].raw.raw_payload.provider_provenance.contentSha256 = "e".repeat(64);
    },
  ],
])
  test("DOM acknowledgement never covers changed " + name, () => {
    const f = reviewFixture(),
      record = decode(f).records[0];
    change(record);
    assert.throws(
      () =>
        assertPatchTarget({
          record,
          state: f.state,
          relation: f.relation,
          property: f.property,
          link: f.link,
          pendingReview: false,
          reviewPlan: f.plan,
        }),
      (e) => e.code === "patch_source_conflict_requires_review",
    );
  });

test("new, active, held or foreign draft targets do not gain authority", () => {
  for (const change of [
    (f) => (f.state = null),
    (f) => (f.property.status = "active"),
    (f) => (f.relation.holdProjection = true),
    (f) => (f.relation.propertyId = "44444444-4444-4444-8444-444444444444"),
  ]) {
    const f = reviewFixture();
    change(f);
    assert.throws(
      () =>
        assertPatchTarget({
          record: decode(f).records[0],
          state: f.state,
          relation: f.relation,
          property: f.property,
          link: f.link,
          pendingReview: false,
          reviewPlan: f.plan,
        }),
      (e) => ["patch_review_plan_target_changed", "patch_review_required"].includes(e.code),
    );
  }
});

test("exact rejected historical proposal is read-only and independently bounded", async () => {
  const f = reviewFixture(),
    batch = decode(f),
    calls = [];
  const keys = await rejectedHistoricalReviewKeys(
    async (sql, args) => {
      calls.push({ sql, args });
      return [f.historical];
    },
    batch,
    batch.records[0],
    f.state,
    f.relation,
    f.property,
    validateReviewPlan(batch, f.options),
    f.link,
  );
  assert.deepEqual(keys, ["c".repeat(64)]);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /\b(?:UPDATE|DELETE|INSERT)\b/);
  assert.deepEqual(calls[0].args, [["c".repeat(64)]]);
  assert.equal(f.historical.status, "open");
  assert.equal(f.historical.held, true);
});

for (const [name, value] of Object.entries({
  row_hash: "e".repeat(32),
  status: "resolved",
  reason: "unknown_field_ownership",
  source: "propertyhk",
  scope_id: "agent:541",
  policy_version: "other",
  external_listing_id: "999",
  deal_type: "rent",
  previous_agency_no: "C999999",
  accepted_agency_no: "A123456",
  proposed_agency_no: "A999999",
  observation_agency_no: "A999999",
  property_id: "44444444-4444-4444-8444-444444444444",
  link_property_id: "44444444-4444-4444-8444-444444444444",
  link_status: "blocked",
  held: false,
}))
  test("historical adjudication rejects changed " + name, async () => {
    const f = reviewFixture(),
      batch = decode(f);
    f.historical[name] = value;
    await assert.rejects(
      () =>
        rejectedHistoricalReviewKeys(
          async () => [f.historical],
          batch,
          batch.records[0],
          f.state,
          f.relation,
          f.property,
          f.plan,
          f.link,
        ),
      (e) => e.code === "patch_historical_review_changed",
    );
  });

test("missing or duplicated historical rows are not mistaken for reviewed", async () => {
  const f = reviewFixture(),
    batch = decode(f);
  for (const rows of [[], [f.historical, f.historical]])
    await assert.rejects(
      () =>
        rejectedHistoricalReviewKeys(
          async () => rows,
          batch,
          batch.records[0],
          f.state,
          f.relation,
          f.property,
          f.plan,
          f.link,
        ),
      (e) => e.code === "patch_historical_review_changed",
    );
});

test("all other pending reviews still veto an acknowledged source", () => {
  const f = reviewFixture();
  assert.throws(
    () =>
      assertPatchTarget({
        record: decode(f).records[0],
        state: f.state,
        relation: f.relation,
        property: f.property,
        link: f.link,
        pendingReview: true,
        reviewPlan: f.plan,
      }),
    (e) => e.code === "patch_review_required",
  );
});

test("audit freezes the plan without modifying formal review or raw HTML evidence", () => {
  const f = reviewFixture(),
    record = decode(f).records[0],
    before = JSON.stringify(record.raw);
  const audit = reviewDecisionAudit(record, validateReviewPlan(decode(f), f.options));
  assert.equal(audit.planHash, f.options.reviewPlanHash);
  assert.equal(audit.formalReviewMutation, false);
  audit.target.external_id = "999";
  assert.equal(f.plan.targets[0].external_id, "123");
  assert.equal(JSON.stringify(record.raw), before);
});

test("review plan hash participates in the native receipt identity", () => {
  const f = reviewFixture(),
    before = decode(f).hash;
  f.plan.approval_ref = "another-explicit-approval";
  seal(f);
  assert.notEqual(decode(f).hash, before);
});

test("target source link must already exist and exactly match source, offer and canonical", () => {
  for (const change of [
    (f) => (f.link = null),
    (f) => (f.link.status = "blocked"),
    (f) => (f.link.property_id = "44444444-4444-4444-8444-444444444444"),
    (f) => (f.link.source = "propertyhk"),
    (f) => (f.link.external_listing_id = "999"),
    (f) => (f.link.deal_type = "rent"),
  ]) {
    const f = reviewFixture();
    change(f);
    assert.throws(
      () =>
        assertPatchTarget({
          record: decode(f).records[0],
          state: f.state,
          relation: f.relation,
          property: f.property,
          link: f.link,
          pendingReview: false,
          reviewPlan: f.plan,
        }),
      (e) => e.code === "patch_review_plan_target_changed",
    );
  }
});
