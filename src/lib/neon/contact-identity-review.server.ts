import "@tanstack/react-start/server-only";

import { queryRows, transactionRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import { isOptOutText } from "../woztell/woztell.server.ts";
import {
  CONFLICT_ACTIONS,
  DUPLICATE_ACTIONS,
  type IdentityReviewAction,
  type IdentityReviewContact,
  type IdentityReviewPage,
  type IdentityReviewReason,
  type IdentityReviewResolution,
  type IdentityReviewRow,
  type IdentityReviewStatus,
} from "./contact-identity-review.types.ts";

export type {
  IdentityReviewAction,
  IdentityReviewContact,
  IdentityReviewReason,
  IdentityReviewRow,
} from "./contact-identity-review.types.ts";

const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f-]{36})$/i;
const ACTIONS: readonly IdentityReviewAction[] = [...CONFLICT_ACTIONS, ...DUPLICATE_ACTIONS];

/** Fix-plan access rule: the list, the count and every resolution are admin/manager only. */
function requireReviewer(actor: Pick<StaffAccess, "roles"> | null | undefined) {
  if (!actor || !actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
}
const fail = (status: number, code: string) => new Response(code, { status });

/** A contact as the list shows it. Only the last four digits of a phone ever leave SQL. */
const contactJson = (column: string) => `(SELECT jsonb_build_object(
    'id',c.id,'name',NULLIF(btrim(c.name),''),
    'last4',right(regexp_replace(COALESCE(c.normalized_phone,c.phone,''),'[^0-9]','','g'),4),
    'hasWhatsapp',c.whatsapp_member_id IS NOT NULL,
    'optedOut',COALESCE(c.opted_out_whatsapp,false),
    'openLeadIds',COALESCE((SELECT jsonb_agg(l.id ORDER BY l.created_at DESC,l.id) FROM (
      SELECT ol.id,ol.created_at FROM crm_leads ol WHERE ol.contact_id=c.id
        AND ol.stage NOT IN ('closed_won','closed_lost') ORDER BY ol.created_at DESC,ol.id LIMIT 5) l),'[]'::jsonb),
    'leadCount',(SELECT count(*)::int FROM crm_leads al WHERE al.contact_id=c.id))
  FROM crm_contacts c WHERE c.id=${column})`;

function toContact(value: unknown): IdentityReviewContact | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const last4 = typeof v.last4 === "string" ? v.last4 : "";
  return {
    id: String(v.id),
    name: typeof v.name === "string" ? v.name : null,
    maskedPhone: /^\d{4}$/.test(last4) ? `•••• ${last4}` : null,
    hasWhatsapp: v.hasWhatsapp === true,
    optedOut: v.optedOut === true,
    openLeadIds: Array.isArray(v.openLeadIds) ? v.openLeadIds.map(String) : [],
    leadCount: Number(v.leadCount ?? 0),
  };
}
const iso = (value: unknown) =>
  value === null || value === undefined ? null : new Date(value as string).toISOString();

export async function listContactIdentityReviews(
  input: { status: "open" | "resolved"; cursor?: string | null },
  actor: StaffAccess,
): Promise<IdentityReviewPage> {
  requireReviewer(actor);
  if (input?.status !== "open" && input?.status !== "resolved") throw fail(400, "VALIDATION_ERROR");
  const cursor = input.cursor ? CURSOR.exec(input.cursor) : null;
  if (input.cursor && !cursor) throw fail(400, "VALIDATION_ERROR");
  const rows = await queryRows(
    `WITH page AS (
       SELECT r.*,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
       FROM crm_contact_identity_reviews r
       WHERE (CASE WHEN $1::text='open' THEN r.status='open' ELSE r.status<>'open' END)
         AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid))
       ORDER BY r.created_at DESC,r.id DESC LIMIT $4::int)
     SELECT p.id,p.reason,p.status,p.conversation_id,p.created_at,p.resolved_at,p.resolution_note,
       p.cursor_at,COALESCE((p.evidence->>'messageCount')::int,0) AS message_count,
       p.evidence->>'lastMessageAt' AS last_message_at,
       COALESCE(NULLIF(s.name_zh,''),NULLIF(s.name_en,'')) AS resolved_by_name,
       ${contactJson("p.contact_a")} AS a,${contactJson("p.contact_b")} AS b,
       (SELECT count(*)::int FROM crm_contact_identity_reviews o WHERE o.status='open') AS open_count
     FROM page p LEFT JOIN staff_users s ON s.id=p.resolved_by
     ORDER BY p.created_at DESC,p.id DESC`,
    [input.status, cursor?.[1] ?? null, cursor?.[2] ?? null, PAGE_SIZE + 1],
  );
  let openCount = Number(rows[0]?.open_count ?? NaN);
  if (!Number.isFinite(openCount))
    openCount = Number(
      (
        await queryRows(
          "SELECT count(*)::int AS n FROM crm_contact_identity_reviews WHERE status='open'",
        )
      )[0]?.n ?? 0,
    );
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page.map(
      (row): IdentityReviewRow => ({
        id: String(row.id),
        reason: row.reason as IdentityReviewReason,
        status: row.status as IdentityReviewStatus,
        a: toContact(row.a),
        b: toContact(row.b),
        conversationId: row.conversation_id ? String(row.conversation_id) : null,
        messageCount: Number(row.message_count ?? 0),
        lastMessageAt: iso(row.last_message_at),
        createdAt: iso(row.created_at) ?? "",
        resolvedAt: iso(row.resolved_at),
        resolvedByName: row.resolved_by_name ? String(row.resolved_by_name) : null,
        note: row.resolution_note ? String(row.resolution_note) : null,
      }),
    ),
    nextCursor: rows.length > PAGE_SIZE && last ? `${last.cursor_at}|${last.id}` : null,
    openCount,
  };
}

