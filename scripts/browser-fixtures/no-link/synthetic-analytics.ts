/** Real calculation/drilldown, synthetic read adapter. No DB/Auth/provider claims. */
import {
  calculateSalesPerformance,
  parsePerformanceFilters,
} from "../../../src/lib/analytics/sales-performance.mjs";
import { selectPerformanceRecords } from "../../../src/lib/analytics/sales-performance-drilldown.mjs";
const id = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const branch = id(500),
  otherBranch = id(501),
  staff = id(600);
const asOf = "2026-10-03T01:00:00Z";
const inquiry = (
  n: number,
  quality = "production",
  sourceEvidence = "unknown",
  createdAt = "2026-09-30T00:00:00Z",
) => ({
  id: id(n),
  quality,
  sourceEvidence,
  currentSource: sourceEvidence === "message_28hse" ? "28hse" : "whatsapp",
  createdAt,
  customerMessageAt: createdAt,
  webhookReceivedAt: null,
  crmLeadId: id(n + 100),
  firstLeadInquiryId: id(n),
  assignedStaffId: staff,
  branchId: branch,
  responseDueAt: null,
  servicePolicyId: null,
});
const inquiries = [
  inquiry(1, "production", "message_28hse", "2026-09-29T16:01:00Z"),
  inquiry(2, "production", "tracked_open"),
  inquiry(3, "production", "unknown", "2026-09-30T15:59:00Z"),
  inquiry(4, "test"),
  inquiry(5, "spam"),
  inquiry(6, "unknown"),
  inquiry(7, "production", "unknown", "2026-09-30T16:01:00Z"),
  { ...inquiry(8), branchId: otherBranch },
];
const event = (type: string, n: number) => ({
  type,
  quality: "production",
  leadId: id(n + 100),
  inquiryId: id(n),
  staffId: staff,
  branchIdAtEvent: branch,
  eventKey: `${type}:${id(n)}`,
  occurredAt: "2026-09-30T00:15:00Z",
});
const events = [
  event("assignment_confirmed", 1),
  event("internal_ack", 2),
  event("human_response", 2),
];
const deals = ["sale", "rent"].map((dealType, index) => ({
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
}));
const reads: { name: string; input: unknown }[] = [];
Object.assign(window, { analyticsFixture: { reads, branch, staff } });
function input(value: unknown) {
  const filters = parsePerformanceFilters(value);
  const actor = sessionStorage.getItem("no-link-fixture-actor");
  if (actor !== "manager") throw Object.assign(Error("Denied"), { status: 403 });
  if (filters.branchId && filters.branchId !== branch)
    throw Object.assign(Error("Scope denied"), { status: 403 });
  if (sessionStorage.getItem("analytics-fixture-fail") === "true")
    throw Error("Synthetic report read outage");
  const start = Date.parse(filters.start + "T00:00:00Z") - 8 * 3600000;
  const end = Date.parse(filters.end + "T00:00:00Z") + 16 * 3600000;
  const visible = inquiries.filter(
    (i) =>
      i.branchId === branch &&
      Date.parse(i.createdAt) >= start &&
      Date.parse(i.createdAt) < end &&
      (!filters.source || i.currentSource === filters.source),
  );
  const visibleIds = new Set(visible.map((i) => i.id));
  return {
    inquiries: visible,
    events: events.filter((e) => visibleIds.has(e.inquiryId)),
    deals,
    credits: [],
    backlog: { openInquiries: 3, unknownQuality: 1 },
    backlogRows: [],
    filters,
    asOf,
  };
}
export async function fetchSalesPerformance(filters: unknown) {
  reads.push({ name: "report", input: filters });
  return calculateSalesPerformance(input(filters));
}
export async function fetchSalesPerformanceRecords(value: {
  filters: unknown;
  drilldownKey: string;
  cursor?: string | null;
}) {
  reads.push({ name: "records", input: value });
  return selectPerformanceRecords(input(value.filters), value.drilldownKey, value.cursor ?? null);
}
export async function fetchPerformanceFilterOptions() {
  return {
    canCorrect: false,
    branches: [{ id: branch, name: "合成分行甲" }],
    staff: [{ id: staff, name: "合成同事甲", branchId: branch }],
  };
}
export async function fetchOperationalAnalytics(range: { start: string; end: string }) {
  if (sessionStorage.getItem("no-link-fixture-actor") !== "manager")
    throw Object.assign(Error("Denied"), { status: 403 });
  return {
    range,
    summary: {
      inquiries: 3,
      linkedLeads: 3,
      leads: 3,
      conversations: 3,
      unassignedInquiries: 0,
      unassignedLeads: 0,
      unassignedConversations: 0,
      openConversations: 3,
    },
    days: [{ day: range.start, inquiries: 3, linkedLeads: 3, leads: 3, conversations: 3 }],
  };
}
export async function correctInquiryQuality() {
  throw Error("No mutation allowed in this readback fixture");
}
export async function correctPerformanceEventQuality() {
  throw Error("No mutation allowed in this readback fixture");
}
export async function qualifyPerformanceLead() {
  throw Error("No mutation allowed in this readback fixture");
}
