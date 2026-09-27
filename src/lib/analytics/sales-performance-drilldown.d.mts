import type { PerformanceFilters } from "./sales-performance.types.ts";
export const PERFORMANCE_DRILLDOWN_KEYS: Set<string>;
export function selectPerformanceRecords(
 input: {
  inquiries: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  deals: Array<Record<string, any>>;
  backlogRows: Array<Record<string, any>>;
  filters: PerformanceFilters;
  asOf: string;
 }, key: string, cursor: string | null,
): { records: Array<{
  kind: string; id: string; occurredAt: string; quality: string;
  staffId: string | null; inquiryId: string | null;
  leadId: string | null; transactionId: string | null;
}>; nextCursor: string | null };