type ReviewState = {
  id: string;
  reason: IdentityReviewReason;
  status: IdentityReviewStatus;
  contact_a: string | null;
  contact_b: string | null;
  conversation_id: string | null;
  stop_received: boolean;
  /** Exact microsecond updated_at. Ingest bumps it on every stored message or opt-out. */
  version: string;
};
const readReview = async (id: string) =>
  (
    await queryRows<ReviewState>(
      `SELECT id,reason,status,contact_a,contact_b,conversation_id,
         COALESCE((evidence->>'stopReceived')::boolean,false) AS stop_received,
         to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version
       FROM crm_contact_identity_reviews WHERE id=$1::uuid`,
      [id],
    )
  )[0] ?? null;

function actionAllowed(review: ReviewState, action: IdentityReviewAction) {
  if (review.reason === "phone_format_duplicate") return DUPLICATE_ACTIONS.includes(action);
  if (action === "link_a") return review.contact_a !== null;
  if (action === "link_b") return review.contact_b !== null;
  return action === "link_new";
}

/** 404, then 400 (the action does not fit), then 409 (not open). Null: open and allowed. */
function refusalFor(review: ReviewState | null, action: IdentityReviewAction) {
  if (!review) return fail(404, "Not found");
  if (!actionAllowed(review, action)) return fail(400, "REVIEW_ACTION_NOT_ALLOWED");
  if (review.status !== "open") return fail(409, "REVIEW_ALREADY_RESOLVED");
  return null;
}

type StopMessage = { id: string; externalId: string; text: string; at: string };
/**
 * The newest unlinked inbound message in the conversation that the D4 classifier (the same
 * isOptOutText ingest uses) calls a STOP. Every unlinked message is checked; the length filter
 * only skips texts far longer than any opt-out word could be after normalisation.
 */
async function findStop(conversationId: string): Promise<StopMessage | null> {
  const candidates = await queryRows<{
    id: string;
    external_message_id: string;
    text: string;
    at: string;
  }>(
    `SELECT id,external_message_id,text,
       to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
     FROM whatsapp_messages WHERE conversation_id=$1::uuid AND contact_id IS NULL
       AND direction::text='inbound' AND external_message_id IS NOT NULL
       AND text IS NOT NULL AND char_length(text)<=256
     ORDER BY created_at DESC,id DESC`,
    [conversationId],
  );
  const found = candidates.find((message) => isOptOutText(message.text));
  return found
    ? { id: found.id, externalId: found.external_message_id, text: found.text, at: found.at }
    : null;
}

/**
 * The FX-08 opt-out assignments for the contact a manager links a review conversation to.
 *  - d.nso: a STOP stored in the conversation ($4 message id, $5 text, $6 time), as
 *    'customer_message'. The same rules as ingest's OPT_OUT_ASSIGNMENTS: newer evidence wins
 *    and a new episode resets clears.
 *  - d.nsr: a STOP the review recorded whose message can no longer be found, as
 *    'staff_recorded' at the link time. The same rules as recording 拒收推廣 by hand: a new
 *    episode at now(), an already opted-out contact keeps its earlier message evidence, and
 *    marketing consent is withdrawn.
 * d.nso and d.nsr never both hold.
 */
