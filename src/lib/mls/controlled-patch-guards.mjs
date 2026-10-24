import { SnapshotError, canonicalJson, normalizeDecimal } from "./ingestion-contract.mjs";
import { assertReviewPlanTarget, hasUnreviewedSourceConflict } from "./controlled-review-plan.mjs";

function micros(value) {
  const text = value instanceof Date ? value.toISOString() : String(value);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new SnapshotError("patch_capture_unverified", 409);
  const tail = text.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "";
  return BigInt(ms) * 1000n + BigInt(tail.padEnd(6, "0").slice(3, 6));
}

export function assertPatchTarget({
  record,
  state,
  relation,
  property,
  pendingReview,
  reviewPlan,
  link,
}) {
  assertReviewPlanTarget(record, state, relation, property, reviewPlan, link);
  if (hasUnreviewedSourceConflict(record, reviewPlan))
    throw new SnapshotError("patch_source_conflict_requires_review", 409);
  if (record.sourceStatus !== "active" || (state && state.source_status !== "active"))
    throw new SnapshotError("patch_source_lifecycle_requires_review", 409);
  if (property && !["active", "draft"].includes(property.status))
    throw new SnapshotError("patch_inactive_requires_review", 409);
  if (relation.holdProjection || relation.reason === "ambiguous_exact_unit" || pendingReview)
    throw new SnapshotError("patch_review_required", 409);
  if (state && state.captured_at == null) throw new SnapshotError("patch_capture_unverified", 409);
  if (state && micros(record.fetchedAt) < micros(state.captured_at))
    throw new SnapshotError("patch_capture_stale", 409);
}

export function assertPatchExpectation({ record, state, relation, property, expected, created }) {
  const numeric = new Set([
    "price",
    "rent",
    "gross_area",
    "saleable_area",
    "bedrooms",
    "bathrooms",
  ]);
  if (
    !expected ||
    (state?.observation_id ?? null) !== expected.observation_id ||
    (expected.property_id === null
      ? relation.propertyId != null && !created.has(relation.propertyId)
      : expected.property_id !== relation.propertyId) ||
    Object.entries(expected.fields).some(([field, value]) => {
      const actual = property?.[field] ?? null;
      return numeric.has(field) && actual != null && value != null
        ? normalizeDecimal(actual) !== normalizeDecimal(value)
        : canonicalJson(actual) !== canonicalJson(value);
    })
  )
    throw new SnapshotError("patch_expectation_changed", 409);
}
