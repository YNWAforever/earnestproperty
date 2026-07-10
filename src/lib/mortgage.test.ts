import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MORTGAGE_INPUTS,
  MORTGAGE_INPUT_LIMITS,
  calculateMortgage,
  calculateResidentialStampDuty,
  mortgageInputsFromSearch,
  normalizeMortgageInputs,
  parseMortgageSearch,
} from "./mortgage";

function expectOnlyFiniteNumbersOrNull(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBeTrue();
    return;
  }

  if (value === null || value === undefined || typeof value !== "object") return;

  for (const nestedValue of Object.values(value)) {
    expectOnlyFiniteNumbersOrNull(nestedValue);
  }
}

describe("normalizeMortgageInputs", () => {
  test("uses one visible normalization result for zero and huge committed values", () => {
    const normalized = normalizeMortgageInputs({
      price: 0,
      ltv: Number.MAX_VALUE,
      years: Number.MAX_VALUE,
      annualInterestRate: Number.MAX_VALUE,
      stressRate: Number.MAX_VALUE,
    });

    expect(normalized).toEqual({
      price: DEFAULT_MORTGAGE_INPUTS.price,
      ltv: MORTGAGE_INPUT_LIMITS.ltv.max,
      years: MORTGAGE_INPUT_LIMITS.years.max,
      annualInterestRate: MORTGAGE_INPUT_LIMITS.annualInterestRate.max,
      stressRate: MORTGAGE_INPUT_LIMITS.stressRate.max,
    });
    expect(calculateMortgage(normalized).inputs).toEqual(normalized);
  });

  test.each([
    [1.1, 1],
    [12.7, 13],
    [49.9, 50],
  ])("normalizes a %s-year term to %i whole years", (years, expectedYears) => {
    const normalized = normalizeMortgageInputs({ years });

    expect(normalized.years).toBe(expectedYears);
    expect(calculateMortgage(normalized).amortization).toHaveLength(expectedYears);
  });
});

describe("calculateMortgage", () => {
  test("calculates the default Hong Kong repayment and stressed repayment", () => {
    const result = calculateMortgage(DEFAULT_MORTGAGE_INPUTS);

    expect(result.loanAmount).toBe(5_600_000);
    expect(result.deposit).toBe(2_400_000);
    expect(result.monthlyPayment).toBeCloseTo(24_371.55, 2);
    expect(result.stressedMonthlyPayment).toBeCloseTo(30_923.41, 2);
    expect(result.totalInterest).toBeCloseTo(3_173_759.39, 2);
    expect(result.stampDuty).toBe(240_000);
    expect(result.amortization).toHaveLength(30);
    expect(result.amortization.at(-1)?.closingBalance).toBeCloseTo(0, 2);
  });

  test("calculates DSR when income and existing monthly debt are supplied", () => {
    const result = calculateMortgage({
      ...DEFAULT_MORTGAGE_INPUTS,
      monthlyIncome: 80_000,
      monthlyDebtExpenses: 10_000,
    });

    expect(result.dsr).toBeCloseTo(42.96, 2);
    expect(result.stressedDsr).toBeCloseTo(51.15, 2);
  });

  test("uses even principal repayments for a zero-interest mortgage", () => {
    const result = calculateMortgage({
      price: 1_200_000,
      ltv: 50,
      years: 10,
      annualInterestRate: 0,
      stressRate: 2,
    });

    expect(result.monthlyPayment).toBe(5_000);
    expect(result.totalInterest).toBe(0);
    expect(result.amortization[0]).toMatchObject({
      openingBalance: 600_000,
      principalPaid: 60_000,
      interestPaid: 0,
      closingBalance: 540_000,
    });
  });

  test("normalizes unusable values without returning NaN or Infinity", () => {
    const result = calculateMortgage({
      price: Number.NaN,
      ltv: 300,
      years: 0,
      annualInterestRate: Number.POSITIVE_INFINITY,
      stressRate: -10,
      monthlyIncome: -1,
      monthlyDebtExpenses: Number.NaN,
    });

    expect(result.inputs).toEqual({
      ...DEFAULT_MORTGAGE_INPUTS,
      ltv: 100,
      stressRate: 0,
    });
    expect(
      Object.values(result).flatMap((value) => (Array.isArray(value) ? value : [value])),
    ).not.toContain(Number.NaN);
    expect(Number.isFinite(result.monthlyPayment)).toBeTrue();
    expect(result.dsr).toBeNull();
    expect(result.stressedDsr).toBeNull();
  });

  test.each([
    {
      ...DEFAULT_MORTGAGE_INPUTS,
      monthlyIncome: Number.MIN_VALUE,
      monthlyDebtExpenses: Number.MAX_VALUE,
    },
    {
      price: Number.MAX_VALUE,
      ltv: Number.MAX_VALUE,
      years: Number.MAX_VALUE,
      annualInterestRate: Number.MAX_VALUE,
      stressRate: Number.MAX_VALUE,
      monthlyIncome: Number.MIN_VALUE,
      monthlyDebtExpenses: Number.MAX_VALUE,
    },
    {
      ...DEFAULT_MORTGAGE_INPUTS,
      ltv: 0,
      annualInterestRate: 0,
      stressRate: 0,
      monthlyIncome: 0,
      monthlyDebtExpenses: 0,
    },
  ])("returns only finite numbers or null for every numeric result", (input) => {
    const result = calculateMortgage(input);

    expectOnlyFiniteNumbersOrNull(result);
    expect(result.dsr === null || Number.isFinite(result.dsr)).toBeTrue();
    expect(result.stressedDsr === null || Number.isFinite(result.stressedDsr)).toBeTrue();
  });
});

