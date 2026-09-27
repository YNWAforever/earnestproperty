import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { unwrapServerFnResponse } from "../neon/server-fn-response.ts";
import { parsePerformanceFilters } from "./sales-performance.mjs";
import type {
  PerformanceFilters,
  PerformanceFilterOptions,
  PerformanceRecordPage,
  PerformanceReport,
} from "./sales-performance.types.ts";

const fetchReportServer = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => parsePerformanceFilters(input))
  .handler(async ({ data }) => {
    const actor = await (
      await import("../neon/auth.server.ts")
    ).requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./sales-performance.server.ts")).getSalesPerformance(data, actor);
  });
const fetchFilterOptionsServer = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await (
    await import("../neon/auth.server.ts")
  ).requireStaffAccess(getRequest(), ["admin", "manager"]);
  return (await import("./sales-performance.server.ts")).getPerformanceFilterOptions(actor);
});
const fetchRecordsServer = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid drilldown");
    const row = input as Record<string, unknown>;
    return {
      filters: parsePerformanceFilters(row.filters),
      drilldownKey: String(row.drilldownKey ?? ""),
      cursor: row.cursor === null || row.cursor === undefined ? null : String(row.cursor),
    };
  })
  .handler(async ({ data }) => {
    const actor = await (
      await import("../neon/auth.server.ts")
    ).requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./sales-performance.server.ts")).listPerformanceRecords(data, actor);
  });
const qualifyLeadServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid qualification");
    const row = input as Record<string, unknown>;
    return {
      leadId: String(row.leadId ?? ""),
      qualifiedAt: String(row.qualifiedAt ?? ""),
      evidence: String(row.evidence ?? ""),
    };
  })
  .handler(async ({ data }) => {
    const actor = await (
      await import("../neon/auth.server.ts")
    ).requireStaffAccess(getRequest(), ["admin", "manager"]);
    return (await import("./performance-events.server.ts")).qualifyLeadForPerformance(data, actor);
  });
const reviseEventQualityServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid correction");
    const row = input as Record<string, unknown>;
    return {
      eventKey: String(row.eventKey ?? ""),
      quality: String(row.quality ?? "") as "production" | "test" | "spam" | "unknown",
      reason: String(row.reason ?? ""),
    };
  })
  .handler(async ({ data }) => {
    const actor = await (
      await import("../neon/auth.server.ts")
    ).requireStaffAccess(getRequest(), ["admin"]);
    return (await import("./performance-events.server.ts")).revisePerformanceEventQuality(
      data,
      actor,
    );
  });
const reviseInquiryQualityServer = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid correction");
    const row = input as Record<string, unknown>;
    return {
      inquiryId: String(row.inquiryId ?? ""),
      quality: String(row.quality ?? "") as "production" | "test" | "spam" | "unknown",
      reason: String(row.reason ?? ""),
    };
  })
  .handler(async ({ data }) => {
    const actor = await (
      await import("../neon/auth.server.ts")
    ).requireStaffAccess(getRequest(), ["admin"]);
    return (await import("./sales-performance.server.ts")).reviseInquiryQuality(data, actor);
  });

export async function fetchSalesPerformance(
  filters: PerformanceFilters,
): Promise<PerformanceReport> {
  return unwrapServerFnResponse(fetchReportServer(await withStaffAuthHeaders({ data: filters })));
}
export async function fetchSalesPerformanceRecords(input: {
  filters: PerformanceFilters;
  drilldownKey: string;
  cursor?: string | null;
}): Promise<PerformanceRecordPage> {
  return unwrapServerFnResponse(fetchRecordsServer(await withStaffAuthHeaders({ data: input })));
}
export async function correctPerformanceEventQuality(input: {
  eventKey: string;
  quality: "production" | "test" | "spam" | "unknown";
  reason: string;
}) {
  return unwrapServerFnResponse(
    reviseEventQualityServer(await withStaffAuthHeaders({ data: input })),
  );
}
export async function correctInquiryQuality(input: {
  inquiryId: string;
  quality: "production" | "test" | "spam" | "unknown";
  reason: string;
}) {
  return unwrapServerFnResponse(
    reviseInquiryQualityServer(await withStaffAuthHeaders({ data: input })),
  );
}

export async function fetchPerformanceFilterOptions(): Promise<PerformanceFilterOptions> {
  return unwrapServerFnResponse(fetchFilterOptionsServer(await withStaffAuthHeaders({})));
}

export async function qualifyPerformanceLead(input: {
  leadId: string;
  qualifiedAt: string;
  evidence: string;
}) {
  return unwrapServerFnResponse(qualifyLeadServer(await withStaffAuthHeaders({ data: input })));
}
