import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import { enquiryTextOfferingSql } from "./enquiry-routing.server.ts";
import { SOURCE_28HSE } from "../mls/source-contract.mjs";
import { ENQUIRY_ROUTING_APPROVAL, ENQUIRY_ROUTING_PHOTO_SHA256 } from "./enquiry-routing.mjs";

export type EnquiryInfoSourceWitness = { version: 1; hash: string; salesHash: string };
type Subject = { source: "website" | "whatsapp"; subjectId: string };
type SnapshotSql = "t.routing_snapshot" | "d.snapshot";

export function parseEnquiryInfoSourceWitness(value: unknown): EnquiryInfoSourceWitness | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const witness = value as Record<string, unknown>;
  return witness.version === 1 &&
    typeof witness.hash === "string" &&
    /^[a-f0-9]{64}$/.test(witness.hash) &&
    typeof witness.salesHash === "string" &&
    /^[a-f0-9]{64}$/.test(witness.salesHash)
    ? { version: 1, hash: witness.hash, salesHash: witness.salesHash }
    : null;
}

/** A single statement snapshot of the actual resolver's inputs, not a second routing algorithm.
 * Property reads are bounded to subject/reference targets and their public offering clusters.
 * Every approved estate alias is a candidate (including newly introduced ambiguity), so the
 * small approved map is included. CRM consent, conversation ownership/locks, staff roles,
 * receipt completion and unrelated properties are deliberately absent.
 * Candidate eligibility is a Sales-only digest: a retired Sales phone must not stop
 * the independent copy. Both digests fence the resolver sandwich. All configuration
 * and subject values are parameters; only fixed SQL expressions are interpolated.
 * Time flags use the wall clock so lock waits cannot preserve expired source evidence.
 */
