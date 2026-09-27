import type { PerformanceFilters } from "./sales-performance.types.ts";
export const INQUIRY_ROWS_SQL: string;
export const EVENT_ROWS_SQL: string;
export const DEAL_ROWS_SQL: string;
export const CREDIT_ROWS_SQL: string;
export const BACKLOG_SQL: string;
export const BACKLOG_ROWS_SQL: string;
export const LEGACY_TRANSACTION_SQL: string;
export function reportParams(filters: PerformanceFilters, branchScope: string | null): unknown[];
