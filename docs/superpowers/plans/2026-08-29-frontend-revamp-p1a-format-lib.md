# P1a — Shared Formatting Library (`src/lib/format.ts`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `src/lib/format.ts`, the single shared module for every HKD/area/PSF/date
formatter and for sanitizing malformed imported listing text — the module the rest of
P1 (layout primitives, call-site cleanup) and P2 (DR-2, DR-4) depend on.

**Architecture:** One pure-function module, no React, no I/O. Every date formatter pins
`timeZone: "Asia/Hong_Kong"` so SSR (Vercel = UTC) and client (UTC+8) never disagree —
this is the fix for DR-2 (hydration/date mismatch). `sanitizeListingText` strips
control characters, collapses whitespace, and suppresses known malformed-import tokens
(`NaN`, `null`, `$0`, `- 房`) — this is the fix for DR-4. Every formatter that can
receive missing/invalid input returns `null` rather than a placeholder string, per the
plan's "no invented facts, hide the field" rule (`docs/superpowers/plans/2026-08-28-frontend-revamp.md`
§0.3) — callers decide how to render "no data" (usually: don't render the row/label at all).

**Tech Stack:** TypeScript, `Intl.DateTimeFormat` / `Number.prototype.toLocaleString`,
`bun:test` (this repo's `.test.ts` runner — confirmed via `src/components/property/PropertyDecisionActions.test.tsx`,
no `@testing-library/react` anywhere in this repo).

**Relationship to the master plan:** this is sub-plan "P1a" of P1 — Design-system
foundation in `docs/superpowers/plans/2026-08-28-frontend-revamp.md`. P1 is split into
four independently-shippable sub-plans because it covers four genuinely separate
subsystems (this skill's own scope-check guidance): P1a (this plan, the format
library), P1b (wiring `format.ts` into the six existing call sites the master plan
cites), P1c (the ten layout primitives), P1d (`AppImage` + its 24-site rollout), plus a
smaller P1e for design tokens/font loading. This plan produces working, independently
testable software on its own — nothing here touches an existing route or component.

---

## File Structure

- **Create:** `src/lib/format.ts` — the formatter module (no default export; eight named exports).
- **Create:** `src/lib/format.test.ts` — `bun test` contract tests for every export.
- **Modify:** `package.json` — add `"test:format": "bun test src/lib/format.test.ts"`.

No existing file is modified except `package.json`'s `scripts` block (additive, one new
key). Nothing in `src/routes/` or `src/components/` is touched by this plan — that's
P1b.

---

## Task 1: Currency and area formatters

**Files:**
- Create: `src/lib/format.ts` (new file — this task writes its first four exports)
- Test: `src/lib/format.test.ts` (new file — this task writes its first block)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/format.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/lib/format.test.ts`
Expected: FAIL — `error: Cannot find module './format'` (the module doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/format.ts`:

```ts
const HK_NUMBER_LOCALE = "en-US";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatHkd(amount: number | null | undefined): string | null {
  if (!isFiniteNumber(amount)) return null;
  return `$${Math.round(amount).toLocaleString(HK_NUMBER_LOCALE)}`;
}

export function formatManDisplay(amount: number | null | undefined): string | null {
  if (!isFiniteNumber(amount) || amount <= 0) return null;
  const man = amount / 10000;
  const rounded = Math.round(man * 10) / 10;
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${display}萬`;
}

export function formatArea(sqft: number | null | undefined): string | null {
  if (!isFiniteNumber(sqft) || sqft <= 0) return null;
  return `${Math.round(sqft).toLocaleString(HK_NUMBER_LOCALE)} 呎`;
}