describe("calculateResidentialStampDuty", () => {
  const bands = [
    [4_000_000, 100, 100],
    [4_323_780, 64_856, 64_855.8],
    [4_500_000, 67_500, 67_499.985],
    [4_935_480, 111_048, 111_047.9],
    [6_000_000, 135_000, 134_999.9775],
    [6_642_860, 199_286, 199_285.9],
    [9_000_000, 270_000, 269_999.97],
    [10_080_000, 378_000, 377_999.9],
    [20_000_000, 750_000, 749_999.9625],
    [21_739_120, 923_912, 923_911.9],
    [100_000_000, 4_250_000, 4_249_999.9575],
    [109_574_470, 7_122_341, 7_122_340.7],
  ] as const;

  test.each(bands)("applies the statutory duty at $%i", (price, expectedDuty) => {
    expect(calculateResidentialStampDuty(price)).toBe(expectedDuty);
  });

  test.each(bands)("uses the preceding scale just below $%i", (price, _expectedDuty, belowDuty) => {
    expect(calculateResidentialStampDuty(price - 1)).toBeCloseTo(belowDuty, 3);
  });

  test.each([
    [4_000_001, 100.2],
    [4_323_781, 64_856.715],
    [4_500_001, 67_500.1],
    [4_935_481, 111_048.3225],
    [6_000_001, 135_000.1],
    [6_642_861, 199_285.83],
    [9_000_001, 270_000.1],
    [10_080_001, 378_000.0375],
    [20_000_001, 750_000.1],
    [21_739_121, 923_912.6425],
    [100_000_001, 4_250_000.3],
    [109_574_471, 7_122_340.615],
  ] as const)("uses the next scale just above $%i", (price, expectedDuty) => {
    expect(calculateResidentialStampDuty(price)).toBeCloseTo(expectedDuty, 3);
  });

  test("returns zero for unusable property values", () => {
    expect(calculateResidentialStampDuty(0)).toBe(0);
    expect(calculateResidentialStampDuty(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("parseMortgageSearch", () => {
  test("accepts safe price and affordability search parameters", () => {
    expect(parseMortgageSearch({ price: "8000000", income: "90000", expenses: "5000" })).toEqual({
      price: 8_000_000,
      income: 90_000,
      expenses: 5_000,
    });
  });

  test("drops unusable optional values", () => {
    expect(parseMortgageSearch({ price: "NaN", income: "-2", expenses: "Infinity" })).toEqual({});
  });

  test("normalizes zero and huge URL prices before they reach displayed state", () => {
    const zeroSearch = parseMortgageSearch({ price: "0" });
    const hugeSearch = parseMortgageSearch({ price: String(Number.MAX_VALUE) });

    expect(zeroSearch).toEqual({ price: DEFAULT_MORTGAGE_INPUTS.price });
    expect(hugeSearch).toEqual({ price: MORTGAGE_INPUT_LIMITS.price.max });

    for (const search of [zeroSearch, hugeSearch]) {
      const displayedInputs = mortgageInputsFromSearch(search);
      expect(calculateMortgage(displayedInputs).inputs).toEqual(displayedInputs);
    }
  });
});
