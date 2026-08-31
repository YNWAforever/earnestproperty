# P7c — Performance (fetchPriority, self-hosted fonts, transactions pagination)

**Goal:** Close the 3 still-open items from the master plan's P7 Performance work item (fresh 2026-08-31 audit: 6/9 already done by earlier phases). Lighthouse recording is deliberately out of scope for this PR (see §0).

**Base branch:** `main` (post-#90-#94, all merged).

## 0. Scope decisions

1. **Lighthouse before/after is not done in this PR.** It needs a deployed/previewable build plus a real run, which isn't reproducible from this sandbox (no live DB, no public URL). Left as a documented follow-up, not silently dropped.
2. **Hero `fetchPriority="high"` moves off the header logo.** It's a 60×60px logo rendered on every single page, never the actual LCP candidate; the real hero images (`index.tsx`, `property.$listingNo.tsx`) already have `loading="eager"` but not `fetchPriority`.
3. **Transactions pagination reuses the existing `RESULT_LIMIT`/filter shape** — adds `page` to the search schema and `offset`/total-count to the query layer, not a redesign of the filter UI.
4. **Fonts self-host via `@fontsource` packages** (Inter, Noto Sans TC) rather than hand-downloading `.woff2` files — same fonts, same weights, MIT-licensed, already-optimized subsets, no external request at all (replacing the Google Fonts `<link>` tags in `__root.tsx` entirely, not just adding a preload).

## Task 1: fetchPriority fix

- Add `fetchPriority="high"` to `index.tsx`'s hero `<AppImage>` (~line 212) and `property.$listingNo.tsx`'s hero image (~line 572).
- Remove `fetchPriority="high"` from `SiteHeader.tsx`'s logo (~line 357) — keep `loading="eager"` there (still reasonable, it's always visible immediately, just not the LCP element).

## Task 2: self-hosted fonts

- `npm install @fontsource/inter @fontsource/noto-sans-tc` (only the weights actually used: 400/500/600/700 for Inter, 400/500/700/900 for Noto Sans TC, per `__root.tsx`'s current Google Fonts URL).
- Replace `__root.tsx`'s `preconnect`/`preload`/`stylesheet` links to `fonts.googleapis.com`/`fonts.gstatic.com` with `import` statements for the specific weight files, plus a `<link rel="preload" as="font">` for the two most-used weights (400/700 body text).

## Task 3: transactions pagination

- Add `page` to `transactions.tsx`'s search schema (default 1).
- Server: add `offset` to `NeonRecentTransactionsInput`/SQL (`OFFSET`), and a total count (window function `COUNT(*) OVER()` on the same query, cheapest way to get both in one round trip).
- UI: page controls (prev/next, page N of M) below the table, matching `listings.tsx`'s existing pagination pattern where reasonable.

## Final verification

`npx tsc --noEmit && npm run test:transactions && npm run test:homepage && npm run build && npm run lint`
