export * from "../no-link/synthetic-analytics";
import * as base from "../no-link/synthetic-analytics";
import { read } from "./read-control";
export const fetchSalesPerformance = read("fetchSalesPerformance", base.fetchSalesPerformance);
export const fetchPerformanceFilterOptions = read(
  "fetchPerformanceFilterOptions",
  base.fetchPerformanceFilterOptions,
);
export const fetchOperationalAnalytics = read(
  "fetchOperationalAnalytics",
  base.fetchOperationalAnalytics,
);
