# P1b — Wire `format.ts` Into Existing Call Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every duplicated inline price/area/PSF/date formatter across
`transactions.tsx`, `CorridorInventory.tsx`, `listings.tsx`, `index.tsx`, and
`property.$listingNo.tsx` with calls into the shared `src/lib/format.ts` module — this
is what actually closes DR-2 (hydration/date mismatch) on these routes; P1a only built
the module.

**Architecture:** Every replacement preserves the exact current visible output — this
is a pure de-duplication pass, not a redesign. Where a site's fallback text or output
shape doesn't match an existing `format.ts` export 1:1, a note explains the mapping so
no visible copy changes. One new export (`formatSaleDisplay`) is added to `format.ts`
first, because the audit for this plan found the codebase's "$12.80M" sale-price
convention (÷1,000,000) has no equivalent in P1a's function set — only
`formatManDisplay` (÷10,000, "萬") existed there.

**Tech Stack:** Same as P1a — TypeScript, `bun:test`.

**Prerequisite:** P1a (`docs/superpowers/plans/2026-08-29-frontend-revamp-p1a-format-lib.md`)
must be merged first — every task below imports from `src/lib/format.ts`.

**Explicitly out of scope (do not touch in this plan):**
- `src/routes/index.tsx:893-895` (`priceDisplay` in `PropertyCard`) — uses a *different*,
  valid convention (`(rent/1000).toFixed(0)+"K"` and `(price/10000).toFixed(0)+"萬"`,
  zero decimal places) than `formatManDisplay` (up to one decimal place). Swapping it
  would visibly change rounding on the homepage (e.g. "128.4萬" instead of "128萬") —
  a copy change, not a de-duplication. Not cited by the master plan either. Leave as is.
- `src/routes/listings.tsx:87,90,130` (filter-summary min/max price, result count) —
  plain number formatting, not price/date formatting, and not cited by the master plan.
- `src/components/site/MortgageCalculator.tsx:51-68` (`moneyFormatter`/`percentFormatter`)
  — see the note at the end of this plan. Master plan says "align," but `format.ts` has
  no percent formatter and `moneyFormatter`'s `en-HK` currency style renders `"HK$1,235"`
  where `formatHkd` renders `"$1,235"` — swapping it would change visible currency
  formatting on `/mortgage`. Deferred to P5, which already fully rewrites this
  component's zh-HK copy (DR-8) — bundle the format decision into that pass instead of
  half-aligning it here.
- `src/components/ui/calendar.tsx:35,157` — matches the "un-timezoned date" grep, but
  the component is confirmed unused (no importer anywhere in `src/`). Dead code, not a
  live call site; a P1 task shouldn't touch dead code. Flagged for `refactor-cleaner` /
  a dead-code removal pass, not this plan.

---

## File Structure

- **Modify:** `src/lib/format.ts` — add `formatSaleDisplay`.
- **Modify:** `src/lib/format.test.ts` — add its tests.
- **Modify:** `src/routes/transactions.tsx` — 4 local formatters become thin wrappers around `format.ts`.
- **Modify:** `src/components/site/CorridorInventory.tsx` — 1 local formatter rewritten.
- **Modify:** `src/routes/listings.tsx` — `ListingCard`'s price/date computation.
- **Modify:** `src/routes/index.tsx` — `PropertyCard`'s PSF display.
- **Modify:** `src/routes/property.$listingNo.tsx` — head() price string, `priceLabel`/PSF
  display, `updatedAt`, management fee, comparable-transactions table, `SimilarCard`.

---

## Task 1: Add `formatSaleDisplay` to `format.ts`

**Files:**
- Modify: `src/lib/format.ts` (append one export, after `formatManDisplay`)
- Modify: `src/lib/format.test.ts` (append a test block)

- [ ] **Step 1: Write the failing tests**

Update the import line at the top of `src/lib/format.test.ts` to add `formatSaleDisplay`:

```ts
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
```

