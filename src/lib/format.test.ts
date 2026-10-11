import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  formatArea,
  formatFreshness,
  formatHkd,
  formatHkDate,
  formatHkDateTime,
  formatPrice,
  formatPsf,
  sanitizeListingText,
} from "./format";

describe("formatHkd", () => {
  test("formats a whole-dollar amount with thousands separators and a $ prefix", () => {
    expect(formatHkd(12800000)).toBe("$12,800,000");
  });

  test("rounds a fractional amount to the nearest dollar", () => {
    expect(formatHkd(1234.6)).toBe("$1,235");
  });

  test("returns null for null, undefined, zero, negative, and non-finite input", () => {
    expect(formatHkd(null)).toBeNull();
    expect(formatHkd(undefined)).toBeNull();
    expect(formatHkd(Number.NaN)).toBeNull();
    expect(formatHkd(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatHkd(0)).toBeNull();
    expect(formatHkd(-500)).toBeNull();
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
    expect(formatFreshness(fortyDaysAgo, now)).toBe(`${formatHkDate(fortyDaysAgo)} 更新`);
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
    expect(sanitizeListingText("  海景   單位   \n\n望向大海  ")).toBe("海景 單位 望向大海");
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
    expect(sanitizeListingText("三房兩廳，向南，望花園")).toBe("三房兩廳，向南，望花園");
  });
});

describe("formatPrice", () => {
  test("a sale price is shown in 萬 with thousands separators", () => {
    expect(formatPrice(12_680_000, { dealType: "sale" })).toBe("HK$1,268萬");
    expect(formatPrice(8_000_000, { dealType: "sale" })).toBe("HK$800萬");
    expect(formatPrice(100_000_000, { dealType: "sale" })).toBe("HK$10,000萬");
  });

  test("a non-round sale price keeps up to two decimals of 萬 with trailing zeros stripped", () => {
    expect(formatPrice(12_685_000, { dealType: "sale" })).toBe("HK$1,268.5萬");
    expect(formatPrice(12_684_500, { dealType: "sale" })).toBe("HK$1,268.45萬");
    expect(formatPrice(12_684_567, { dealType: "sale" })).toBe("HK$1,268.46萬");
    expect(formatPrice(12_680_040, { dealType: "sale" })).toBe("HK$1,268萬");
  });

  test("exact: true adds the full amount when 萬 rounding hides digits (admin confirm/edit)", () => {
    expect(formatPrice(6_200_040, { dealType: "sale", exact: true })).toBe(
      "HK$620萬（HK$6,200,040）",
    );
    expect(formatPrice(6_200_000, { dealType: "sale", exact: true })).toBe("HK$620萬");
    expect(formatPrice(12_685_000, { dealType: "sale", exact: true })).toBe("HK$1,268.5萬");
    expect(formatPrice(12_684_567, { dealType: "sale", exact: true })).toBe(
      "HK$1,268.46萬（HK$12,684,567）",
    );
    expect(formatPrice(38_000, { dealType: "rent", exact: true })).toBe("HK$38,000／月");
    expect(formatPrice(5_000, { dealType: "sale", exact: true })).toBe("HK$5,000");
    expect(formatPrice(null, { dealType: "sale", exact: true })).toBeNull();
    // Without exact the public rounding is unchanged.
    expect(formatPrice(6_200_040, { dealType: "sale" })).toBe("HK$620萬");
  });

  test("a sale price below 1萬 falls back to whole dollars with commas", () => {
    expect(formatPrice(5_000, { dealType: "sale" })).toBe("HK$5,000");
  });

  test("a rent is whole dollars per month with a full-width slash", () => {
    expect(formatPrice(38_000, { dealType: "rent" })).toBe("HK$38,000／月");
    expect(formatPrice(18_500.4, { dealType: "rent" })).toBe("HK$18,500／月");
  });

  test("returns null for null, undefined, zero, negative, and non-finite input so callers keep their fallback", () => {
    for (const dealType of ["sale", "rent"] as const) {
      expect(formatPrice(null, { dealType })).toBeNull();
      expect(formatPrice(undefined, { dealType })).toBeNull();
      expect(formatPrice(0, { dealType })).toBeNull();
      expect(formatPrice(-1_000_000, { dealType })).toBeNull();
      expect(formatPrice(Number.NaN, { dealType })).toBeNull();
      expect(formatPrice(Number.POSITIVE_INFINITY, { dealType })).toBeNull();
    }
  });
});

// One price format (FX-19d-2, D8). Every listing, transaction, budget and
// enquiry price goes through formatPrice; nothing in src formats a price inline.
// Allowed money that is not a price: per-square-foot rates (psf), the mortgage
// calculator's figures, and the analytics commission totals. JSON-LD
// (src/lib/schema.ts) keeps numeric prices and never formats them.
describe("price formatting has a single source", () => {
  const SRC = join(import.meta.dir, "..");
  const NOT_A_PRICE_FILES = new Set([
    "components/property/PropertyDecisionActions.tsx", // mortgage monthly payment / deposit
    "components/site/MortgageCalculator.tsx", // mortgage calculator figures
    "components/admin/analytics/PerformanceDashboard.tsx", // commission analytics
  ]);
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["old helper", /\bformat(?:SaleDisplay|ManDisplay)\b/],
    ["millions with toFixed", /\/\s*1_?000_?000\)\.toFixed\(/],
    ["inline $ + toLocaleString", /(?:\$\$\{|"HK\$"\s*\+|HK\$\$\{)[^`]*toLocaleString\(/],
    [
      "toLocaleString on a price, rent, budget or amount",
      /(?:^|[\s.(!])(?:\w*[pP]rice|rent|budget_\w+|amount)\)?\.toLocaleString\(/,
    ],
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      if (!/\.(?:ts|tsx|js)$/.test(name) || /\.test\.|\.d\.ts$|routeTree\.gen\.ts$/.test(name))
        return [];
      return [path];
    });
  }

  test("no other price formatter or inline price formatting remains in src", () => {
    const offences: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const rel = relative(SRC, path).replaceAll("\\", "/");
      if (rel === "lib/format.ts" || NOT_A_PRICE_FILES.has(rel)) continue;
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (/psf|Psf|呎/.test(line)) return; // a per-square-foot rate is not a price
          for (const [label, pattern] of FORBIDDEN)
            if (pattern.test(line)) offences.push(`${rel}:${index + 1} ${label}: ${line.trim()}`);
        });
    }
    expect(offences).toEqual([]);
  });

  test("admin screens where staff confirm or edit a price use the exact option", () => {
    for (const rel of [
      "lib/admin/property-management-ui.ts", // admin listings, detail and publish confirm
      "routes/admin.transactions.tsx",
      "components/admin/whatsapp/WhatsappLinkWizard.tsx",
    ]) {
      const source = readFileSync(join(SRC, rel), "utf8");
      const calls = source.match(/formatPrice\([^;]*?\}\)/gs) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call).toContain("exact: true");
    }
  });

  test("JSON-LD keeps numeric prices", () => {
    const schema = readFileSync(join(SRC, "lib/schema.ts"), "utf8");
    expect(schema).not.toContain("formatPrice");
    expect(schema).toContain("return Number(value) || null;");
  });
});
