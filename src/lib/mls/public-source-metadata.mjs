import { selectWholeContact } from "./source-selection.mjs";
/** Supplemental source evidence. Never mutates or impersonates a verified staff profile. */
export async function readPublicSourceMetadata(
  query,
  propertyId,
  { now = new Date().toISOString() } = {},
) {
  const empty = { source_contact: null, source_freshness: [] };
  const [schema] = await query(
    "SELECT to_regclass('mls_source_state') IS NOT NULL AND to_regclass('mls_source_contacts') IS NOT NULL AND to_regclass('mls_ingestion_policies') IS NOT NULL AS available",
  );
  if (schema?.available !== true) return empty;
  const rows = await query(
    `SELECT s.source,s.observation_id,s.source_status,o.payload->'holdProjection' AS projection_held,
 to_char(s.last_accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_accepted_at,
 c.observation_id AS contact_observation_id, c.contact, (p.config->'public_contacts_enabled' = 'true'::jsonb) AS contact_approved
 FROM mls_source_state s
 JOIN listing_source_observations o ON o.id=s.observation_id
 JOIN mls_ingestion_policies p ON p.source=s.source AND p.scope_id=s.scope_id AND p.policy_version=s.policy_version
 JOIN property_public_members member ON member.property_id=s.property_id
 LEFT JOIN mls_source_contacts c ON c.source=s.source AND c.external_listing_id=s.external_listing_id AND c.deal_type=s.deal_type AND c.observation_id = s.observation_id
 WHERE member.public_listing_no=(SELECT public_listing_no FROM property_public_members WHERE property_id=$1) AND s.policy_version='no-hermes-v2'
 ORDER BY s.source,s.external_listing_id,s.deal_type`,
    [propertyId],
  );
  const supported = rows.filter((r) => ["28hse_agent_540", "propertyhk"].includes(r.source));
  const approved = supported.filter(
    (r) => r.contact_approved === true && r.contact_observation_id === r.observation_id,
  );
  const ambiguous = supported.some(
    (r) => r.projection_held === true || supported.filter((s) => s.source === r.source).length > 1,
  );
  return {
    source_contact: ambiguous ? null : selectWholeContact(approved, { now }),
    source_freshness: supported
      .filter((r) => r.projection_held !== true)
      .map((r) => ({
        source: r.source,
        observed_at: r.last_accepted_at,
        status: r.source_status,
      })),
  };
}
