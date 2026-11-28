import "@tanstack/react-start/server-only";
import { estateRegistry } from "../../content/estate-registry.ts";
import { CURRENT_PUBLIC_OFFERING_ORDER } from "../neon/public-listing-query.js";
import { SOURCE_28HSE } from "../mls/source-contract.mjs";
import {
  ENQUIRY_ROUTING_APPROVAL,
  ENQUIRY_ROUTING_PHOTO_SHA256,
  normalizeEstateLabel,
  mentionsSpecificProperty,
  planEnquiryRouting,
} from "./enquiry-routing.mjs";
import type {
  EnquiryEstateRoute,
  EnquiryForwardingPlan,
  EnquirySalesContact,
  EnquirySource,
} from "./enquiry-routing";

type Row = Record<string, unknown>;
export type EnquiryRoutingQuery = (statement: string, params?: unknown[]) => Promise<Row[]>;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const string = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
const stamp = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
const text = (value: unknown) => (typeof value === "string" ? value : "");

export async function enquiryEstateRoutes(
  query: EnquiryRoutingQuery,
): Promise<EnquiryEstateRoute[]> {
  const rows = await query(
    `SELECT r.scope_key,r.label,r.estate_id,r.aliases,r.district_scope,r.manager_recipient_key,r.version,
    e.name_zh AS estate_name_zh,e.name_en AS estate_name_en
    FROM enquiry_estate_routes r LEFT JOIN estates e ON e.id=r.estate_id
    WHERE r.enabled AND r.approval_ref=$1 AND r.source_hash=$2 ORDER BY r.scope_key`,
    [ENQUIRY_ROUTING_APPROVAL, ENQUIRY_ROUTING_PHOTO_SHA256],
  );
  return rows.map((r) => ({
    scopeKey: String(r.scope_key),
    label: String(r.label),
    estateId: string(r.estate_id),
    aliases: [
      ...new Set(
        [...(Array.isArray(r.aliases) ? r.aliases : []), r.estate_name_zh, r.estate_name_en].filter(
          (alias): alias is string => typeof alias === "string" && Boolean(alias.trim()),
        ),
      ),
    ],
    districtScope: string(r.district_scope),
    managerKey: String(r.manager_recipient_key),
    version: Number(r.version),
  }));
}
/** Resolve one standalone public listing number in a plain WhatsApp enquiry.
 * A dual sale/rent offering needs an explicit deal label to identify one unit. */
