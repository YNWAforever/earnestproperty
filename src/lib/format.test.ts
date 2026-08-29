import { describe, expect, test } from "bun:test";

import { formatArea, formatHkd, formatManDisplay, formatPsf } from "./format";

describe("formatHkd", () => {
  test("formats a whole-dollar amount with thousands separators and a $ prefix", () => {
    expect(formatHkd(12800000)).toBe("$12,800,000");
  });

  test("rounds a fractional amount to the nearest dollar", () => {
    expect(formatHkd(1234.6)).toBe("$1,235");
  });

  test("returns null for null, undefined, and non-finite input", () => {
    expect(formatHkd(null)).toBeNull();
    expect(formatHkd(undefined)).toBeNull();
    expect(formatHkd(Number.NaN)).toBeNull();
    expect(formatHkd(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatManDisplay", () => {
  test("converts to 萬 with at most one decimal place", () => {
    expect(formatManDisplay(1280000)).toBe("128萬");
  });

  test("keeps a single decimal when the amount is not a whole 萬", () => {
    expect(formatManDisplay(1284000)).toBe("128.4萬");
  });

  test("returns null for null, undefined, zero, negative, and non-finite input", () => {
    expect(formatManDisplay(null)).toBeNull();
    expect(formatManDisplay(undefined)).toBeNull();
    expect(formatManDisplay(0)).toBeNull();
    expect(formatManDisplay(-500000)).toBeNull();
    expect(formatManDisplay(Number.NaN)).toBeNull();
  });
});

describe("formatArea", () => {
  test("formats square feet with thousands separators and a 呎 suffix", () => {
    expect(formatArea(1234)).toBe("1,234 呎");
  });

  test("rounds a fractional area to the nearest whole 呎", () => {
    expect(formatArea(500.6)).toBe("501 呎");
  });

  test("returns null for null, undefined, zero, negative, and non-finite input", () => {
    expect(formatArea(null)).toBeNull();
    expect(formatArea(undefined)).toBeNull();
    expect(formatArea(0)).toBeNull();
    expect(formatArea(-10)).toBeNull();
    expect(formatArea(Number.NaN)).toBeNull();
  });
});

describe("formatPsf", () => {
  test("divides price by area and formats as $/呎", () => {
    expect(formatPsf(5000000, 500)).toBe("$10,000 呎");
  });

  test("rounds to the nearest dollar", () => {
    expect(formatPsf(1000000, 333)).toBe("$3,003 呎");
  });

  test("never divides by zero -- returns null when area is missing or zero", () => {
    expect(formatPsf(5000000, 0)).toBeNull();
    expect(formatPsf(5000000, null)).toBeNull();
    expect(formatPsf(5000000, undefined)).toBeNull();
  });

  test("returns null when price is missing, even with a valid area", () => {
    expect(formatPsf(null, 500)).toBeNull();
    expect(formatPsf(undefined, 500)).toBeNull();
  });

  test("returns null when area is negative or non-finite", () => {
    expect(formatPsf(5000000, -500)).toBeNull();
    expect(formatPsf(5000000, Number.NaN)).toBeNull();
  });
});
