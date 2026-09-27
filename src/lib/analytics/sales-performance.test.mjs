import assert from "node:assert/strict";
import test from "node:test";
import { calculateSalesPerformance, parsePerformanceFilters } from "./sales-performance.mjs";
import { selectPerformanceRecords } from "./sales-performance-drilldown.mjs";

const base = parsePerformanceFilters({
  start: "2026-06-01",
  end: "2026-06-30",
  cohortWindowDays: 90,
});
const asOf = "2026-10-01T00:00:00Z";
const inquiry = (n, quality = "production") => ({
  id: "inquiry-" + n,
  quality,
  createdAt: "2026-06-01T00:00:00Z",
  customerMessageAt: "2026-06-01T00:00:00Z",
  webhookReceivedAt: null,
  crmLeadId: "lead-" + n,
  firstLeadInquiryId: "inquiry-" + n,
  responseDueAt: null,
  servicePolicyId: null,
});
const deal = (n, extra = {}) => ({
  transactionId: "tx-" + n,
  version: 1,
  current: true,
  status: "verified_attributed",
  quality: "production",
  dealType: "sale",
  leadId: "lead-" + n,
  confirmedAt: "2026-06-20T00:00:00Z",
  price: "10000000.00",
  commissionReceivable: "100000.00",
  ...extra,
});
const event = (type, n, other = {}) => ({
  type,
  quality: "production",
  leadId: "lead-" + n,
  inquiryId: "inquiry-" + n,
  occurredAt: "2026-06-01T00:30:00Z",
  ...other,
});
test("90-day acquisition conversion uses cohort denominator and excludes test/spam", () => {
  const inquiries = Array.from({ length: 10 }, (_, i) => inquiry(i + 1));
  inquiries.push(
    inquiry(11, "test"),
    inquiry(12, "test"),
    inquiry(13, "spam"),
    inquiry(14, "unknown"),
  );
  const events = [
    ...Array.from({ length: 6 }, (_, i) => event("lead_qualified", i + 1)),
    ...Array.from({ length: 3 }, (_, i) => event("viewing_completed", i + 1)),
    event("human_response", 1, { occurredAt: "2026-06-01T00:15:00Z" }),
  ];
  const result = calculateSalesPerformance({
    inquiries,
    events,
    deals: [deal(1), deal(2)],
    credits: [],
    backlog: { openInquiries: 4, unknownQuality: 1 },
    filters: base,
    asOf,
  });
  assert.equal(result.acquisition.inquiries.value, 10);
  assert.equal(result.acquisition.qualifiedLeads.value, 6);
  assert.equal(result.acquisition.completedViewings.value, 3);
  assert.equal(result.acquisition.saleConversion.value, 0.2);
  assert.equal(result.acquisition.saleConversion.status, "ready");
  assert.deepEqual(result.qualityCoverage.inquiries, {
    production: 10,
    test: 2,
    spam: 1,
    unknown: 1,
  });
  assert.equal(result.followup.unanswered.value, 9);
});
test("sale and rent have separate money semantics, credits do not duplicate company deals", () => {
  const rent = deal(3, { dealType: "rent", price: "20000.00", commissionReceivable: null });
  const credits = [
    { transactionId: "tx-1", version: 1, staffId: "a", branchIdAtClose: "branch", shareBps: 6000 },
    { transactionId: "tx-1", version: 1, staffId: "b", branchIdAtClose: "branch", shareBps: 4000 },
  ];
  const result = calculateSalesPerformance({
    inquiries: [inquiry(1)],
    events: [],
    deals: [deal(1), rent, deal(4, { status: "cancelled" }), deal(5, { quality: "unknown" })],
    credits,
    backlog: { openInquiries: 0, unknownQuality: 0 },
    filters: base,
    asOf,
  });
  assert.equal(result.sales.deals.value, 2);
  assert.equal(result.sales.saleValue.value, "10000000.00");
  assert.equal(result.sales.commissionReceivable.value, "100000.00");
  assert.equal(result.agents.find((a) => a.staffId === "a").weightedSaleValue, "6000000.00");
  assert.equal(result.agents.find((a) => a.staffId === "a").commissionReceivable, "60000.00");
  assert.equal(result.agents.find((a) => a.staffId === "b").weightedSaleValue, "4000000.00");
});
test("zero denominator, immature cohort, and missing policy evidence remain explicit", () => {
  const result = calculateSalesPerformance({
    inquiries: [],
    events: [],
    deals: [],
    credits: [],
    backlog: { openInquiries: 0, unknownQuality: 0 },
    filters: base,
    asOf: "2026-07-01T00:00:00Z",
  });
  assert.equal(result.acquisition.saleConversion.value, null);
  assert.equal(result.acquisition.saleConversion.status, "provisional");
  assert.equal(result.followup.businessSla.status, "unavailable");
  assert.equal(result.sales.commissionReceivable.value, null);
});
test("invalid filters reject broad or forged scopes", () => {
  assert.throws(() => parsePerformanceFilters({ ...base, end: "2027-01-01" }), /range/);
  assert.throws(() => parsePerformanceFilters({ ...base, start: "2026-02-30" }), /date/);
  assert.throws(() => parsePerformanceFilters({ ...base, source: "all;DROP TABLE" }), /source/);
  assert.throws(() => parsePerformanceFilters({ ...base, branchId: "not-uuid" }), /branchId/);
});

