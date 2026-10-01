import assert from "node:assert/strict";
import test from "node:test";
import { safePerformanceCsvCell } from "./performance-csv.ts";
test("visible report CSV neutralizes formula strings and quotes", () => {
  assert.equal(safePerformanceCsvCell("=IMPORTXML(1)"), '"\'=IMPORTXML(1)"');
  assert.equal(safePerformanceCsvCell(" +HYPERLINK(1)"), '"\' +HYPERLINK(1)"');
  assert.equal(safePerformanceCsvCell('hello\"world'), '"hello""world"');
});
