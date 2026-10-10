import "@tanstack/react-start/server-only";
import { queryRows } from "./db.server.ts";

const CONFIRMED_ACTION = "first_login_checklist.confirmed";

/** Only the caller's own staff id is ever used; it comes from the server session. */
type Caller = { staffId: string };

export async function fetchFirstLoginChecklistDoneForStaff(actor: Caller): Promise<boolean> {
  const rows = await queryRows<{ done: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM audit_logs WHERE actor_id = $1 AND action = $2
     ) AS done`,
    [actor.staffId, CONFIRMED_ACTION],
  );
  return rows[0]?.done === true;
}

/**
 * Idempotent: one INSERT ... SELECT ... WHERE NOT EXISTS. writeAudit is a plain INSERT, so it
 * cannot skip an existing row in one statement. Same columns as writeAudit.
 */
export async function confirmFirstLoginChecklistForStaff(actor: Caller): Promise<{ ok: true }> {
  await queryRows(
    `INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
     SELECT $1::uuid, $2, 'staff_user', $1::uuid, '{}'::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM audit_logs WHERE actor_id = $1::uuid AND action = $2
     )`,
    [actor.staffId, CONFIRMED_ACTION],
  );
  return { ok: true };
}
