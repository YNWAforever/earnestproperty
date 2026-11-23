# Market-registration data audit (2026-11-24)

Independent audit of the two handoff archives against `DEEPSEEK_INSTRUCTIONS.md` §4/§6 and `data-contract.md`. Every figure was recomputed in Python 3.14 from the extracted directories (`…\Temp\ep-mt-20261124\p61\earnest-estates-61-20261122`, `…\pmount\earnest-mount-20261122-curated`), not copied from the brief. No archive content was added to the repo; no code or fixture changed. Method: CSV/JSON parse, key/date/nature/null profiling, and a re-implementation of the contract pairing rule.

## 1. Counts vs the brief's verified figures

| Metric                                                                           | Brief                                                        | Recomputed                                                   | Verdict |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------- |
| 61 rows (unique `estate_slug+year+ref`, unique `year+ref`)                       | 8,496                                                        | 8,496 / 8,496 / 8,496                                        | MATCH   |
| 61 listing pages / unique ids / unique `property_no` / `property_no` on >1 page  | 612 / 612 / 362 / 140                                        | 612 / 612 / 362 / 140 (max 7 pages, `C034708`)               | MATCH   |
| 61 filtered-empty estates                                                        | 3                                                            | 3 (`chui-king-garden`, `hoi-wan-toi`, `kwun-hoi-villas`)     | MATCH   |
| 61 rows by list year 2021–2026; natures                                          | 2,235 / 992 / 1,159 / 1,258 / 1,594 / 1,258; 7,765 / 730 / 1 | same; same                                                   | MATCH   |
| 61 gross-area / psf nulls; registration = instrument; instrument < 2021-01-01    | 4,397 / 4,400; 0; 65                                         | 4,397 / 4,400; 0; 65 (64×2020-12 + 1×2002)                   | MATCH   |
| Mount rows (unique `year+ref`) / by year                                         | 323; 92/41/38/40/57/55                                       | 323 / 323; same                                              | MATCH   |
| Mount natures; gross/psf nulls; listing pages/ids/`property_no`/repeated twice   | 261/62; 322/322; 22/22/18/4                                  | same (`B051070`, `A059644`, `B050328`, `A056650`)            | MATCH   |
| Mount same-day 臨時+買賣 pairs                                                   | 14                                                           | 14 (28 rows, ref-consecutive)                                | MATCH   |
| combined trend rows; image_transcribed; derived registration; derived instrument | 8,070; 408/17 (2024-11..2026-10); 3,708/59; 3,954/59         | same; same; same (2021-01..2026-11); same (2002-06..2026-11) | MATCH   |

No MISMATCH against the brief. Integrity: per-estate files sum to exactly 8,496 rows / 8,070 trend rows / 612 listings; `master_coverage.csv` reports `details_failed` 0, `source_failures` 0, status complete (61) + `complete_in_mount_package` (滿名山). As-of: 61 package `2026-11-23T01:51:39+08:00`, trends `01:56:03+08:00` (`MONTHLY_TRENDS.md`: 01:56:04 — 1 s drift), Mount `2026-11-22T23:38:48+08:00`; latest registration date anywhere 2026-11-19.

## 2. Slug mapping

All 62 `roster.csv` slugs exist verbatim in `src/content/estate-registry.ts` (63 entries). The one registry entry **not** in the roster is `chui-fung-siu-chuk` (翠峰小築, `published=false`, `hasPage=false`, no district row) — a roster-driven generator is required or a 63rd empty estate appears. 58 of the 61 batch slugs have rows; the 3 without rows are the filtered-empty estates; 58 + 滿名山 (`included_in_this_batch=False`) = the 59 trend slugs.

## 3. Natures and date ranges

|                                          | 61 package              | Mount                   |
| ---------------------------------------- | ----------------------- | ----------------------- |
| 買賣合約 / 臨時合約 / 確認合約           | 7,765 / 730 / 1         | 261 / 62 / 0            |
| registration dates                       | 2021-01-04 → 2026-11-19 | 2021-01-07 → 2026-11-18 |
| instrument dates                         | 2002-06-28 → 2026-11-12 | 2020-12-19 → 2026-11-06 |
| registration == instrument               | 0                       | 0                       |
| instrument < 2021-01-01 / > registration | 65 / 0                  | 5 / 0                   |

**NAPA anomaly:** ref `09134488` (list year 2024, 買賣合約, $4.09M, 第05座 3樓 D室) has registration 2024-07-12 but instrument **2002-06-28**; `registration_no` starts `240712` and the instrument date shares month/day with 2024-06-28, consistent with a source year typo but unverified. Keep it exactly as published (the contract forbids dropping out-of-range instrument dates), flag it, and never let it stretch a chart — the instrument series already gives napa a 294-month 2002-06→2026-11 zero grid.

