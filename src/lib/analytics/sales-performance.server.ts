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
  SOURCE_EVIDENCE_SQL,
} from "./sales-performance.queries.mjs";
import {
  PERFORMANCE_DRILLDOWN_KEYS,
  selectPerformanceRecords,
} from "./sales-performance-drilldown.mjs";
import type { PerformanceRecordPage, PerformanceReport } from "./sales-performance.types.ts";

async function resolveBranchScope(actor: StaffAccess, requested: string | null) {
  const cachedAdmin = actor.roles.includes("admin");
  if (!cachedAdmin && !actor.roles.includes("manager"))
    throw new Response("Forbidden", { status: 403 });
  const rows = await queryRows<{
    branch_id: string | null;
    current_admin: boolean;
    actor_allowed: boolean;
  }>(
    `WITH actor_row AS MATERIALIZED (
       SELECT id,branch_id FROM staff_users
       WHERE id=$1::uuid AND auth_user_id=$2 AND active FOR SHARE
     ), actor_roles AS MATERIALIZED (
       SELECT r.role FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
       WHERE r.role IN ('admin','manager') FOR SHARE OF r
     ) SELECT (SELECT branch_id::text FROM actor_row) AS branch_id,
       EXISTS(SELECT 1 FROM actor_roles WHERE role='admin') AS current_admin,
       EXISTS(SELECT 1 FROM actor_roles) AS actor_allowed`,
    [actor.staffId, actor.authUserId],
  );
  const current = rows[0];
  if (!current?.actor_allowed) throw new Response("Forbidden", { status: 403 });
  // Current grants can restrict a cached role; promotion needs a fresh authenticated actor.
  const canCorrect = cachedAdmin && current.current_admin;
  let branch = requested;
  if (!canCorrect) {
    if (typeof current.branch_id !== "string" || (requested && requested !== current.branch_id))
      throw new Response("Branch outside scope", { status: 403 });
    branch = current.branch_id;
  }
  return { branch, canCorrect };
}