export const enquiryInfoSourceWitnessParams = [
  ENQUIRY_ROUTING_APPROVAL,
  ENQUIRY_ROUTING_PHOTO_SHA256,
  SOURCE_28HSE,
] as const;
function sourceHashSql(
  source: string,
  subjectId: string,
  config: readonly [string, string, string],
) {
  const [approval, photo, portalSource] = config;
  return `(WITH witness_input AS (SELECT ${source} AS source,${subjectId} AS subject_id),
  witness_website AS (
    SELECT l.id,l.source,l.created_at,l.contact_id,l.property_id,l.note,l.preferred_estates,
      l.enquiry_routing_context,l.assigned_agent_id,c.name,c.phone,c.normalized_phone,
      i.id AS inquiry_id,i.created_at AS inquiry_created_at,i.message,i.public_listing_no
    FROM crm_leads l CROSS JOIN witness_input x LEFT JOIN crm_contacts c ON c.id=l.contact_id
    LEFT JOIN LATERAL (SELECT i.id,i.created_at,i.message,i.public_listing_no FROM inquiries i
      WHERE i.crm_lead_id=l.id AND i.source='website' ORDER BY i.created_at,i.id LIMIT 1) i ON true
    WHERE x.source='website' AND l.id=x.subject_id
  ), witness_whatsapp AS (
    SELECT i.id,i.source,i.created_at,i.name,i.phone,i.crm_contact_id,i.conversation_id,
      i.intake_message_id,i.property_id,i.public_listing_no,i.requested_staff_id,
      i.attribution_method,i.association_review,i.link_open_id,
      c.name AS contact_name,c.phone AS contact_phone,c.normalized_phone,
      m.text,m.contact_id AS message_contact_id,m.direction,m.channel_id AS message_channel_id,
      m.woztell_member_id AS message_member_id,
      e.id AS event_id,e.received_at,e.occurred_at,e.origin,e.kind,e.app_id,e.channel_id AS event_channel_id,
      e.member_id,e.external_message_id,e.capture_mode,e.timing,e.identity_quality,
      e.processing_state='suppressed' AS event_suppressed,
      w.channel_id,w.woztell_member_id,w.contact_id AS conversation_contact_id,
      o.context_snapshot,enquiry_forwarding_whatsapp_eligible(i.id,w.channel_id) AS eligible
    FROM inquiries i CROSS JOIN witness_input x
    JOIN whatsapp_messages m ON m.id=i.intake_message_id AND m.conversation_id=i.conversation_id
    JOIN whatsapp_enquiry_events e ON e.message_id=m.id AND e.inquiry_id=i.id
    JOIN whatsapp_conversations w ON w.id=i.conversation_id
    LEFT JOIN crm_contacts c ON c.id=i.crm_contact_id
    LEFT JOIN whatsapp_link_opens o ON o.id=i.link_open_id AND o.channel_id=w.channel_id
    WHERE x.source='whatsapp' AND i.id=x.subject_id ORDER BY e.received_at,e.id LIMIT 1
  ), witness_references AS (
    SELECT r.event_id,r.ref_index,r.property_id,r.deal_type,r.resolution,r.source,r.scope_id,r.external_listing_id
    FROM whatsapp_enquiry_reference_links r JOIN witness_whatsapp w ON r.inquiry_id=w.id AND r.event_id=w.event_id
  ), witness_scopes AS (
    SELECT s.channel_id,s.source,s.scope_id,s.enabled,s.verified_at,
      s.verified_at<=clock_timestamp() AS verified
    FROM whatsapp_portal_source_scopes s JOIN witness_whatsapp w ON w.channel_id=s.channel_id
    WHERE EXISTS(SELECT 1 FROM witness_references r WHERE r.scope_id=s.scope_id
      AND s.source=CASE WHEN r.source='28hse' THEN ${portalSource} ELSE 'propertyhk' END)
  ), witness_mls AS (
    SELECT s.source,s.scope_id,s.external_listing_id,s.deal_type,s.property_id,s.source_status,
      s.last_accepted_at,s.last_accepted_at>=clock_timestamp()-interval '30 days' AS fresh
    FROM mls_source_state s WHERE EXISTS(SELECT 1 FROM witness_references r
      WHERE s.scope_id=r.scope_id AND s.external_listing_id=r.external_listing_id
        AND s.source=CASE WHEN r.source='28hse' THEN ${portalSource} ELSE 'propertyhk' END)
  ), witness_target_ids AS (
    SELECT property_id::text AS id FROM witness_website UNION SELECT property_id::text FROM witness_whatsapp
    UNION SELECT offering.id::text FROM witness_website website CROSS JOIN LATERAL (
      SELECT coalesce(nullif(website.enquiry_routing_context->>'requestedPublicListingNo',''),website.public_listing_no,website.message,website.note) AS text
    ) w CROSS JOIN LATERAL (${enquiryTextOfferingSql("w.text")}) offering WHERE website.property_id IS NULL
    UNION SELECT lower(context_snapshot->>'propertyId') FROM witness_whatsapp
    UNION SELECT offering.id::text FROM witness_whatsapp w CROSS JOIN LATERAL (${enquiryTextOfferingSql("w.text")}) offering
      WHERE w.property_id IS NULL AND w.link_open_id IS NULL AND NOT EXISTS(SELECT 1 FROM witness_references)
    UNION SELECT property_id::text FROM witness_references
    UNION SELECT property_id::text FROM witness_mls
  ), witness_targets AS (
    SELECT p.id,p.status,p.deal_type,p.agent_id,p.listing_no,p.canonical_property_no,m.public_listing_no
    FROM properties p LEFT JOIN property_public_members m ON m.property_id=p.id
    WHERE p.id::text IN (SELECT id FROM witness_target_ids)
  ), witness_offerings AS (
    SELECT p.id,p.status,p.deal_type,p.source_authority,p.source_updated_at,p.last_seen_at,
      p.updated_at,p.created_at,m.public_listing_no
    FROM properties p JOIN property_public_members m ON m.property_id=p.id
    WHERE EXISTS(SELECT 1 FROM witness_targets t WHERE t.public_listing_no=m.public_listing_no
      AND t.deal_type=p.deal_type)
  ), witness_agents AS (
    SELECT a.property_id,a.position,a.staff_id FROM property_agents a
    WHERE a.property_id IN (SELECT id FROM witness_targets)
  ), witness_staff AS (
    SELECT s.id,s.active,s.show_on_website,s.phone,s.whatsapp,s.name_zh,s.name_en FROM staff_users s
    WHERE s.id IN (SELECT staff_id FROM witness_agents UNION SELECT agent_id FROM witness_targets)
  ), witness_estates AS (
    SELECT r.scope_key,r.label,r.estate_id,r.aliases,r.district_scope,r.manager_recipient_key,r.version,
      e.name_zh,e.name_en FROM enquiry_estate_routes r LEFT JOIN estates e ON e.id=r.estate_id
    WHERE r.enabled AND r.approval_ref=${approval} AND r.source_hash=${photo}
  ), witness_facts AS (SELECT jsonb_build_object(
    'version',1,'input',(SELECT to_jsonb(x) FROM witness_input x),
    'website',(SELECT to_jsonb(w) FROM witness_website w),
    'whatsapp',(SELECT to_jsonb(w) FROM witness_whatsapp w),
    'references',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.event_id,r.ref_index) FROM witness_references r),
    'scopes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.channel_id,s.source,s.scope_id) FROM witness_scopes s),
    'mls',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source,s.external_listing_id,s.deal_type) FROM witness_mls s),
    'targets',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM witness_targets p),
    'offerings',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM witness_offerings p),
    'agents',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.property_id,a.position,a.staff_id) FROM witness_agents a),
    'estates',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.scope_key) FROM witness_estates e)
  ) AS value) SELECT jsonb_build_object('version',1,
    'hash',encode(digest(value::text,'sha256'),'hex'),
    'salesHash',encode(digest(jsonb_build_array(value,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM witness_staff s))::text,'sha256'),'hex'))
    FROM witness_facts)`;
}

