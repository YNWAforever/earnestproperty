# Market-registration snapshot — data contract (v1)

Input for the 2026-11-24 handoff (`DEEPSEEK_INSTRUCTIONS.md`). This file is the
single source of truth for the snapshot format shared by the generator script,
the pure module, the estate-page UI and the listing-page summary. Change it in
the same commit as the code if the shape moves.

> **2026-11-26:** the separate `EPRC 匯出` block and its modules
> (`eprc-transactions*.ts`, `EstateRegisteredTransactions.tsx`, its CSV fixture
> and tests) were deleted from the estate page at the owner's request. The
> estate page now renders only the registry table described here, without the
> source-row counts, pairing note, `更新於` stamp or source paragraph. References
> to the EPRC files below describe the shipped state before that date.

## Scope decisions (settled, do not re-litigate)

1. **Static versioned snapshot, no database.** `origin/main` already ships
   `src/content/eprc-transactions*.ts` + `EstateRegisteredTransactions.tsx`,
   whose contract test (`src/routes/estate.market-transactions.contract.test.mjs`)
   forbids any import from `src/lib/neon`, `src/lib/queries` or
   `createServerFn`. The handoff data therefore follows the shipped pattern: a
   versioned source file under `src/content/fixtures/` imported with `?raw` /
   static JSON, parsed by a pure module. No migration, no production DB write.
2. **Two packages, one row store, no cross-package de-duplication.** 61-estate
   package rows (`sourcePackage: "estates-61"`) and Mount package rows
   (`sourcePackage: "mount"`) are concatenated. They are disjoint by design
   (the Mount estate is `included_in_this_batch=False` in the 61 package). A
   coverage sum is a **source-row** sum, never a deal count.
3. **The archives are inputs to a build script, never committed.** The
   generator reads extracted directories passed on the command line. Only the
   derived snapshot is committed.
4. **Registration date and instrument date are two stored fields.** Never one a
   proxy for the other; never discard a row whose instrument date falls outside
   2021–2026.
5. **No contact fields, no vendor/purchaser, no per-row URLs, no `remarks`.**
   The old-site detail URL is derived from `ref` + year filter:
   `https://www.earnestproperty.com.hk/tran_prop_detail.php?ref={ref}&year={yearFilter}`.
6. **Slug mapping is exact.** All 62 `roster.csv` slugs are present verbatim in
   `src/content/estate-registry.ts` (verified 2026-11-24). The generator must
   fail loudly on any unmapped slug rather than silently dropping rows.

## Files

| Path                                                                | Owner      | Purpose                                     |
| ------------------------------------------------------------------- | ---------- | ------------------------------------------- |
| `scripts/market-transactions/build-snapshot.mjs`                    | data layer | deterministic offline generator             |
| `src/content/fixtures/market-transactions-62-estates-20261123.json` | data layer | committed derived snapshot                  |
| `src/content/market-transactions.ts`                                | data layer | pure parse / filter / paginate / provenance |
| `src/content/market-transactions-snapshot.ts`                       | data layer | binds the fixture; exports estate getters   |
| `src/content/market-transactions.test.mjs`                          | data layer | `node --test`, synthetic fixtures only      |
| `src/components/site/EstateRegisteredTransactions.tsx`              | UI         | estate-page module                          |
| `src/components/site/ListingEstateMarketSummary.tsx`                | UI         | listing-detail summary                      |

## Generator CLI

```
node scripts/market-transactions/build-snapshot.mjs \
  --estates61 <dir containing roster.csv, parsed/, combined/, estates/> \
  --mount <dir containing parsed/transactions.csv> \
  [--out src/content/fixtures/market-transactions-62-estates-20261123.json] \
  [--dry-run] [--check] [--print-summary]
```

- `--dry-run` prints counts and the mapping report, writes nothing.
- `--check` re-generates in memory and exits non-zero when the committed file
  differs (byte comparison). This is the idempotency gate: same input → same
  bytes, so a second run can never duplicate rows.
- Deterministic: no `Date.now()`, fixed row ordering (see below), fixed key
  order, `JSON.stringify(..., 2)` + trailing newline.
- Prints `estates61 rows`, `mount rows`, `estates covered`, `filtered-empty`,
  `chart months`, `unmapped slugs`, `output bytes`.