async function revalidatePerformanceScope(
  actor: StaffAccess,
  requested: string | null,
  original: Awaited<ReturnType<typeof resolveBranchScope>>,
) {
  const current = await resolveBranchScope(actor, requested);
  if (current.branch !== original.branch || current.canCorrect !== original.canCorrect)
    throw new Response("Performance scope changed", { status: 403 });
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
  const scope = await resolveBranchScope(actor, filters.branchId);
  const { branch } = scope;
  const params = reportParams(filters, branch);
  // Separate source reads avoid multiplying enquiries, activities and credits.
  const inquiryRows = await queryRows(INQUIRY_ROWS_SQL, params.slice(0, 6));
  const inquiryIds = inquiryRows.map((row) => String(row.id));
  const leadIds = [
    ...new Set(
      inquiryRows.map((row) => row.crmLeadId).filter((id): id is string => typeof id === "string"),
    ),
  ];
  const [eventRows, dealRows, backlogRows, legacyRows, sourceRows] = await Promise.all([
    inquiryIds.length ? queryRows(EVENT_ROWS_SQL, [inquiryIds, leadIds]) : Promise.resolve([]),
    queryRows(DEAL_ROWS_SQL, params),
    queryRows(BACKLOG_SQL, params.slice(2, 6)),
    queryRows(LEGACY_TRANSACTION_SQL, params.slice(0, 6)),
    inquiryIds.length ? queryRows(SOURCE_EVIDENCE_SQL, [inquiryIds]) : Promise.resolve([]),
  ]);
  const dealIds = [...new Set(dealRows.map((row) => String(row.transactionId)))];
  const creditRows = dealIds.length
    ? await queryRows(CREDIT_ROWS_SQL, [dealIds, branch, filters.staffId])
    : [];
  const backlog = backlogRows[0];
  if (typeof backlog?.openInquiries !== "number" || typeof backlog?.unknownQuality !== "number") {
    throw new Response("Invalid backlog aggregate", { status: 503 });
  }
  const evidenceById = new Map(sourceRows.map((row) => [String(row.inquiryId), row]));
  const report = calculateSalesPerformance({
    inquiries: inquiryRows.map((row) => ({ ...row, ...evidenceById.get(String(row.id)) })),
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
  await revalidatePerformanceScope(actor, filters.branchId, scope);
  return report;
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
  const scope = await resolveBranchScope(actor, filters.branchId);
  const { branch } = scope;
  const params = reportParams(filters, branch);
  const inquiries = await queryRows(INQUIRY_ROWS_SQL, params.slice(0, 6));
  const ids = inquiries.map((row) => String(row.id));
  const leadIds = [
    ...new Set(
      inquiries.map((row) => row.crmLeadId).filter((id): id is string => typeof id === "string"),
    ),
  ];
  const [events, deals, backlogRows, sourceRows] = await Promise.all([
    ids.length ? queryRows(EVENT_ROWS_SQL, [ids, leadIds]) : Promise.resolve([]),
    queryRows(DEAL_ROWS_SQL, params),
    input.drilldownKey === "open_inquiries" || input.drilldownKey === "unknown_backlog"
      ? queryRows(BACKLOG_ROWS_SQL, params.slice(2, 6))
      : Promise.resolve([]),
    ids.length ? queryRows(SOURCE_EVIDENCE_SQL, [ids]) : Promise.resolve([]),
  ]);
  const evidenceById = new Map(sourceRows.map((row) => [String(row.inquiryId), row]));
  let records: PerformanceRecordPage;
  try {
    records = selectPerformanceRecords(
      {
        inquiries: inquiries.map((row) => ({ ...row, ...evidenceById.get(String(row.id)) })),
        events,
        deals,
        backlogRows,
        filters,
        asOf: new Date().toISOString(),
      },
      input.drilldownKey,
      input.cursor ?? null,
    );
  } catch {
    throw new Response("Invalid performance cursor", { status: 400 });
  }
  // Read accepted source facts for this page only, never infer them from an aggregate.
  // The author is independent of the colleague credited by the immutable event.
  const visibleIds = records.records
    .filter((r) => r.kind === "inquiry" && r.leadId)
    .map((r) => r.id);
  if (visibleIds.length) {
    const qualifications = await queryRows<{
      inquiryId: string;
      leadId: string;
      qualifiedAt: string | Date;
      evidence: string;
      eventKey: string;
    }>(
      `WITH actor_row AS MATERIALIZED (
         SELECT id,branch_id FROM staff_users
         WHERE id=$2::uuid AND auth_user_id=$3 AND active FOR SHARE
       ), actor_roles AS MATERIALIZED (
         SELECT r.role FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
         WHERE r.role IN ('admin','manager') FOR SHARE OF r
       ) SELECT i.id::text AS "inquiryId",l.id::text AS "leadId",
         q.qualified_at AS "qualifiedAt",q.evidence,e.event_key AS "eventKey"
       FROM inquiries i JOIN crm_leads l ON l.id=i.crm_lead_id
       LEFT JOIN staff_users inquiry_owner ON inquiry_owner.id=i.assigned_agent_id
       LEFT JOIN staff_users source_owner ON source_owner.id=l.assigned_agent_id
       CROSS JOIN actor_row a
       JOIN crm_lead_qualifications q ON q.lead_id=l.id AND q.qualified_by=a.id
       JOIN performance_events e ON e.lead_id=q.lead_id
         AND e.event_type='lead_qualified' AND e.source_id=q.lead_id::text
         AND e.event_key='lead_qualified:'||q.lead_id::text
         AND e.source='crm_lead:'||q.lead_id::text AND e.occurred_at=q.qualified_at
       WHERE i.id=ANY($1::uuid[]) AND EXISTS(SELECT 1 FROM actor_roles)
         AND (($4::boolean AND EXISTS(SELECT 1 FROM actor_roles WHERE role='admin'))
           OR (a.branch_id IS NOT NULL AND inquiry_owner.branch_id=a.branch_id
             AND source_owner.branch_id=a.branch_id))
         AND ($5::uuid IS NULL OR (inquiry_owner.branch_id=$5::uuid AND source_owner.branch_id=$5::uuid))
       FOR SHARE OF i,l,q,e`,
      [visibleIds, actor.staffId, actor.authUserId, actor.roles.includes("admin"), branch],
    );
    const byInquiry = new Map(qualifications.map((q) => [q.inquiryId, q]));
    records = {
      ...records,
      records: records.records.map((record) => {
        const source = byInquiry.get(record.id);
        if (record.kind !== "inquiry" || !source || source.leadId !== record.leadId) return record;
        return {
          ...record,
          qualification: {
            qualifiedAt: new Date(source.qualifiedAt).toISOString(),
            evidence: source.evidence,
            eventKey: source.eventKey,
          },
        };
      }),
    };
  }
  await revalidatePerformanceScope(actor, filters.branchId, scope);
  return records;
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
  const rows = await queryRows<{
    inquiry_id: string | null;
    affected_hk_day: string | null;
    actor_allowed: boolean;
  }>(
    `WITH actor_row AS MATERIALIZED (
       SELECT id FROM staff_users WHERE id=$4::uuid AND auth_user_id=$5 AND active FOR SHARE
     ), actor_grant AS MATERIALIZED (
       SELECT r.staff_user_id FROM staff_roles r JOIN actor_row a ON a.id=r.staff_user_id
       WHERE r.role='admin' FOR SHARE OF r
     ), selected AS MATERIALIZED (
       SELECT id,created_at FROM inquiries WHERE id=$1::uuid
     ), written AS (
       INSERT INTO inquiry_quality_revisions(inquiry_id,quality,reason,changed_by)
       SELECT s.id,$2,$3,a.staff_user_id FROM selected s CROSS JOIN actor_grant a
       RETURNING inquiry_id
     ) SELECT (SELECT inquiry_id::text FROM written) AS inquiry_id,
       (SELECT (created_at AT TIME ZONE 'Asia/Hong_Kong')::date::text FROM selected) AS affected_hk_day,
       EXISTS(SELECT 1 FROM actor_grant) AS actor_allowed`,
    [input.inquiryId, input.quality, input.reason.trim(), actor.staffId, actor.authUserId],
  );
  if (!rows[0]?.actor_allowed) throw new Response("Forbidden", { status: 403 });
  if (!rows[0].inquiry_id || !rows[0].affected_hk_day)
    throw new Response("Inquiry not found", { status: 404 });
  return { inquiryId: rows[0].inquiry_id, affectedHkDay: rows[0].affected_hk_day };
}

export async function getPerformanceFilterOptions(actor: StaffAccess) {
  const scope = await resolveBranchScope(actor, null);
  const { branch } = scope;
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
  const options = {
    canCorrect: scope.canCorrect,
    branches: branchRows.map((row) => ({ id: String(row.id), name: String(row.name) })),
    staff: staffRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      branchId: row.branchId === null ? null : String(row.branchId),
    })),
  };
  await revalidatePerformanceScope(actor, null, scope);
  return options;
}
