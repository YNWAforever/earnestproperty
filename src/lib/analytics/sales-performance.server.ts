import "@tanstack/react-start/server-only";

import type { StaffAccess } from "../neon/auth.server.ts";
import { queryRows } from "../neon/db.server.ts";
import { calculateSalesPerformance, parsePerformanceFilters } from "./sales-performance.mjs";
import {
  BACKLOG_SQL,
  BACKLOG_ROWS_SQL,
  CREDIT_ROWS_SQL,
  DEAL_ROWS_SQL,
  EVENT_ROWS_SQL,
  INQUIRY_ROWS_SQL,
  LEGACY_TRANSACTION_SQL,
  reportParams,
} from "./sales-performance.queries.mjs";
import {
  PERFORMANCE_DRILLDOWN_KEYS,
  selectPerformanceRecords,
} from "./sales-performance-drilldown.mjs";
import type { PerformanceReport } from "./sales-performance.types.ts";

async function resolveBranchScope(actor: StaffAccess, requested: string | null) {
  const admin = actor.roles.includes("admin");
  if (!admin && !actor.roles.includes("manager")) throw new Response("Forbidden", { status: 403 });
  let branch = requested;
  if (!admin) {
    const rows = await queryRows(
      "SELECT branch_id::text AS branch_id FROM staff_users WHERE id=$1::uuid",
      [actor.staffId],
    );
    const ownBranch = rows[0]?.branch_id;
    if (typeof ownBranch !== "string" || (requested && requested !== ownBranch)) {
      throw new Response("Branch outside scope", { status: 403 });
    }
    branch = ownBranch;
  }
  return branch;
}

export async function getSalesPerformance(
  input: unknown,
  actor: StaffAccess,
): Promise<PerformanceReport> {
  let filters;
  try {
    filters = parsePerformanceFilters(input);
  } catch {
    throw new Response("Invalid performance filters", { status: 400 });
  }
  const branch = await resolveBranchScope(actor, filters.branchId);
  const params = reportParams(filters, branch);
  // Separate source reads avoid multiplying enquiries, activities and credits.
  const inquiryRows = await queryRows(INQUIRY_ROWS_SQL, params.slice(0, 6));
  const inquiryIds = inquiryRows.map((row) => String(row.id));
  const leadIds = [
    ...new Set(
      inquiryRows.map((row) => row.crmLeadId).filter((id): id is string => typeof id === "string"),
    ),
  ];
  const [eventRows, dealRows, backlogRows, legacyRows] = await Promise.all([
    inquiryIds.length ? queryRows(EVENT_ROWS_SQL, [inquiryIds, leadIds]) : Promise.resolve([]),
    queryRows(DEAL_ROWS_SQL, params),
    queryRows(BACKLOG_SQL, params.slice(2, 6)),
    queryRows(LEGACY_TRANSACTION_SQL, params.slice(0, 6)),
  ]);
  const dealIds = [...new Set(dealRows.map((row) => String(row.transactionId)))];
  const creditRows = dealIds.length
    ? await queryRows(CREDIT_ROWS_SQL, [dealIds, branch, filters.staffId])
    : [];
  const backlog = backlogRows[0];
  if (typeof backlog?.openInquiries !== "number" || typeof backlog?.unknownQuality !== "number") {
    throw new Response("Invalid backlog aggregate", { status: 503 });
  }
  return calculateSalesPerformance({
    inquiries: inquiryRows,
    events: eventRows,
    deals: dealRows,
    credits: creditRows,
    legacyTransactions: Number(legacyRows[0]?.count ?? 0),
    backlog: {
      openInquiries: backlog.openInquiries,
      unknownQuality: backlog.unknownQuality,
    },
    filters,
    asOf: new Date().toISOString(),
  });
}

