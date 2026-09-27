import { parsePerformanceFilters } from "./sales-performance.mjs";
const allowed = new Set([
  "start",
  "end",
  "branchId",
  "staffId",
  "source",
  "dealType",
  "cohortWindowDays",
]);
export function parsePerformanceSearch(search, defaults) {
  const raw = {
    start: search.start ?? defaults.start,
    end: search.end ?? defaults.end,
    branchId: search.branchId,
    staffId: search.staffId,
    source: search.source,
    dealType: search.dealType,
    cohortWindowDays: Number(search.cohortWindowDays ?? 90),
  };
  try {
    if (Object.keys(search).some((key) => !allowed.has(key))) throw new Error("Unknown filter");
    return parsePerformanceFilters(raw);
  } catch {
    return {
      ...parsePerformanceFilters({ ...defaults, cohortWindowDays: 90 }),
      invalidFilter: true,
    };
  }
}