export function enquiryTextOfferingSql(message: "$1" | "w.text") {
  return `WITH refs AS (
    SELECT DISTINCT upper(m[1]) AS listing_no FROM regexp_matches(${message},'(?<![a-zA-Z0-9])([a-zA-Z][0-9]{6})(?![a-zA-Z0-9])','g') m
    WHERE ${message} !~* '(https?://|www[.]|EPWA[[:space:]]*:)'
  ), current_offers AS (
    SELECT DISTINCT ON(p.deal_type) p.id,p.deal_type,p.status,m.public_listing_no
    FROM property_public_members m JOIN properties p ON p.id=m.property_id
    WHERE (SELECT count(*) FROM refs)=1 AND m.public_listing_no=(SELECT min(listing_no) FROM refs)
    ORDER BY p.deal_type,${CURRENT_PUBLIC_OFFERING_ORDER}
  ) SELECT id,public_listing_no FROM current_offers WHERE status='active'
    AND (position('（出售）' in ${message})=0 OR deal_type='sale')
    AND (position('（出租）' in ${message})=0 OR deal_type='rent')`;
}
async function property(query: EnquiryRoutingQuery, propertyId: string) {
  const [p] = await query(
    `SELECT p.id,p.status,p.deal_type,p.agent_id,p.listing_no,p.canonical_property_no,m.public_listing_no,
    (p.id=(SELECT p.id FROM properties p JOIN property_public_members member ON member.property_id=p.id
      WHERE member.public_listing_no=m.public_listing_no AND p.deal_type=outer_p.deal_type ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER} LIMIT 1)) AS current
    FROM properties outer_p JOIN properties p ON p.id=outer_p.id LEFT JOIN property_public_members m ON m.property_id=p.id WHERE p.id=$1::uuid`,
    [propertyId],
  );
  if (!p) return null;
  const [available] = await query("SELECT to_regclass('property_agents') IS NOT NULL AS available");
  const agents =
    available?.available === true
      ? await query(
          `SELECT s.id AS staff_id,a.position,s.active,s.show_on_website,s.phone,s.whatsapp,coalesce(s.name_zh,s.name_en) AS display_name
    FROM property_agents a JOIN staff_users s ON s.id=a.staff_id WHERE a.property_id=$1::uuid ORDER BY a.position,s.id`,
          [propertyId],
        )
      : [];
  const legacy = uuid(p.agent_id)
    ? (
        await query(
          "SELECT id AS staff_id,active,show_on_website,phone,whatsapp,coalesce(name_zh,name_en) AS display_name FROM staff_users WHERE id=$1::uuid",
          [p.agent_id],
        )
      )[0]
    : null;
  const contact = (r: Row): EnquirySalesContact => ({
    staffId: String(r.staff_id),
    position: Number(r.position),
    active: r.active === true,
    showOnWebsite: r.show_on_website === true,
    phone: string(r.phone),
    whatsapp: string(r.whatsapp),
    ...(string(r.display_name) ? { displayName: String(r.display_name) } : {}),
  });
  return {
    raw: p,
    value: {
      id: String(p.id),
      status: String(p.status),
      dealType: p.deal_type as "sale" | "rent",
      publicListingNo: String(p.public_listing_no ?? p.listing_no),
      current: p.current === true,
    },
    agents: agents.map(contact),
    legacyAgent: legacy ? contact(legacy) : null,
  };
}

/** Notification recipients only. This resolver never changes staff roles,
 * conversation assignment, customer consent, registry verification or source facts. */
