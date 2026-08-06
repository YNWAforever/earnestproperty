import { expect, test } from "bun:test";

import { leadBudgetError } from "./lead-budget";

test("a well-formed or partial budget range is accepted", () => {
  expect(leadBudgetError(null, null)).toBeNull();
  expect(leadBudgetError(5_000_000, null)).toBeNull();
  expect(leadBudgetError(null, 8_000_000)).toBeNull();
  expect(leadBudgetError(5_000_000, 8_000_000)).toBeNull();
  // Equal bounds are a legitimate "exactly this much" budget.
  expect(leadBudgetError(6_000_000, 6_000_000)).toBeNull();
  expect(leadBudgetError(0, 0)).toBeNull();
});

test("a reversed range is rejected", () => {
  expect(leadBudgetError(9_000_000, 3_000_000)).toBe("最低預算不可高於最高預算。");
});

test("negative bounds are rejected on either side", () => {
  expect(leadBudgetError(-1, null)).toBe("預算不可為負數。");
  expect(leadBudgetError(null, -1)).toBe("預算不可為負數。");
  // Negative wins over the reversed-range message: it is the more basic problem
  // and naming it first is what tells the user what to actually change.
  expect(leadBudgetError(-5, -9)).toBe("預算不可為負數。");
});
