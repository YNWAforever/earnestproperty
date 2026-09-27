import type { PerformanceFilters, PerformanceReport } from "./sales-performance.types.ts";
export function parsePerformanceFilters(input: unknown): Required<PerformanceFilters>;
export function calculateSalesPerformance(input: {
  inquiries: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  deals: Array<Record<string, any>>;
  credits: Array<Record<string, any>>;
  backlog: { openInquiries: number; unknownQuality: number };
  legacyTransactions?: number;
  filters: PerformanceFilters;
  asOf: string;
}): PerformanceReport;
export function measuredResponseMinutes(inquiry: Record<string, any>, reply: Record<string, any> | undefined): number | null;