Append at the end of `src/lib/format.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx bun test src/lib/format.test.ts`
Expected: FAIL — `error: export named 'formatSaleDisplay' not found in module './format'`.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/format.ts`, add this export immediately after `formatManDisplay`'s
definition (same file, Task 1 of P1a):

```ts
export function formatSaleDisplay(price: number | null | undefined): string | null {
  if (!isFiniteNumber(price) || price <= 0) return null;
  return `$${(price / 1_000_000).toFixed(2)}M`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx bun test src/lib/format.test.ts`
Expected: PASS — 37 tests total (9 describe blocks), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat(format): add formatSaleDisplay for the \$X.XXM sale-price convention"
```

---

## Task 2: Wire `transactions.tsx` onto `format.ts`

**Files:**
- Modify: `src/routes/transactions.tsx:1-7` (imports), `:139-153` (the four local formatters)

- [ ] **Step 1: Add the import**

In `src/routes/transactions.tsx`, the current import block is:

```ts
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { canonicalLink } from "@/content/seo";
import { fetchRecentTransactions, type RecentTransaction } from "@/lib/queries";
```

Add one line after the `@/lib/queries` import:

```ts
import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { canonicalLink } from "@/content/seo";
import { formatArea, formatHkd, formatHkDate, formatManDisplay } from "@/lib/format";
import { fetchRecentTransactions, type RecentTransaction } from "@/lib/queries";
```

- [ ] **Step 2: Replace the four local formatters**

Current code, `src/routes/transactions.tsx:139-153`:

```ts
function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-HK").format(new Date(value)) : "-";
}

function formatPrice(value: number | null) {
  return value ? `HK$${(value / 10000).toLocaleString()}萬` : "-";
}

function formatArea(value: number | null) {
  return value ? `${value.toLocaleString()} 呎` : "-";
}

function formatPsf(value: number | null) {
  return value ? `HK$${value.toLocaleString()}` : "-";
}
```

Replace with (note `formatArea` from `@/lib/format` is imported under its own name, so
the local wrapper below needs a different name — call sites at lines 123-124 must be
updated too, see step 3):

```ts
function formatDate(value: string | null) {
  return formatHkDate(value) ?? "-";
}

function formatPrice(value: number | null) {
  const man = formatManDisplay(value);
  return man ? `HK$${man}` : "-";
}

function formatAreaCell(value: number | null) {
  return formatArea(value) ?? "-";
}

function formatPsf(value: number | null) {
  // This local formatPsf takes an already-computed per-square-foot number (from
  // transaction.saleable_psf), not a (price, area) pair -- it maps onto
  // format.ts's formatHkd, not format.ts's formatPsf (which divides two inputs).
  const hkd = formatHkd(value);
  return hkd ? `HK${hkd}` : "-";
}
```

- [ ] **Step 3: Update the one call site that used the old local `formatArea` name**

Current code, `src/routes/transactions.tsx:123`:

```tsx
      <td className="px-4 py-3">{formatArea(transaction.saleable_area)}</td>
```

Replace with:

```tsx
      <td className="px-4 py-3">{formatAreaCell(transaction.saleable_area)}</td>
```

- [ ] **Step 4: Run this route's test coverage and the format suite**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail (unchanged from Task 1; this task doesn't add new
`format.ts` tests, it only consumes the module).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 5: Commit**

```bash
git add src/routes/transactions.tsx
git commit -m "refactor(transactions): wire local formatters onto src/lib/format.ts

formatDate/formatPrice/formatAreaCell/formatPsf now delegate to the
shared module (DR-2 fix: dates now pin Asia/Hong_Kong). Local formatArea
renamed formatAreaCell to avoid shadowing the imported format.ts export."
```

---

## Task 3: Wire `CorridorInventory.tsx` onto `format.ts`

**Files:**
- Modify: `src/components/site/CorridorInventory.tsx:1-17`

- [ ] **Step 1: Add the import**

Current imports, `src/components/site/CorridorInventory.tsx:1-7`:

```ts
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bath, Bed, Maximize2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import type { CorridorInventory as CorridorInventoryData, ListingRow } from "@/lib/queries";
```

Add one line:

```ts
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bath, Bed, Maximize2, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { formatHkd, formatSaleDisplay } from "@/lib/format";
import type { CorridorInventory as CorridorInventoryData, ListingRow } from "@/lib/queries";
```

- [ ] **Step 2: Replace the local `formatPrice` helper**

Current code, `src/components/site/CorridorInventory.tsx:11-17`:

```ts
function formatPrice(row: ListingRow) {
  if (row.deal_type === "rent") {
    return row.rent ? `HK$${row.rent.toLocaleString()}/月` : "查詢租金";
  }

  return row.price ? `HK$${(row.price / 1_000_000).toFixed(2)}M` : "查詢售價";
}
```

Replace with:

```ts
function formatPrice(row: ListingRow) {
  if (row.deal_type === "rent") {
    const hkd = formatHkd(row.rent);
    return hkd ? `HK${hkd}/月` : "查詢租金";
  }

  return formatSaleDisplay(row.price) ?? "查詢售價";
}
```

