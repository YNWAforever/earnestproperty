import type { PerformanceFilters } from "./sales-performance.types.ts";
export function parsePerformanceSearch(
  search: Record<string, unknown>,
  defaults: { start: string; end: string },
): Required<PerformanceFilters> & { invalidFilter?: true };
