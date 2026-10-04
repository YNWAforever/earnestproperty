// Actual calculation/drilldown; synthetic Auth/API ports, not SQL/provider evidence.
import {
  calculateSalesPerformance,
  parsePerformanceFilters,
} from "../../../src/lib/analytics/sales-performance.mjs";
import { selectPerformanceRecords } from "../../../src/lib/analytics/sales-performance-drilldown.mjs";
import { ServerFnResponseError } from "../../../src/lib/neon/server-fn-response";
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const state = {
  actor: sessionStorage.getItem("performance-readback-actor") ?? "actor-a",
  binding: "staff-a",
  role: sessionStorage.getItem("performance-readback-role") ?? "manager",
  denied: false,
  reportMode: sessionStorage.getItem("performance-delayed-initial") === "true" ? "delayed" : "ok",
  recordsMode: "ok",
  qualityMode: "ok",
  qualificationMode: "ok",
  leadStages: {} as Record<string, string>,
  qualifications: JSON.parse(sessionStorage.getItem("performance-qualifications") ?? "[]") as {
    leadId: string;
    qualifiedAt: string;
    evidence: string;
    actor: string;
    staffId: string;
    branchId: string;
  }[],
  qualityRevisions: JSON.parse(sessionStorage.getItem("performance-quality-revisions") ?? "[]") as {
    kind: string;
    key: string;
    quality: string;
    reason: string;
    actor: string;
  }[],
  calls: [] as { name: string; actor: string; binding: string; input: unknown }[],
  pending: [] as { release: () => void }[],
  changeContext: async (
    _actor: string,
    _binding = "staff-a",
    _role = "manager",
    _denied = false,
  ) => {},
};
declare global {
  interface Window {
    performanceReadbackFixture: typeof state;
  }
}
window.performanceReadbackFixture = state;
function scope() {
  return state.actor === "actor-a" && state.binding === "staff-a" ? 0 : 1;
}
function input(value: unknown) {
  if (state.denied || !["admin", "manager"].includes(state.role))
    throw new Response("Owned forbidden", { status: 403 });
  const filters = parsePerformanceFilters(value),
    which = scope(),
    branch = id(500 + which),
    staff = id(600 + which);
  if (filters.branchId && filters.branchId !== branch)
    throw new Response("Owned branch denied", { status: 403 });
  const inquiry = (
    n: number,
    quality = "production",
    evidence = "unknown",
    at = "2026-09-30T00:00:00Z",
  ) => ({
    id: id(n),
    quality:
      state.qualityRevisions.filter((r) => r.kind === "inquiry" && r.key === id(n)).at(-1)
        ?.quality ?? quality,
    sourceEvidence: evidence,
    currentSource: evidence === "message_28hse" ? "28hse" : "whatsapp",
    createdAt: at,
    customerMessageAt: at,
    webhookReceivedAt: null,
    crmLeadId: id(100 + n),
    firstLeadInquiryId: id(n),
    assignedStaffId: staff,
    branchId: branch,
    dealType: n === 2 ? "rent" : "sale",
    responseDueAt: null,
    servicePolicyId: null,
  });
  const all = which
    ? [inquiry(91)]
    : [
        inquiry(1, "production", "message_28hse", "2026-09-29T16:01:00Z"),
        inquiry(2, "production", "tracked_open"),
        inquiry(3, "production", "unknown", "2026-09-30T15:59:00Z"),
        { ...inquiry(4), crmLeadId: id(101), firstLeadInquiryId: id(1) },
        inquiry(5, "production", "unknown", "2026-09-30T16:01:00Z"),
        inquiry(6, "test"),
        inquiry(7, "spam"),
        inquiry(8, "unknown"),
      ];
  const start = Date.parse(filters.start + "T00:00:00Z") - 8 * 3600000,
    end = Date.parse(filters.end + "T00:00:00Z") + 16 * 3600000;
  const inquiries = all.filter(
    (i) =>
      Date.parse(i.createdAt) >= start &&
      Date.parse(i.createdAt) < end &&
      (!filters.source || i.currentSource === filters.source) &&
      (!filters.staffId || i.assignedStaffId === filters.staffId) &&
      (!filters.dealType || i.dealType === filters.dealType),
  );
  const visible = new Set(inquiries.map((i) => i.id));
  const event = (type: string, n: number) => ({
    type,
    quality:
      state.qualityRevisions
        .filter((r) => r.kind === "event" && r.key === `${type}:${id(n)}`)
        .at(-1)?.quality ?? "production",
    leadId: id(100 + n),
    inquiryId: id(n),
    staffId: staff,
    branchIdAtEvent: branch,
    eventKey: `${type}:${id(n)}`,
    occurredAt: "2026-09-30T00:15:00Z",
  });
  const qualifications = state.qualifications.map((q) => {
    const key = `lead_qualified:${q.leadId}`;
    return {
      type: "lead_qualified",
      quality:
        state.qualityRevisions.filter((r) => r.kind === "event" && r.key === key).at(-1)?.quality ??
        "unknown",
      leadId: q.leadId,
      inquiryId: null,
      staffId: q.staffId,
      branchIdAtEvent: q.branchId,
      eventKey: key,
      occurredAt: q.qualifiedAt,
    };
  });
  const events = [
    ...(which
      ? []
      : [event("assignment_confirmed", 1), event("internal_ack", 2), event("human_response", 2)]),
    ...qualifications,
  ].filter((e) =>
    e.type === "lead_qualified"
      ? inquiries.some((i) => i.crmLeadId === e.leadId)
      : e.inquiryId !== null && visible.has(e.inquiryId),
  );
  const deals = (which ? [] : ["sale", "rent"])
    .map((dealType, index) => ({
      transactionId: id(700 + index),
      version: 1,
      current: true,
      status: "verified_attributed",
      quality: "production",
      dealType,
      leadId: id(101 + index),
      confirmedAt: "2026-09-30T01:00:00Z",
      price: dealType === "sale" ? "10000000.00" : "18000.00",
      commissionReceivable: dealType === "sale" ? "100000.00" : null,
    }))
    .filter(
      (d) =>
        (!filters.dealType || d.dealType === filters.dealType) &&
        (!filters.source || inquiries.some((i) => i.crmLeadId === d.leadId)),
    );
  return {
    inquiries,
    events,
    deals,
    credits: [],
    backlog: { openInquiries: which ? 1 : 7, unknownQuality: which ? 0 : 1 },
    backlogRows: [],
    filters,
    asOf: "2026-10-03T01:00:00Z",
  };
}
async function read(name: string, value: unknown, mode: string) {
  state.calls.push({ name, input: value, actor: state.actor, binding: state.binding });
  const snapshot = input(value);
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) => state.pending.push({ release }));
  if (mode === "failure") throw Error("Owned report read outage");
  if (mode.endsWith("denied")) throw new Response("Owned forbidden", { status: 403 });
  return snapshot;
}
export async function fetchSalesPerformance(filters: unknown) {
  return calculateSalesPerformance(await read("report", filters, state.reportMode));
}
export async function fetchSalesPerformanceRecords(value: {
  filters: unknown;
  drilldownKey: string;
  cursor?: string | null;
}) {
  const page = selectPerformanceRecords(
    await read("records", value.filters, state.recordsMode),
    value.drilldownKey,
    value.cursor ?? null,
  );
  // Test-only backend read port. Production metadata is independently checked with real SQL.
  return {
    ...page,
    records: page.records.map((record) => {
      const original = state.qualifications.find(
        (q) =>
          q.leadId === record.leadId &&
          q.actor === state.actor &&
          q.staffId === id(600 + scope()) &&
          q.branchId === id(500 + scope()),
      );
      return record.kind === "inquiry" && original
        ? {
            ...record,
            qualification: {
              qualifiedAt: original.qualifiedAt,
              evidence: original.evidence,
              eventKey: `lead_qualified:${original.leadId}`,
            },
          }
        : record;
    }),
  };
}
export async function fetchPerformanceFilterOptions() {
  state.calls.push({ name: "options", actor: state.actor, binding: state.binding, input: null });
  const which = scope();
  return {
    canCorrect: state.role === "admin" && !state.denied,
    branches: [{ id: id(500 + which), name: which ? "合成分行乙" : "合成分行甲" }],
    staff: [
      { id: id(600 + which), name: which ? "合成同事乙" : "合成同事甲", branchId: id(500 + which) },
    ],
  };
}
export async function fetchOperationalAnalytics(range: { start: string; end: string }) {
  const which = scope(),
    count = which ? 1 : 7;
  state.calls.push({
    name: "operational",
    actor: state.actor,
    binding: state.binding,
    input: range,
  });
  return {
    range,
    summary: {
      inquiries: count,
      linkedLeads: count,
      leads: count,
      conversations: count,
      unassignedInquiries: 0,
      unassignedLeads: 0,
      unassignedConversations: 0,
      openConversations: count,
    },
    days: [
      {
        day: range.start,
        inquiries: count,
        linkedLeads: count,
        leads: count,
        conversations: count,
      },
    ],
  };
}
async function correct(kind: string, key: string, quality: string, reason: string) {
  const actor = state.actor;
  state.calls.push({
    name: "quality",
    actor,
    binding: state.binding,
    input: { kind, key, quality, reason },
  });
  if (state.role !== "admin" || state.denied)
    throw new Response("Owned correction forbidden", { status: 403 });
  if (reason.trim().length < 8 || !["production", "test", "spam", "unknown"].includes(quality))
    throw new Response("Owned invalid correction", { status: 400 });
  const mode = state.qualityMode;
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) => state.pending.push({ release }));
  if (mode.endsWith("failure")) throw Error("Owned correction refused before write");
  state.qualityRevisions.push({ kind, key, quality, reason: reason.trim(), actor });
  sessionStorage.setItem("performance-quality-revisions", JSON.stringify(state.qualityRevisions));
}
export async function correctInquiryQuality(input: {
  inquiryId: string;
  quality: string;
  reason: string;
}) {
  await correct("inquiry", input.inquiryId, input.quality, input.reason);
  return { inquiryId: input.inquiryId, affectedHkDay: "2026-09-30" };
}
export async function correctPerformanceEventQuality(input: {
  eventKey: string;
  quality: string;
  reason: string;
}) {
  await correct("event", input.eventKey, input.quality, input.reason);
  return { eventKey: input.eventKey, affectedHkDay: "2026-09-30" };
}
export async function qualifyPerformanceLead(value: {
  leadId: string;
  qualifiedAt: string;
  evidence: string;
}) {
  const actor = state.actor,
    which = scope(),
    mode = state.qualificationMode;
  state.calls.push({ name: "qualification", actor, binding: state.binding, input: value });
  if (mode === "replay-denied")
    throw new ServerFnResponseError("Owned current authority denied", 403);
  const snapshot = input({ start: "2026-09-30", end: "2026-09-30", cohortWindowDays: 90 });
  if (
    !value.evidence ||
    value.evidence.trim().length < 8 ||
    !Number.isFinite(Date.parse(value.qualifiedAt))
  )
    throw new ServerFnResponseError("Owned invalid qualification", 400);
  if (!snapshot.inquiries.some((i) => i.crmLeadId === value.leadId))
    throw new ServerFnResponseError("Owned source outside current scope", 409);
  const existing = state.qualifications.find((q) => q.leadId === value.leadId);
  if (existing) {
    if (
      existing.actor !== actor ||
      existing.evidence !== value.evidence.trim() ||
      new Date(existing.qualifiedAt).getTime() !== new Date(value.qualifiedAt).getTime()
    )
      throw new ServerFnResponseError("Owned different qualification request", 409);
    if (mode === "commit-unknown") throw Error("Owned response lost after retained qualification");
    return { eventKey: `lead_qualified:${value.leadId}` };
  }
  if (
    !["contacted", "viewing", "negotiating", "closed_won"].includes(
      state.leadStages[value.leadId] ?? "contacted",
    )
  )
    throw new ServerFnResponseError("Owned ineligible source", 409);
  if (mode.startsWith("delayed"))
    await new Promise<void>((release) => state.pending.push({ release }));
  if (mode.endsWith("failure")) throw Error("Owned qualification refused before write");

  state.qualifications.push({
    ...value,
    evidence: value.evidence.trim(),
    actor,
    staffId: id(600 + which),
    branchId: id(500 + which),
  });
  sessionStorage.setItem("performance-qualifications", JSON.stringify(state.qualifications));
  if (mode === "commit-unknown") throw Error("Owned response lost after committed qualification");
  return { eventKey: `lead_qualified:${value.leadId}` };
}
