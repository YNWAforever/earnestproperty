import "@tanstack/react-start/server-only";
import { z } from "zod";
import { isOptOutText } from "../woztell/woztell.server.ts";
import type { StaffAccess } from "./auth.server";
import { queryRows } from "./db.server.ts";

// FX-08 / D-01 / D4: a manager can clear an ACCIDENTAL opt-out (a legacy false positive such
// as 「唔要」). A genuine D4 request (退訂 / STOP …) or a staff-recorded 拒收推廣 cannot be
// cleared here: only recorded marketing consent can reverse those. Clearing keeps every
// evidence column and never writes opt_in_whatsapp; the audit row snapshots the evidence.

export type ClearAccidentalOptOutInput = {
  contactId: string;
  reason: string;
  /** The opt-out version (optOutVersionSql) from the detail the manager saw; stale guard. */
  expectedOptedOutAt: string | null;
};

/**
 * The opt-out version: opted_out_at as an exact microsecond UTC string (FX-05b pattern). A JS
 * Date keeps only milliseconds, so the version is always produced and compared in SQL. Every
 * reader that hands a version to the clear (Task 5 detail) must emit this same expression.
 */
export function optOutVersionSql(alias: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error("INVALID_SQL_ALIAS");
  return `to_char(${alias}.opted_out_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const schema = z
  .object({
    contactId: z.string().uuid(),
    reason: z.string().trim().min(5).max(500),
    expectedOptedOutAt: z.string().regex(VERSION).nullable(),
  })
  .strict();

type ReadRow = {
  actor_ok: boolean;
  id: string | null;
  opted_out_whatsapp: boolean | null;
  opted_out_at: Date | string | null;
  opted_out_version: string | null;
  opted_out_message_id: string | null;
  opted_out_text: string | null;
  opted_out_source: string | null;
  opted_out_cleared_at: Date | string | null;
  inbound_texts: (string | null)[] | null;
};

const MANAGER_SQL = `EXISTS (SELECT 1 FROM staff_users s JOIN staff_roles r ON r.staff_user_id = s.id
        WHERE s.id = $2::uuid AND s.active = true AND r.role IN ('admin', 'manager'))`;

export type OptOutEvidence = {
  optedOut: boolean;
  optedOutAt: string | null;
  optedOutVersion: string | null;
  optedOutMessageId: string | null;
  optedOutText: string | null;
  optedOutSource: string | null;
  optedOutClearedAt: string | null;
  optedOutClearedBy: string | null;
} | null;

const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : (value instanceof Date ? value : new Date(String(value))).toISOString();

/** Read-only: a contact's opt-out evidence and its version, for the manager's detail. */
export async function readOptOutEvidence(
  contactId: string,
  ports: { query?: typeof queryRows } = {},
): Promise<OptOutEvidence> {
  const id = z.string().uuid().parse(contactId);
  const query = ports.query ?? queryRows;
  const [row] = await query<Record<string, unknown>>(
    `SELECT c.opted_out_whatsapp, c.opted_out_at, ${optOutVersionSql("c")} AS opted_out_version,
      c.opted_out_message_id, c.opted_out_text, c.opted_out_source, c.opted_out_cleared_at,
      c.opted_out_cleared_by
     FROM crm_contacts c WHERE c.id = $1::uuid`,
    [id],
  );
  if (!row) return null;
  return {
    optedOut: row.opted_out_whatsapp === true,
    optedOutAt: iso(row.opted_out_at),
    optedOutVersion: (row.opted_out_version as string | null) ?? null,
    optedOutMessageId: (row.opted_out_message_id as string | null) ?? null,
    optedOutText: (row.opted_out_text as string | null) ?? null,
    optedOutSource: (row.opted_out_source as string | null) ?? null,
    optedOutClearedAt: iso(row.opted_out_cleared_at),
    optedOutClearedBy: (row.opted_out_cleared_by as string | null) ?? null,
  };
}

export async function clearAccidentalOptOut(
  value: unknown,
  actor: Pick<StaffAccess, "staffId" | "roles">,
  ports: { query?: typeof queryRows } = {},
): Promise<{ ok: true; contactId: string; cleared: boolean }> {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Response("VALIDATION_ERROR", { status: 400 });
  const input = parsed.data;
  const query = ports.query ?? queryRows;

  // 1. Read the evidence and up to 200 inbound texts up to the opt-out (all inbound when the
  //    time is unknown), plus whether the caller is still an active admin or manager.
  const [row] = await query<ReadRow>(
    `SELECT ${MANAGER_SQL} AS actor_ok,
      c.id, c.opted_out_whatsapp, c.opted_out_at, ${optOutVersionSql("c")} AS opted_out_version,
      c.opted_out_message_id, c.opted_out_text,
      c.opted_out_source, c.opted_out_cleared_at,
      ARRAY(SELECT m.text FROM whatsapp_messages m
        WHERE m.contact_id = c.id AND m.direction = 'inbound'
          AND m.created_at <= COALESCE(c.opted_out_at, 'infinity'::timestamptz)
        ORDER BY m.created_at DESC LIMIT 200) AS inbound_texts
     FROM (SELECT 1) one LEFT JOIN crm_contacts c ON c.id = $1::uuid`,
    [input.contactId, actor.staffId],
  );
  if (!row?.actor_ok) throw new Response("Forbidden", { status: 403 });
  if (!row.id) throw new Response("CONTACT_NOT_FOUND", { status: 404 });
  if (!row.opted_out_whatsapp) {
    // Idempotent replay: this exact opt-out was already cleared.
    if (row.opted_out_cleared_at && row.opted_out_version === input.expectedOptedOutAt) {
      return { ok: true, contactId: row.id, cleared: false };
    }
    throw new Response("CONTACT_NOT_OPTED_OUT", { status: 404 });
  }
  if ((row.opted_out_version ?? null) !== input.expectedOptedOutAt) {
    throw new Response("OPT_OUT_CHANGED", { status: 409 });
  }
  const genuine =
    row.opted_out_source === "staff_recorded" ||
    isOptOutText(row.opted_out_text) ||
    (row.inbound_texts ?? []).some((text) => isOptOutText(text));
  if (genuine) throw new Response("OPT_OUT_GENUINE_USE_CONSENT", { status: 409 });

  // 2. One guarded write: still opted out, still the same opt-out version (exact to the
  //    microsecond), caller still a manager.
  const written = await query<{ id: string }>(
    `WITH changed AS (
      UPDATE crm_contacts c SET opted_out_whatsapp = false, opted_out_cleared_at = now(),
        opted_out_cleared_by = $2::uuid, updated_at = now()
      WHERE c.id = $1::uuid AND c.opted_out_whatsapp
        AND ${optOutVersionSql("c")} IS NOT DISTINCT FROM $3::text
        AND ${MANAGER_SQL}
      RETURNING c.id, c.opted_out_at, c.opted_out_message_id, c.opted_out_text, c.opted_out_source
    ), audit AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT $2::uuid, 'contact.whatsapp_opt_out_cleared', 'contact', id,
        jsonb_build_object('reason', $4::text, 'optedOutAt', opted_out_at,
          'optedOutMessageId', opted_out_message_id, 'optedOutText', left(opted_out_text, 200),
          'optedOutSource', opted_out_source)
      FROM changed RETURNING id
    ) SELECT id FROM changed`,
    [input.contactId, actor.staffId, input.expectedOptedOutAt, input.reason],
  );
  if (!written[0]?.id) throw new Response("OPT_OUT_CHANGED", { status: 409 });
  return { ok: true, contactId: written[0].id, cleared: true };
}
