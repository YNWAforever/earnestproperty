/**
 * Which columns mean "this staff member currently owns this row", and which
 * only record who did something once.
 *
 * Kept as data rather than inline SQL so the distinction is testable without a
 * database. Reassigning a historical column would falsify the record --
 * rewriting `sent_by` claims a different person sent a WhatsApp message, and
 * ops_audit_logs is append-only by trigger and must never be touched at all.
 */

export type StaffOwnershipColumn = { table: string; column: string };

/** Current assignment. These move when someone leaves. */
export const STAFF_OWNERSHIP_COLUMNS: readonly StaffOwnershipColumn[] = [
  { table: "properties", column: "agent_id" },
  { table: "crm_contacts", column: "assigned_agent_id" },
  { table: "crm_leads", column: "assigned_agent_id" },
  { table: "inquiries", column: "assigned_agent_id" },
  { table: "whatsapp_conversations", column: "assigned_agent_id" },
] as const;

/**
 * Authorship and audit. These never move. Listed so tests can assert exclusion.
 *
 * Twelve DISTINCT column names, spanning eighteen occurrences across the
 * schema -- several tables share a name such as `created_by`. Verify with:
 *   grep -rn "REFERENCES staff_users" neon/migrations/*.sql
 */
export const STAFF_HISTORICAL_COLUMNS: readonly string[] = [
  "actor_id",
  "actor_staff_id",
  "approved_by",
  "approved_by_staff_id",
  "author_id",
  "created_by",
  "decided_by",
  "executed_by_staff_id",
  "requested_by",
  "reviewed_by",
  "sent_by",
  "staff_user_id",
] as const;

/**
 * One row of counts, one column per ownership table, aliased by table name so
 * the caller can map results back without positional guessing.
 */
export function staffOwnershipCountSql(staffId: string) {
  const selects = STAFF_OWNERSHIP_COLUMNS.map(
    ({ table, column }) =>
      `(SELECT count(*)::int FROM ${table} WHERE ${column} = $1::uuid) AS ${table}`,
  ).join(",\n       ");
  return { statement: `SELECT ${selects}`, params: [staffId] };
}

/** One UPDATE per ownership column, for transactionRows. */
export function staffReassignStatements(fromStaffId: string, toStaffId: string) {
  return STAFF_OWNERSHIP_COLUMNS.map(({ table, column }) => ({
    statement: `UPDATE ${table} SET ${column} = $2::uuid WHERE ${column} = $1::uuid`,
    params: [fromStaffId, toStaffId] as unknown[],
  }));
}
