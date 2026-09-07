import { writeSyncFields } from "./ingestion-batch-writes.mjs";
import { SnapshotError, canonicalJson } from "./ingestion-contract.mjs";
export function companyPolicy(policy) {
  const rule = policy.config?.company_number_identity;
  if (
    policy.source !== "28hse_agent_540" ||
    policy.scope_id !== "agent:540" ||
    rule?.approved !== true
  )
    return null;
  if (
    rule.version !== "company-number-v1" ||
    typeof rule.approved_by !== "string" ||
    !rule.approved_by.trim()
  )
    throw new SnapshotError("invalid_company_identity_policy", 503);
  return rule;
}
export async function companyRelationship(q, record, existing, relation, rule) {
  if (
    !rule ||
    ["source_link_requires_review", "source_link_inconsistent"].includes(relation.reason)
  )
    return relation;
  const no = record.agencyPropertyNo;
  const hold = (reason) => ({ ...relation, reason, holdProjection: true });
  if (!no) return hold("company_number_missing");
  if (existing?.raw_identity?.agency_property_no && existing.raw_identity.agency_property_no !== no)
    return hold("company_number_changed");
  const groups = await q(
    "SELECT g.* FROM property_public_groups g WHERE g.canonical_property_no=$1 OR g.public_listing_no=$1 OR EXISTS(SELECT 1 FROM property_public_members m JOIN properties p ON p.id=m.property_id WHERE m.public_listing_no=g.public_listing_no AND p.listing_no=$1)",
    [no],
  );
  if (groups.length > 1 || groups.some((g) => g.canonical_property_no !== no))
    return hold("company_group_ambiguous");
  const group = groups[0];
  if (group?.review_required) return hold("company_group_requires_review");
  if (existing?.property_id) {
    const rows = await q(
      "SELECT p.canonical_property_no,m.public_listing_no FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE p.id=$1",
      [existing.property_id],
    );
    if (
      rows.length !== 1 ||
      rows[0].canonical_property_no !== no ||
      (group && group.public_listing_no !== rows[0].public_listing_no)
    )
      return hold("company_number_changed");
    return { ...relation, companyNumber: no, publicGroup: rows[0].public_listing_no };
  }
  const candidates = group
    ? await q(
        "SELECT p.* FROM properties p JOIN property_public_members m ON m.property_id=p.id WHERE m.public_listing_no=$1 AND p.deal_type=$2 ORDER BY p.source_updated_at DESC NULLS LAST,p.last_seen_at DESC NULLS LAST,p.updated_at DESC NULLS LAST,p.created_at DESC,p.id ASC",
        [group.public_listing_no, record.dealType],
      )
    : [];
  return {
    propertyId: candidates[0]?.id ?? null,
    reason: "company_number_v1",
    holdProjection: false,
    unitKey: record.unitKey,
    companyNumber: no,
    publicGroup: group?.public_listing_no ?? no,
  };
}
// Only called for a property and temporary group created in this same transaction.
export async function groupNewCompanyProperty(q, property, relation) {
  if (!relation.companyNumber) return;
  const temporary = await q(
    "SELECT g.* FROM property_public_groups g JOIN property_public_members m ON m.public_listing_no=g.public_listing_no WHERE m.property_id=$1 AND g.public_listing_no=$2 AND g.canonical_property_no IS NULL AND (SELECT count(*) FROM property_public_members peers WHERE peers.public_listing_no=g.public_listing_no)=1",
    [property.id, property.listing_no],
  );
  if (temporary.length !== 1) throw new SnapshotError("company_group_initialization_conflict", 409);
  await q(
    "INSERT INTO property_public_groups(public_listing_no,canonical_property_no) VALUES($1,$2) ON CONFLICT(public_listing_no) DO NOTHING",
    [relation.publicGroup, relation.companyNumber],
  );
  const target = await q(
    "SELECT * FROM property_public_groups WHERE public_listing_no=$1 AND canonical_property_no=$2 AND NOT review_required",
    [relation.publicGroup, relation.companyNumber],
  );
  if (target.length !== 1) throw new SnapshotError("company_group_initialization_conflict", 409);
  await q("UPDATE property_public_members SET public_listing_no=$2 WHERE property_id=$1", [
    property.id,
    relation.publicGroup,
  ]);
  const removed = await q(
    "DELETE FROM property_public_groups g WHERE public_listing_no=$1 AND canonical_property_no IS NULL AND NOT EXISTS(SELECT 1 FROM property_public_members m WHERE m.public_listing_no=g.public_listing_no) AND NOT EXISTS(SELECT 1 FROM admin_property_overrides o WHERE o.property_no=g.public_listing_no) AND NOT EXISTS(SELECT 1 FROM admin_property_source_snapshots s WHERE s.property_no=g.public_listing_no) RETURNING public_listing_no",
    [property.listing_no],
  );
  if (removed.length !== 1) throw new SnapshotError("company_group_initialization_conflict", 409);
}
export async function adoptCompanyFields(q, property, rule, allowedFields, observationId) {
  const baseline = rule?.legacy_field_ownership?.baselines?.[property.id];
  if (
    rule?.legacy_field_ownership?.approved !== true ||
    !baseline ||
    !property.source_url ||
    !property.source_updated_at
  )
    return;
  const overrides = (
    await q(
      "SELECT o.* FROM admin_property_overrides o JOIN property_public_members m ON m.public_listing_no=o.property_no WHERE m.property_id=$1",
      [property.id],
    )
  )[0];
  const patch = { ...overrides?.shared, ...overrides?.[property.deal_type] };
  const adopted = [];
  for (const field of allowedFields) {
    if (
      !Object.hasOwn(baseline, field) ||
      Object.hasOwn(patch, field) ||
      canonicalJson(baseline[field]) !== canonicalJson(property[field])
    )
      continue;
    adopted.push({
      property_id: property.id,
      field_name: field,
      last_published_value: property[field] ?? null,
      winning_observation_id: observationId,
      selection_reason: "approved_legacy_import",
      policy_version: "no-hermes-v2",
    });
  }
  // Never replace existing ownership, including manual and unknown selections.
  await writeSyncFields(q, adopted, true);
}
