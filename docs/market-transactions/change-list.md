# 市場註冊成交 — 改動說明（Change list）

Branch: `feat/market-registered-transactions-20261124` (from `origin/main` @ `b8d5d4fe`)
Handoff: `earnest-deepseek-handoff-20261124` (`DEEPSEEK_INSTRUCTIONS.md`, verified SHA-256)

## 1. Proof this extends the existing site instead of forking a parallel one

`origin/main` already shipped 市場註冊成交 as a static, database-free module
(EPRC export, 22 estate queries, 8 rows per estate, no filters, no pagination):

| Existing surface                                       | Kept?         | How it changed                                                                                                 |
| ------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/content/eprc-transactions.ts` + `-snapshot.ts`    | **unchanged** | still the EPRC read path, same CSV fixture, same parser                                                        |
| `src/components/site/EstateRegisteredTransactions.tsx` | **unchanged** | now rendered as a separately-counted 其他來源 block inside the estate page's market section                    |
| `/estate/{slug}` route                                 | extended      | same route, same `/estate/{slug}` URLs; the market module gains filters, pagination, both dates and provenance |
| `/property/{listingNo}`                                | extended      | gained an estate-level 市場註冊成交 summary that links to the estate page                                      |
| `transactions` table (`本行成交`)                      | **untouched** | still rendered by `EstateMarketSnapshot` (estate) and the agency table (listing), separate headings and counts |
| `src/lib/queries.ts`, `src/lib/neon/*`, admin          | **untouched** | the contract test still asserts the market module cannot import them                                           |

No new route, no second estate directory, no new table.

## 2. Data layer (new files)

| File                                                                | Purpose                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `docs/market-transactions/data-contract.md`                         | authoritative snapshot/API contract                                                                        |
| `scripts/market-transactions/build-snapshot.mjs`                    | deterministic offline generator; `--dry-run`, `--check`, `--print-summary`; archives stay outside the repo |
| `src/content/fixtures/market-transactions-62-estates-20261123.json` | derived snapshot committed as the versioned source                                                         |
| `src/content/market-transactions.ts`                                | pure module: validation, slug mapping, filters, facets, pagination, pairing counts, derived old-site URL   |
| `src/content/market-transactions-snapshot.ts`                       | binds the fixture; `getEstateMarketTransactions`, `getEstateChartTranscription`                            |

Coverage: **62** estates, **59** with rows, **3** genuinely filtered-empty
(翠景花園 / 海韻臺 / 觀海別墅), **8,819** source rows (8,496 + 323), **408**
chart-transcription months across **17** estates. Rows are always labelled
source rows, never "deals"; pairing produces a separate, explicitly-labelled
count.

## 3. UI / UX changes

### Estate page 市場註冊成交 (`src/components/site/EstateMarketRegistrations.tsx`)

- Filters: 年份 / 性質 / 期數座數 as URL search params (`mtYear`, `mtNature`,
  `mtPhase`, `mtPage`), validated by `src/lib/estate-market-search.ts` and
  rendered as links, so the table stays server-rendered, crawlable and
  shareable.
- Pagination: 20 rows per page with 上一頁／下一頁 and `第 X / Y 頁`; thousands of
  rows are never dumped into the DOM.
- Both **登記日期** and **文書日期** are shown as separate columns.
- Missing 面積/呎價 renders as `—`, never `0`; no estate average is ever
  synthesised from mostly-null areas.
- Counts: `共 N 筆來源紀錄`, plus `其中 X 組為臨時＋正式合約配對（同單位、同登記日、
同成交價），去重後 Y 宗` only when pairing exists.
- Honest empty states: (a) filtered-empty source → "不代表此屋苑沒有成交",
  (b) over-narrow filter → reset link, (c) no rows at all → the EPRC block
  still renders.
- Provenance footnote: source, period, 2026 year-to-date, "非即時、非全部歷史",
  missing area/psf caveat, and "本表為來源列數".
- Chart transcription is a separate `<details>` block: 宗數 / 平均實用呎價 per
  month, zero volume keeps `0` with a blank 呎價, and the text states it is a
  hand transcription, not an official dataset, with an unpublished date basis.
  No third-party PNG is embedded or hotlinked.
- The EPRC export renders under `其他來源：EPRC 匯出（N 筆，2026-10-27）` with its
  own count — never merged into the table above.

### Listing detail page (`src/components/site/ListingEstateMarketSummary.tsx`)

- Latest 3 estate-level market registrations for the listing's estate plus
  `N 筆來源紀錄` and the snapshot date, then
  `查看 {屋苑} 全部市場註冊成交 →` linking to `/estate/{slug}`.
- The listing's own blank unit facts (floor, unit, asking price, gross area) are
  untouched — nothing is back-filled from estate averages.
- The agency block on the same page is now explicitly headed **本行成交紀錄**
  (it was 屋苑近期成交) so the two sources cannot be mistaken for one table.
- The snapshot import is deliberately fail-soft: a snapshot problem logs and
  renders the listing page without the block instead of taking the money page
  down.

## 4. SEO / performance

- The first page uses `/estate/{slug}`. Filters and later pages carry `noindex,follow` and point to the base estate URL as their canonical. Changing or clearing one filter retains the other selections and returns to the first page. Listing, filter and pagination links target the market registration heading.
- The ~5.7 MB snapshot is read through **one server function**
  (`src/lib/market/estate-market.ts`, the repo's `createServerFn` +
  `await import(...)` boundary) and `src/content/market-transactions-snapshot.ts`
  is marked `@tanstack/react-start/server-only`. Only the current page of rows
  is serialised into the route payload.
  - Why that matters: the first cut imported the snapshot directly from the
    route loaders, which worked in SSR but also emitted a **5.6 MB client chunk**
    (`.output/public/assets/market-transactions-snapshot-*.js`). Route loaders
    run in the client graph too, so "lazy inside the loader" is not server-only.
    The contract test now fails if either route imports the snapshot module, and
    the build output was re-checked to confirm the chunk is gone.
- Accessibility: real `<table>` with `<caption class="sr-only">`, `scope="col"`
  headers, scrollable region with `aria-label` + `tabIndex`, `aria-current` on
  the active filter, `aria-live` page indicator, mobile-first wrap.

## 5. Tests

`npm run test:estate-conversion` now covers the new modules:

- `src/content/market-transactions.test.mjs` — schema drift, ISO dates, facet
  counts, pagination clamping, null-vs-zero area/psf, zero-volume chart months,
  two separate dates, pairing (same-day pair / cross-date non-pair /
  same-nature retained), determinism.
- `src/lib/estate-market-search.test.mjs` — search schema defaults, invalid and
  hostile query strings, filter detection.
- `src/components/site/EstateMarketRegistrations.test.tsx` — headings, both
  date columns, blanks as `—`, source-row counts, facet links, pagination,
  filtered-empty copy, chart separation, provenance copy.
- `src/components/site/ListingEstateMarketSummary.test.tsx` — three-row limit,
  estate link, blanks, honest empty state, no agency data.
- `src/routes/estate.market-transactions.contract.test.mjs` — rewritten to pin
  the new wiring **and** keep the original isolation guarantees (agency and
  market paths must not import each other, EPRC snapshot unchanged).

Fixtures in the repo are synthetic; the only real data committed is the public
registered-transaction snapshot itself (no contacts, no vendor/purchaser, no
raw HTML), matching the existing EPRC fixture precedent.

## 6. PR, preview and screenshots

- **PR:** https://github.com/YNWAforever/earnestproperty/pull/361 (opened as a
  **draft**; it must not be merged without Willy's named approval).
- **Vercel preview:** https://earnestproperty-git-feat-market-re-429665-ynwaforevers-projects.vercel.app
  — deployment succeeded, but this project's previews sit behind **Vercel
  Authentication**, so an unauthenticated request gets the Vercel login page
  (`<title>Login – Vercel</title>`). Sign in as the project owner to view it;
  it cannot be captured anonymously.
- GitHub reports an account billing or spending-limit issue for all five checks. The jobs started zero steps. The account owner can check the payment status and Actions budget under Billing and plans before rerunning the checks. [GitHub Actions run](https://github.com/YNWAforever/earnestproperty/actions/runs/45257834385).

Screenshots below are from the **local production build** (the brief allows
preview _or_ local; the preview is auth-gated). `.output/server` + Playwright
Chromium, 1440×1000 desktop / 390×844 mobile, `locale=zh-HK`, zero page errors,
no page-level horizontal overflow.
`docs/market-transactions/screenshots/`:

| File                                                                           | Shows                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estate-mun-ming-shan-desktop.png`                                             | estate page module: 323 source rows, both date columns, all-`—` 面積／呎價, facet counts 2021 92 … 2026 55, 性質 261/62, pagination 1/17, chart transcription collapsed, provenance footnote |
| `estate-mun-ming-shan-filtered-2021.png`                                       | URL-driven filter (`?mtYear=2021`): `符合篩選 92 筆（此屋苑共 323 筆來源紀錄）`                                                                                                              |
| `estate-mun-ming-shan-temporary-contracts.png`                                 | 性質 filter (`?mtNature=臨時合約`): 62                                                                                                                                                       |
| `estate-hoi-wan-toi-filtered-empty.png`                                        | filtered-empty estate: honest copy, no rows, no zero chart                                                                                                                                   |
| `listing-a059644-estate-summary.png`                                           | listing page estate summary + `查看 滿名山 全部市場註冊成交 →`                                                                                                                               |
| `estate-mun-ming-shan-mobile.png`, `listing-a059644-estate-summary-mobile.png` | mobile 390 px: wrapped facets, contained horizontal scroll, no page-level overflow                                                                                                           |

Note on the brief's worked example: old-site listing `#B051070`
(`property-detail/6887554`) has no live new-site listing, and its neighbour
`A056650` resolves to a property row whose _selected offering_ has no
`estate_id`, so the summary correctly renders nothing there rather than
guessing. `A059644` (same estate group) is used as the equivalent live example.

## 7. Not changed / not included

- No new scrape, no network access, no new dependency.
- No production database write, no migration, no deployment (see
  `production-import-plan.md`).
- 45 estates still have no discovered chart: not shown, not zeros.
- The 61-estate and Mount packages' listing JSON (612 / 22 listing pages) is not
  imported — this change is about registered transactions, and those listing
  pages add no field the site is missing.
