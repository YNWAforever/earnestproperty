import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { withStaffAuthHeaders } from "@/auth";
import { unwrapServerFnResponse } from "../neon/server-fn-response.ts";
import { parseAnalyticsDateRange } from "./reporting.ts";
import type { AnalyticsDateRange, OperationalAnalyticsReport } from "./reporting.ts";
const fetchOperationalAnalyticsServer = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => parseAnalyticsDateRange(input))
  .handler(async ({ data }) =>
    (await import("./reporting.server")).fetchOperationalAnalytics(data, getRequest()),
  );
export async function fetchOperationalAnalytics(
  range: AnalyticsDateRange,
): Promise<OperationalAnalyticsReport> {
  return unwrapServerFnResponse(
    fetchOperationalAnalyticsServer(await withStaffAuthHeaders({ data: range })),
  );
}