- [ ] **Step 3: Run the tests**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail.

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/site/CorridorInventory.tsx
git commit -m "refactor(corridor): wire formatPrice onto src/lib/format.ts"
```

---

## Task 4: Wire `listings.tsx`'s `ListingCard` onto `format.ts`

**Files:**
- Modify: `src/routes/listings.tsx:16-19` (imports), `:393-401` (price/lastSeen)

- [ ] **Step 1: Add the import**

Current imports, `src/routes/listings.tsx:16-19`:

```ts
import { SearchFallbackCTA } from "@/components/site/SearchFallbackCTA";
import { canonicalLink, pageSeo, SITE_URL } from "@/content/seo";
import { searchListings, fetchEstateOptions, type ListingRow } from "@/lib/queries";
import { itemListSchema, jsonLdScript } from "@/lib/schema";
```

Add one line:

```ts
import { SearchFallbackCTA } from "@/components/site/SearchFallbackCTA";
import { canonicalLink, pageSeo, SITE_URL } from "@/content/seo";
import { formatHkd, formatHkDate, formatSaleDisplay } from "@/lib/format";
import { searchListings, fetchEstateOptions, type ListingRow } from "@/lib/queries";
import { itemListSchema, jsonLdScript } from "@/lib/schema";
```

- [ ] **Step 2: Replace the price and date computation**

Current code, `src/routes/listings.tsx:393-401`:

```ts
  const price =
    p.deal_type === "rent"
      ? p.rent
        ? `HK$${p.rent.toLocaleString()}/月`
        : "—"
      : p.price
        ? `HK$${(p.price / 1_000_000).toFixed(2)}M`
        : "—";
  const lastSeen = p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString("zh-HK") : null;
```

Replace with:

```ts
  const price =
    p.deal_type === "rent"
      ? p.rent
        ? `HK${formatHkd(p.rent)}/月`
        : "—"
      : formatSaleDisplay(p.price) ?? "—";
  const lastSeen = formatHkDate(p.last_seen_at);
```

- [ ] **Step 3: Run the tests**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail.

Run: `npm run test:listing-search`
Expected: same result as the P0 baseline (16 pass, 0 fail — this task doesn't touch
query logic, only display formatting).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/routes/listings.tsx
git commit -m "refactor(listings): wire ListingCard price/date onto src/lib/format.ts

DR-2 fix: last_seen_at now formats through formatHkDate (Asia/Hong_Kong
pinned) instead of an un-timezoned toLocaleDateString."
```

---

## Task 5: Wire `index.tsx`'s `PropertyCard` PSF display onto `format.ts`

**Files:**
- Modify: `src/routes/index.tsx:45` (imports), `:1004-1008` (PSF display)

**Note:** `priceDisplay` (lines 893-895) is explicitly out of scope — see this plan's
header. Only the PSF display (the master plan's cited line 898, computed as a raw
number, and its paired display at line 1007) is in scope.

- [ ] **Step 1: Add the import**

Current line, `src/routes/index.tsx:45`:

```ts
import { toTelHref } from "@/lib/contact-links";
```

Add one line after it:

```ts
import { toTelHref } from "@/lib/contact-links";
import { formatHkd } from "@/lib/format";
```

- [ ] **Step 2: Replace the PSF display**

Current code, `src/routes/index.tsx:1004-1008`:

```tsx
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-coral">{priceDisplay}</span>
          <span className="text-xs text-muted-foreground">
            {isRent ? "/月" : psf ? ` · 實呎 $${psf.toLocaleString()}` : ""}
          </span>
        </div>
```

Replace with:

```tsx
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-coral">{priceDisplay}</span>
          <span className="text-xs text-muted-foreground">
            {isRent ? "/月" : psf ? ` · 實呎 ${formatHkd(psf)}` : ""}
          </span>
        </div>
```

(The `psf` computation itself at line 898 — `Math.round(property.price / property.saleable_area)`
— is a data calculation, not duplicated display formatting, so it's unchanged. Only
the `.toLocaleString()` display call moves onto `formatHkd`.)

- [ ] **Step 3: Run the tests**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail.