const LINK_OPT_OUT_OR_STAFF_RECORDED = `opted_out_whatsapp=CASE WHEN d.nsr THEN true ELSE COALESCE(x.opted_out_whatsapp,false) OR d.nso END,
      opt_in_whatsapp=CASE WHEN d.nsr THEN false ELSE x.opt_in_whatsapp END,
      opted_out_at=CASE WHEN d.nsr THEN now() WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN $6::timestamptz ELSE x.opted_out_at END,
      opted_out_message_id=CASE WHEN d.nsr THEN CASE WHEN x.opted_out_whatsapp THEN x.opted_out_message_id END WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN $4::text ELSE x.opted_out_message_id END,
      opted_out_text=CASE WHEN d.nsr THEN CASE WHEN x.opted_out_whatsapp THEN x.opted_out_text END WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN left($5::text,500) ELSE x.opted_out_text END,
      opted_out_source=CASE WHEN d.nsr THEN 'staff_recorded' WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN 'customer_message' ELSE x.opted_out_source END,
      opted_out_cleared_at=CASE WHEN d.nsr OR (d.nso AND NOT COALESCE(x.opted_out_whatsapp,false)) THEN NULL ELSE x.opted_out_cleared_at END,
      opted_out_cleared_by=CASE WHEN d.nsr OR (d.nso AND NOT COALESCE(x.opted_out_whatsapp,false)) THEN NULL ELSE x.opted_out_cleared_by END`;

/** How often a resolve re-reads after the review changed under it (a new message). */
const MAX_ATTEMPTS = 3;

export type ResolveHooks = {
  /** Test seam: runs after the pre-read and before the locked transaction. */
  afterRead?: () => Promise<void>;
};

/**
 * Lock the member (as ingest does) and the chosen contact's lead key (as the FX-09 trigger does),
 * then one statement: the review FOR UPDATE WHERE status='open' AND updated_at is the version
 * read just before, apply, and write one audit_logs row in the same CTE. A message (or a STOP)
 * stored after the pre-read changes updated_at, so the statement writes nothing and the resolve
 * re-reads: a STOP is never linked past.
 *  - link_a / link_b / link_new: the conversation and every NULL-contact message move to the
 *    chosen contact. Lead and conversation rules mirror a new inbound message (FX-09
 *    20261009110000): a contact with no lead gets its first lead from the trigger's UPDATE path;
 *    a contact whose leads are all closed gets a new lead when the newest reattached inbound
 *    message is newer than its latest close, or the link reopened the conversation; a closed
 *    conversation reopens when that message is at least as new as its last inbound. The owner
 *    is kept only while active. No job is queued (the trigger queues none either).
 *  - The chosen contact's member id is filled only when blank and free. link_new inserts a
 *    contact with the WhatsApp profile name (or NULL), the member when free, source 'whatsapp'
 *    and opt_in_whatsapp=false: never a phone or consent.
 *  - A live STOP stored in the conversation (evidence.stopReceived) opts the chosen contact out
 *    with FX-08 'customer_message' evidence. If the STOP message can no longer be found, the
 *    link still goes ahead and the chosen contact is opted out as FX-08 'staff_recorded' at the
 *    link time (FX-08's source for an opt-out with no message), with a crm_consent_events row
 *    whose evidence_ref names the review and the audit's optOutSource, so a STOP is never
 *    linked past.
 *  - The audit records what a link changed, so a wrong link can be reversed by hand (FX-18
 *    owns a real undo): the linked and previous contact, the reattached message ids, member
 *    fill, opt-out (by internal message id), lead opened and conversation reopened. No phone
 *    and no message text.
 *  - same_person / different_people / dismiss change only the review row. Nothing is merged.
 */
