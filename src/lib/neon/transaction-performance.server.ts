import "@tanstack/react-start/server-only";

import type { StaffAccess } from "./auth.server.ts";
import { queryRows } from "./db.server.ts";
import { canonicalListingCte } from "./public-listing-query.js";
import { buildSavePerformanceQuery } from "./transaction-performance.mjs";
import type {
  TransactionPerformance,
  TransactionPerformanceInput,
  TransactionAttributionLookup,
  TransactionAttributionOption,
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
        `SELECT c.staff_id::text AS staff_id,c.branch_id_at_close::text AS branch_id_at_close,c.share_bps,
       COALESCE(s.name_zh,s.name_en,s.email) AS staff_name,b.name AS branch_name
     FROM transaction_agent_credits c JOIN staff_users s ON s.id=c.staff_id
     LEFT JOIN branches b ON b.id=c.branch_id_at_close
     WHERE c.transaction_id=$1::uuid AND c.version=$2::integer ORDER BY c.staff_id`,
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
      staffName: credit.staff_name === null ? null : String(credit.staff_name),
      branchName: credit.branch_name === null ? null : String(credit.branch_name),
    })),
  };
}

export async function searchTransactionAttributionOptions(
  input: { kind: TransactionAttributionLookup; q: string; dealType?: "sale" | "rent" },
  actor: StaffAccess,
): Promise<TransactionAttributionOption[]> {
  requirePerformanceRole(actor);
  const q = input.q.trim();
  if (!q || q.length > 80) return [];
  const isAdmin = actor.roles.includes("admin");
  if (input.kind === "staff") {
    const rows = await queryRows(
      `SELECT s.id::text AS id,COALESCE(s.name_zh,s.name_en,s.email,s.id::text) AS label,
       s.branch_id::text AS branch_id,b.name AS branch_name
       FROM staff_users s LEFT JOIN branches b ON b.id=s.branch_id WHERE s.active=true
       AND (s.name_zh ILIKE $1 OR s.name_en ILIKE $1 OR s.email ILIKE $1 OR s.id::text=$2)
       AND ($3::boolean OR EXISTS(SELECT 1 FROM staff_users manager
         WHERE manager.id=$4::uuid AND manager.branch_id IS NOT NULL AND manager.branch_id=s.branch_id))
       ORDER BY label,s.id LIMIT 10`,
      [`%${q}%`, q, isAdmin, actor.staffId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      branchId: row.branch_id === null ? null : String(row.branch_id),
      branchName: row.branch_name === null ? null : String(row.branch_name),
    }));
  }
  if (input.kind === "lead") {
    const rows = await queryRows(
      `SELECT l.id::text AS id,COALESCE(NULLIF(c.name,''),l.id::text) AS label
       FROM crm_leads l LEFT JOIN crm_contacts c ON c.id=l.contact_id
       LEFT JOIN staff_users owner ON owner.id=l.assigned_agent_id
       WHERE (l.id::text=$2 OR c.name ILIKE $1)
       AND ($3::boolean OR EXISTS(SELECT 1 FROM staff_users manager
         WHERE manager.id=$4::uuid AND manager.branch_id IS NOT NULL AND manager.branch_id=owner.branch_id))
       ORDER BY l.created_at DESC,l.id LIMIT 10`,
      [`%${q}%`, q, isAdmin, actor.staffId],
    );
    return rows.map((row) => ({ id: String(row.id), label: String(row.label) }));
  }
  if (input.kind === "listing" && (input.dealType === "sale" || input.dealType === "rent")) {
    const rows = await queryRows(
      canonicalListingCte("TRUE", true) +
        ` SELECT c.public_listing_no AS id,COALESCE(NULLIF(p.title_zh,''),c.public_listing_no) AS label,
          p.deal_type::text AS deal_type
          FROM current_offerings c JOIN properties p ON p.id=c.id
          WHERE p.status='active' AND p.deal_type=$2::deal_type
            AND c.public_listing_no ILIKE $1
          ORDER BY c.public_listing_no LIMIT 10`,
      [`%${q}%`, input.dealType],
    );
    return rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      dealType: row.deal_type === "rent" ? "rent" : "sale",
    }));
  }
  throw new Response("Invalid attribution lookup", { status: 400 });
}