export async function resolveEnquiryForwarding(
  query: EnquiryRoutingQuery,
  input: { source: EnquirySource; subjectId: string },
): Promise<EnquiryForwardingPlan | null> {
  if (!["website", "whatsapp"].includes(input?.source) || !uuid(input?.subjectId))
    throw new Error("ENQUIRY_FORWARD_SUBJECT_INVALID");
  const [schema] = await query(
    "SELECT to_regclass('enquiry_notification_recipients') IS NOT NULL AND to_regclass('enquiry_estate_routes') IS NOT NULL AS available",
  );
  if (schema?.available !== true) return null;
  let subject: Row;
  let message = "";
  let requestedPropertyId: string | null = null;
  let requestedNo: string | null = null;
  let requestedDeal: string | null = null;
  let selectedStaffId: string | null = null;
  let specific = false;
  let review = false;
  let estateLabel: string | null = null;
  let estateId: string | null = null;
  let formEstateLabel: string | null = null;
  let conversationId: string | undefined;
  let sourceMessageId: string | undefined;
  let channelId: string | undefined;
  if (input.source === "website") {
    const [lead] = await query(
      `SELECT l.*,to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS forwarding_created_at,
      c.name AS customer_name,coalesce(c.normalized_phone,c.phone) AS customer_phone,i.message AS inquiry_message,i.public_listing_no AS inquiry_public_no
      FROM crm_leads l LEFT JOIN crm_contacts c ON c.id=l.contact_id
      LEFT JOIN LATERAL (SELECT i.message,i.public_listing_no FROM inquiries i WHERE i.crm_lead_id=l.id AND i.source='website' ORDER BY i.created_at,i.id LIMIT 1) i ON true
      JOIN enquiry_notification_recipients copy ON copy.recipient_key='copy'
      WHERE l.id=$1::uuid AND l.source='website' AND l.created_at>=copy.enabled_since AND enquiry_forwarding_is_enabled()`,
      [input.subjectId],
    );
    if (!lead) return null;
    subject = lead;
    const context = object(lead.enquiry_routing_context);
    requestedPropertyId = string(lead.property_id);
    requestedNo = string(context.requestedPublicListingNo) ?? string(lead.inquiry_public_no);
    selectedStaffId =
      string(context.selectedAgentId)?.toLowerCase() ?? string(lead.assigned_agent_id);
    specific =
      context.kind === "property" ||
      Boolean(requestedPropertyId || string(context.requestedPropertyId) || requestedNo);
    if (
      string(context.requestedPropertyId) &&
      (!uuid(context.requestedPropertyId) ||
        context.requestedPropertyId.toLowerCase() !== requestedPropertyId)
    )
      review = true;
    message = text(lead.inquiry_message ?? lead.note);
    formEstateLabel =
      estateRegistry.find((entry) => entry.slug === context.requestedEstateSlug)?.nameZh ?? null;
    if (
      !requestedPropertyId &&
      !review &&
      (requestedNo || (!specific && mentionsSpecificProperty(message)))
    ) {
      const offers = await query(enquiryTextOfferingSql("$1"), [requestedNo ?? message]);
      if (offers.length === 1) {
        requestedPropertyId = string(offers[0].id);
        requestedNo = string(offers[0].public_listing_no);
        specific = true;
      }
    }
    const preferred = Array.isArray(lead.preferred_estates)
      ? [
          ...new Set(
            lead.preferred_estates.filter(
              (label): label is string =>
                typeof label === "string" && Boolean(normalizeEstateLabel(label)),
            ),
          ),
        ]
      : [];
    if (preferred.length > 1) review = true;
    else if (uuid(preferred[0])) estateId = preferred[0].toLowerCase();
    else estateLabel = preferred[0] ?? null;
  } else {
    const [inquiry] = await query(
      `SELECT i.*,to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS forwarding_created_at,
      coalesce(i.name,c.name) AS customer_name,coalesce(i.phone,c.normalized_phone,c.phone) AS customer_phone,
      m.text AS intake_text,e.id AS event_id,w.channel_id,o.context_snapshot
      FROM inquiries i JOIN whatsapp_messages m ON m.id=i.intake_message_id AND m.conversation_id=i.conversation_id
      JOIN whatsapp_enquiry_events e ON e.message_id=m.id AND e.inquiry_id=i.id
      JOIN whatsapp_conversations w ON w.id=i.conversation_id LEFT JOIN crm_contacts c ON c.id=i.crm_contact_id
      LEFT JOIN whatsapp_link_opens o ON o.id=i.link_open_id AND o.channel_id=w.channel_id
      WHERE i.id=$1::uuid AND enquiry_forwarding_whatsapp_eligible(i.id,w.channel_id) ORDER BY e.received_at,e.id LIMIT 1`,
      [input.subjectId],
    );
    if (!inquiry) return null;
    subject = inquiry;
    message = text(inquiry.intake_text);
    conversationId = String(inquiry.conversation_id);
    sourceMessageId = String(inquiry.intake_message_id);
    channelId = String(inquiry.channel_id);
    requestedPropertyId = string(inquiry.property_id);
    requestedNo = string(inquiry.public_listing_no);
    selectedStaffId = string(inquiry.requested_staff_id);
    const snapshot = object(inquiry.context_snapshot);
    const [portalSchema] = await query(
      "SELECT to_regclass('whatsapp_enquiry_reference_links') IS NOT NULL AS available",
    );
    const references =
      portalSchema?.available === true
        ? await query(
            `SELECT r.property_id,r.deal_type,r.resolution,
      (r.resolution->>'status'='resolved' AND r.resolution->'reasons'='[]'::jsonb AND EXISTS(
        SELECT 1 FROM whatsapp_portal_source_scopes scope JOIN mls_source_state s ON s.source=scope.source AND s.scope_id=scope.scope_id
        JOIN properties p ON p.id=s.property_id AND p.status::text='active'
        WHERE scope.channel_id=$3 AND scope.enabled AND scope.verified_at<=now()
          AND scope.source=CASE WHEN r.source='28hse' THEN $4 ELSE 'propertyhk' END
          AND r.source IN ('28hse','propertyhk') AND scope.scope_id=r.scope_id AND s.external_listing_id=r.external_listing_id
          AND s.deal_type::text=r.deal_type AND s.property_id=r.property_id AND s.source_status='active' AND s.last_accepted_at>=now()-interval '30 days')) AS verified
      FROM whatsapp_enquiry_reference_links r WHERE r.inquiry_id=$1::uuid AND r.event_id=$2::uuid ORDER BY r.ref_index`,
            [input.subjectId, inquiry.event_id, channelId, SOURCE_28HSE],
          )
        : [];
    if (references.length) {
      specific = true;
      if (references.length !== 1 || references[0].verified !== true) review = true;
      else {
        const reference = references[0];
        if (requestedPropertyId && requestedPropertyId !== reference.property_id) review = true;
        requestedPropertyId = string(reference.property_id);
        requestedDeal = string(reference.deal_type);
      }
    }
    if (inquiry.attribution_method === "reference") {
      specific = true;
      if (
        !uuid(snapshot.propertyId) ||
        (requestedPropertyId && requestedPropertyId !== snapshot.propertyId.toLowerCase()) ||
        inquiry.association_review === true
      )
        review = true;
      else requestedPropertyId = snapshot.propertyId.toLowerCase();
      requestedDeal = string(snapshot.dealType) ?? requestedDeal;
    }
    if (
      !requestedPropertyId &&
      !references.length &&
      !review &&
      !inquiry.link_open_id &&
      mentionsSpecificProperty(message)
    ) {
      const offers = await query(enquiryTextOfferingSql("$1"), [message]);
      if (
        offers.length === 1 &&
        (!requestedNo || requestedNo.toUpperCase() === offers[0].public_listing_no)
      ) {
        requestedPropertyId = string(offers[0].id);
        requestedNo = string(offers[0].public_listing_no);
      }
    }
    specific ||= Boolean(requestedPropertyId || requestedNo);
  }
  specific ||= mentionsSpecificProperty(message);
  const target = uuid(requestedPropertyId) ? await property(query, requestedPropertyId) : null;
  if (
    target &&
    requestedNo &&
    ![target.raw.public_listing_no, target.raw.listing_no, target.raw.canonical_property_no].some(
      (no) => typeof no === "string" && no.trim().toUpperCase() === requestedNo?.toUpperCase(),
    )
  )
    review = true;
  if (target && requestedDeal && requestedDeal !== target.value.dealType) review = true;
  const [copy] = await query("SELECT phone FROM enquiry_forwarding_copy_contact()");
  const plan = planEnquiryRouting({
    copyPhone: string(copy?.phone),
    specific,
    property: target?.value ?? null,
    selectedStaffId,
    agents: target?.agents ?? [],
    legacyAgent: target?.legacyAgent ?? null,
    review,
    estateLabel: estateLabel ?? (estateId ? null : formEstateLabel),
    estateId,
    text: formEstateLabel ? `${formEstateLabel}\n${message}` : message,
    routes: await enquiryEstateRoutes(query),
  });
  return {
    ...plan,
    source: input.source,
    subjectId: input.subjectId,
    createdAt: stamp(subject.forwarding_created_at ?? subject.created_at),
    customerName: string(subject.customer_name),
    customerPhone: string(subject.customer_phone),
    summary: message,
    customerMessage: text(
      input.source === "website" ? subject.inquiry_message : subject.intake_text,
    ),
    ...(channelId ? { channelId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
  } as EnquiryForwardingPlan;
}