export async function loadEnquiryInfoSourceWitness(subject: Subject, query = queryRows) {
  const [row] = await query(
    `SELECT ${sourceHashSql("$1::text", "$2::uuid", ["$3::text", "$4::text", "$5::text"])} AS witness`,
    [subject.source, subject.subjectId, ...enquiryInfoSourceWitnessParams],
  );
  const witness = parseEnquiryInfoSourceWitness(row?.witness);
  if (!witness) throw Error("ENQUIRY_INFO_SOURCE_WITNESS_UNAVAILABLE");
  return witness;
}

/** Run in the final UPDATE statement AFTER separate policy/identity/subject lock statements. */
export function enquiryInfoSourceWitnessSql(snapshot: SnapshotSql) {
  if (snapshot !== "t.routing_snapshot" && snapshot !== "d.snapshot")
    throw Error("INVALID_SNAPSHOT_SQL");
  return `(SELECT ${snapshot}#>'{sourceWitness,version}'='1'::jsonb
    AND ${snapshot}#>>'{sourceWitness,hash}'=fresh.value->>'hash'
    AND (${snapshot}->>'recipientKind'<>'sales' OR
      ${snapshot}#>>'{sourceWitness,salesHash}'=fresh.value->>'salesHash')
    FROM LATERAL (SELECT ${sourceHashSql(`(${snapshot}->>'source')`, `(${snapshot}->>'subjectId')::uuid`, ["$9::text", "$10::text", "$11::text"])} AS value) fresh)`;
}

/** A post-resolver fingerprint alone could bless an already stale route. Sandwich the
 * actual resolver and reject an unstable read before it can become frozen evidence.
 */
export async function resolveEnquiryInfoSource<T>(
  subject: Subject,
  resolve: (query: typeof queryRows, subject: Subject) => Promise<T | null>,
  query = queryRows,
) {
  const before = await loadEnquiryInfoSourceWitness(subject, query);
  const route = await resolve(query, subject);
  const after = await loadEnquiryInfoSourceWitness(subject, query);
  return route && before.hash === after.hash && before.salesHash === after.salesHash
    ? { route, witness: after }
    : null;
}