test("drilldown records match production cohort counts and page without overlap", () => {
  const inquiries = Array.from({ length: 62 }, (_, i) => ({
    ...inquiry(i + 1),
    id: "inquiry-" + String(i + 1).padStart(3, "0"),
    firstLeadInquiryId: "inquiry-" + String(i + 1).padStart(3, "0"),
  }));
  const input = { inquiries, events: [], deals: [], backlogRows: [], filters: base, asOf };
  const first = selectPerformanceRecords(input, "inquiries", null);
  assert.equal(first.records.length, 50);
  assert.ok(first.nextCursor);
  const second = selectPerformanceRecords(input, "inquiries", first.nextCursor);
  assert.equal(second.records.length, 12);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.records, ...second.records].map((r) => r.id)).size, 62);
  assert.throws(() => selectPerformanceRecords(input, "unknown_key", null), /drilldown/);
  assert.throws(() => selectPerformanceRecords(input, "inquiries", "garbage"), /cursor/);
});
test("unverified or predating human response is omitted from measured sample and drilldown", () => {
  const i = inquiry(1);
  const early = event("human_response", 1, { occurredAt: "2026-05-31T23:00:00Z" });
  const input = {
    inquiries: [i],
    events: [early],
    deals: [],
    credits: [],
    backlog: { openInquiries: 0, unknownQuality: 0 },
    backlogRows: [],
    filters: base,
    asOf,
  };
  const report = calculateSalesPerformance(input);
  assert.equal(report.followup.responseMedianMinutes.value, null);
  assert.equal(report.followup.unanswered.value, 1);
  assert.equal(selectPerformanceRecords(input, "responses", null).records.length, 0);
  assert.equal(selectPerformanceRecords(input, "unanswered", null).records.length, 1);
});

test("quality queues retain unknown, test and spam events and deals for restoration", () => {
  const i = inquiry(1);
  const events = [
    event("viewing_completed", 1, { eventKey: "viewing_completed:one", quality: "unknown" }),
    event("human_response", 1, { eventKey: "human_response:two", quality: "test" }),
    event("assignment_confirmed", 1, { eventKey: "assignment_confirmed:three", quality: "spam" }),
  ];
  const deals = [
    deal(1, { quality: "unknown", eventKey: "deal_confirmed:one" }),
    deal(2, { quality: "test", eventKey: "deal_confirmed:two" }),
    deal(3, { quality: "spam", eventKey: "deal_confirmed:three" }),
  ];
  const input = {
    inquiries: [i],
    events,
    deals,
    credits: [],
    backlog: { openInquiries: 0, unknownQuality: 0 },
    backlogRows: [],
    filters: base,
    asOf,
  };
  const report = calculateSalesPerformance(input);
  assert.deepEqual(report.qualityCoverage.events, { production: 0, test: 1, spam: 1, unknown: 1 });
  assert.equal(report.qualityCoverage.deals.test, 1);
  assert.equal(
    selectPerformanceRecords(input, "quality_unknown_events", null).records[0].eventKey,
    "viewing_completed:one",
  );
  assert.equal(
    selectPerformanceRecords(input, "quality_test_deals", null).records[0].eventKey,
    "deal_confirmed:two",
  );
  assert.equal(selectPerformanceRecords(input, "quality_spam_events", null).records.length, 1);
});