Run: `npm run test:homepage`
Expected: same result as the P0 baseline (6 pass, 0 fail).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.tsx
git commit -m "refactor(homepage): wire PropertyCard PSF display onto formatHkd"
```

---

## Task 6: Wire `property.$listingNo.tsx`'s head() price string onto `format.ts`

**Files:**
- Modify: `src/routes/property.$listingNo.tsx:43` (imports), `:82-89` (head() price string)

- [ ] **Step 1: Add the import**

Current line, `src/routes/property.$listingNo.tsx:43`:

```ts
import { createWebsiteInquiry } from "@/lib/neon/admin-data";
```

Add one line after it:

```ts
import { createWebsiteInquiry } from "@/lib/neon/admin-data";
import { formatHkd, formatHkDate, formatSaleDisplay } from "@/lib/format";
```

- [ ] **Step 2: Replace the head() price string**

Current code, `src/routes/property.$listingNo.tsx:82-89`:

```ts
    const priceStr =
      p.deal_type === "rent"
        ? p.rent
          ? `月租 $${Number(p.rent).toLocaleString()}`
          : ""
        : p.price
          ? `售 $${(Number(p.price) / 1_000_000).toFixed(2)}M`
          : "";
```

Replace with:

```ts
    const priceStr =
      p.deal_type === "rent"
        ? p.rent
          ? `月租 ${formatHkd(Number(p.rent))}`
          : ""
        : p.price
          ? `售 ${formatSaleDisplay(Number(p.price))}`
          : "";
```

- [ ] **Step 3: Run the tests**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail.

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/routes/property.$listingNo.tsx
git commit -m "refactor(property): wire head() price string onto src/lib/format.ts"
```

---

## Task 7: Wire `property.$listingNo.tsx`'s `priceLabel`/PSF display onto `format.ts`

**Files:**
- Modify: `src/routes/property.$listingNo.tsx:171-177` (priceLabel), `:392-403` (PSF display)

- [ ] **Step 1: Replace `priceLabel`**

Current code, `src/routes/property.$listingNo.tsx:171-177`:

```ts
  const priceLabel = isRent
    ? property.rent
      ? `$${Number(property.rent).toLocaleString()} / 月`
      : "—"
    : property.price
      ? `$${(Number(property.price) / 1_000_000).toFixed(2)}M`
      : "—";
```

Replace with:

```ts
  const priceLabel = isRent
    ? property.rent
      ? `${formatHkd(Number(property.rent))} / 月`
      : "—"
    : property.price
      ? formatSaleDisplay(Number(property.price))
      : "—";
```

(`psf` and `grossPsf` at lines 178-185 are unchanged — same reasoning as Task 5: those
are data computations, not display formatting.)

- [ ] **Step 2: Replace the PSF display**

Current code, `src/routes/property.$listingNo.tsx:392-403`:

```tsx
        <p className="mt-4 text-3xl font-bold text-primary">
          {priceLabel}
          {psf && !isRent ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              實呎 ${psf.toLocaleString()}
            </span>
          ) : null}
          {grossPsf && !isRent ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · 建呎 ${grossPsf.toLocaleString()}
            </span>
          ) : null}
        </p>
```

Replace with:

```tsx
        <p className="mt-4 text-3xl font-bold text-primary">
          {priceLabel}
          {psf && !isRent ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              實呎 {formatHkd(psf)}
            </span>
          ) : null}
          {grossPsf && !isRent ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · 建呎 {formatHkd(grossPsf)}
            </span>
          ) : null}
        </p>
```

- [ ] **Step 3: Run the tests**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail.

Run: `npm run test:property-experience`
Expected: same pre-existing result as the P0 baseline (89 node pass / 2 known
pre-existing fail + 105 bun pass — the 2 known failures are the unrelated
`site.test.mjs` homepage-ordering bug documented in
`docs/superpowers/reports/2026-08-28-revamp-baseline.md` §4.2, not something this task
touches).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/routes/property.$listingNo.tsx
git commit -m "refactor(property): wire priceLabel and PSF display onto src/lib/format.ts"
```

---

## Task 8: Wire the rest of `property.$listingNo.tsx` onto `format.ts`

**Files:**
- Modify: `src/routes/property.$listingNo.tsx:328-330` (`updatedAt`), `:425-430`
  (management fee), `:648-658` (comparable-transactions table), `:791-797` (`SimilarCard`)

- [ ] **Step 1: Replace `updatedAt`**

Current code, `src/routes/property.$listingNo.tsx:328-330`:

```ts
  const updatedAt = property.updated_at
    ? new Date(property.updated_at).toLocaleDateString("zh-HK")
    : null;
```

Replace with:

```ts
  const updatedAt = formatHkDate(property.updated_at);
