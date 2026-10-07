import "@tanstack/react-start/server-only";
import { z } from "zod";
import { isOptOutNearMiss, isOptOutText } from "../woztell/woztell.server.ts";
import type { StaffAccess } from "./auth.server";
import { queryRows } from "./db.server.ts";

// FX-08 owner decision 7: a near-miss opt-out request (「我要退訂」, "STOP please") is a flag
// for staff review only. It is derived at read time and NEVER writes crm_contacts. A dismissal
// is persisted as an audit_logs row whose messageAt (the dismissed message's own created_at,
// not the click time) is a read-time cut-off, so a later request still shows. No migration.

/** `exact`: the message is a whole D4 stop word (history-imported), not a "maybe" near-miss. */
export type OptOutNearMiss = { messageId: string; text: string; at: string; exact: boolean } | null;

/**
 * What the review flag shows. On a contact that is NOT opted out an exact D4 word is flagged
 * too: it can only be there without setting the flag when it arrived through history_import
 * (D4 never opts out from history), and a customer stop request must never be invisible.
 * Display-only, like the near-miss itself: nothing here writes crm_contacts.
 */
export function isOptOutReviewFlag(text: string | null | undefined, optedOut: boolean) {
  return isOptOutNearMiss(text) || (!optedOut && isOptOutText(text));
}

/** Dismissing an exact stop word needs a written reason (at least this many characters). */
export const EXACT_DISMISS_REASON_MIN = 5;

const uuid = z.string().uuid();