## 4. Missing-data profile

| Field                                  | Empty               | Share           |
| -------------------------------------- | ------------------- | --------------- |
| 61 gross area (list **and** detail)    | 4,397 / 8,496       | 51.8%           |
| 61 published psf (list **and** detail) | 4,400 / 8,496       | 51.8%           |
| basis of the 4,096 filled psf labels   | 建築 4,096 · 實用 0 | 100% gross-area |
| Mount gross area / psf                 | 322 / 323 each      | 99.7%           |

**Why no estate 實用呎價 series or average from these rows.** Half the register publishes no area and no 呎價, and every one of the 4,096 filled 呎價 labels is 建築 (gross) — none is 實用. A mean from the rows is thus a gross-area mean over a self-selected ~48% subset, not the saleable-area figure the old-site chart plots. Mount has exactly one filled row (`09079607`, 建築 1,217 sq ft, $9,860), which supports no average at all. The archive agrees: every transaction-derived trend row has `avg_psf = null` (0 of 3,708, 0 of 3,954), and the only 實用 series is the chart transcription, whose date basis and averaging are unpublished. A saleable-psf figure must come from the live EPRC export (`Area N` / `$/ft2 N`, 106/107 filled), labelled, and never merged into one number with these rows.

## 5. The three filtered-empty estates

| slug               | name     | searches tried                      | raw / kept rows     | listings kept | chart |
| ------------------ | -------- | ----------------------------------- | ------------------- | ------------- | ----- |
| `chui-king-garden` | 翠景花園 | 翠景花園, Jade View Villa × NTM/NTW | 0 / 0 for 2021–2026 | 2             | none  |
| `hoi-wan-toi`      | 海韻臺   | 海韻臺 × NTW/NTM                    | 0 / 0 for 2021–2026 | 0             | none  |
| `kwun-hoi-villas`  | 觀海別墅 | 觀海別墅, Vista Del Mar × NTW/NTM   | 0 / 0 for 2021–2026 | 0             | none  |

The source returned `zero_result: true`, `raw_rows: 0` and no `source_failures` for every year option (2021–2026); the estate trend files contain 0 rows and no chart was discovered. 翠景花園 still has 2 kept listings, so the estate is real and marketed. Honest copy (zh-HK): 「此來源（舊站「田土廳成交」公開列表）於 2021–2026 年度選項下未返回任何紀錄；不代表此屋苑沒有成交，亦不代表其他來源沒有資料。」 with source, fetch date and year options shown. Never render 「沒有成交」 or 「0 宗成交」: the EPRC table on the same page can hold rows (the live EPRC export has 1 海韻臺 row), so the absolute claim would contradict the page itself.

## 6. Preliminary/formal pairing (contract rule)

| Package    | same-day pairs | paired rows | deduped deals         | same-nature groups | cross-date candidates       |
| ---------- | -------------- | ----------- | --------------------- | ------------------ | --------------------------- |
| 61 package | 154            | 308         | 8,342 (= 8,496 − 154) | 3 groups / 6 rows  | 341 pairs / 683 rows (8.0%) |
| Mount      | 14             | 28          | 309 (= 323 − 14)      | 0                  | 28 pairs / 56 rows (17.3%)  |

All 14 Mount pairs are `ref`-consecutive (diff 1), matching the README; the 61 count matches the archive's own `chart_source_coverage.csv` (154 for the batch + 14 for 滿名山 = 168). **Rows that fail the rule are not dropped.** Mount's 28 cross-date 臨時→買賣 candidate pairs (2–49 days apart), all refs listed: `09683518→09687264`, `09644450→09655303`, `09515137→09519955`, `09488253→09518697`, `09513196→09518512`, `09496974→09504375`, `09440128→09443176`, `09384751→09386802`, `09306986→09319698`, `09294260→09304229`, `09278628→09281175`, `09202741→09217850`, `09192560→09194228`, `09076468→09082998`, `09071217→09079607`, `08013932→08016098`, `07875216→07882034`, `07778419→07793102`, `07756053→07769444`, `07734333→07743873`, `07638086→07648742`, `07536926→07578254`, `07491254→07513832`, `07489636→07505671`, `07491771→07495304`, `07484312→07487529`, `07431192→07462021`, `07455257→07462829`; no same-nature duplicates. For the 61 package, 683 rows (8.0%) sit in mixed-nature unit groups with >1 registration date; greedy matching gives 341 candidates, 340 genuinely cross-date — 5 with the formal registered _before_ the temporary (−9 to −1 days), 328 within 60 days, 7 at 60+ days (max 253, `dragon-inn-court`) — so it is an upper bound, not a pairing set. Its 3 same-nature groups (expose as `mixedSameUnitCount`): `Z2260082`/`Z2260099` (買賣, ching-yung-toi), `Z0940021`/`09595763` (買賣) and `Z1460056`/`09584321` (臨時) (nga-tak-yuen). The lone 確認合約 row (`09581742`) has no same-day partner.

