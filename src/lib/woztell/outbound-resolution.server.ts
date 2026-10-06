import "@tanstack/react-start/server-only";
import { z } from "zod";
import type { StaffAccess } from "../neon/auth.server";
import { queryRows } from "../neon/db.server.ts";

// FX-08 / D-02: a manager closes out a real `unknown` outbound send. The resolved states are
// outside the reservation lock states, so the conversation can be replied to again.
// Resolving NEVER sends anything: this module has no provider import, never queues a job and
// never creates an intent. `resolved_not_sent` only releases the lock; any resend is a separate,
// explicit staff action. `resolved_sent` is never credited as a verified human response (only
// `accepted` is). Applies to staff and service-automation intents alike, since both lock staff.

export type ResolveUnknownOutboundInput = {
  intentId: string;
  conversationId: string;
  outcome: "resolved_sent" | "resolved_not_sent";
  reason: string;
};

/**
 * A lease-expired `dispatching` row becomes `unknown` while the original worker may still be
 * waiting on the provider (up to the 15 s fetch timeout). Resolving only after this many minutes
 * since dispatch keeps a resolution (and a later manual resend) clear of an in-flight send.
 * A row with no dispatch time falls back to its last update, so it is never resolvable at once.
 */
export const UNKNOWN_RESOLUTION_MIN_AGE_MINUTES = 15;

const RESOLVED = ["resolved_sent", "resolved_not_sent"] as const;

const schema = z
  .object({
    intentId: z.string().uuid(),
    conversationId: z.string().uuid(),
    outcome: z.enum(RESOLVED),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

type Row = {
  actor_ok: boolean;
  can_read: boolean;
  intent_id: string | null;
  state: string | null;
  changed: boolean;
  lock_released: boolean;
};

export async function resolveUnknownOutbound(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  ports: { query?: typeof queryRows } = {},
): Promise<{
  ok: true;
  intentId: string;
  state: "resolved_sent" | "resolved_not_sent";
  changed: boolean;
  lockReleased: boolean;
}> {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Response("VALIDATION_ERROR", { status: 400 });
  const input = parsed.data;
  const query = ports.query ?? queryRows;

  // One statement. The conversation row lock serialises with the reservation trigger and with a
  // concurrent resolution; `cur` then re-reads the intent under its own row lock, so a second
  // caller sees the first caller's committed state rather than its own statement snapshot.
  const [row] = await query<Row>(
    `WITH lock AS (
      SELECT wc.id FROM whatsapp_conversations wc WHERE wc.id = $2::uuid FOR UPDATE
    ), cur AS (
      SELECT i.id, i.state FROM whatsapp_outbound_intents i JOIN lock l ON l.id = i.conversation_id
      WHERE i.id = $1::uuid FOR UPDATE OF i
    ), actor AS (
      SELECT EXISTS (SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id = s.id
          WHERE s.id = $3::uuid AND s.active = true AND r.role IN ('admin', 'manager')) AS ok,
        wa_can_read_conversation($3::uuid, $2::uuid) AS can_read
    ), upd AS (
      UPDATE whatsapp_outbound_intents i SET state = $4::text, resolved_at = now(),
        resolved_by = $3::uuid, resolution_reason = $5::text,
        error = COALESCE(i.error, 'WOZTELL_DELIVERY_UNKNOWN'), updated_at = now()
      FROM cur c, actor a
      WHERE i.id = c.id AND i.id = $1::uuid AND i.conversation_id = $2::uuid
        AND i.state = 'unknown'
        AND COALESCE(i.dispatch_started_at, i.updated_at) <= now() - make_interval(mins => $6::int)
        AND a.ok AND a.can_read
      RETURNING i.*
    ), msg AS (
      UPDATE whatsapp_messages m SET status = u.state FROM upd u WHERE m.id = u.message_id
      RETURNING m.id
    ), audit AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT $3::uuid, 'whatsapp.outbound_unknown_resolved', 'whatsapp_outbound_intent', u.id,
        jsonb_build_object('conversationId', u.conversation_id, 'outcome', u.state,
          'reason', $5::text, 'kind', u.kind, 'actorType', u.actor_type,
          'dispatchStartedAt', u.dispatch_started_at, 'previousError', u.error)
      FROM upd u RETURNING id
    )
    SELECT a.ok AS actor_ok, a.can_read, c.id AS intent_id,
      COALESCE((SELECT state FROM upd), c.state) AS state,
      EXISTS (SELECT 1 FROM upd) AS changed,
      NOT EXISTS (SELECT 1 FROM whatsapp_outbound_intents o
        WHERE o.conversation_id = $2::uuid AND o.id <> $1::uuid
          AND o.state IN ('dispatching', 'unknown')) AS lock_released
    FROM actor a LEFT JOIN cur c ON true`,
    [
      input.intentId,
      input.conversationId,
      actor.staffId,
      input.outcome,
      input.reason,
      UNKNOWN_RESOLUTION_MIN_AGE_MINUTES,
    ],
  );
  if (!row?.actor_ok) throw new Response("Forbidden", { status: 403 });
  // Read access first, so a caller who cannot read the conversation learns nothing about
  // whether an intent exists (no existence oracle).
  if (!row.can_read) throw new Response("Forbidden", { status: 403 });
  // An intent id paired with another conversation id is simply not found.
  if (!row.intent_id) throw new Response("OUTBOUND_NOT_FOUND_OR_FORBIDDEN", { status: 404 });
  const result = (changed: boolean) => ({
    ok: true as const,
    intentId: row.intent_id as string,
    state: input.outcome,
    changed,
    lockReleased: row.lock_released,
  });
  if (row.changed) return result(true);
  // Idempotent replay (double click, or a second manager choosing the same outcome).
  if (row.state === input.outcome) return result(false);
  if ((RESOLVED as readonly string[]).includes(row.state ?? "")) {
    throw new Response("OUTBOUND_ALREADY_RESOLVED", { status: 409 });
  }
  if (row.state === "unknown") {
    throw new Response("OUTBOUND_RESOLUTION_TOO_EARLY", { status: 409 });
  }
  throw new Response("OUTBOUND_NOT_UNKNOWN", { status: 409 });
}
