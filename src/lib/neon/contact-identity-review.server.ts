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
};
const readReview = async (id: string) =>
  (
    await queryRows<ReviewState>(
      `SELECT id,reason,status,contact_a,contact_b,conversation_id,
         COALESCE((evidence->>'stopReceived')::boolean,false) AS stop_received
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

/** Why nothing was written: 404, then 400 (the action does not fit), then 409 (not open). */
async function refusal(id: string, action: IdentityReviewAction) {
  const review = await readReview(id);
  if (!review) return fail(404, "Not found");
  if (!actionAllowed(review, action)) return fail(400, "REVIEW_ACTION_NOT_ALLOWED");
  return fail(409, "REVIEW_ALREADY_RESOLVED");
}

/**
 * The FX-08 opt-out assignments for a STOP stored in the review conversation, applied to the
 * contact a manager links it to ($4 message id, $5 text, $6 time; d.nso = apply it). The same
 * rules as ingest's OPT_OUT_ASSIGNMENTS: newer evidence wins and a new episode resets clears.
 */
const LINK_OPT_OUT = `opted_out_whatsapp=COALESCE(x.opted_out_whatsapp,false) OR d.nso,
      opted_out_at=CASE WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN $6::timestamptz ELSE x.opted_out_at END,
      opted_out_message_id=CASE WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN $4::text ELSE x.opted_out_message_id END,
      opted_out_text=CASE WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN left($5::text,500) ELSE x.opted_out_text END,
      opted_out_source=CASE WHEN d.nso AND (NOT COALESCE(x.opted_out_whatsapp,false) OR x.opted_out_at IS NULL OR $6::timestamptz>x.opted_out_at) THEN 'customer_message' ELSE x.opted_out_source END,
      opted_out_cleared_at=CASE WHEN d.nso AND NOT COALESCE(x.opted_out_whatsapp,false) THEN NULL ELSE x.opted_out_cleared_at END,
      opted_out_cleared_by=CASE WHEN d.nso AND NOT COALESCE(x.opted_out_whatsapp,false) THEN NULL ELSE x.opted_out_cleared_by END`;

/**
 * One statement: lock the review FOR UPDATE WHERE status='open', apply, and write one audit_logs
 * row ('contact.identity_review.resolve', metadata {reviewId, reason, action}; no phone) in the
 * same CTE. A link first takes the member's ingest advisory lock, so no message from that member
 * can be stored with no contact in between.
 *  - link_a / link_b / link_new: the conversation and every NULL-contact message move to the
 *    chosen contact (the FX-09 trigger's UPDATE path opens a first lead only if it has none).
 *    The chosen contact's member id is filled only when it is blank and no other contact holds
 *    the member. link_new inserts a contact with the WhatsApp profile name (or NULL), the member
 *    when free, source 'whatsapp' and opt_in_whatsapp=false: never a phone or consent.
 *  - A live STOP stored in the conversation (evidence.stopReceived) opts the chosen contact out,
 *    with FX-08 evidence, unless that contact already holds this message as its evidence.
 *  - same_person / different_people / dismiss change only the review row. Nothing is merged.
 */
export async function resolveContactIdentityReview(
  input: { id: string; action: IdentityReviewAction; note?: string | null },
  actor: StaffAccess,
): Promise<IdentityReviewResolution> {
  requireReviewer(actor);
  if (!input || typeof input.id !== "string" || !UUID.test(input.id))
    throw fail(400, "VALIDATION_ERROR");
  if (!ACTIONS.includes(input.action)) throw fail(400, "VALIDATION_ERROR");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null;
  const review = await readReview(input.id);
  if (!review) throw fail(404, "Not found");
  if (!actionAllowed(review, input.action)) throw fail(400, "REVIEW_ACTION_NOT_ALLOWED");
  if (review.status !== "open") throw fail(409, "REVIEW_ALREADY_RESOLVED");

  // The STOP itself: the newest stored live-STOP text among the conversation's unlinked messages.
  let stop: { id: string; text: string; at: string } | null = null;
  if (review.stop_received && review.conversation_id && CONFLICT_ACTIONS.includes(input.action)) {
    const candidates = await queryRows<{ external_message_id: string; text: string; at: string }>(
      `SELECT external_message_id,text,
         to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
       FROM whatsapp_messages WHERE conversation_id=$1::uuid AND contact_id IS NULL
         AND direction::text='inbound' AND external_message_id IS NOT NULL
       ORDER BY created_at DESC,id DESC LIMIT 200`,
      [review.conversation_id],
    );
    const found = candidates.find((message) => isOptOutText(message.text));
    if (found) stop = { id: found.external_message_id, text: found.text, at: found.at };
  }

  const [, result] = await transactionRows([
    {
      statement: `SELECT pg_advisory_xact_lock(hashtextextended('woztell-member:'||wc.woztell_member_id,0))
        FROM crm_contact_identity_reviews r JOIN whatsapp_conversations wc ON wc.id=r.conversation_id
        WHERE r.id=$1::uuid AND wc.woztell_member_id IS NOT NULL AND $2::text LIKE 'link\\_%'`,
      params: [input.id, input.action],
    },
    {
      statement: `WITH target AS (
        SELECT r.* FROM crm_contact_identity_reviews r
        WHERE r.id=$1::uuid AND r.status='open' AND (
          (r.reason='whatsapp_identity_conflict' AND ($2::text='link_new'
            OR ($2::text='link_a' AND r.contact_a IS NOT NULL)
            OR ($2::text='link_b' AND r.contact_b IS NOT NULL)))
          OR (r.reason='phone_format_duplicate' AND $2::text IN ('same_person','different_people','dismiss')))
        FOR UPDATE
      ), conv AS (
        SELECT wc.id,wc.woztell_member_id FROM whatsapp_conversations wc
        JOIN target t ON wc.id=t.conversation_id AND t.reason='whatsapp_identity_conflict'
      ), member_free AS (
        SELECT conv.woztell_member_id AS member FROM conv WHERE conv.woztell_member_id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM crm_contacts o WHERE o.whatsapp_member_id=conv.woztell_member_id)
      ), stop AS (
        SELECT COALESCE((t.evidence->>'stopReceived')::boolean,false) AND $4::text IS NOT NULL AS yes
        FROM target t
      ), profile AS (
        SELECT NULLIF(btrim(COALESCE(m.payload->'memberExtra'->>'name',
          m.payload->'messageEvent'->'memberExtra'->>'name')),'') AS name
        FROM whatsapp_messages m JOIN conv ON m.conversation_id=conv.id
        WHERE m.contact_id IS NULL AND m.direction::text='inbound'
        ORDER BY m.created_at DESC,m.id DESC LIMIT 1
      ), new_contact AS (
        INSERT INTO crm_contacts(name,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp,
          opted_out_at,opted_out_message_id,opted_out_text,opted_out_source)
        SELECT (SELECT name FROM profile),(SELECT member FROM member_free),'whatsapp',false,s.yes,
          CASE WHEN s.yes THEN $6::timestamptz END,CASE WHEN s.yes THEN $4::text END,
          CASE WHEN s.yes THEN left($5::text,500) END,CASE WHEN s.yes THEN 'customer_message' END
        FROM conv,stop s WHERE $2::text='link_new'
        RETURNING id
      ), chosen AS (
        SELECT CASE WHEN $2::text='link_a' THEN t.contact_a ELSE t.contact_b END AS id
        FROM target t, conv WHERE $2::text IN ('link_a','link_b')
        UNION ALL SELECT id FROM new_contact
      ), decision AS (
        SELECT x.id,
          (s.yes AND x.opted_out_message_id IS DISTINCT FROM $4::text) AS nso,
          (x.whatsapp_member_id IS NULL AND EXISTS(SELECT 1 FROM member_free)) AS fill
        FROM crm_contacts x JOIN chosen c ON c.id=x.id, stop s WHERE $2::text IN ('link_a','link_b')
      ), linked_contact AS (
        UPDATE crm_contacts x SET
          whatsapp_member_id=CASE WHEN d.fill THEN (SELECT member FROM member_free) ELSE x.whatsapp_member_id END,
          ${LINK_OPT_OUT},
          updated_at=now()
        FROM decision d WHERE x.id=d.id AND (d.nso OR d.fill)
        RETURNING x.id
      ), linked_conversation AS (
        UPDATE whatsapp_conversations wc SET contact_id=c.id,updated_at=now()
        FROM chosen c, conv WHERE wc.id=conv.id AND c.id IS NOT NULL RETURNING wc.id
      ), linked_messages AS (
        -- Reattaches the stored messages. The FX-09 trigger's UPDATE path opens a first lead for
        -- the chosen contact only if it has none. No crm_leads row is updated here.
        UPDATE whatsapp_messages m SET contact_id=c.id
        FROM chosen c, conv WHERE m.conversation_id=conv.id AND m.contact_id IS NULL AND c.id IS NOT NULL
        RETURNING m.id
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
        FROM resolved r RETURNING id
      )
      SELECT r.status,r.linked_contact_id,
        (SELECT count(*)::int FROM linked_messages) AS linked_messages,
        (SELECT count(*)::int FROM linked_contact) AS contact_writes,
        (SELECT count(*)::int FROM linked_conversation) AS linked_conversations,
        (SELECT count(*)::int FROM audit) AS audits
      FROM resolved r`,
      params: [
        input.id,
        input.action,
        actor.staffId,
        stop?.id ?? null,
        stop?.text ?? null,
        stop?.at ?? null,
        note,
      ],
    },
  ]);
  const row = (result as Record<string, unknown>[] | undefined)?.[0];
  if (!row) throw await refusal(input.id, input.action);
  return {
    ok: true,
    status: row.status as IdentityReviewStatus,
    linkedContactId: row.linked_contact_id ? String(row.linked_contact_id) : null,
  };
}
