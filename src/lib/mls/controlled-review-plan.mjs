import { canonicalJson, hashPayload, SnapshotError } from "./ingestion-contract.mjs";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hex = (v, n) => typeof v === "string" && new RegExp(`^[a-f0-9]{${n}}$`).test(v);
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const keys = (v, names) =>
  object(v) && canonicalJson(Object.keys(v).sort()) === canonicalJson([...names].sort());
const targetFor = (record, plan) =>
  plan?.targets.find((t) => t.external_id === record.externalId && t.deal_type === record.dealType);
const fail = (code) => {
  throw new SnapshotError(code, 409);
};

export function validateReviewPlan(batch, options = {}) {
  const reference = batch.meta.controlled_patch?.review_plan_hash;
  if (
    reference === undefined &&
    options.reviewPlan === undefined &&
    options.reviewPlanHash === undefined
  )
    return null;
  if (!options.reviewPlan || !options.reviewPlanHash || !reference)
    fail("patch_review_plan_unapproved");
  const plan = JSON.parse(JSON.stringify(options.reviewPlan));
  if (
    !hex(reference, 64) ||
    reference !== options.reviewPlanHash ||
    reference !== hashPayload(plan)
  )
    fail("patch_review_plan_hash_mismatch");
  const base = structuredClone(batch.payload);
  delete base.meta.controlled_patch.review_plan_hash;
  if (
    options.controlledPatch !== true ||
    batch.source !== "28hse_agent_540" ||
    batch.meta.full_snapshot !== false ||
    batch.meta.eligible_for_absence !== false ||
    batch.meta.controlled_patch?.evidence_mode !== "saved-capture-v1" ||
    !keys(plan, [
      "version",
      "source",
      "scope_id",
      "policy_version",
      "payload_hash",
      "approval_ref",
      "targets",
    ]) ||
    plan.version !== "controlled-review-v1" ||
    plan.source !== batch.source ||
    plan.scope_id !== batch.scopeId ||
    plan.policy_version !== batch.policyVersion ||
    plan.payload_hash !== hashPayload(base) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(plan.approval_ref ?? "") ||
    !Array.isArray(plan.targets) ||
    plan.targets.length !== 1 ||
    batch.records.length !== 1
  )
    fail("invalid_patch_review_plan");
  for (const target of plan.targets) {
    if (
      !keys(target, [
        "external_id",
        "deal_type",
        "property_id",
        "agency_property_no",
        "dom_conflict",
        "historical",
      ]) ||
      !uuid(target.property_id) ||
      !/^[A-Z][0-9]{6}$/.test(target.agency_property_no ?? "") ||
      !Array.isArray(target.historical) ||
      target.historical.length > 1
    )
      fail("invalid_patch_review_plan");
    const record = batch.records.find((r) => targetFor(r, plan) === target);
    const expected = batch.meta.controlled_patch.expectations?.find(
      (e) => e.external_id === target.external_id && e.deal_type === target.deal_type,
    );
    if (
      !record ||
      record.agencyPropertyNo !== target.agency_property_no ||
      expected?.property_id !== target.property_id
    )
      fail("patch_review_plan_target_changed");
    if (
      target.dom_conflict !== null &&
      (!keys(target.dom_conflict, [
        "decision",
        "captured_at",
        "content_sha256",
        "conflicts_hash",
      ]) ||
        target.dom_conflict.decision !== "accept_dom" ||
        !hex(target.dom_conflict.content_sha256, 64) ||
        !hex(target.dom_conflict.conflicts_hash, 64) ||
        !domConflictReviewed(record, target))
    )
      fail("patch_review_plan_conflict_changed");
    if (target.dom_conflict === null && target.historical.length === 0)
      fail("invalid_patch_review_plan");
    for (const historical of target.historical) {
      if (
        !keys(historical, [
          "review_key",
          "row_hash",
          "external_id",
          "previous_agency_no",
          "proposed_agency_no",
          "bound_property_id",
          "decision",
        ]) ||
        !hex(historical.review_key, 64) ||
        !hex(historical.row_hash, 32) ||
        !uuid(historical.bound_property_id) ||
        !/^[0-9]+$/.test(historical.external_id ?? "") ||
        historical.external_id === record.externalId ||
        historical.bound_property_id === target.property_id ||
        historical.decision !== "reject_reassignment" ||
        !/^[A-Z][0-9]{6}$/.test(historical.previous_agency_no ?? "") ||
        historical.previous_agency_no === target.agency_property_no ||
        historical.proposed_agency_no !== target.agency_property_no
      )
        fail("invalid_patch_review_plan");
    }
  }
  return plan;
}