```

- [ ] **Step 2: Replace the management-fee display**

Current code, `src/routes/property.$listingNo.tsx:425-430`:

```tsx
          <Spec
            label="管理費"
            value={
              property.management_fee ? `$${Number(property.management_fee).toLocaleString()}` : "—"
            }
          />
```

Replace with:

```tsx
          <Spec
            label="管理費"
            value={formatHkd(property.management_fee) ?? "—"}
          />
```

- [ ] **Step 3: Replace the comparable-transactions table row**

Current code, `src/routes/property.$listingNo.tsx:648-658`:

```tsx
                          <TableCell className="text-right">
                            {t.saleable_area ? `${t.saleable_area} 呎` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {t.price ? `$${(Number(t.price) / 1_000_000).toFixed(2)}M` : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {t.saleable_psf
                              ? `$${Math.round(Number(t.saleable_psf)).toLocaleString()}`
                              : "—"}
                          </TableCell>
```

Replace with:

```tsx
                          <TableCell className="text-right">
                            {formatArea(t.saleable_area) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatSaleDisplay(Number(t.price)) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatHkd(Number(t.saleable_psf)) ?? "—"}
                          </TableCell>
```

This introduces `formatArea` in this file for the first time — add it to this file's
`@/lib/format` import (from Task 6, now three exports become four):

```ts
import { formatArea, formatHkd, formatHkDate, formatSaleDisplay } from "@/lib/format";
```

- [ ] **Step 4: Replace `SimilarCard`'s price**

Current code, `src/routes/property.$listingNo.tsx:791-797`:

```ts
  const price = isRent
    ? listing.rent
      ? `$${Number(listing.rent).toLocaleString()} / 月`
      : "—"
    : listing.price
      ? `$${(Number(listing.price) / 1_000_000).toFixed(2)}M`
      : "—";
```

Replace with:

```ts
  const price = isRent
    ? listing.rent
      ? `${formatHkd(Number(listing.rent))} / 月`
      : "—"
    : formatSaleDisplay(Number(listing.price)) ?? "—";
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:format`
Expected: PASS — 37 tests, 0 fail.

Run: `npm run test:property-experience`
Expected: same as Task 7 step 3 (2 known pre-existing failures, unrelated to this task).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

Run: `npx eslint src/routes/property.$listingNo.tsx src/routes/transactions.tsx src/routes/listings.tsx src/routes/index.tsx src/components/site/CorridorInventory.tsx`
Expected: no *new* problems introduced by this plan's edits (the P0 baseline's
pre-existing `prettier/prettier` count for these files may still show — that's the
ratchet's job in CI, not this step's; this step is a human sanity check that nothing
new and real snuck in).

- [ ] **Step 6: Commit**

```bash
git add src/routes/property.$listingNo.tsx
git commit -m "refactor(property): wire updatedAt, management fee, comparable
transactions, and SimilarCard onto src/lib/format.ts

DR-2 fix: updatedAt and the comparable-transactions deal dates now
format through formatHkDate/formatHkd instead of un-timezoned
toLocaleDateString/toLocaleString calls."
```

---

## Verification (end to end)

1. `npm run test:format` — 37 tests pass.
2. `npm run test:listing-search && npm run test:homepage && npm run test:property-experience`
   — each matches its P0-baseline result exactly (no new failures, the 2 pre-existing
   `test:property-experience` failures are unrelated and untouched).
3. `npx tsc --noEmit` — still 0 errors.
4. `npx eslint .` — problem count still at or below the P0 baseline's 6,185 (this
   plan's five modified files should net-reduce duplicated logic, not add lint
   problems, but the ratchet is what actually gates this in CI).
5. `npm run build` — still passes.
6. Manually load `/`, `/listings`, `/property/<a-real-listing-no>`, `/transactions`,
   and a corridor page (`/castle-peak-road/ting-kau`) in a dev server and confirm every
   price/area/PSF/date figure renders identically to before this plan (same numbers,
   same currency symbols, same suffixes) — this plan must be visually silent.
7. `git diff --stat` against the branch this was built on shows only the eight files
   listed in "File Structure" above.

After this plan, DR-2 is closed on every route it touches except the explicitly
deferred `MortgageCalculator.tsx` (P5) and the dead `ui/calendar.tsx` (cleanup, not P1).
Remaining DR-2 sites are the 11 admin files recorded in the P0 baseline report — those
belong to P6 (admin workspace), not this plan.
