import assert from "node:assert/strict";
import test from "node:test";
import { parsePerformanceSearch } from "./performance-route-search.mjs";
const defaults = { start: "2026-09-01", end: "2026-09-27" };
test("valid URL round trip retains date, staff and 30-day cohort filters", () => {
  const parsed = parsePerformanceSearch(
    { start: "2026-06-01", end: "2026-06-30", cohortWindowDays: "30", source: "28hse" },
    defaults,
  );
  assert.equal(parsed.invalidFilter, undefined);
  assert.equal(parsed.cohortWindowDays, 30);
  assert.equal(parsed.source, "28hse");
});
test("unknown or invalid URL filter creates repair state without widening request", () => {
  for (const search of [
    { source: "all" },
    { other: "1" },
    { branchId: "forged" },
    { start: "2026-02-30", end: "2026-03-01" },
  ]) {
    const parsed = parsePerformanceSearch(search, defaults);
    assert.equal(parsed.invalidFilter, true);
    assert.equal(parsed.branchId, null);
  }
});