function domConflictReviewed(record, target) {
  const ack = target.dom_conflict;
  if (!ack) return false;
  return [record.raw, ...(record.sourceOccurrences ?? []).map((o) => o.raw)].every((raw) => {
    const conflicts = raw.raw_payload?.source_conflicts;
    const provider = raw.raw_payload?.provider_provenance;
    return (
      Array.isArray(conflicts) &&
      conflicts.length === 1 &&
      keys(conflicts[0], ["field", "dom", "json_ld", "resolution", "status"]) &&
      conflicts[0].field === "bedrooms" &&
      conflicts[0].resolution === "dom" &&
      conflicts[0].status === "review" &&
      Number.isInteger(conflicts[0].dom) &&
      conflicts[0].dom >= 0 &&
      conflicts[0].dom <= 100 &&
      Number.isInteger(conflicts[0].json_ld) &&
      conflicts[0].json_ld >= 0 &&
      conflicts[0].json_ld <= 100 &&
      conflicts[0].dom !== conflicts[0].json_ld &&
      record.fields.bedrooms === conflicts[0].dom &&
      ack.conflicts_hash === hashPayload(conflicts) &&
      ack.content_sha256 === provider?.contentSha256 &&
      ack.captured_at === record.fetchedAt &&
      ack.captured_at === raw.captured_at &&
      ack.captured_at === provider?.fetchedAt &&
      provider?.resolvedUrl === record.sourceUrl
    );
  });
}

export function hasUnreviewedSourceConflict(record, plan) {
  const pending = [record.raw, ...(record.sourceOccurrences ?? []).map((o) => o.raw)].some((raw) =>
    raw.raw_payload?.source_conflicts?.some((c) => c.status === "review"),
  );
  const target = targetFor(record, plan);
  return pending && !(target && domConflictReviewed(record, target));
}

export function assertReviewPlanTarget(record, state, relation, property, plan, link) {
  const target = targetFor(record, plan);
  if (
    target &&
    (property?.status !== "draft" ||
      property.id !== target.property_id ||
      state?.property_id !== target.property_id ||
      link?.status !== "active" ||
      link.property_id !== target.property_id ||
      link.source !== record.source ||
      link.external_listing_id !== record.externalId ||
      link.deal_type !== record.dealType ||
      relation.propertyId !== target.property_id ||
      property.canonical_property_no !== target.agency_property_no ||
      record.agencyPropertyNo !== target.agency_property_no)
  )
    fail("patch_review_plan_target_changed");
}

export async function rejectedHistoricalReviewKeys(
  q,
  batch,
  record,
  state,
  relation,
  property,
  plan,
  link,
) {
  assertReviewPlanTarget(record, state, relation, property, plan, link);
  const decisions = targetFor(record, plan)?.historical ?? [];
  if (!decisions.length) return [];
  // Caller holds native table locks; hash freezes the entire formal review row.
  const rows = await q(
    `SELECT /* controlled_patch_review_decisions */ r.review_key,md5(to_jsonb(r)::text) AS row_hash,
    r.status,r.reason,r.source,r.external_listing_id,r.deal_type,receipt.scope_id,receipt.policy_version,
    r.evidence#>>'{previousIdentity,agency_property_no}' AS previous_agency_no,
    r.evidence#>>'{identity,agency_property_no}' AS proposed_agency_no,
    s.raw_identity->>'agency_property_no' AS accepted_agency_no,
    o.payload#>>'{identity,agency_property_no}' AS observation_agency_no,
    s.property_id,l.property_id AS link_property_id,l.status AS link_status,
    (o.payload->'holdProjection'='true'::jsonb) AS held
    FROM mls_ingestion_reviews r JOIN listing_source_observations o ON o.id=r.observation_id
      AND o.source=r.source AND o.external_listing_id=r.external_listing_id AND o.deal_type=r.deal_type
    JOIN mls_ingestion_receipts receipt ON receipt.run_id=o.run_id AND receipt.source=o.source
    JOIN mls_source_state s ON s.source=r.source AND s.external_listing_id=r.external_listing_id AND s.deal_type=r.deal_type AND s.observation_id=o.id
    JOIN property_source_links l ON l.source=s.source AND l.external_listing_id=s.external_listing_id AND l.deal_type=s.deal_type
    WHERE r.review_key=ANY($1::text[])`,
    [decisions.map((d) => d.review_key)],
  );
  if (rows.length !== decisions.length) fail("patch_historical_review_changed");
  for (const decision of decisions) {
    const row = rows.find((r) => r.review_key === decision.review_key);
    if (
      !row ||
      row.row_hash !== decision.row_hash ||
      row.status !== "open" ||
      row.reason !== "company_number_changed" ||
      row.source !== batch.source ||
      row.scope_id !== batch.scopeId ||
      row.policy_version !== batch.policyVersion ||
      row.external_listing_id !== decision.external_id ||
      row.deal_type !== record.dealType ||
      row.previous_agency_no !== decision.previous_agency_no ||
      row.accepted_agency_no !== decision.previous_agency_no ||
      row.proposed_agency_no !== record.agencyPropertyNo ||
      row.observation_agency_no !== record.agencyPropertyNo ||
      row.property_id !== decision.bound_property_id ||
      row.link_property_id !== decision.bound_property_id ||
      row.link_status !== "active" ||
      row.held !== true
    )
      fail("patch_historical_review_changed");
  }
  return decisions.map((d) => d.review_key);
}

export function reviewDecisionAudit(record, plan) {
  const target = targetFor(record, plan);
  return target
    ? {
        version: plan.version,
        planHash: hashPayload(plan),
        approvalRef: plan.approval_ref,
        target: structuredClone(target),
        formalReviewMutation: false,
      }
    : null;
}