function iso(value: unknown) {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

/** Read-time derivation. Never writes. */
export async function readOptOutNearMiss(
  input: { conversationId: string; contactId: string },
  ports: { query?: typeof queryRows } = {},
): Promise<OptOutNearMiss> {
  const conversationId = uuid.parse(input.conversationId);
  const contactId = uuid.parse(input.contactId);
  const query = ports.query ?? queryRows;
  // Cut-offs: the latest consent decision, the latest dismissal, and the opt-out itself while
  // opted out (so the flag never duplicates the 已退訂推廣 badge). The 30-day floor and
  // LIMIT 50 bound the cost.
  const rows = await query<{
    id: string;
    text: string | null;
    created_at: Date | string;
    opted_out: boolean | null;
  }>(
    `WITH cut AS (SELECT GREATEST(
       (SELECT max(created_at) FROM crm_consent_events WHERE contact_id = $2::uuid),
       (SELECT max((metadata->>'messageAt')::timestamptz) FROM audit_logs
         WHERE action = 'contact.whatsapp_opt_out_near_miss_dismissed' AND subject_type = 'contact' AND subject_id = $2::uuid),
       (SELECT CASE WHEN opted_out_whatsapp THEN opted_out_at END FROM crm_contacts WHERE id = $2::uuid),
       now() - interval '30 days') AS t)
     SELECT id, text, created_at,
       (SELECT opted_out_whatsapp FROM crm_contacts WHERE id = $2::uuid) AS opted_out
     FROM whatsapp_messages, cut
     WHERE conversation_id = $1::uuid AND contact_id = $2::uuid AND direction = 'inbound' AND created_at > cut.t
     ORDER BY created_at DESC LIMIT 50`,
    [conversationId, contactId],
  );
  const flagged = rows.find((row) => isOptOutReviewFlag(row.text, row.opted_out === true));
  return flagged
    ? {
        messageId: String(flagged.id),
        text: String(flagged.text),
        at: iso(flagged.created_at),
        // A message is never both an exact word and a near-miss.
        exact: isOptOutText(flagged.text),
      }
    : null;
}

const dismissSchema = z
  .object({
    conversationId: z.string().uuid(),
    contactId: z.string().uuid(),
    messageId: z.string().uuid(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();

// Shared by the dismiss read and write: $1 conversation, $2 contact, $3 message, $4 actor.
const DISMISS_GUARD = `WITH actor AS (
      SELECT s.id FROM staff_users s
      WHERE s.id = $4::uuid AND s.active = true
        AND EXISTS (SELECT 1 FROM staff_roles r WHERE r.staff_user_id = s.id AND r.role IN ('admin', 'manager'))
    ), msg AS (
      SELECT m.id, m.created_at, m.text FROM whatsapp_messages m
      JOIN whatsapp_conversations wc ON wc.id = m.conversation_id
      JOIN actor a ON true
      WHERE m.id = $3::uuid AND m.conversation_id = $1::uuid AND m.contact_id = $2::uuid
        AND wc.contact_id = $2::uuid AND m.direction = 'inbound'
        AND wa_can_read_conversation(a.id, wc.id)
    )`;

export async function dismissOptOutNearMiss(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  ports: { query?: typeof queryRows } = {},
): Promise<{ ok: true; dismissed: boolean }> {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  const parsed = dismissSchema.safeParse(value);
  if (!parsed.success) throw new Response("VALIDATION_ERROR", { status: 400 });
  const input = parsed.data;
  const query = ports.query ?? queryRows;
  const params = [input.conversationId, input.contactId, input.messageId, actor.staffId];
  // 1. Read: the actor is an active admin/manager, and the message is this contact's inbound
  //    message on this conversation (wrong-recipient guard) that the actor can read.
  const [found] = await query<{
    actor_ok: boolean;
    message_ok: boolean;
    text: string | null;
    opted_out: boolean | null;
  }>(
    `${DISMISS_GUARD} SELECT EXISTS (SELECT 1 FROM actor) AS actor_ok,
      EXISTS (SELECT 1 FROM msg) AS message_ok, (SELECT text FROM msg) AS text,
      (SELECT opted_out_whatsapp FROM crm_contacts WHERE id = $2::uuid) AS opted_out`,
    params,
  );
  if (!found?.actor_ok) throw new Response("Forbidden", { status: 403 });
  // Only a message the flag would show can be dismissed (a near-miss, or an exact word on a
  // contact that is not opted out). An ordinary message is refused, so a dismissal cannot
  // silently move the cut-off.
  if (!found.message_ok || !isOptOutReviewFlag(found.text, found.opted_out === true)) {
    throw new Response("NEAR_MISS_MESSAGE_NOT_FOUND", { status: 404 });
  }
  // A plain stop word is not a "maybe": hiding it needs a written reason.
  if (isOptOutText(found.text) && (input.reason ?? "").length < EXACT_DISMISS_REASON_MIN) {
    throw new Response("NEAR_MISS_REASON_REQUIRED", { status: 400 });
  }
  // 2. Write, re-checking the same guard: one audit row per message (idempotent). The
  //    dismissal lives only in audit_logs. crm_contacts is never written.
  const [row] = await query<{ actor_ok: boolean; message_ok: boolean; dismissed: boolean }>(
    `${DISMISS_GUARD}, inserted AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT $4::uuid, 'contact.whatsapp_opt_out_near_miss_dismissed', 'contact', $2::uuid,
        jsonb_build_object('conversationId', $1::text, 'messageId', m.id::text,
          'messageAt', m.created_at, 'text', left(m.text, 200), 'reason', $5::text)
      FROM msg m
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_logs l
        WHERE l.action = 'contact.whatsapp_opt_out_near_miss_dismissed' AND l.subject_type = 'contact'
          AND l.subject_id = $2::uuid AND l.metadata->>'messageId' = m.id::text)
      RETURNING id
    ) SELECT EXISTS (SELECT 1 FROM actor) AS actor_ok, EXISTS (SELECT 1 FROM msg) AS message_ok,
      EXISTS (SELECT 1 FROM inserted) AS dismissed`,
    [...params, input.reason || null],
  );
  if (!row?.actor_ok) throw new Response("Forbidden", { status: 403 });
  if (!row.message_ok) throw new Response("NEAR_MISS_MESSAGE_NOT_FOUND", { status: 404 });
  return { ok: true, dismissed: row.dismissed === true };
}