export function formatPsf(
  price: number | null | undefined,
  area: number | null | undefined,
): string | null {
  if (!isFiniteNumber(price)) return null;
  if (!isFiniteNumber(area) || area <= 0) return null;
  const psf = price / area;
  return `$${Math.round(psf).toLocaleString(HK_NUMBER_LOCALE)} 呎`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/lib/format.test.ts`
Expected: PASS — 14 tests (4 describe blocks), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(format): add currency and area formatters

formatHkd, formatManDisplay, formatArea, formatPsf. Every formatter
returns null on missing/invalid input rather than a placeholder --
formatPsf specifically never divides by zero."
```

---

## Task 2: Date and freshness formatters (DR-2 fix)

**Files:**
- Modify: `src/lib/format.ts` (append three exports + one private helper)
- Modify: `src/lib/format.test.ts` (append a test block)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/format.test.ts` (after the existing `import` line, extend it; add
the new `describe` blocks at the end of the file):

```ts
import { describe, expect, test } from "bun:test";

import {
  formatArea,
  formatFreshness,
  formatHkd,
  formatHkDate,
  formatHkDateTime,
  formatManDisplay,
  formatPsf,
} from "./format";
```

(Replace the file's existing `import` line with the block above — it's the same file,
just with three more named imports.)

Then append at the end of `src/lib/format.test.ts`:

```ts
describe("formatHkDate", () => {
  test("anchors to Asia/Hong_Kong regardless of the input's UTC-day boundary", () => {
    // 2026-01-01T16:30:00Z is 2026-01-02T00:30 in Hong Kong (UTC+8). A
    // formatter without an explicit timeZone would report 1月1日 on a UTC
    // server and 1月2日 on an HKT browser -- this is the exact DR-2 hydration
    // mismatch. formatHkDate must report 2026/01/02 no matter where it runs.
    const date = new Date("2026-01-01T16:30:00Z");
    expect(formatHkDate(date)).toBe("2026/01/02");
  });

  test("accepts an ISO date string", () => {
    expect(formatHkDate("2026-03-15T00:00:00Z")).toBe("2026/03/15");
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
    expect(formatHkDateTime(date)).toBe("2026/01/02 00:30");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/lib/format.test.ts`
Expected: FAIL — `error: export named 'formatHkDate' not found in module './format'`
(and similarly for `formatHkDateTime`, `formatFreshness`).

- [ ] **Step 3: Write the minimal implementation**

Append to `src/lib/format.ts`:

```ts
const HK_TIME_ZONE = "Asia/Hong_Kong";
const HK_DATE_LOCALE = "zh-HK";

function toValidDate(input: string | number | Date | null | undefined): Date | null {
  if (input === null || input === undefined) return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatHkDate(input: string | number | Date | null | undefined): string | null {
  const date = toValidDate(input);
  if (!date) return null;
  return new Intl.DateTimeFormat(HK_DATE_LOCALE, {
    timeZone: HK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatHkDateTime(
  input: string | number | Date | null | undefined,
): string | null {
  const date = toValidDate(input);
  if (!date) return null;
  return new Intl.DateTimeFormat(HK_DATE_LOCALE, {
    timeZone: HK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatFreshness(
  input: string | number | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  const date = toValidDate(input);
  if (!date) return null;
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "剛剛更新";
  if (diffMinutes < 60) return `${diffMinutes} 分鐘前更新`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小時前更新`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 日前更新`;
  return `${formatHkDate(date)} 更新`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/lib/format.test.ts`
Expected: PASS — 24 tests total (7 describe blocks), 0 fail.

If `formatHkDate`'s exact output differs from `"2026/01/02"` in this environment's ICU
data (locale rendering can vary slightly by Node/Bun/ICU version), update the test's
expected string to match the actual `Intl` output for `zh-HK` — the point of the test
is that it's **stable and HK-anchored**, not the exact separator character.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(format): add HK-timezone date formatters (DR-2 fix)

formatHkDate, formatHkDateTime, formatFreshness all pin
timeZone: Asia/Hong_Kong, so SSR (UTC) and client (UTC+8) render the
same date -- the root cause of DR-2's hydration mismatch."
```

---

## Task 3: `sanitizeListingText` (DR-4 fix)

**Files:**
- Modify: `src/lib/format.ts` (append one export)
- Modify: `src/lib/format.test.ts` (append a test block)

- [ ] **Step 1: Write the failing tests**

Update the import line at the top of `src/lib/format.test.ts` to add `sanitizeListingText`:

```ts
import {
  formatArea,
  formatFreshness,
  formatHkd,
  formatHkDate,
  formatHkDateTime,
  formatManDisplay,
  formatPsf,
  sanitizeListingText,
} from "./format";
```

Then append at the end of `src/lib/format.test.ts`:

```ts
describe("sanitizeListingText", () => {
  test("strips control characters", () => {
    expect(sanitizeListingText("正常 文字")).toBe("正常文字");
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/lib/format.test.ts`
Expected: FAIL — `error: export named 'sanitizeListingText' not found in module './format'`.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/lib/format.ts`:

```ts
const CONTROL_CHAR_PATTERN = /[ --]/g;
const WRAPPING_QUOTES_PATTERN = /^"+|"+$/g;
const REPEATED_DELIMITER_PATTERN = /,{2,}/g;
const EXACT_MALFORMED_TOKEN_PATTERN = /^(NaN|null|undefined|-\s*房|\$0)$/;

export function sanitizeListingText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  let text = input.replace(CONTROL_CHAR_PATTERN, "");
  text = text.replace(WRAPPING_QUOTES_PATTERN, "");
  text = text.replace(REPEATED_DELIMITER_PATTERN, ",");
  text = text.replace(/\s+/g, " ").trim();

  if (text === "" || EXACT_MALFORMED_TOKEN_PATTERN.test(text)) return null;

  return text;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/lib/format.test.ts`
Expected: PASS — 32 tests total (8 describe blocks), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(format): add sanitizeListingText (DR-4 fix)

Strips control characters, wrapping CSV quotes, and repeated
delimiters; suppresses exact malformed-import tokens (NaN, null,
undefined, \$0, - 房) to null rather than rendering them."
```

---

## Task 4: Wire up `test:format` and verify against the P0 baseline

**Files:**
- Modify: `package.json:23` (scripts block, immediately after the existing `"typecheck"` line added in P0)

- [ ] **Step 1: Add the npm script**

In `package.json`, find this block (added in P0):

```json
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
```

Add `"test:format"` after `"typecheck"`:

```json
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test:format": "bun test src/lib/format.test.ts",
    "format": "prettier --write .",
```

- [ ] **Step 2: Run the new script**

Run: `npm run test:format`
Expected: PASS — 32 tests, 0 fail (same result as Task 3 step 4, now reachable the same
way every other test suite in this repo is run).

- [ ] **Step 3: Confirm this plan didn't move the P0 ratchets**

Run: `npx tsc --noEmit`
Expected: exit 0, no output (P0 baseline was 0 errors — must still be 0; this plan adds
a fully-typed module, so it shouldn't introduce any).

Run: `npx eslint src/lib/format.ts src/lib/format.test.ts`
Expected: no new errors from these two files (the P0 baseline's 6,185 pre-existing
problems are in *other* files — this task's new files should lint clean since they're
written to this repo's prettier config from the start, not migrated from elsewhere).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(format): wire up npm run test:format"
```

---

## Verification (end to end)

1. `npm run test:format` — 32 tests pass.
2. `npx tsc --noEmit` — still 0 errors (P0 baseline held).
3. `npx eslint src/lib/format.ts src/lib/format.test.ts` — no new problems from these files.
4. `git log --oneline` on this branch shows four commits, each independently revertable.
5. Nothing outside `src/lib/format.ts`, `src/lib/format.test.ts`, and `package.json`
   changed — confirm with `git diff --stat` against the branch this was built on.

No route, component, or existing call site was touched. `formatHkd`, `formatManDisplay`,
`formatArea`, `formatPsf`, `formatHkDate`, `formatHkDateTime`, `formatFreshness`, and
`sanitizeListingText` are exported and ready for P1b (wiring them into
`property.$listingNo.tsx`, `listings.tsx`, `transactions.tsx`, `index.tsx`,
`CorridorInventory.tsx`, and aligning `MortgageCalculator.tsx`) and for P2's DR-2/DR-4
closure.
