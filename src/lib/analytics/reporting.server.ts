import "@tanstack/react-start/server-only";
import { OPERATIONAL_METRICS, parseAnalyticsDateRange } from "./reporting.ts";
import type { OperationalCounts, OperationalAnalyticsReport } from "./reporting.ts";

type Ports = {
  requireAccess: (
    request: Request,
    roles: Array<"admin" | "manager">,
  ) => Promise<{ roles: readonly string[] }>;
  query: (statement: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;
};
export const OPERATIONAL_REPORT_SQL = `WITH bounds AS (
 SELECT ($1::date::timestamp AT TIME ZONE 'Asia/Hong_Kong') AS starts,
 (($2::date+1)::timestamp AT TIME ZONE 'Asia/Hong_Kong') AS ends
), days AS (SELECT generate_series($1::timestamp,$2::timestamp,interval '1 day')::date AS day),
inquiry_counts AS (
 SELECT (created_at AT TIME ZONE 'Asia/Hong_Kong')::date AS day,count(*)::integer AS inquiries,
 count(crm_lead_id)::integer AS linked_leads,
 count(*) FILTER(WHERE assigned_agent_id IS NULL)::integer AS unassigned_inquiries
 FROM inquiries,bounds WHERE created_at>=bounds.starts AND created_at<bounds.ends GROUP BY 1
), lead_counts AS (
 SELECT (created_at AT TIME ZONE 'Asia/Hong_Kong')::date AS day,count(*)::integer AS leads,
 count(*) FILTER(WHERE assigned_agent_id IS NULL)::integer AS unassigned_leads
 FROM crm_leads,bounds WHERE created_at>=bounds.starts AND created_at<bounds.ends GROUP BY 1
), conversation_counts AS (
 SELECT (created_at AT TIME ZONE 'Asia/Hong_Kong')::date AS day,count(*)::integer AS conversations,
 count(*) FILTER(WHERE assigned_agent_id IS NULL)::integer AS unassigned_conversations,
 count(*) FILTER(WHERE status<>'closed')::integer AS open_conversations
 FROM whatsapp_conversations,bounds WHERE created_at>=bounds.starts AND created_at<bounds.ends GROUP BY 1
)
SELECT to_char(d.day,'YYYY-MM-DD') AS day,
 COALESCE(i.inquiries,0) AS inquiries,COALESCE(i.linked_leads,0) AS "linkedLeads",
 COALESCE(i.unassigned_inquiries,0) AS "unassignedInquiries",COALESCE(l.leads,0) AS leads,
 COALESCE(l.unassigned_leads,0) AS "unassignedLeads",COALESCE(c.conversations,0) AS conversations,
 COALESCE(c.unassigned_conversations,0) AS "unassignedConversations",COALESCE(c.open_conversations,0) AS "openConversations"
 FROM days d LEFT JOIN inquiry_counts i ON i.day=d.day LEFT JOIN lead_counts l ON l.day=d.day
 LEFT JOIN conversation_counts c ON c.day=d.day ORDER BY d.day LIMIT 90`;

export async function fetchOperationalAnalytics(
  input: unknown,
  request: Request,
  injected?: Ports,
): Promise<OperationalAnalyticsReport> {
  const requireAccess =
    injected?.requireAccess ?? (await import("../neon/auth.server.ts")).requireStaffAccess;
  const actor = await requireAccess(request, ["admin", "manager"]);
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  let range;
  try {
    range = parseAnalyticsDateRange(input);
  } catch {
    throw new Response("請選擇有效日期，最多 90 日。", { status: 400 });
  }
  const query = injected?.query ?? (await import("../neon/db.server.ts")).queryRows;
  try {
    const rows = await query(OPERATIONAL_REPORT_SQL, [range.start, range.end]);
    const expectedDays = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
    if (rows.length !== expectedDays) throw Error("INVALID_AGGREGATE");
    const dates = new Set<string>();
    const days = rows.map((row) => {
      const { start: day } = parseAnalyticsDateRange({ start: row.day, end: row.day });
      if (day < range.start || day > range.end || dates.has(day)) throw Error("INVALID_AGGREGATE");
      dates.add(day);
      const values = Object.fromEntries(
        OPERATIONAL_METRICS.map((key) => {
          const value = row[key];
          if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1e9)
            throw Error("INVALID_AGGREGATE");
          return [key, value];
        }),
      ) as OperationalCounts;
      if (
        values.linkedLeads > values.inquiries ||
        values.unassignedInquiries > values.inquiries ||
        values.unassignedLeads > values.leads ||
        values.unassignedConversations > values.conversations ||
        values.openConversations > values.conversations
      )
        throw Error("INVALID_AGGREGATE");
      return { day, ...values };
    });
    const summary = Object.fromEntries(
      OPERATIONAL_METRICS.map((key) => [key, days.reduce((sum, day) => sum + day[key], 0)]),
    ) as OperationalCounts;
    return {
      range,
      days,
      summary,
      provider: {
        status: "reporting_unconfigured",
        pageViews: null,
        whatsappClicks: null,
        inquiryConversions: null,
      },
    };
  } catch {
    throw new Response("未能載入營運統計，請稍後再試。", { status: 503 });
  }
}
