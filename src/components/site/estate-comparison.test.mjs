import assert from "node:assert/strict";
import { test } from "node:test";

// estate-comparison.ts is a plain .ts module with no JSX (see its own header
// comment), so -- like estate-registry.ts and castle-peak-road.ts already do
// for their own pure logic -- it can be imported and actually executed here
// under Node's native TS stripping, letting P4 Task 5's 2/1/0-comparable
// cases and its em-dash formatting be proven by real execution rather than a
// source-text scan.
import {
  buildComparisonColumns,
  buildComparisonRowDefs,
  estateTextFigure,
} from "./estate-comparison.ts";

function estate(overrides) {
  return {
    slug: "fixture",
    nameZh: "測試屋苑",
    hasPage: true,
    avgPsf: null,
    totalUnits: null,
    yearCompleted: null,
    developer: null,
    ...overrides,
  };
}

const current = estate({ slug: "current", nameZh: "現居屋苑" });
const comparableA = estate({ slug: "comparable-a", nameZh: "比較屋苑 A" });
const comparableB = estate({ slug: "comparable-b", nameZh: "比較屋苑 B" });

test("buildComparisonColumns: 2 comparables present -> 3-column table (current + 2)", () => {
  const columns = buildComparisonColumns(current, [comparableA, comparableB]);
  assert.notEqual(columns, null);
  assert.equal(columns.length, 3);
  assert.deepEqual(
    columns.map((col) => col.slug),
    ["current", "comparable-a", "comparable-b"],
  );
});

test("buildComparisonColumns: 1 comparable present -> 2-column table (current + 1)", () => {
  const columns = buildComparisonColumns(current, [comparableA]);
  assert.notEqual(columns, null);
  assert.equal(columns.length, 2);
  assert.deepEqual(
    columns.map((col) => col.slug),
    ["current", "comparable-a"],
  );
});

test("buildComparisonColumns: 0 comparables -> null, so the whole section is absent, never a 1-column table", () => {
  assert.equal(buildComparisonColumns(current, []), null);
});

test("every row's missing-fact cell renders as an em dash via estateFigure's convention, never blank or 0", () => {
  const missing = estate({ slug: "missing", nameZh: "缺資料屋苑" });
  const rows = buildComparisonRowDefs();
  const cells = Object.fromEntries(
    rows.map((row) => [row.key, row.formatCell(missing)]),
  );

  // Directly checking the rendered/computed cell value for each specific
  // missing-fact case, not just that buildComparisonRowDefs exists.
  assert.equal(cells.avgPsf, "—");
  assert.equal(cells.totalUnits, "— 個");
  assert.equal(cells.yearCompleted, "— 年");
  assert.equal(cells.developer, "—");

  // Never a fabricated "0" or "$0" -- the literal characters "0" must not
  // appear anywhere in a missing-fact cell.
  for (const value of Object.values(cells)) {
    assert.equal(
      value.includes("0"),
      false,
      `"${value}" must not contain a fabricated 0`,
    );
  }
});

test("a present fact renders its real value, correctly formatted, not just a non-dash placeholder", () => {
  const filled = estate({
    slug: "filled",
    avgPsf: 12345,
    totalUnits: 3345,
    yearCompleted: 1998,
    developer: "新鴻基地產",
  });
  const rows = buildComparisonRowDefs();
  const cells = Object.fromEntries(
    rows.map((row) => [row.key, row.formatCell(filled)]),
  );

  assert.equal(cells.avgPsf, "$12,345");
  assert.equal(cells.totalUnits, "3,345 個");
  // A calendar year must never carry a thousands separator (estateFigure's
  // own .toLocaleString() would otherwise print the wrong "1,998").
  assert.equal(cells.yearCompleted, "1998 年");
  assert.equal(cells.developer, "新鴻基地產");
});

test('avgPsf never renders the broken "$—" for a missing/non-finite value', () => {
  const rows = buildComparisonRowDefs();
  const avgPsfRow = rows.find((row) => row.key === "avgPsf");
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const cell = avgPsfRow.formatCell(estate({ avgPsf: value }));
    assert.equal(cell, "—");
    assert.equal(cell.startsWith("$"), false);
  }
});

test("estateTextFigure treats null, undefined, and a blank/whitespace-only string as missing", () => {
  assert.equal(estateTextFigure(null), "—");
  assert.equal(estateTextFigure(undefined), "—");
  assert.equal(estateTextFigure(""), "—");
  assert.equal(estateTextFigure("   "), "—");
  assert.equal(estateTextFigure("新鴻基地產"), "新鴻基地產");
});
