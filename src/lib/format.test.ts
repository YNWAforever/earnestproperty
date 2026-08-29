import { describe, expect, test } from "bun:test";

import {
  formatArea,
  formatFreshness,
  formatHkd,
  formatHkDate,
  formatHkDateTime,
  formatManDisplay,
  formatPsf,
  formatSaleDisplay,
  sanitizeListingText,
} from "./format";

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

  test("adds thousands-grouping once the 萬 value reaches 1000 or more", () => {
    expect(formatManDisplay(25000000)).toBe("2,500萬");
    expect(formatManDisplay(12345678)).toBe("1,234.6萬");
    expect(formatManDisplay(100000000)).toBe("10,000萬");
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

describe("formatHkDate", () => {
  test("anchors to Asia/Hong_Kong regardless of the input's UTC-day boundary", () => {
    // 2026-01-01T16:30:00Z is 2026-01-02T00:30 in Hong Kong (UTC+8). A
    // formatter without an explicit timeZone would resolve to the UTC day
    // (Jan 1) on a UTC server and the HKT day (Jan 2) on an HKT browser --
    // this is the exact DR-2 hydration mismatch. formatHkDate must resolve
    // to the Hong Kong day (Jan 2) no matter where it runs. The expected
    // string below is "02/01/2026" because this environment's ICU renders
    // zh-HK numeric dates as DD/MM/YYYY, not because the day differs.
    const date = new Date("2026-01-01T16:30:00Z");
    expect(formatHkDate(date)).toBe("02/01/2026");
  });

  test("accepts an ISO date string", () => {
    expect(formatHkDate("2026-03-15T00:00:00Z")).toBe("15/03/2026");
  });

  test("returns null for null, undefined, and an unparseable string", () => {
    expect(formatHkDate(null)).toBeNull();
    expect(formatHkDate(undefined)).toBeNull();
    expect(formatHkDate("not a date")).toBeNull();
  });
});

describe("formatHkDateTime", () => {
  test("formats date and time (24h) anchored to Asia/Hong_Kong", () => {
    const date = new Date("2026-01-01T16:30:00Z");
    expect(formatHkDateTime(date)).toBe("02/01/2026 00:30");
  });

  test("returns null for null, undefined, and an unparseable string", () => {
    expect(formatHkDateTime(null)).toBeNull();
    expect(formatHkDateTime(undefined)).toBeNull();
    expect(formatHkDateTime("not a date")).toBeNull();
  });
});

describe("formatFreshness", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  test("reports 'just updated' under one minute ago", () => {
    const thirtySecondsAgo = new Date(now.getTime() - 30_000);
    expect(formatFreshness(thirtySecondsAgo, now)).toBe("剛剛更新");
  });

  test("reports minutes ago under one hour", () => {
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000);
    expect(formatFreshness(fifteenMinutesAgo, now)).toBe("15 分鐘前更新");
  });

  test("reports hours ago under one day", () => {
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60_000);
    expect(formatFreshness(threeHoursAgo, now)).toBe("3 小時前更新");
  });

  test("reports days ago under 30 days", () => {
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60_000);
    expect(formatFreshness(fiveDaysAgo, now)).toBe("5 日前更新");
  });

  test("falls back to a full date at 30 days or older", () => {
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60_000);
    expect(formatFreshness(fortyDaysAgo, now)).toBe(
      `${formatHkDate(fortyDaysAgo)} 更新`,
    );
  });

  test("returns null for null, undefined, and an unparseable string", () => {
    expect(formatFreshness(null, now)).toBeNull();
    expect(formatFreshness(undefined, now)).toBeNull();
    expect(formatFreshness("not a date", now)).toBeNull();
  });
});

describe("sanitizeListingText", () => {
  test("strips control characters", () => {
    // The character between 正常 and 文字 is a literal NUL (U+0000) control
    // character, written as an explicit escape so the test is unambiguous --
    // not a printable space. A correct control-char strip removes it
    // entirely (no space is introduced), joining the two words directly.
    expect(sanitizeListingText("正常\u0000文字")).toBe("正常文字");
  });

  test("collapses runs of whitespace and trims", () => {
    expect(sanitizeListingText("  海景   單位   \n\n望向大海  ")).toBe(
      "海景 單位 望向大海",
    );
  });

  test("strips wrapping quotes left over from a CSV export", () => {
    expect(sanitizeListingText('"高層開揚"')).toBe("高層開揚");
  });

  test("collapses repeated CSV delimiters left over from empty cells", () => {
    expect(sanitizeListingText("三房兩廳,,,,連車位")).toBe("三房兩廳,連車位");
  });

  test("suppresses exact malformed-import tokens to null", () => {
    expect(sanitizeListingText("NaN")).toBeNull();
    expect(sanitizeListingText("null")).toBeNull();
    expect(sanitizeListingText("undefined")).toBeNull();
    expect(sanitizeListingText("$0")).toBeNull();
    expect(sanitizeListingText("- 房")).toBeNull();
    expect(sanitizeListingText("-房")).toBeNull();
  });

  test("does not suppress legitimate text that merely contains a suppressed token as a substring", () => {
    expect(sanitizeListingText("業主誠意放盤，樓價$0手續費")).not.toBeNull();
  });

  test("returns null for empty, whitespace-only, null, and undefined input", () => {
    expect(sanitizeListingText("")).toBeNull();
    expect(sanitizeListingText("   ")).toBeNull();
    expect(sanitizeListingText(null)).toBeNull();
    expect(sanitizeListingText(undefined)).toBeNull();
  });

  test("passes through well-formed text unchanged", () => {
    expect(sanitizeListingText("三房兩廳，向南，望花園")).toBe(
      "三房兩廳，向南，望花園",
    );
  });
});

describe("formatSaleDisplay", () => {
  test("formats a sale price in millions with two decimal places and an M suffix", () => {
    expect(formatSaleDisplay(12800000)).toBe("$12.80M");
  });

  test("rounds to two decimal places", () => {
    expect(formatSaleDisplay(5678900)).toBe("$5.68M");
  });

  test("returns null for null, undefined, zero, negative, and non-finite input", () => {
    expect(formatSaleDisplay(null)).toBeNull();
    expect(formatSaleDisplay(undefined)).toBeNull();
    expect(formatSaleDisplay(0)).toBeNull();
    expect(formatSaleDisplay(-1_000_000)).toBeNull();
    expect(formatSaleDisplay(Number.NaN)).toBeNull();
  });
});
