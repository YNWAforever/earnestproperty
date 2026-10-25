import test from "node:test";
import assert from "node:assert/strict";
import { planOwnerReviewResolution } from "./owner-review-resolution.mjs";
const review = (
  key,
  reason = "unknown_field_ownership",
  evidence = { field: "bedrooms", current: 2 },
) => ({
  review_key: key,
  source: "28hse_agent_540",
  external_listing_id: "123",
  deal_type: "sale",
  status: "open",
  observation_id: "o",
  reason,
  evidence,
});
const plan = (reviews, candidates = [], fields = []) =>
  planOwnerReviewResolution(
    { approval_ref: "owner-approval", reviews },
    { reviews, candidates, fields },
  );
test("keeps exact captured field only on a unique verified property", () => {
  const r = review("a");
  const candidate = { review_key: "a", property: { id: "p", bedrooms: 2 } };
  assert.equal(plan([r], [candidate]).actions[0].decision, "keep_current_value");
  assert.equal(plan([r], [candidate, candidate]).actions.length, 0);
  assert.equal(plan([r], [{ ...candidate, property: { id: "p", bedrooms: 3 } }]).actions.length, 0);
  assert.equal(
    plan(
      [r],
      [candidate],
      [{ property_id: "p", field_name: "bedrooms", selection_reason: "source" }],
    ).actions.length,
    0,
  );
});
test("retains representative and every distinct substantive case", () => {
  const a = review("a", "company_group_ambiguous", { x: 1 }),
    b = { ...a, review_key: "b" },
    c = { ...a, review_key: "c", evidence: { x: 2 } },
    d = review("d", "company_number_changed", {});
  const result = plan([a, b, c, d]);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].representative_review_key, "a");
  assert.equal(result.held.length, 3);
});
test("snapshot or observation drift blocks resolution", () => {
  const r = review("a");
  const result = planOwnerReviewResolution(
    { approval_ref: "owner", reviews: [r] },
    {
      reviews: [{ ...r, observation_id: "new" }],
      candidates: [{ review_key: "a", property: { id: "p", bedrooms: 2 } }],
      fields: [],
    },
  );
  assert.equal(result.actions.length, 0);
});

test("owner keep-current decisions suppress recurrence only while the exact reviewed value stays intact", async () => {
  const { isOwnerKeptField } = await import("./owner-review-resolution.mjs");
  const field = {
    policy_version: "owner-keep-current-v1",
    selection_reason: "manual_override",
    active_override: true,
    override_value: 2,
    last_published_value: 2,
  };
  assert.equal(isOwnerKeptField(field, 2), true);
  assert.equal(isOwnerKeptField(field, 3), false);
  assert.equal(isOwnerKeptField({ ...field, policy_version: "ordinary-manual" }, 2), false);
  assert.equal(isOwnerKeptField({ ...field, last_published_value: 3 }, 2), false);
});

test("redundant media hold evidence does not duplicate a real review case; distinct identities remain open", () => {
  const a = review("a", "company_group_ambiguous", {
    identity: { agency_property_no: "A123456" },
    candidates: [],
  });
  const b = {
    ...a,
    review_key: "b",
    evidence: { ...a.evidence, reasons: ["owned_media_review_required"] },
  };
  const c = {
    ...a,
    review_key: "c",
    evidence: { identity: { agency_property_no: "B654321" }, candidates: [] },
  };
  const result = plan([a, b, c]);
  assert.equal(result.actions.length, 1);
  assert.equal(result.held.length, 2);
});

test("reviews lacking ref evidence from different observations are not merged across reused ad IDs", () => {
  const a = review("a", "company_group_ambiguous", {});
  const b = { ...a, review_key: "b", observation_id: "other-observation" };
  assert.equal(plan([a, b]).actions.length, 0);
});
