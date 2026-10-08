import type { StaffAccess } from "./auth.server";
import {
  decodeAdminCursor,
  pageBinding,
  parseAdminPageInput,
  type AdminPageInput,
  type AdminPageResource,
} from "./admin-pagination.ts";
import { identityReviewOpenSql } from "../woztell/identity-review-sql.ts";
const CMS_TABLES = {
  estates: "estates",
  articles: "articles",
  videos: "cms_videos",
  faqs: "faqs",
  media: "media_assets",
};
/** All client filters are bound values. Tables, columns and ordering are fixed here. */
export function buildAdminPageQuery(
  raw: AdminPageInput,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  _options: { enquiries?: boolean } = {},
) {
  if (!actor || !actor.roles.some((role) => ["admin", "manager", "agent"].includes(role)))
    throw Error("FORBIDDEN");
  const input = parseAdminPageInput(raw);
  const scope = actor.roles.some((role) => role === "admin" || role === "manager")
    ? null
    : actor.staffId;
  const params: unknown[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const own = param(actor.staffId);
  // The unfiltered inbox can page authorized conversation IDs before joining per-row details.
  const fastConversationPage =
    input.resource === "conversations" &&
    !input.q?.trim() &&
    (!input.status || input.status === "all");
  let source = "";
  if (input.resource === "leads")
    source = `SELECT to_jsonb(item)-'page_at' AS row,item.page_at,item.id FROM (SELECT l.id,l.stage,l.intent,l.budget_min,l.budget_max,l.source,l.note,l.created_at,l.assigned_agent_id,c.name,c.phone,c.email,c.opt_in_whatsapp,p.listing_no,p.title_zh AS property_title,l.created_at AS page_at FROM crm_leads l LEFT JOIN crm_contacts c ON c.id=l.contact_id LEFT JOIN properties p ON p.id=l.property_id WHERE ${scope ? `l.assigned_agent_id=${own}::uuid` : "true"}) item`;
  else if (input.resource === "contacts")
    source = `SELECT to_jsonb(item)-'page_at' AS row,item.page_at,item.id FROM (SELECT c.id,c.name,c.phone,c.email,c.opt_in_whatsapp,c.opted_out_whatsapp,c.created_at AS page_at FROM crm_contacts c WHERE ${scope ? `(EXISTS(SELECT 1 FROM crm_leads l WHERE l.contact_id=c.id AND l.assigned_agent_id=${own}::uuid) OR EXISTS(SELECT 1 FROM whatsapp_conversations w WHERE w.contact_id=c.id AND w.assigned_agent_id=${own}::uuid))` : "true"}) item`;
  else if (input.resource === "conversations")
    source = `SELECT to_jsonb(item)-'page_at' AS row,item.page_at,item.id FROM (
      SELECT w.id,w.status,w.assigned_agent_id,w.last_message_at,w.last_inbound_at,
        c.name,c.phone,c.opted_out_whatsapp,m.text AS last_text,m.direction AS last_direction,
        COALESCE(w.last_message_at,w.created_at) AS page_at,
        COALESCE(NULLIF(c.name,''),NULLIF(c.phone,''),'WhatsApp 客戶') AS customer_display_name,
        i.public_listing_no,COALESCE(rl.source,i.placement_source,'unknown') AS source_label,
        rl.external_listing_id,
        COALESCE(NULLIF(requested.name_zh,''),NULLIF(requested.name_en,'')) AS requested_staff_name,
        CASE WHEN wa_can_reply_enquiry(${own}::uuid,i.id) THEN
          COALESCE(NULLIF(owner.name_zh,''),NULLIF(owner.name_en,'')) END AS confirmed_owner_name,
        CASE WHEN EXISTS(SELECT 1 FROM inquiries active_i WHERE active_i.conversation_id=w.id
          AND active_i.source='whatsapp' AND active_i.status NOT IN ('closed','resolved','spam'))
          THEN EXISTS(SELECT 1 FROM inquiries awaiting_i WHERE awaiting_i.conversation_id=w.id
            AND awaiting_i.source='whatsapp' AND awaiting_i.status NOT IN ('closed','resolved','spam')
            AND awaiting_i.first_human_response_at IS NULL)
          ELSE COALESCE(m.direction::text='inbound',false) END AS awaiting_human_response,
        EXISTS(SELECT 1 FROM inquiries review_i WHERE review_i.conversation_id=w.id
          AND review_i.source='whatsapp' AND review_i.status NOT IN ('closed','resolved','spam')
          AND (review_i.association_review OR review_i.provider_thread_review)) AS association_review,
        -- FX-12: a 「身分待核對」 conversation. Every reader of the row sees the flag (the assigned
        -- agent too); only managers can open the review itself.
        ${identityReviewOpenSql("w.id")} AS identity_review,
        (SELECT idr.id FROM crm_contact_identity_reviews idr WHERE idr.conversation_id=w.id
          AND idr.reason='whatsapp_identity_conflict' AND idr.status='open' LIMIT 1) AS identity_review_id,
        CASE WHEN ${identityReviewOpenSql("w.id")} THEN 'review'
          WHEN i.association_review OR i.provider_thread_review THEN 'review'
          WHEN i.id IS NOT NULL AND i.first_human_response_at IS NULL THEN 'reply'
          WHEN w.assigned_agent_id IS NULL THEN 'triage'
          ELSE 'follow_up' END AS next_action,
        jsonb_build_object('canReply',COALESCE(wa_can_reply_enquiry(${own}::uuid,i.id),false),
          'canCorrect',COALESCE(wa_can_correct_enquiry(${own}::uuid,i.id),false)) AS capabilities
      FROM whatsapp_conversations w
      LEFT JOIN crm_contacts c ON c.id=w.contact_id
      LEFT JOIN LATERAL (SELECT text,direction FROM whatsapp_messages
        WHERE conversation_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1) m ON true
      LEFT JOIN LATERAL (SELECT * FROM inquiries WHERE conversation_id=w.id AND source='whatsapp'
        AND status NOT IN ('closed','resolved','spam') ORDER BY updated_at DESC,id DESC LIMIT 1) i ON true
      LEFT JOIN LATERAL (SELECT source,external_listing_id FROM whatsapp_enquiry_reference_links
        WHERE inquiry_id=i.id ORDER BY created_at DESC,event_id DESC,ref_index DESC LIMIT 1) rl ON true
      LEFT JOIN staff_users requested ON requested.id=i.requested_staff_id
      LEFT JOIN staff_users owner ON owner.id=i.enquiry_owner_staff_id
      WHERE ${scope ? `w.assigned_agent_id=${own}::uuid AND ` : ""}wa_can_read_conversation(${own}::uuid,w.id)
        ${fastConversationPage ? "AND w.id IN (SELECT id FROM page)" : ""}
    ) item`;
  else if (input.resource === "messages")
    source = `SELECT to_jsonb(item)-'page_at' AS row,item.page_at,item.id FROM (SELECT m.id,m.direction,m.message_type,m.text,m.status,m.error,to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,m.created_at AS page_at FROM whatsapp_messages m JOIN whatsapp_conversations w ON w.id=m.conversation_id WHERE w.id=${param(input.conversationId)}::uuid ${input.messageIds ? `AND m.id=ANY(${param(input.messageIds)}::uuid[])` : ""} AND ${scope ? `w.assigned_agent_id=${own}::uuid AND ` : ""}wa_can_read_conversation(${own}::uuid,w.id)) item`;
  else {
    const table = CMS_TABLES[input.resource];
    const time = "created_at";
    // Private actor drafts override their corresponding live rows and include draft-only resources.
    if (input.resource === "estates" || input.resource === "articles") {
      const kind = input.resource === "estates" ? "estate" : "article";
      source = `WITH actor_drafts AS (SELECT DISTINCT ON(resource_id) * FROM cms_content_revisions WHERE resource_type='${kind}' AND state='draft' AND draft_retired_at IS NULL AND created_by=${own}::uuid ORDER BY resource_id,version_number DESC)
    SELECT to_jsonb(c) AS row,c.${time} AS page_at,c.id FROM ${table} c WHERE NOT EXISTS(SELECT 1 FROM actor_drafts d WHERE d.resource_id=c.id)
    UNION ALL SELECT d.payload||jsonb_build_object('id',d.resource_id,'is_draft',true,'draft_revision_id',d.id,'draft_version',d.version_number) AS row,COALESCE((SELECT live.created_at FROM ${table} live WHERE live.id=d.resource_id),d.browse_created_at) AS page_at,d.resource_id AS id FROM actor_drafts d`;
    } else
      source = `SELECT to_jsonb(c) AS row,c.${time} AS page_at,c.id FROM ${table} c${input.resource === "media" ? " WHERE c.archived_at IS NULL" : ""}`;
  }
  const filters: string[] = [`${own}::uuid IS NOT NULL`];
  const equal = (key: string, value: unknown) => {
    if (value && value !== "all") filters.push(`row->>'${key}'=${param(value)}`);
  };
  if (input.resource === "leads" && input.stage === "open")
    filters.push("row->>'stage' NOT IN ('closed_won','closed_lost')");
  else equal("stage", input.stage);
  equal("intent", input.intent);
  equal("source", input.source);
  equal("scope", input.scope);
  if (input.resource === "conversations") {
    if (input.status === "awaiting")
      filters.push("(row->>'awaiting_human_response')::boolean IS TRUE");
    else if (input.status === "attention")
      filters.push(
        "((row->>'association_review')::boolean IS TRUE OR (row->>'awaiting_human_response')::boolean IS TRUE)",
      );
    else if (input.status === "unassigned") filters.push("row->>'assigned_agent_id' IS NULL");
    else if (input.status === "mine") filters.push(`row->>'assigned_agent_id'=${own}::text`);
    else equal("status", input.status);
  } else equal("status", input.status);
  if (input.agentId === "unassigned") filters.push("row->>'assigned_agent_id' IS NULL");
  else equal("assigned_agent_id", input.agentId);
  if (input.optIn === "yes") filters.push("(row->>'opt_in_whatsapp')::boolean IS TRUE");
  if (input.optIn === "no") filters.push("(row->>'opt_in_whatsapp')::boolean IS NOT TRUE");
  if (input.q?.trim()) {
    const fields: Record<AdminPageResource, string[]> = {
      leads: [
        "name",
        "phone",
        "email",
        "intent",
        "source",
        "note",
        "listing_no",
        "property_title",
        "stage",
      ],
      contacts: ["name", "phone", "email"],
      conversations: ["name", "phone", "last_text", "public_listing_no", "external_listing_id"],
      messages: ["text"],
      estates: ["slug", "name_zh", "name_en", "district_slug", "developer"],
      articles: ["title", "slug", "excerpt", "content"],
      videos: ["title", "description", "video_url"],
      faqs: ["scope", "question", "answer"],
      media: ["pathname", "alt_text", "owner_id"],
    };
    const needle = param("%" + input.q.trim().replace(/[\\%_]/g, "\\$&") + "%");
    const fieldMatches = fields[input.resource]
      .map((field) => `COALESCE(row->>'${field}','') ILIKE ${needle}`)
      .join(" OR ");
    const relatedMatches =
      input.resource === "conversations"
        ? ` OR EXISTS(SELECT 1 FROM whatsapp_messages search_message
          WHERE search_message.conversation_id=(row->>'id')::uuid AND search_message.text ILIKE ${needle})
          OR EXISTS(SELECT 1 FROM whatsapp_enquiry_reference_links search_ref
          WHERE search_ref.conversation_id=(row->>'id')::uuid AND
            (search_ref.external_listing_id ILIKE ${needle} OR
             EXISTS(SELECT 1 FROM inquiries search_inquiry WHERE search_inquiry.id=search_ref.inquiry_id
               AND search_inquiry.public_listing_no ILIKE ${needle})))`
        : "";
    filters.push(`(${fieldMatches}${relatedMatches})`);
  }
  const binding = pageBinding(
    input,
    actor.staffId +
      ":" +
      (["conversations", "messages"].includes(input.resource) ? "wa-acl" : scope ? "own" : "all"),
  );
  const cursor = input.cursor ? decodeAdminCursor(input.cursor, binding) : null;
  const ascending = input.resource === "messages" && input.direction === "newer";
  const boundary = cursor
    ? `WHERE (page_at,id) ${ascending ? ">" : "<"} (${param(cursor.at)}::timestamptz,${param(cursor.id)}::uuid)`
    : "";
  const limit = param(input.limit + 1);
  const order = ascending ? "ASC" : "DESC";
  const statement = fastConversationPage
    ? `WITH scoped AS NOT MATERIALIZED (SELECT w.id,COALESCE(w.last_message_at,w.created_at) AS page_at FROM whatsapp_conversations w WHERE ${scope ? `w.assigned_agent_id=${own}::uuid AND ` : ""}wa_can_read_conversation(${own}::uuid,w.id)), page AS MATERIALIZED (SELECT id,page_at FROM scoped ${boundary} ORDER BY page_at DESC,id DESC LIMIT ${limit}), authorized AS NOT MATERIALIZED (${source}) SELECT COALESCE((SELECT jsonb_agg(row||jsonb_build_object('_cursor_at',to_char(page_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY page_at DESC,id DESC) FROM authorized),'[]'::jsonb) AS rows,(SELECT count(*)::int FROM scoped) AS total`
    : `WITH authorized AS NOT MATERIALIZED (${source}), filtered AS NOT MATERIALIZED (SELECT * FROM authorized ${filters.length ? "WHERE " + filters.join(" AND ") : ""}), page AS (SELECT row,page_at,id FROM filtered ${boundary} ORDER BY page_at ${order},id ${order} LIMIT ${limit}) SELECT COALESCE((SELECT jsonb_agg(row||jsonb_build_object('_cursor_at',to_char(page_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY page_at ${order},id ${order}) FROM page),'[]'::jsonb) AS rows,(SELECT count(*)::int FROM filtered) AS total`;
  return { statement, params, input, binding, ascending };
}
