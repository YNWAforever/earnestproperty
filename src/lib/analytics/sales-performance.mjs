const day = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sources = new Set(["website", "whatsapp", "28hse", "youtube", "other", "unknown"]);
export function parsePerformanceFilters(input) {
  if (
    !input ||
    !day.test(input.start) ||
    !day.test(input.end) ||
    !Number.isFinite(Date.parse(input.start + "T00:00:00Z")) ||
    !Number.isFinite(Date.parse(input.end + "T00:00:00Z")) ||
    new Date(input.start + "T00:00:00Z").toISOString().slice(0, 10) !== input.start ||
    new Date(input.end + "T00:00:00Z").toISOString().slice(0, 10) !== input.end
  )
    throw new Error("Invalid date");
  const span = (Date.parse(input.end) - Date.parse(input.start)) / 86400000;
  if (span < 0 || span >= 90) throw new Error("Date range must be 1–90 days");
  if (![30, 90].includes(input.cohortWindowDays)) throw new Error("Invalid cohort window");
  for (const key of ["branchId", "staffId"])
    if (input[key] && !uuid.test(input[key])) throw new Error("Invalid " + key);
  if (input.source && !sources.has(input.source)) throw new Error("Invalid source");
  if (input.dealType && !["sale", "rent"].includes(input.dealType))
    throw new Error("Invalid deal type");
  return {
    start: input.start,
    end: input.end,
    branchId: input.branchId || null,
    staffId: input.staffId || null,
    source: input.source || null,
    dealType: input.dealType || null,
    cohortWindowDays: input.cohortWindowDays,
  };
}
const metric = (
  value,
  unit,
  denominator = null,
  sampleSize = null,
  status = "ready",
  drilldownKey = null,
) => ({ value, unit, denominator, sampleSize, status, drilldownKey });
const timestamp = (value) => (value == null ? null : new Date(value).getTime());
const quantile = (numbers, p) => {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * p) - 1];
};
const decimal = (value) => (value == null ? null : Number(value));
const good = (row) => row.quality === "production";
export function measuredResponseMinutes(inquiry, reply) {
  if (!reply) return null;
  const intake = timestamp(
    inquiry.customerMessageAt || inquiry.webhookReceivedAt || inquiry.createdAt,
  );
  const responded = timestamp(reply.occurredAt);
  if (intake == null || responded == null || responded < intake) return null;
  return (responded - intake) / 60000;
}
export function calculateSalesPerformance({
  inquiries,
  events,
  deals,
  credits,
  backlog,
  legacyTransactions = 0,
  filters,
  asOf,
}) {
  const cohort = inquiries.filter(good);
  const byLead = new Map();
  for (const i of cohort)
    if (i.crmLeadId && i.firstLeadInquiryId === i.id) byLead.set(i.crmLeadId, i);
  const eventSet = (type) => events.filter((e) => e.type === type && good(e));
  const withinCohort = (e) => {
    const i = byLead.get(e.leadId);
    return (
      i &&
      timestamp(e.occurredAt) >= timestamp(i.createdAt) &&
      timestamp(e.occurredAt) <= timestamp(i.createdAt) + filters.cohortWindowDays * 86400000 &&
      timestamp(e.occurredAt) <= timestamp(asOf)
    );
  };
  const qualifiedEvents = eventSet("lead_qualified").filter(withinCohort);
  const qualified = new Set(qualifiedEvents.map((e) => e.leadId));
  const viewings = eventSet("viewing_completed").filter(withinCohort);
  const confirmedAssignments = eventSet("assignment_confirmed").filter(
    (e) => cohort.some((i) => i.id === e.inquiryId) && timestamp(e.occurredAt) <= timestamp(asOf),
  );
  const responses = new Map(
    eventSet("human_response")
      .filter((e) => timestamp(e.occurredAt) <= timestamp(asOf))
      .map((e) => [e.inquiryId, e]),
  );
  const elapsed = [];
  let unanswered = 0,
    overdue = 0,
    slaSample = 0,
    slaMet = 0;
  for (const i of cohort) {
    const reply = responses.get(i.id);
    const minutes = measuredResponseMinutes(i, reply);
    if (minutes !== null) elapsed.push(minutes);
    else {
      unanswered++;
      if (i.responseDueAt && timestamp(i.responseDueAt) < timestamp(asOf)) overdue++;
    }
    if (i.responseDueAt && i.servicePolicyId && minutes !== null) {
      slaSample++;
      if (timestamp(reply.occurredAt) <= timestamp(i.responseDueAt)) slaMet++;
    }
  }
  const currentDeals = deals.filter(
    (d) =>
      d.current &&
      d.status.startsWith("verified_") &&
      d.quality === "production" &&
      timestamp(d.confirmedAt) <= timestamp(asOf),
  );
  const soldLeads = new Set(currentDeals.filter((d) => d.dealType === "sale").map((d) => d.leadId));
  let conversions = 0;
  for (const i of cohort) {
    if (i.firstLeadInquiryId !== i.id || !soldLeads.has(i.crmLeadId)) continue;
    const deal = currentDeals.find(
      (d) =>
        d.dealType === "sale" &&
        d.leadId === i.crmLeadId &&
        timestamp(d.confirmedAt) >= timestamp(i.createdAt) &&
        timestamp(d.confirmedAt) <= timestamp(i.createdAt) + filters.cohortWindowDays * 86400000,
    );
    if (deal) conversions++;
  }
  const matured =
    timestamp(asOf) >= Date.parse(filters.end + "T16:00:00Z") + filters.cohortWindowDays * 86400000;
  const rangeStart = Date.parse(filters.start + "T00:00:00Z") - 8 * 3600000;
  const rangeEnd = Date.parse(filters.end + "T00:00:00Z") + 16 * 3600000;
  const rangeDeals = currentDeals.filter(
    (d) => timestamp(d.confirmedAt) >= rangeStart && timestamp(d.confirmedAt) < rangeEnd,
  );
  const dealIds = new Set(rangeDeals.map((d) => d.transactionId));
  const saleValue = rangeDeals
    .filter((d) => d.dealType === "sale")
    .reduce((sum, d) => sum + (decimal(d.price) || 0), 0);
  const saleKnown = rangeDeals.filter((d) => d.dealType === "sale" && d.price != null).length;
  const commissionKnown = rangeDeals.filter((d) => d.commissionReceivable != null);
  const commission = commissionKnown.reduce((sum, d) => sum + decimal(d.commissionReceivable), 0);
  const agentsMap = new Map();
  const ensureAgent = (staffId, branchId = null) => {
    if (!agentsMap.has(staffId))
      agentsMap.set(staffId, {
        staffId,
        branchId,
        deals: new Set(),
        weightedSaleValue: 0,
        commission: 0,
        commissionKnown: 0,
        inquiries: 0,
        qualifiedLeads: 0,
        completedViewings: 0,
        humanResponses: 0,
      });
    const item = agentsMap.get(staffId);
    if (!item.branchId && branchId) item.branchId = branchId;
    return item;
  };
  for (const i of cohort) if (i.assignedStaffId) ensureAgent(i.assignedStaffId).inquiries++;
  for (const e of qualifiedEvents)
    if (e.staffId) ensureAgent(e.staffId, e.branchIdAtEvent).qualifiedLeads++;
  for (const e of viewings)
    if (e.staffId) ensureAgent(e.staffId, e.branchIdAtEvent).completedViewings++;
  for (const e of responses.values())
    if (e.staffId && cohort.some((i) => i.id === e.inquiryId))
      ensureAgent(e.staffId, e.branchIdAtEvent).humanResponses++;
  for (const c of credits) {
    const deal = rangeDeals.find(
      (d) => d.transactionId === c.transactionId && d.version === c.version,
    );
    if (!deal) continue;
    const item = ensureAgent(c.staffId, c.branchIdAtClose);
    item.deals.add(deal.transactionId);
    if (deal.dealType === "sale" && deal.price != null)
      item.weightedSaleValue += (decimal(deal.price) * c.shareBps) / 10000;
    if (deal.commissionReceivable != null) {
      item.commission += (decimal(deal.commissionReceivable) * c.shareBps) / 10000;
      item.commissionKnown++;
    }
    agentsMap.set(c.staffId, item);
  }
  const unknownInquiries = inquiries.filter((i) => i.quality === "unknown").length;
  const unknownDeals = deals.filter(
    (d) =>
      d.current &&
      d.quality === "unknown" &&
      timestamp(d.confirmedAt) >= rangeStart &&
      timestamp(d.confirmedAt) < rangeEnd,
  ).length;
  return {
    range: { start: filters.start, end: filters.end, cohortWindowDays: filters.cohortWindowDays },
    asOf,
    qualityCoverage: {
      inquiries: {
        production: cohort.length,
        test: inquiries.filter((i) => i.quality === "test").length,
        spam: inquiries.filter((i) => i.quality === "spam").length,
        unknown: unknownInquiries,
      },
      deals: {
        production: rangeDeals.length,
        unknown: unknownDeals,
        unattributed: legacyTransactions,
      },
    },
    acquisition: {
      inquiries: metric(cohort.length, "count", null, cohort.length, "ready", "inquiries"),
      uniqueCustomers: metric(null, "count", null, null, "unavailable", null),
      qualifiedLeads: metric(
        qualified.size,
        "count",
        cohort.length,
        qualified.size,
        "ready",
        "qualified",
      ),
      completedViewings: metric(
        viewings.length,
        "count",
        cohort.length,
        viewings.length,
        "ready",
        "viewings",
      ),
      saleConversion: metric(
        cohort.length ? conversions / cohort.length : null,
        "ratio",
        cohort.length,
        conversions,
        matured ? "ready" : "provisional",
        "converted",
      ),
    },
    followup: {
      confirmedAssignments: metric(
        confirmedAssignments.length,
        "count",
        cohort.length,
        confirmedAssignments.length,
        "ready",
        "assignments",
      ),
      responseMedianMinutes: metric(
        quantile(elapsed, 0.5),
        "minutes",
        cohort.length,
        elapsed.length,
        elapsed.length ? "ready" : "unavailable",
        "responses",
      ),
      responseP90Minutes: metric(
        quantile(elapsed, 0.9),
        "minutes",
        cohort.length,
        elapsed.length,
        elapsed.length ? "ready" : "unavailable",
        "responses",
      ),
      unanswered: metric(unanswered, "count", cohort.length, unanswered, "ready", "unanswered"),
      overdue: metric(overdue, "count", cohort.length, overdue, "ready", "overdue"),
      businessSla: metric(
        slaSample ? slaMet / slaSample : null,
        "ratio",
        slaSample,
        slaMet,
        slaSample ? "ready" : "unavailable",
        "sla",
      ),
    },
    sales: {
      deals: metric(dealIds.size, "count", null, dealIds.size, "ready", "deals"),
      saleValue: metric(
        saleKnown ? saleValue.toFixed(2) : null,
        "HKD",
        null,
        saleKnown,
        saleKnown ? "ready" : "unavailable",
        "sale_value",
      ),
      commissionReceivable: metric(
        commissionKnown.length ? commission.toFixed(2) : null,
        "HKD",
        rangeDeals.length,
        commissionKnown.length,
        commissionKnown.length ? "ready" : "unavailable",
        "commission",
      ),
    },
    backlog: {
      openInquiries: metric(
        backlog.openInquiries,
        "count",
        null,
        backlog.openInquiries,
        "ready",
        "open_inquiries",
      ),
      unknownQuality: metric(
        backlog.unknownQuality,
        "count",
        null,
        backlog.unknownQuality,
        "ready",
        "unknown_backlog",
      ),
    },
    agents: [...agentsMap.values()].map((a) => ({
      staffId: a.staffId,
      branchId: a.branchId,
      deals: a.deals.size,
      inquiries: a.inquiries,
      qualifiedLeads: a.qualifiedLeads,
      completedViewings: a.completedViewings,
      humanResponses: a.humanResponses,
      weightedSaleValue: a.weightedSaleValue.toFixed(2),
      commissionReceivable: a.commissionKnown ? a.commission.toFixed(2) : null,
      commissionSampleSize: a.commissionKnown,
    })),
    definitions: {
      inquiries:
        "Unique inquiry rows created within the Hong Kong calendar date range; production quality only. Test, spam and unknown are shown in quality coverage.",
      uniqueCustomers:
        "Unavailable until a verified, deduplicated contact identity is present. Inquiry count is not customer count.",
      qualifiedLeads:
        "Unique explicit lead-qualification evidence linked to the earliest production inquiry for a lead, recorded within the selected cohort window.",
      completedViewings:
        "Completed CRM viewing activities linked to the earliest production inquiry for a lead within the cohort window; cancelled or unfinished activities are excluded.",
      saleConversion:
        "Number of earliest production inquiries linked to a current verified production sale confirmed within 30/90 calendar days of intake, divided by all production inquiries in the acquisition cohort. Incomplete windows are provisional.",
      confirmedAssignments:
        "Provider-confirmed assignment requests attached unambiguously to a production inquiry; requested and current assignee states are separate.",
      responseMinutes:
        "Median and nearest-rank p90 elapsed wall-clock minutes from customer message/receipt to trusted first human response, only for production inquiries and production response evidence. Unanswered inquiries remain in separate counts.",
      businessSla:
        "Responses at or before the stored approved-policy due time divided by answered production inquiries with both due time and policy ID. Missing policy evidence is unavailable.",
      deals:
        "Unique current verified production-quality transactions confirmed during the selected Hong Kong dates. Cancelled and superseded versions do not count.",
      saleValue:
        "Full verified sale prices in HKD for selected sale transactions with known price; rent is excluded. Staff attribution uses credit weights separately.",
      commissionReceivable:
        "Known HKD receivable amounts on selected verified deals; unknown amounts are excluded and sample size is shown. This is not property sale value or cash received.",
      agentCredits:
        "Per-agent sale price and receivable commission multiplied by saved share basis points; branch comes from the transaction credit snapshot.",
      backlog:
        "Current open inquiry rows at report as-of time, scoped to the actor. This does not reconstruct historical daily backlog.",
      quality:
        "Unreviewed old or new inquiries and deals remain unknown. Test and spam are visible in coverage and excluded from production metrics; legacy verified transactions without attribution are counted separately.",
    },
  };
}