export async function resolveContactIdentityReview(
  input: { id: string; action: IdentityReviewAction; note?: string | null },
  actor: StaffAccess,
  hooks: ResolveHooks = {},
): Promise<IdentityReviewResolution> {
  requireReviewer(actor);
  if (!input || typeof input.id !== "string" || !UUID.test(input.id))
    throw fail(400, "VALIDATION_ERROR");
  if (!ACTIONS.includes(input.action)) throw fail(400, "VALIDATION_ERROR");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;
  const link = CONFLICT_ACTIONS.includes(input.action);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const review = await readReview(input.id);
    const refused = refusalFor(review, input.action);
    if (refused || !review) throw refused;

    let stop: StopMessage | null = null;
    if (link && review.stop_received && review.conversation_id)
      stop = await findStop(review.conversation_id);
    // A recorded STOP whose message is gone: opt out as staff_recorded instead of refusing.
    const staffRecordedStop = link && review.stop_received && !stop;
    await hooks.afterRead?.();
    const chosenKnown =
      input.action === "link_a"
        ? review.contact_a
        : input.action === "link_b"
          ? review.contact_b
          : null;

    const [, , result] = await transactionRows([
      {
        statement: `SELECT pg_advisory_xact_lock(hashtextextended('woztell-member:'||wc.woztell_member_id,0))
          FROM crm_contact_identity_reviews r JOIN whatsapp_conversations wc ON wc.id=r.conversation_id
          WHERE r.id=$1::uuid AND wc.woztell_member_id IS NOT NULL AND $2::text LIKE 'link\\_%'`,
        params: [input.id, input.action],
      },
      {
        statement: `SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-lead:'||$1::text,0))
          WHERE $1::uuid IS NOT NULL`,
        params: [chosenKnown],
      },
      {
        statement: `WITH target AS (
        SELECT r.* FROM crm_contact_identity_reviews r
        WHERE r.id=$1::uuid AND r.status='open' AND r.updated_at=$8::timestamptz AND (
          (r.reason='whatsapp_identity_conflict' AND ($2::text='link_new'
            OR ($2::text='link_a' AND r.contact_a IS NOT NULL)
            OR ($2::text='link_b' AND r.contact_b IS NOT NULL))
            AND (NOT COALESCE((r.evidence->>'stopReceived')::boolean,false) OR $4::text IS NOT NULL
              OR $10::boolean))
          OR (r.reason='phone_format_duplicate' AND $2::text IN ('same_person','different_people','dismiss')))
        FOR UPDATE
      ), conv AS (
        SELECT wc.id,wc.woztell_member_id,wc.contact_id AS previous_contact_id,wc.status,wc.last_inbound_at
        FROM whatsapp_conversations wc
        JOIN target t ON wc.id=t.conversation_id AND t.reason='whatsapp_identity_conflict'
      ), member_free AS (
        SELECT conv.woztell_member_id AS member FROM conv WHERE conv.woztell_member_id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM crm_contacts o WHERE o.whatsapp_member_id=conv.woztell_member_id)
      ), stop AS (
        SELECT COALESCE((t.evidence->>'stopReceived')::boolean,false) AND $4::text IS NOT NULL AS yes,
          COALESCE((t.evidence->>'stopReceived')::boolean,false) AND $4::text IS NULL
            AND $10::boolean AS staff
        FROM target t
      ), unlinked AS (
        SELECT m.id,m.created_at,m.direction::text AS direction,m.payload FROM whatsapp_messages m
        JOIN conv ON m.conversation_id=conv.id WHERE m.contact_id IS NULL
      ), newest AS (
        SELECT max(created_at) AS at FROM unlinked WHERE direction='inbound'
      ), profile AS (
        SELECT NULLIF(btrim(COALESCE(u.payload->'memberExtra'->>'name',
          u.payload->'messageEvent'->'memberExtra'->>'name')),'') AS name
        FROM unlinked u WHERE u.direction='inbound'
        ORDER BY u.created_at DESC,u.id DESC LIMIT 1
      ), new_contact AS (
        INSERT INTO crm_contacts(name,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp,
          opted_out_at,opted_out_message_id,opted_out_text,opted_out_source)
        SELECT (SELECT name FROM profile),(SELECT member FROM member_free),'whatsapp',false,
          s.yes OR s.staff,
          CASE WHEN s.yes THEN $6::timestamptz WHEN s.staff THEN now() END,
          CASE WHEN s.yes THEN $4::text END,CASE WHEN s.yes THEN left($5::text,500) END,
          CASE WHEN s.yes THEN 'customer_message' WHEN s.staff THEN 'staff_recorded' END
        FROM conv,stop s WHERE $2::text='link_new'
        RETURNING id,whatsapp_member_id IS NOT NULL AS member_filled,opted_out_whatsapp AS opted_out,
          opted_out_source AS opt_out_source
      ), chosen AS (
        SELECT CASE WHEN $2::text='link_a' THEN t.contact_a ELSE t.contact_b END AS id
        FROM target t, conv WHERE $2::text IN ('link_a','link_b')
        UNION ALL SELECT id FROM new_contact
      ), lead_state AS (
        -- The chosen contact's leads before the link, read as the FX-09 trigger reads them.
        SELECT c.id AS contact_id,count(l.id)>0 AS has_any,
          COALESCE(bool_or(l.stage NOT IN ('closed_won','closed_lost')),false) AS has_open,
          max(l.updated_at) FILTER (WHERE l.stage IN ('closed_won','closed_lost')) AS latest_closed,
          COALESCE(jsonb_agg(l.id) FILTER (WHERE l.id IS NOT NULL),'[]'::jsonb) AS before_ids
        FROM chosen c LEFT JOIN crm_leads l ON l.contact_id=c.id WHERE c.id IS NOT NULL GROUP BY c.id
      ), decision AS (
        SELECT x.id,
          (s.yes AND x.opted_out_message_id IS DISTINCT FROM $4::text) AS nso,
          s.staff AS nsr,
          (x.whatsapp_member_id IS NULL AND EXISTS(SELECT 1 FROM member_free)) AS fill
        FROM crm_contacts x JOIN chosen c ON c.id=x.id, stop s WHERE $2::text IN ('link_a','link_b')
      ), linked_contact AS (
        UPDATE crm_contacts x SET
          whatsapp_member_id=CASE WHEN d.fill AND x.whatsapp_member_id IS NULL
            THEN (SELECT member FROM member_free) ELSE x.whatsapp_member_id END,
          ${LINK_OPT_OUT_OR_STAFF_RECORDED},
          updated_at=now()
        FROM decision d WHERE x.id=d.id AND (d.nso OR d.nsr OR d.fill)
        RETURNING x.id,
          (d.fill AND x.whatsapp_member_id IS NOT DISTINCT FROM (SELECT member FROM member_free)) AS member_filled,
          d.nso OR d.nsr AS opted_out,
          CASE WHEN d.nsr THEN 'staff_recorded' WHEN d.nso THEN 'customer_message' END AS opt_out_source
      ), staff_recorded_consent AS (
        -- The consent history row a 拒收推廣 record writes, naming this review as the evidence.
        INSERT INTO crm_consent_events(contact_id,opted_in,source,evidence_ref,copy_version,actor_staff_id)
        SELECT o.id,false,'customer_opt_out','identity-review:'||$1::text,'whatsapp-marketing-v1',$3::uuid
        FROM (SELECT id,opt_out_source FROM linked_contact
          UNION ALL SELECT id,opt_out_source FROM new_contact) o
        WHERE o.opt_out_source='staff_recorded'
        RETURNING id
      ), linked_conversation AS (
        -- A closed conversation reopens like it would for a new inbound message (FX-09).
        UPDATE whatsapp_conversations wc SET contact_id=c.id,
          status=CASE WHEN wc.status='closed' AND n.at IS NOT NULL
            AND (wc.last_inbound_at IS NULL OR n.at>=wc.last_inbound_at) THEN 'open' ELSE wc.status END,
          updated_at=now()
        FROM chosen c, conv, newest n WHERE wc.id=conv.id AND c.id IS NOT NULL
        RETURNING wc.id,(conv.status='closed' AND wc.status='open') AS reopened
      ), linked_messages AS (
        -- Reattaches the stored messages. A contact with no lead gets its first lead from the
        -- FX-09 trigger's UPDATE path. No crm_leads row is updated here.
        UPDATE whatsapp_messages m SET contact_id=c.id
        FROM chosen c, conv WHERE m.conversation_id=conv.id AND m.contact_id IS NULL AND c.id IS NOT NULL
        RETURNING m.id,m.created_at
      ), new_lead AS (
        -- FX-09's INSERT-path rule for a contact that has leads but none open: a new lead when
        -- the newest reattached inbound message is newer than the latest close, or the link
        -- reopened the conversation. The owner is kept only while active.
        INSERT INTO crm_leads(contact_id,assigned_agent_id,stage,intent,source,note,created_at,updated_at)
        SELECT c.id,CASE WHEN s.active THEN c.assigned_agent_id END,'new','unknown','whatsapp',
          'WhatsApp 入站查詢；詳情見對話紀錄。',n.at,n.at
        FROM lead_state ls JOIN crm_contacts c ON c.id=ls.contact_id
        LEFT JOIN staff_users s ON s.id=c.assigned_agent_id
        CROSS JOIN newest n CROSS JOIN linked_conversation lc
        WHERE ls.has_any AND NOT ls.has_open AND n.at IS NOT NULL
          AND (n.at>ls.latest_closed OR lc.reopened)
        RETURNING id
      ), resolved AS (
        UPDATE crm_contact_identity_reviews r SET
          status=CASE WHEN $2::text LIKE 'link\\_%' THEN 'linked' WHEN $2::text='dismiss' THEN 'dismissed' ELSE $2::text END,
          linked_contact_id=(SELECT id FROM chosen LIMIT 1),
          resolved_at=now(),resolved_by=$3::uuid,resolution_note=$7::text,updated_at=now()
        FROM target t WHERE r.id=t.id AND ($2::text NOT LIKE 'link\\_%' OR EXISTS(SELECT 1 FROM chosen WHERE id IS NOT NULL))
        RETURNING r.id,r.reason,r.status,r.linked_contact_id
      ), audit AS (
        INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
        SELECT $3::uuid,'contact.identity_review.resolve','crm_contact_identity_review',r.id,
          jsonb_build_object('reviewId',r.id,'reason',r.reason,'action',$2::text)
          || CASE WHEN $2::text LIKE 'link\\_%' THEN jsonb_build_object(
            'linkedContactId',r.linked_contact_id,
            'newContact',EXISTS(SELECT 1 FROM new_contact),
            'conversationId',(SELECT id FROM conv),
            'previousConversationContactId',(SELECT previous_contact_id FROM conv),
            'messagesLinked',(SELECT count(*)::int FROM linked_messages),
            'messageIds',(SELECT COALESCE(jsonb_agg(lm.id ORDER BY lm.created_at,lm.id),'[]'::jsonb)
              FROM (SELECT id,created_at FROM linked_messages ORDER BY created_at,id LIMIT 100) lm),
            'firstMessageId',(SELECT id FROM linked_messages ORDER BY created_at,id LIMIT 1),
            'lastMessageId',(SELECT id FROM linked_messages ORDER BY created_at DESC,id DESC LIMIT 1),
            'memberFilled',COALESCE((SELECT member_filled FROM linked_contact),false)
              OR COALESCE((SELECT member_filled FROM new_contact),false),
            'optOutApplied',COALESCE((SELECT opted_out FROM linked_contact),false)
              OR COALESCE((SELECT opted_out FROM new_contact),false),
            'optOutSource',COALESCE((SELECT opt_out_source FROM linked_contact),
              (SELECT opt_out_source FROM new_contact)),
            'optOutMessageId',CASE WHEN COALESCE((SELECT opted_out FROM linked_contact),false)
              OR COALESCE((SELECT opted_out FROM new_contact),false) THEN $9::uuid END,
            'leadOpenedId',(SELECT id FROM new_lead),
            'leadsBefore',COALESCE((SELECT before_ids FROM lead_state),'[]'::jsonb),
            'conversationReopened',COALESCE((SELECT reopened FROM linked_conversation),false))
          ELSE '{}'::jsonb END
        FROM resolved r RETURNING id
      )
      SELECT r.status,r.linked_contact_id FROM resolved r`,
        params: [
          input.id,
          input.action,
          actor.staffId,
          stop?.externalId ?? null,
          stop?.text ?? null,
          stop?.at ?? null,
          note,
          review.version,
          stop?.id ?? null,
          staffRecordedStop,
        ],
      },
      {
        // The FX-09 trigger opens a first lead after the statement above, so its id is added to
        // the audit here, in the same transaction (now() is the transaction start).
        statement: `UPDATE audit_logs a SET metadata=(a.metadata||jsonb_build_object('leadOpenedId',
            COALESCE(a.metadata->>'leadOpenedId',(SELECT l.id::text FROM crm_leads l
              WHERE l.contact_id=(a.metadata->>'linkedContactId')::uuid
                AND NOT (a.metadata->'leadsBefore') @> to_jsonb(l.id::text)
              ORDER BY l.created_at DESC,l.id DESC LIMIT 1))))-'leadsBefore'
          WHERE a.subject_id=$1::uuid AND a.action='contact.identity_review.resolve'
            AND a.created_at=now() AND a.metadata ? 'linkedContactId'`,
        params: [input.id],
      },
    ]);
    const row = (result as Record<string, unknown>[] | undefined)?.[0];
    if (row)
      return {
        ok: true,
        status: row.status as IdentityReviewStatus,
        linkedContactId: row.linked_contact_id ? String(row.linked_contact_id) : null,
      };
    // Nothing was written. Name why, or re-read when the review changed under us.
    const refusedNow = refusalFor(await readReview(input.id), input.action);
    if (refusedNow) throw refusedNow;
  }
  throw fail(409, "REVIEW_CHANGED");
}
