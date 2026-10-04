import { measuredResponseMinutes } from "./sales-performance.mjs";
const iso = (value) => new Date(value).toISOString();
const time = (value) => (value == null ? null : new Date(value).getTime());
const inRange = (value, filters) => {
  const at = time(value);
  return (
    at != null &&
    at >= Date.parse(filters.start + "T00:00:00Z") - 8 * 3600000 &&
    at < Date.parse(filters.end + "T00:00:00Z") + 16 * 3600000
  );
};
const PAGE_SIZE = 50;
export const PERFORMANCE_DRILLDOWN_KEYS = new Set([
  "inquiries",
  "message_28hse",
  "tracked_open_enquiries",
  "unknown_origin",
  "assignments",
  "qualified",
  "viewings",
  "converted",
  "responses",
  "unanswered",
  "overdue",
  "sla",
  "deals",
  "sale_value",
  "commission",
  "open_inquiries",
  "unknown_backlog",
  "quality_unknown_inquiries",
  "quality_test_inquiries",
  "quality_spam_inquiries",
  "quality_unknown_deals",
  "quality_unknown_events",
  "quality_test_events",
  "quality_spam_events",
  "quality_test_deals",
  "quality_spam_deals",
]);
export function selectPerformanceRecords(
  { inquiries, events, deals, backlogRows, filters, asOf },
  key,
  cursor,
) {
  if (!PERFORMANCE_DRILLDOWN_KEYS.has(key)) throw new Error("Invalid drilldown");
  const cohort = inquiries.filter((i) => i.quality === "production");
  const first = new Map(
    cohort.filter((i) => i.crmLeadId && i.firstLeadInquiryId === i.id).map((i) => [i.crmLeadId, i]),
  );
  const relevant = (type) =>
    events.filter(
      (e) =>
        e.type === type &&
        e.quality === "production" &&
        first.has(e.leadId) &&
        time(e.occurredAt) >= time(first.get(e.leadId).createdAt) &&
        time(e.occurredAt) <=
          time(first.get(e.leadId).createdAt) + filters.cohortWindowDays * 86400000 &&
        time(e.occurredAt) <= time(asOf),
    );
  const replies = new Map(
    events
      .filter(
        (e) =>
          e.type === "human_response" &&
          e.quality === "production" &&
          time(e.occurredAt) <= time(asOf),
      )
      .map((e) => [e.inquiryId, e]),
  );
  const current = deals.filter(
    (d) =>
      d.current &&
      d.status.startsWith("verified_") &&
      d.quality === "production" &&
      time(d.confirmedAt) <= time(asOf),
  );
  const selectedDeals = current.filter((d) => inRange(d.confirmedAt, filters));
  const asRecord = (kind, row, id, occurredAt) => ({
    kind,
    id: String(id),
    occurredAt: iso(occurredAt),
    quality: row.quality,
    ...(Object.hasOwn(row, "qualityRevisionId")
      ? { qualityRevisionId: row.qualityRevisionId }
      : {}),
    staffId: row.staffId || row.assignedStaffId || null,
    inquiryId: row.inquiryId || null,
    leadId: row.leadId || row.crmLeadId || null,
    transactionId: row.transactionId || null,
    eventKey: row.eventKey || null,
  });
  let rows;
  switch (key) {
    case "inquiries":
      rows = cohort.map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "message_28hse":
      rows = cohort
        .filter((i) => i.sourceEvidence === "message_28hse")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "tracked_open_enquiries":
      rows = cohort
        .filter((i) => i.sourceEvidence === "tracked_open")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "unknown_origin":
      rows = cohort
        .filter((i) => !i.sourceEvidence || i.sourceEvidence === "unknown")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "assignments":
      rows = events
        .filter(
          (e) =>
            e.type === "assignment_confirmed" &&
            e.quality === "production" &&
            cohort.some((i) => i.id === e.inquiryId),
        )
        .map((e) => asRecord("event", e, e.eventKey || e.inquiryId, e.occurredAt));
      break;
    case "qualified":
      rows = relevant("lead_qualified").map((e) =>
        asRecord("event", e, e.eventKey || e.leadId, e.occurredAt),
      );
      break;
    case "viewings":
      rows = relevant("viewing_completed").map((e) =>
        asRecord("event", e, e.eventKey || e.leadId, e.occurredAt),
      );
      break;
    case "converted":
      rows = cohort
        .filter(
          (i) =>
            i.firstLeadInquiryId === i.id &&
            current.some(
              (d) =>
                d.dealType === "sale" &&
                d.leadId === i.crmLeadId &&
                time(d.confirmedAt) >= time(i.createdAt) &&
                time(d.confirmedAt) <= time(i.createdAt) + filters.cohortWindowDays * 86400000,
            ),
        )
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "responses":
      rows = cohort
        .filter((i) => measuredResponseMinutes(i, replies.get(i.id)) !== null)
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "unanswered":
      rows = cohort
        .filter((i) => measuredResponseMinutes(i, replies.get(i.id)) === null)
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "overdue":
      rows = cohort
        .filter(
          (i) =>
            measuredResponseMinutes(i, replies.get(i.id)) === null &&
            i.responseDueAt &&
            time(i.responseDueAt) < time(asOf),
        )
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "sla":
      rows = cohort
        .filter(
          (i) =>
            i.responseDueAt &&
            i.servicePolicyId &&
            measuredResponseMinutes(i, replies.get(i.id)) !== null,
        )
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "deals":
      rows = selectedDeals.map((d) => asRecord("deal", d, d.transactionId, d.confirmedAt));
      break;
    case "sale_value":
      rows = selectedDeals
        .filter((d) => d.dealType === "sale" && d.price != null)
        .map((d) => asRecord("deal", d, d.transactionId, d.confirmedAt));
      break;
    case "commission":
      rows = selectedDeals
        .filter((d) => d.commissionReceivable != null)
        .map((d) => asRecord("deal", d, d.transactionId, d.confirmedAt));
      break;
    case "quality_unknown_inquiries":
      rows = inquiries
        .filter((i) => i.quality === "unknown")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "quality_test_inquiries":
      rows = inquiries
        .filter((i) => i.quality === "test")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "quality_spam_inquiries":
      rows = inquiries
        .filter((i) => i.quality === "spam")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "quality_unknown_events":
      rows = events
        .filter((e) => e.quality === "unknown" && time(e.occurredAt) <= time(asOf))
        .map((e) => asRecord("event", e, e.eventKey || e.inquiryId || e.leadId, e.occurredAt));
      break;
    case "quality_test_events":
    case "quality_spam_events":
      rows = events
        .filter(
          (e) =>
            e.quality === (key === "quality_test_events" ? "test" : "spam") &&
            time(e.occurredAt) <= time(asOf),
        )
        .map((e) => asRecord("event", e, e.eventKey || e.inquiryId || e.leadId, e.occurredAt));
      break;
    case "quality_test_deals":
    case "quality_spam_deals":
      rows = deals
        .filter(
          (d) =>
            d.current &&
            d.quality === (key === "quality_test_deals" ? "test" : "spam") &&
            inRange(d.confirmedAt, filters),
        )
        .map((d) => asRecord("deal", d, d.transactionId, d.confirmedAt));
      break;
    case "quality_unknown_deals":
      rows = deals
        .filter((d) => d.current && d.quality === "unknown" && inRange(d.confirmedAt, filters))
        .map((d) => asRecord("deal", d, d.transactionId, d.confirmedAt));
      break;
    case "open_inquiries":
      rows = backlogRows.map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    case "unknown_backlog":
      rows = backlogRows
        .filter((i) => i.quality === "unknown")
        .map((i) => asRecord("inquiry", i, i.id, i.createdAt));
      break;
    default:
      throw new Error("Invalid drilldown");
  }
  rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  if (cursor) {
    if (typeof cursor !== "string" || cursor.length > 256) throw new Error("Invalid cursor");
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw new Error("Invalid cursor");
    }
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== "string" ||
      typeof decoded[1] !== "string"
    )
      throw new Error("Invalid cursor");
    rows = rows.filter(
      (r) => r.occurredAt > decoded[0] || (r.occurredAt === decoded[0] && r.id > decoded[1]),
    );
  }
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    records: page,
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? Buffer.from(JSON.stringify([last.occurredAt, last.id])).toString("base64url")
        : null,
  };
}