export async function listPerformanceRecords(
  input: { filters: unknown; drilldownKey: string; cursor?: string | null },
  actor: StaffAccess,
) {
  let filters;
  try {
    filters = parsePerformanceFilters(input.filters);
    if (!PERFORMANCE_DRILLDOWN_KEYS.has(input.drilldownKey)) throw new Error("Invalid drilldown");
  } catch {
    throw new Response("Invalid performance filters", { status: 400 });
  }
  const branch = await resolveBranchScope(actor, filters.branchId);
  const params = reportParams(filters, branch);
  const inquiries = await queryRows(INQUIRY_ROWS_SQL, params.slice(0, 6));
  const ids = inquiries.map((row) => String(row.id));
  const leadIds = [
    ...new Set(
      inquiries.map((row) => row.crmLeadId).filter((id): id is string => typeof id === "string"),
    ),
  ];
  const [events, deals, backlogRows] = await Promise.all([
    ids.length ? queryRows(EVENT_ROWS_SQL, [ids, leadIds]) : Promise.resolve([]),
    queryRows(DEAL_ROWS_SQL, params),
    input.drilldownKey === "open_inquiries" || input.drilldownKey === "unknown_backlog"
      ? queryRows(BACKLOG_ROWS_SQL, params.slice(2, 6))
      : Promise.resolve([]),
  ]);
  try {
    return selectPerformanceRecords(
      { inquiries, events, deals, backlogRows, filters, asOf: new Date().toISOString() },
      input.drilldownKey,
      input.cursor ?? null,
    );
  } catch {
    throw new Response("Invalid performance cursor", { status: 400 });
  }
}

export async function reviseInquiryQuality(
  input: { inquiryId: string; quality: "production" | "test" | "spam" | "unknown"; reason: string },
  actor: StaffAccess,
): Promise<{ inquiryId: string; affectedHkDay: string }> {
  if (!actor.roles.includes("admin")) throw new Response("Forbidden", { status: 403 });
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.inquiryId,
    ) ||
    !["production", "test", "spam", "unknown"].includes(input.quality) ||
    input.reason.trim().length < 8
  ) {
    throw new Response("Invalid quality correction", { status: 400 });
  }
  const rows = await queryRows<{ inquiry_id: string; affected_hk_day: string }>(
    `WITH selected AS (
       SELECT id,created_at FROM inquiries WHERE id=$1::uuid
     ), written AS (
       INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by)
       SELECT id,$2,$3,$4::uuid FROM selected RETURNING inquiry_id
     )
     SELECT written.inquiry_id::text,(selected.created_at AT TIME ZONE 'Asia/Hong_Kong')::date::text AS affected_hk_day
     FROM written JOIN selected ON selected.id=written.inquiry_id`,
    [input.inquiryId, input.quality, input.reason.trim(), actor.staffId],
  );
  if (!rows[0]) throw new Response("Inquiry not found", { status: 404 });
  return { inquiryId: rows[0].inquiry_id, affectedHkDay: rows[0].affected_hk_day };
}

export async function getPerformanceFilterOptions(actor: StaffAccess) {
  const branch = await resolveBranchScope(actor, null);
  const [branchRows, staffRows] = await Promise.all([
    queryRows(
      `SELECT id::text AS id,name FROM branches WHERE $1::uuid IS NULL OR id=$1::uuid ORDER BY name,id LIMIT 200`,
      [branch],
    ),
    queryRows(
      `SELECT id::text AS id,COALESCE(name_zh,name_en,email) AS name,branch_id::text AS "branchId"
       FROM staff_users WHERE active AND ($1::uuid IS NULL OR branch_id=$1::uuid)
       ORDER BY name_zh,name_en,id LIMIT 500`,
      [branch],
    ),
  ]);
  return {
    canCorrect: actor.roles.includes("admin"),
    branches: branchRows.map((row) => ({ id: String(row.id), name: String(row.name) })),
    staff: staffRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      branchId: row.branchId === null ? null : String(row.branchId),
    })),
  };
}
