import { companyPolicy } from "./company-number.mjs";
import { selectSourceFields } from "./source-selection.mjs";
import { identityText } from "./unit-identity.mjs";

const IDENTITY_FIELDS = [
  "estate",
  "district",
  "phase",
  "block",
  "floor",
  "unit",
  "agency_property_no",
];
const present = (value) => value != null && value !== "";
const displayText = (value) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= 80 &&
  !/^(?:UNKNOWN|N\/A|NA|NULL|NONE|TBC|TBD|待定|不詳|未知|[-—?]+)$/i.test(value.trim())
    ? value.trim()
    : null;

// Enrichment only: the caller supplies the already-selected active offers. Never
// promote drafts, infer absence, write canonical fields or expose raw identities.
export async function readPublicSourceLocation(query, propertyId, offeringIds) {
  if (!offeringIds.length) return null;
  const ids = [...new Set(offeringIds)];
  const [schema] = await query(`SELECT
    to_regclass('mls_source_state') IS NOT NULL AND
    to_regclass('listing_source_observations') IS NOT NULL AND
    to_regclass('property_source_links') IS NOT NULL AND
    to_regclass('mls_ingestion_policies') IS NOT NULL AND
    to_regclass('property_public_groups') IS NOT NULL AND
    to_regclass('mls_ingestion_reviews') IS NOT NULL AND
    to_regclass('mls_ingestion_conflicts') IS NOT NULL AND
    to_regclass('property_sync_fields') IS NOT NULL AND
    to_regclass('admin_property_overrides') IS NOT NULL AS available`);
  if (schema?.available !== true) return null;
  const rows = await query(
    `SELECT p.id AS property_id, p.canonical_property_no,
    g.canonical_property_no AS group_company_no,
    s.source,s.scope_id,s.external_listing_id,s.deal_type,s.observation_id,
    s.source_status,s.unit_key,s.last_accepted_at,s.raw_identity,
    ip.config AS policy_config,
    o.payload->'fields' AS fields,o.payload->'identity' AS observation_identity,
    o.payload->>'sourceStatusReason' AS source_status_reason,
    (p.status='active' AND p.ingestion_owner='no-hermes-v2'
      AND p.ingestion_identity_policy='no-hermes-v2' AND g.review_required=false
      AND s.deal_type=p.deal_type AND s.source_status='active'
      AND s.policy_version='no-hermes-v2'
      AND ip.owner='no-hermes-v2' AND ip.publish_enabled=true
      AND l.status='active' AND l.property_id=p.id
      AND o.source=s.source AND o.external_listing_id=s.external_listing_id
      AND o.deal_type=s.deal_type AND o.validation_state='valid'
      AND o.payload->'schemaVersion'='2'::jsonb
      AND o.payload->>'policyVersion'='no-hermes-v2'
      AND o.payload->'holdProjection'='false'::jsonb) AS eligible,
    (EXISTS(SELECT 1 FROM mls_ingestion_reviews r
      WHERE r.source=s.source AND r.external_listing_id=s.external_listing_id
        AND r.deal_type=s.deal_type AND r.status='open')
      OR EXISTS(SELECT 1 FROM mls_ingestion_conflicts c WHERE c.property_id=p.id
        AND c.review_status='unreviewed' AND c.field_name IN
        ('block','phase','estate','district','floor','unit','agency_property_no','source_status'))) AS review_held,
    (EXISTS(SELECT 1 FROM property_sync_fields f WHERE f.property_id=p.id
      AND (f.active_override OR f.selection_reason='manual_override') AND f.field_name IN
        ('block','phase','estate','estate_id','district','district_slug','floor','unit','address'))
      OR EXISTS(SELECT 1 FROM admin_property_overrides a WHERE a.property_no=m.public_listing_no
        AND (a.shared || CASE p.deal_type WHEN 'sale' THEN a.sale ELSE a.rent END) ?|
          ARRAY['block','phase','estate','estate_id','district','district_slug','floor','unit','address'])) AS manual_held
    FROM properties p
    JOIN property_public_members m ON m.property_id=p.id
    LEFT JOIN property_public_groups g ON g.public_listing_no=m.public_listing_no
    LEFT JOIN mls_source_state s ON s.property_id=p.id
    LEFT JOIN listing_source_observations o ON o.id=s.observation_id
    LEFT JOIN property_source_links l ON l.source=s.source AND l.external_listing_id=s.external_listing_id AND l.deal_type=s.deal_type
    LEFT JOIN mls_ingestion_policies ip ON ip.source=s.source AND ip.scope_id=s.scope_id AND ip.policy_version=s.policy_version
    WHERE p.id=ANY($2::uuid[]) AND m.public_listing_no=(
      SELECT public_listing_no FROM property_public_members WHERE property_id=$1)
    ORDER BY p.id,s.source,s.external_listing_id,s.deal_type`,
    [propertyId, ids],
  );
  if (new Set(rows.map((r) => r.property_id)).size !== ids.length) return null;
  for (const row of rows) {
    if (row.eligible !== true || row.review_held !== false || row.manual_held !== false)
      return null;
    if (!["28hse_agent_540", "propertyhk"].includes(row.source)) return null;
    if (row.source === "28hse_agent_540") {
      try {
        if (!companyPolicy({ ...row, config: row.policy_config })) return null;
      } catch (error) {
        if (error.code === "invalid_company_identity_policy") return null;
        throw error;
      }
      const no = row.raw_identity?.agency_property_no;
      if (
        !no ||
        no !== row.canonical_property_no ||
        no !== row.group_company_no ||
        no !== row.observation_identity?.agency_property_no
      )
        return null;
    }
    // A held old relationship must not leak a new identity via a display overlay.
    for (const field of IDENTITY_FIELDS) {
      const old = row.raw_identity?.[field];
      const observed = row.observation_identity?.[field];
      const value = row.fields?.[field];
      if (present(old) && present(observed) && identityText(old) !== identityText(observed))
        return null;
      // Display bands do not supply an exact floor. Never let one hide a known identity.
      const unknownFloorBand =
        field === "floor" &&
        !present(old) &&
        !present(observed) &&
        /^(?:高層|中層|低層|HIGH|MID|LOW)$/.test(identityText(value));
      if (present(value) && identityText(value) !== identityText(observed) && !unknownFloorBand)
        return null;
    }
  }
  const locations = [];
  const identities = [];
  for (const id of ids) {
    const sources = rows.filter((r) => r.property_id === id);
    if (!sources.some((r) => r.source === "28hse_agent_540")) return null;
    const selected = selectSourceFields(sources);
    if (selected.ambiguous || selected.conflicts.some((c) => IDENTITY_FIELDS.includes(c.field)))
      return null;
    identities.push(selected.values);
    locations.push({
      block: displayText(selected.values.block),
      phase: displayText(selected.values.phase),
    });
  }
  for (const field of IDENTITY_FIELDS) {
    const known = identities.map((identity) => identityText(identity[field])).filter(Boolean);
    if (new Set(known).size > 1) return null;
  }
  // Sale/rent toggle shares this physical description. Disagreement or missing
  // evidence on either active offer must not borrow a neighbouring unit's data.
  const location = locations[0];
  if (!location || locations.some((l) => l.block !== location.block || l.phase !== location.phase))
    return null;
  return location.block || location.phase ? location : null;
}
