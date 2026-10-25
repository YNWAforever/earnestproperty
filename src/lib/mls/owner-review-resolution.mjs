// Frozen review snapshots are owner approvals, never a reason to overwrite properties.
export const POLICY = "owner-keep-current-v1";
export const REVIEW_RESOLUTION_POLICY = POLICY;
const fields = new Set([
  "title_zh",
  "description",
  "district_slug",
  "floor",
  "price",
  "rent",
  "gross_area",
  "saleable_area",
  "bedrooms",
  "bathrooms",
  "orientation",
  "status",
]);
const canonical = (v) =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(canonical(v[k]))]),
          )
      : v,
  );
const identity = (r) =>
  canonical([r.source, r.external_listing_id, r.deal_type, r.reason, r.evidence]);
// Ignore only a generic media hold marker and candidate ordering. Preserve all
// identity/district/candidate evidence so reused IDs or different cases never merge.
function duplicateCase(review) {
  const evidence = structuredClone(review.evidence);
  if (Array.isArray(evidence?.reasons)) {
    evidence.reasons = evidence.reasons.filter(
      (reason) => reason !== "owned_media_review_required",
    );
    if (!evidence.reasons.length) delete evidence.reasons;
  }
  if (Array.isArray(evidence?.candidates))
    evidence.candidates.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const ref = evidence?.identity?.agency_property_no ?? review.observation_ref;
  return canonical([
    identity({ ...review, evidence }),
    ref ?? `observation:${review.observation_id}`,
  ]);
}
export function planOwnerReviewResolution(input, live) {
  if (!input?.approval_ref || !Array.isArray(input.reviews))
    throw Error("REVIEW_SNAPSHOT_REQUIRED");
  const frozen = new Map(input.reviews.map((r) => [r.review_key, r]));
  if (frozen.size !== input.reviews.length) throw Error("REVIEW_DUPLICATE_INPUT_KEY");
  const actions = [],
    held = [],
    groups = new Map();
  for (const r of live.reviews) {
    if (r.status !== "open" || r.source !== "28hse_agent_540") continue;
    const old = frozen.get(r.review_key);
    if (!old || identity(old) !== identity(r) || old.observation_id !== r.observation_id) {
      held.push({ review_key: r.review_key, reason: "snapshot_changed_or_missing" });
      continue;
    }
    if (r.reason === "unknown_field_ownership") {
      const field = r.evidence.field,
        candidates = live.candidates.filter((c) => c.review_key === r.review_key);
      if (
        !fields.has(field) ||
        !Object.hasOwn(r.evidence, "current") ||
        candidates.length !== 1 ||
        canonical(candidates[0].property[field]) !== canonical(r.evidence.current)
      ) {
        held.push({ review_key: r.review_key, reason: "property_or_value_unverified" });
        continue;
      }
      const property = candidates[0].property,
        owned = live.fields.find((f) => f.property_id === property.id && f.field_name === field);
      if (
        owned &&
        !(
          owned.active_override &&
          owned.selection_reason === "manual_override" &&
          canonical(owned.override_value) === canonical(r.evidence.current) &&
          canonical(owned.last_published_value) === canonical(r.evidence.current)
        )
      ) {
        held.push({ review_key: r.review_key, reason: "existing_ownership_requires_review" });
        continue;
      }
      actions.push({
        review_key: r.review_key,
        decision: "keep_current_value",
        property_id: property.id,
        field,
        value: r.evidence.current,
      });
    } else if (["company_group_ambiguous", "district_mapping_unverified"].includes(r.reason)) {
      const key = duplicateCase(r);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    } else held.push({ review_key: r.review_key, reason: "substantive_review_required" });
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.review_key.localeCompare(b.review_key));
    held.push({ review_key: rows[0].review_key, reason: "retained_representative" });
    for (const r of rows.slice(1))
      actions.push({
        review_key: r.review_key,
        decision: "exact_duplicate",
        representative_review_key: rows[0].review_key,
      });
  }
  return { policy: POLICY, approval_ref: input.approval_ref, actions, held };
}
export async function readOwnerReviewQueue(client) {
  const reviews = (
    await client.query(
      "SELECT * FROM mls_ingestion_reviews WHERE status='open' ORDER BY review_key",
    )
  ).rows;
  const candidates = (
    await client.query(`SELECT r.review_key,to_jsonb(p) AS property
    FROM mls_ingestion_reviews r JOIN listing_source_observations o ON o.id=r.observation_id
    AND o.source=r.source AND o.external_listing_id=r.external_listing_id AND o.deal_type=r.deal_type
    JOIN property_source_links l ON l.source=r.source AND l.external_listing_id=r.external_listing_id AND l.deal_type=r.deal_type AND l.status='active'
    JOIN properties p ON p.id=l.property_id AND p.deal_type=r.deal_type
    WHERE r.status='open' AND r.reason='unknown_field_ownership'
    AND p.canonical_property_no=coalesce(nullif(o.property_no_normalized,''),nullif(o.payload#>>'{identity,agency_property_no}',''),nullif(o.payload#>>'{raw,agency_property_no}','')) AND p.canonical_property_no ~ '^[A-Z][0-9]{6}$'
    AND NOT EXISTS(SELECT 1 FROM properties other WHERE other.canonical_property_no=p.canonical_property_no AND other.deal_type=p.deal_type AND other.id<>p.id)`)
  ).rows;
  return {
    reviews,
    candidates,
    fields: (await client.query("SELECT * FROM property_sync_fields")).rows,
  };
}
export async function inspectOwnerReviewResolution(client, input, { exportSnapshot = false } = {}) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const mode = (await client.query("SHOW transaction_read_only")).rows[0];
    if (mode?.transaction_read_only !== "on") throw Error("REVIEW_READ_ONLY_REQUIRED");
    const live = await readOwnerReviewQueue(client);
    if (exportSnapshot)
      return {
        snapshot: { approval_ref: "owner-review-queue-2026-10-25", reviews: live.reviews },
        plan: input ? planOwnerReviewResolution(input, live) : null,
      };
    return planOwnerReviewResolution(input, live);
  } finally {
    await client.query("ROLLBACK");
  }
}
export async function applyOwnerReviewResolution(
  client,
  input,
  { inputSha256, captureInputSha256 } = {},
) {
  if (!/^[a-f0-9]{64}$/.test(inputSha256 ?? "")) throw Error("REVIEW_FROZEN_HASH_REQUIRED");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'))");
    // Includes absence races: prohibit new fields, links or reviews until commit.
    await client.query(
      "LOCK TABLE properties, property_source_links, listing_source_observations, property_sync_fields, mls_ingestion_reviews, mls_ingestion_policies, audit_logs IN SHARE ROW EXCLUSIVE MODE",
    );
    const plan = planOwnerReviewResolution(input, await readOwnerReviewQueue(client));
    for (const a of plan.actions) {
      if (a.decision === "keep_current_value")
        await client.query(
          `INSERT INTO property_sync_fields(property_id,field_name,last_published_value,override_value,active_override,selection_reason,policy_version)
        VALUES($1,$2,$3::jsonb,$3::jsonb,true,'manual_override',$4)
        ON CONFLICT(property_id,field_name) DO UPDATE SET override_value=EXCLUDED.override_value,active_override=true,selection_reason='manual_override',policy_version=EXCLUDED.policy_version,updated_at=now()`,
          [a.property_id, a.field, JSON.stringify(a.value), POLICY],
        );
      await client.query(
        `INSERT INTO audit_logs(action,subject_type,subject_id,metadata) VALUES('mls.owner_review_resolution','mls_ingestion_review',$1,$2::jsonb)`,
        [
          a.property_id ?? null,
          JSON.stringify({
            ...a,
            approval_ref: input.approval_ref,
            input_sha256: inputSha256,
            capture_input_sha256: captureInputSha256 ?? null,
            policy: POLICY,
          }),
        ],
      );
      // No resolution columns exist; preserve evidence/review-key identity, audit separately.
      await client.query(
        "UPDATE mls_ingestion_reviews SET status='resolved' WHERE review_key=$1 AND status='open'",
        [a.review_key],
      );
    }
    await client.query("COMMIT");
    return plan;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// An explicitly audited keep-current decision is already reviewed, not a new queue item.
export function isOwnerKeptField(field, current) {
  return (
    field?.policy_version === POLICY &&
    field.selection_reason === "manual_override" &&
    field.active_override === true &&
    canonical(field.override_value) === canonical(current) &&
    canonical(field.last_published_value) === canonical(current)
  );
}