**Archive-internal inconsistency:** the combined trends' `n_deduped_deals` sums to 8,647 (61 package 8,338 + Mount 309) — 158 dedupes for the 61 package, four more than the documented rule. The 4 are the 3 same-nature groups plus one **false merge**: napa `07426672` (第03座 10A, $19.62M) and `07426673` (第05座 10A, $22.05M) share the registration date and the published address string 「掃管笏路88號, 10樓 A室」 (tower omitted) but are different towers and prices; the archive collapsed them by grouping on date+address only. Decision: compute counts from rows with the contract rule (8,342 / 309); never present `n_deduped_deals` as the estate deal count.

## 7. Chart transcription vs derived series

- **408 months / 17 estates confirmed:** 24 months each (2024-11..2026-10), 17 distinct PNGs, `visual_verified=true` and `confidence=high` on all 408, `is_official_raw_dataset=false`, `chart_period_start/end` 2024-11/2026-10 on every row.
- **avg_psf null when count = 0 confirmed:** 70 rows have `count=0`; all 70 have `avg_psf` null; all 70 still carry a printed label (61 a non-zero number, 41 of them equal to an adjacent positive month's average; 9 print `0`). `source_displayed_ppsf` is a chart label, never the month's average; the 338 non-null `avg_psf` rows are exactly the `count>0` rows.
- **date_basis unpublished confirmed:** `date_basis` and `averaging_method` are null on all 408 rows (archive note: "unpublished on the chart / iframe"); the chart title is 實用呎價走勢.
- **成交宗數 must never be compared with source-row counts:** for the same 17 estates and same 24 months the chart labels sum to **1,355**, while the derived registration series holds **1,697** source rows (**1,641** deduped). The archive's own `chart_vs_transactions_comparison.csv` records 1,355 vs 1,697 and warns "differences do not imply error" (different date basis, inclusion/pair rules and coverage years). Keep chart counts a separate labelled series.

## 8. Conflicts, surprises, recommended decision

1. **`n_deduped_deals` drift** (§6): 8,338 vs rule-based 8,342 (Mount agrees at 309). Compute counts from rows; document the 4-deal difference, not in the UI.
2. **Address-only unit identity is ambiguous** for street-alias estates: 96 published address strings map to more than one `tower_zh` across 243 rows (napa 89, oma-by-the-sea 81, oma-oma 60, the-carmel 13). Add a `tower_zh` tie-break when both rows carry one, plus a test on the napa pair.
3. **Mount cross-date pairs:** the rule leaves 28 pairs (56 rows) unpaired, so 309 still over-counts them (`323 − 14 − 28 = 281` under a wider rule). Keep the rule, expose `crossDateCandidatePairCount` and a copy caveat; never pair silently. (The 61-package wider scenario, 8,001, is not shippable.)
4. **滿名山 is already inside the combined trends** (323 rows → 309; per-month identical to the Mount CSV). Build the row store from 61 rows + Mount rows; build series only from the combined file; never add Mount rows again.
5. **The live repo already ships EPRC** (`eprc-transactions-22-estates-20261027.csv`: 107 rows / 16 estates, 106 saleable psf, 1 海韻臺 row, 6 滿名山 rows). Keep 本行成交 / 市場註冊成交 / EPRC separate and labelled; archive nulls and 建築 psf must never overwrite EPRC `Area N` / `$/ft2 N`.
6. **Residual sanitization:** contact fields are gone (0 non-null in both packages), but listing remarks still hold the agency licence code `C-018613-A00x` on 166/612 61-package pages and 14/22 Mount pages (remarks present on 506/612 and 21/22), and `gallery_ref` may hold name fragments. Drop `remarks`/`gallery_ref` from the snapshot; never render them.
7. **Listing pages ≠ properties:** 612 → 362 `property_no` (140 repeated, max 7); Mount 22 → 18 (`B051070`=6887554/6844092, `A059644`=6844532/6842408, `B050328`=6829094/6713958, `A056650`=6813126/6781218). Aggregate on distinct `property_no`, not pages.
8. **`monthly_trends.json` mixed types:** chart `count`/`avg_psf` are strings (`"0"`, `"10148"`); derived `n_source_rows` is an int. Coerce and validate.
9. **NAPA 2002-06-28** (§3): keep as published, flag it, never draw the 294-month zero tail.
10. **Chart PNG rights unverified:** do not hotlink or embed the 17 PNGs; render charts from verified rows.
