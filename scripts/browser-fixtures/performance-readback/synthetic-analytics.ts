// Actual calculation/drilldown; synthetic read-only Auth/API ports, not SQL/provider evidence.
import {
  calculateSalesPerformance,
  parsePerformanceFilters,
} from "../../../src/lib/analytics/sales-performance.mjs";
import { selectPerformanceRecords } from "../../../src/lib/analytics/sales-performance-drilldown.mjs";
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const state = {
  actor: sessionStorage.getItem("performance-readback-actor") ?? "actor-a",
  binding: "staff-a",
  role: "manager",
  denied: false,
  reportMode: sessionStorage.getItem("performance-delayed-initial") === "true" ? "delayed" : "ok",
  recordsMode: "ok",
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
    quality,
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
    quality: "production",
    leadId: id(100 + n),
    inquiryId: id(n),
    staffId: staff,
    branchIdAtEvent: branch,
    eventKey: `${type}:${id(n)}`,
    occurredAt: "2026-09-30T00:15:00Z",
  });
  const events = (
    which
      ? []
      : [event("assignment_confirmed", 1), event("internal_ack", 2), event("human_response", 2)]
  ).filter((e) => visible.has(e.inquiryId));
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
  return selectPerformanceRecords(
    await read("records", value.filters, state.recordsMode),
    value.drilldownKey,
    value.cursor ?? null,
  );
}
export async function fetchPerformanceFilterOptions() {
  state.calls.push({ name: "options", actor: state.actor, binding: state.binding, input: null });
  const which = scope();
  return {
    canCorrect: false,
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
export async function correctInquiryQuality() {
  throw Error("Read-only fixture;quality mutation not accepted");
}
export async function correctPerformanceEventQuality() {
  throw Error("Read-only fixture;quality mutation not accepted");
}
export async function qualifyPerformanceLead() {
  throw Error("Read-only fixture;lead mutation not accepted");
}
