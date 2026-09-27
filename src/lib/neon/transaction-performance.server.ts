import "@tanstack/react-start/server-only";

import type { StaffAccess } from "./auth.server.ts";
import { queryRows } from "./db.server.ts";
import { buildSavePerformanceQuery } from "./transaction-performance.mjs";
import type {
  TransactionPerformance,
  TransactionPerformanceInput,
} from "./transaction-performance.types.ts";

function requirePerformanceRole(actor: StaffAccess) {
  if (!actor.roles.includes("admin") && !actor.roles.includes("manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export async function saveTransactionPerformance(
  input: TransactionPerformanceInput,
  actor: StaffAccess,
): Promise<{ transactionId: string; version: number }> {
  requirePerformanceRole(actor);
  let statement: string;
  let params: unknown[];
  try {
    ({ statement, params } = buildSavePerformanceQuery(input, actor));
  } catch (error) {
    throw new Response(error instanceof Error ? error.message : "Invalid attribution", {
      status: 400,
    });
  }
  const rows = await queryRows<{ transaction_id: string; version: number }>(statement, params);
  if (!rows[0]) throw new Response("Attribution is stale or outside your scope", { status: 409 });
  return { transactionId: rows[0].transaction_id, version: Number(rows[0].version) };
}

export async function getTransactionPerformance(
  transactionId: string,
  actor: StaffAccess,
): Promise<TransactionPerformance | null> {
  requirePerformanceRole(actor);
  const rows = await queryRows(
    `SELECT t.id::text AS transaction_id,t.deal_type::text AS deal_type,p.version,
      p.attribution_status,p.lead_id::text AS lead_id,p.public_listing_no,p.confirmed_at,
      p.commission_receivable::text AS commission_receivable,
      p.commission_received::text AS commission_received
     FROM transactions t LEFT JOIN transaction_performance p ON p.transaction_id=t.id
     WHERE t.id=$1::uuid AND ($3::boolean OR EXISTS(
       SELECT 1 FROM staff_users manager JOIN staff_users owner ON owner.id=t.agent_id
       WHERE manager.id=$2::uuid AND manager.branch_id IS NOT NULL AND manager.branch_id=owner.branch_id))`,
    [transactionId, actor.staffId, actor.roles.includes("admin")],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  const version = Number(row.version ?? 0);
  const creditRows = version
    ? await queryRows(
        `SELECT staff_id::text AS staff_id,branch_id_at_close::text AS branch_id_at_close,share_bps
     FROM transaction_agent_credits WHERE transaction_id=$1::uuid AND version=$2::integer ORDER BY staff_id`,
        [transactionId, version],
      )
    : [];
  return {
    transactionId: String(row.transaction_id),
    version,
    leadId: row.lead_id === null ? null : String(row.lead_id),
    publicListingNo: row.public_listing_no === null ? null : String(row.public_listing_no),
    dealType: row.deal_type === "rent" ? "rent" : "sale",
    confirmedAt:
      row.confirmed_at === null ? null : new Date(String(row.confirmed_at)).toISOString(),
    commissionReceivable:
      row.commission_receivable === null ? null : String(row.commission_receivable),
    commissionReceived: row.commission_received === null ? null : String(row.commission_received),
    attributionStatus:
      row.attribution_status === "verified_attributed" ||
      row.attribution_status === "verified_unattributed" ||
      row.attribution_status === "cancelled"
        ? row.attribution_status
        : "draft",
    credits: creditRows.map((credit) => ({
      staffId: String(credit.staff_id),
      branchIdAtClose:
        credit.branch_id_at_close === null ? null : String(credit.branch_id_at_close),
      shareBps: Number(credit.share_bps),
    })),
  };
}
