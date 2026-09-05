import { plainRecord } from "./attribution.ts";
export type OperationalDay = {
  day: string;
  inquiries: number;
  linkedLeads: number;
  unassignedInquiries: number;
};
export type TrafficDay = {
  day: string;
  pageViews: number;
  whatsappClicks: number;
  inquiryConversions: number;
};
function aggregate(rows: unknown, keys: readonly string[]): Record<string, number> {
  if (!Array.isArray(rows) || rows.length > 90) throw Error("INVALID_ANALYTICS_AGGREGATE");
  const totals = Object.fromEntries(keys.map((k) => [k, 0]));
  const dates = new Set();
  for (const row of rows) {
    if (
      !plainRecord(row) ||
      Object.keys(row).length !== keys.length + 1 ||
      typeof row.day !== "string" ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(row.day) ||
      !Number.isFinite(Date.parse(row.day)) ||
      new Date(row.day).toISOString().slice(0, 10) !== row.day ||
      dates.has(row.day)
    )
      throw Error("INVALID_ANALYTICS_AGGREGATE");
    dates.add(row.day);
    for (const key of keys) {
      const n = row[key];
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > 1e9)
        throw Error("INVALID_ANALYTICS_AGGREGATE");
      totals[key] += n;
    }
  }
  return totals;
}
/** Aggregate inputs only; GA4 events and persisted intake counts have different denominators. */
export function buildMeasurementSummary(
  traffic: readonly TrafficDay[] | null,
  operational: readonly OperationalDay[],
) {
  const ops = aggregate(operational, ["inquiries", "linkedLeads", "unassignedInquiries"]);
  if (ops.linkedLeads > ops.inquiries || ops.unassignedInquiries > ops.inquiries)
    throw Error("INVALID_ANALYTICS_AGGREGATE");
  const visits =
    traffic === null
      ? null
      : aggregate(traffic, ["pageViews", "whatsappClicks", "inquiryConversions"]);
  return {
    operational: ops,
    traffic: visits
      ? {
          ...visits,
          inquiryEventsPerPageView: visits.pageViews
            ? visits.inquiryConversions / visits.pageViews
            : null,
        }
      : null,
  };
}
/** Prepared SELECT only: execute behind an admin/manager boundary with a validated <=90-day range. */
export const OPERATIONAL_DAILY_SQL = `SELECT (created_at AT TIME ZONE 'Asia/Hong_Kong')::date::text AS day,
 count(*)::integer AS inquiries,
 count(crm_lead_id)::integer AS "linkedLeads",
 count(*) FILTER (WHERE assigned_agent_id IS NULL)::integer AS "unassignedInquiries"
 FROM inquiries
 WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
   AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
 GROUP BY 1 ORDER BY 1 LIMIT 90`;

export type AnalyticsDateRange = { start: string; end: string };
export function parseAnalyticsDateRange(input: unknown): AnalyticsDateRange {
  const validDate = (value: unknown): value is string =>
    typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (
    !plainRecord(input) ||
    Object.keys(input).length !== 2 ||
    !validDate(input.start) ||
    !validDate(input.end)
  )
    throw Error("INVALID_ANALYTICS_DATE_RANGE");
  const days = (Date.parse(input.end) - Date.parse(input.start)) / 86400000;
  if (days < 0 || days > 89) throw Error("INVALID_ANALYTICS_DATE_RANGE");
  return { start: input.start, end: input.end };
}
export function defaultAnalyticsDateRange(now = new Date()): AnalyticsDateRange {
  const hk = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    start: new Date(hk.getTime() - 29 * 86400000).toISOString().slice(0, 10),
    end: hk.toISOString().slice(0, 10),
  };
}
export const OPERATIONAL_METRICS = [
  "inquiries",
  "linkedLeads",
  "unassignedInquiries",
  "leads",
  "unassignedLeads",
  "conversations",
  "unassignedConversations",
  "openConversations",
] as const;
export type OperationalCounts = Record<(typeof OPERATIONAL_METRICS)[number], number>;
export type OperationalAnalyticsReport = {
  range: AnalyticsDateRange;
  days: Array<OperationalCounts & { day: string }>;
  summary: OperationalCounts;
  provider: {
    status: "reporting_unconfigured";
    pageViews: null;
    whatsappClicks: null;
    inquiryConversions: null;
  };
};