## Snapshot JSON (schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,
  "generatedFrom": {
    "estates61": { "package": "earnest-estates-61-20261122", "asOf": "2026-11-23T01:58:00+08:00" },
    "mount": { "package": "earnest-mount-20261122", "asOf": "2026-11-22T23:38:48+08:00" },
  },
  "registrationThrough": "2026-11-19", // latest registration date in the snapshot
  "counts": {
    "sourceRows": 8819,
    "estates61Rows": 8496,
    "mountRows": 323,
    "estates": 62,
    "estatesWithRows": 59,
    "filteredEmpty": 3,
    "chartMonths": 408,
    "chartEstates": 17,
  },
  "estates": [
    {
      "slug": "bayview-terrace", // live-site slug == registry slug == roster slug
      "nameZh": "碧翠花園",
      "sourcePackage": "estates-61", // "estates-61" | "mount"
      "asOf": "2026-11-23T01:51:39+08:00", // package finalisation for this source
      "registrationThrough": "2026-11-19", // max registration date for this estate (null when no rows)
      "rowCount": 37, // SOURCE ROWS, not deals
      "status": "covered", // "covered" | "filtered-empty"
      "note": null, // short zh-HK note; required for filtered-empty
      "listSourceUrl": "https://…", // old-site filter URL used for this estate, or null
    },
  ],
  "rowsByEstate": {
    "bayview-terrace": [
      {
        "ref": "Z0650060", // old-site reference, unique within (sourcePackage, yearFilter)
        "yearFilter": 2026, // 2021..2026 public-list year filter
        "registrationDate": "2026-10-15", // ISO date, required
        "instrumentDate": "2026-10-08", // ISO date, required; may fall outside 2021–2026
        "registrationNo": "26101500650X6X", // string | null
        "nature": "買賣合約", // 買賣合約 | 臨時合約 | 確認合約 | other raw value
        "phase": null, // string | null (滿庭 / 名庭 / 山庭 …)
        "tower": "第23座", // string | null
        "houseId": null, // string | null
        "floor": "8", // string | null
        "unit": "B", // string | null
        "address": "青山公路107號青山灣段, 碧翠花園 第23座 , 8樓 B室", // string | null
        "district": "屯門", // string | null
        "considerationMillion": 0.65, // number | null ($M)
        "grossAreaSqft": 1173, // number | null
        "pricePerSqft": 554, // number | null, AS PUBLISHED
        "psfBasis": "建築", // "建築" | "實用" | null — only when the published label states it
        "completionYear": 1989, // number | null
      },
    ],
  },
  "chartTranscription": [
    // series "image_transcribed" ONLY
    {
      "slug": "mun-ming-shan",
      "month": "2024-11", // YYYY-MM
      "count": 3, // chart 成交宗數 label
      "avgPsf": 12345, // null when count === 0, even if a label was printed
      "sourceDisplayedPpsf": "$0", // printed label kept verbatim (string | null)
      "visualVerified": true,
      "chartTitle": "…", // OCR title when present
      "periodStart": "2024-11", // chart_period_start | null
      "periodEnd": "2026-10", // chart_period_end | null
    },
  ],
}
```

Row ordering inside each estate: `registrationDate` descending, then
`instrumentDate` descending, then `ref` ascending. Estate ordering: `slug`
ascending. `chartTranscription` ordering: `slug`, then `month`.

## Pure module API (`src/content/market-transactions.ts`)

No imports other than `./estate-registry.ts` (pure data, no DB/network/DOM).

```ts
export const MARKET_PAGE_SIZE = 20;
export type MarketSourcePackage = "estates-61" | "mount";
export type MarketEstateStatus = "covered" | "filtered-empty";
export type MarketTransactionRow = {
  /* as above, minus slug/nameZh/sourcePackage */
};
export type MarketEstateSummary = {
  /* estate record + pairedRowCount + dedupedDealCount */
};
export type MarketTransactionFilters = {
  year?: number | null;
  nature?: string | null;
  phase?: string | null;
  page?: number;
};
export type MarketFacet = { value: string | number; count: number };
export type MarketEstateTransactions = {
  estate: MarketEstateSummary;
  rows: MarketTransactionRow[]; // current page only
  total: number; // filtered SOURCE ROW count
  page: number;
  pageCount: number;
  pageSize: number;
  facets: { years: MarketFacet[]; natures: MarketFacet[]; phases: MarketFacet[] };
  activeFilters: MarketTransactionFilters;
};
export function buildMarketSnapshot(doc: unknown): MarketSnapshot; // validates, throws on drift
export function getEstateMarketTransactions(
  snapshot: MarketSnapshot,
  slug: string,
  filters?: MarketTransactionFilters,
): MarketEstateTransactions | null;
export function getEstateChartTranscription(
  snapshot: MarketSnapshot,
  slug: string,
): MarketChartMonth[];
export function marketTransactionUrl(row: MarketTransactionRow): string; // derived detail URL
```

`buildMarketSnapshot` validation rules (throw, do not coerce):

- `schemaVersion === 1`
- every estate slug resolves in `estateRegistry`
- `rowsByEstate` keys ⊆ `estates[].slug`
- every row has non-empty `ref`, valid ISO `registrationDate` and
  `instrumentDate`, `yearFilter` in 2021–2026
- `pricePerSqft` never `0` (blank must be `null`)
- `chartTranscription[].avgPsf` is `null` whenever `count === 0`

## Preliminary / formal pairing rule

Implement in `market-transactions.ts` and expose as counts only (the rows the UI
shows are always raw source rows):

Two rows form a **pair** when all hold: same `nature` pair (one `臨時合約` + one
`買賣合約`), same unit identity (`address` when both non-null, else
`tower`+`floor`+`unit`+`houseId`), same `considerationMillion` (null-safe
equality), same `registrationDate`. Instrument dates may differ.

- `pairedRowCount` = rows that belong to such a pair.
- `dedupedDealCount` = `rowCount − pairedRowCount / 2`, exposed as an integer.
- Similar rows that fail any condition (`cross-date` mixed pairs, same-nature
  duplicates) stay as source rows and are **not** dropped; expose
  `mixedSameUnitCount` for the audit (same unit identity + same consideration +
  same nature appearing more than once) so the UI/audit can say so.

Public copy rule: the module never claims "N 宗成交" from `rowCount`; it says
`rowCount` 筆來源紀錄 and, when pairing exists, `dedupedDealCount` 宗（已配對
臨時／正式合約）. Do not blend the two into one unlabelled number.
