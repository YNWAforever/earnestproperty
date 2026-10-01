import assert from "node:assert/strict";
import test from "node:test";
import { calculateSalesPerformance, parsePerformanceFilters } from "./sales-performance.mjs";
import { selectPerformanceRecords } from "./sales-performance-drilldown.mjs";
const filters = parsePerformanceFilters({
  start: "2026-09-29",
  end: "2026-09-29",
  cohortWindowDays: 30,
});
const row = (id, sourceEvidence, currentSource) => ({
  id,
  quality: "production",
  createdAt: "2026-09-29T16:01:00Z",
  customerMessageAt: "2026-09-29T16:01:00Z",
  crmLeadId: null,
  firstLeadInquiryId: id,
  sourceEvidence,
  currentSource,
  responseDueAt: null,
  servicePolicyId: null,
});
const inquiries = [
  row("message", "message_28hse", "28hse"),
  row("unknown", "unknown", "whatsapp"),
  row("tracked", "tracked_open", "whatsapp"),
];
test("message-derived 28Hse without a click contributes enquiry count but no click conversion", () => {
  const report = calculateSalesPerformance({
    inquiries,
    events: [],
    deals: [],
    credits: [],
    backlog: { openInquiries: 3, unknownQuality: 0 },
    filters,
    asOf: "2026-09-30T00:00:00Z",
  });
  assert.equal(report.acquisition.inquiries.value, 3);
  assert.equal(report.sourceEvidence.messageDerived28hse.value, 1);
  assert.equal(report.sourceEvidence.trackedOpenEnquiries.value, 1);
  assert.equal(report.sourceEvidence.unknownOrigin.value, 1);
  assert.equal(report.sourceEvidence.clickToEnquiryRate.value, null);
  assert.equal(report.sourceEvidence.clickToEnquiryRate.status, "unavailable");
  assert.equal(report.sourceEvidence.messageDerived28hse.denominator, 3);
  const page = selectPerformanceRecords(
    { inquiries, events: [], deals: [], backlogRows: [], filters, asOf: "2026-09-30T00:00:00Z" },
    "message_28hse",
    null,
  );
  assert.deepEqual(
    page.records.map((r) => r.id),
    ["message"],
  );
});

test("bot-only, internal note and provider accepted are not human response evidence", () => {
  const events = ["bot_outbound", "internal_note", "provider_accepted"].map((type) => ({
    type,
    quality: "production",
    inquiryId: "message",
    occurredAt: "2026-09-29T16:03:00Z",
  }));
  const report = calculateSalesPerformance({
    inquiries: [inquiries[0]],
    events,
    deals: [],
    credits: [],
    backlog: { openInquiries: 1, unknownQuality: 0 },
    filters,
    asOf: "2026-09-30T00:00:00Z",
  });
  assert.equal(report.followup.unanswered.value, 1);
  assert.equal(report.followup.responseMedianMinutes.value, null);
});
