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

/**
 * INVARIANT: every `table` and `column` below must be a compile-time string
 * literal authored in this file, never a runtime value (user input, a request
 * param, a DB read). staffOwnershipCountSql and staffReassignStatements
 * interpolate them directly into SQL text -- Neon's query function only
 * parameterizes values ($1, $2, ...), not identifiers -- so treating either
 * field as untrusted would open a SQL injection hole. Dropping the `readonly
 * StaffOwnershipColumn[]` annotation below and relying on `as const` instead
 * is what keeps `table`/`column` narrowed to their literal unions rather than
 * widened to `string`.
 */

/** Current assignment. These move when someone leaves. */
export const STAFF_OWNERSHIP_COLUMNS = [
  { table: "properties", column: "agent_id" },
  { table: "crm_contacts", column: "assigned_agent_id" },
  { table: "crm_leads", column: "assigned_agent_id" },
  { table: "inquiries", column: "assigned_agent_id" },
  { table: "whatsapp_conversations", column: "assigned_agent_id" },
  // Exists in the schema and in the LiveAgentSession type (src/lib/ai/ai-types.ts)
  // but is not written by any code path today, so it counts zero. Included
  // because an ownership-shaped column absent from the handover is a gap
  // waiting for the first person to wire it.
  { table: "live_agent_sessions", column: "assigned_agent_id" },
  // P5 Task 2 (transaction provenance/verification): the agent currently
  // responsible for a transaction record, same "current assignment" meaning
  // as properties.agent_id above -- not who verified it (that fact lives in
  // verification_state/verified_at, which never move). Reassigned by the
  // same staff-handover flow properties.agent_id already goes through.
  { table: "transactions", column: "agent_id" },
] as const satisfies readonly StaffOwnershipColumn[];

/**
 * Authorship and audit. These never move. Listed so tests can assert exclusion.
 *
 * Several tables share a name such as `created_by`. Kept honest
 * against neon/migrations/*.sql by the schema-derived test in
 * staff-ownership.test.mjs (not by manual re-grepping -- that's how the
 * sixth ownership column got missed the first time).
 */
export const STAFF_HISTORICAL_COLUMNS = [
  // Last editor of a manual property override; attribution never transfers.
  "updated_by",
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
  // Identity-action targets are historical subjects of an operation, not
  // current ownership. Reassigning this would rewrite who received an invite
  // or reset and corrupt the audit trail.
  "target_staff_id",
  "requested_staff_id",
  "desired_staff_id",
  "first_human_response_staff_id",
  "verified_by",
  "property_responsible_staff_id_at_intake",
  "requested_staff_id_snapshot",
  "recipient_staff_id",
  "acknowledged_by",
  "attended_staff_id",
  // Append-only finance and quality revisions retain the actor who made the decision.
  "changed_by",
  "qualified_by",
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
    statement:
      table === "properties"
        ? `WITH handover_context AS MATERIALIZED (
          SELECT set_config('app.staff_property_handover', $2::text, true)
        ), reassigned AS (
          UPDATE properties SET agent_id = $2::uuid FROM handover_context
          WHERE agent_id = $1::uuid RETURNING properties.id
        )
        SELECT count(*)::int AS reassigned,
          set_config('app.staff_property_handover', '', true) AS cleared
        FROM reassigned`
        : table === "crm_leads"
          ? // FX-09: a handover changes the lead, so it bumps the lead version
            // (updated_at). Without it an editor opened before the handover
            // still holds a matching version and its save would silently hand
            // the lead back to the departed agent.
            `UPDATE crm_leads SET assigned_agent_id = $2::uuid, updated_at = GREATEST(now(), updated_at + interval '1 microsecond') WHERE assigned_agent_id = $1::uuid`
          : `UPDATE ${table} SET ${column} = $2::uuid WHERE ${column} = $1::uuid`,
    params: [fromStaffId, toStaffId] as unknown[],
  }));
}

/** Scoped historical evidence never moves during staff handover. The forwarded
 * record keeps its original actor and selected owner for idempotent replay;
 * the CRM lead assignment is the current follow-up owner. */
export const STAFF_HISTORICAL_PAIR_COLUMNS = [
  { table: "staff_notification_test_previews", column: "staff_id" },
  { table: "staff_notification_test_attempts", column: "staff_id" },
  // Review subject and saved deal-credit identity are historical, not handover targets.
  { table: "whatsapp_staff_mapping_reviews", column: "staff_id" },
  { table: "transaction_agent_credits", column: "staff_id" },
  { table: "whatsapp_no_link_effect_decisions", column: "candidate_staff_id" },
  { table: "whatsapp_forwarded_enquiries", column: "forwarded_by" },
  { table: "whatsapp_forwarded_enquiries", column: "responsible_staff_id" },
] as const;

/** Provider-confirmed ownership requires reconciliation; mappings retire on staff exit.
 * Neither may be relabelled by a bulk local handover. Evidence records retain their subject. */
export const STAFF_RECONCILED_COLUMNS = [
  // Query ownership is current, but a staff exit cannot claim that the
  // provider reassigned the whole conversation. Review it separately.
  { table: "inquiries", column: "enquiry_owner_staff_id" },
  { table: "staff_external_references", column: "staff_id" },
  { table: "staff_notification_endpoints", column: "staff_id" },
  { table: "whatsapp_conversations", column: "confirmed_staff_id" },
  { table: "whatsapp_staff_channels", column: "staff_id" },
  { table: "whatsapp_human_response_evidence", column: "staff_id" },
] as const;
