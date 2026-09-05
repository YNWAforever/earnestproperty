# Property data audit — 2026-09-06

## Scope and method

Read-only SQL audit of `public.properties` on Neon project `dawn-meadow-79190048`, production branch `br-polished-sea-aom4i1ct`, database `neondb`. The population was all 1,067 rows (431 active; 636 inactive). No database rows or application code were changed, and no secrets or customer/CRM data were read.

Checks cover identifiers, canonical groups, status/deal consistency, prices, areas, room counts, estate joins, media URL structure and duplication, source timestamps, and basic text hygiene. “Conflict” means distinct non-null values in the database. Address variants and source facts were not verified against the live legacy pages, so this report does not declare which variant is factually correct.

## Findings that affect canonical grouping

- All 1,067 rows have a `listing_no` and `canonical_property_no`. Both identifier formats are valid; every listing prefix matches its canonical number and every `-S`/`-R` suffix matches `deal_type`.
- `listing_no` is unique: zero duplicate groups.
- There are 265 repeated canonical groups containing 825 rows across all statuses.
- No repeated canonical group conflicts on non-null `estate_id`, `district_slug`, or `gross_area`.
- Across all statuses, hard physical conflicts comprise one saleable-area group, four bedroom groups, and 17 floor groups. These are 22 distinct canonical IDs.
- Address comparison flags 126 groups, but inspection shows the dominant pattern is a general estate address beside a tower/phase-expanded address. Address string inequality alone is not evidence of different physical properties.

Active-only canonical groups contain 107 groups / 303 rows. Five groups have contradictory physical values:

| Canonical | Active rows | Conflict | Public listing evidence |
|---|---:|---|---|
| A060071 | 2 | saleable area 2,179 vs 2,181 sq ft | A060071-6723606-S; A060071-6772058-S |
| B053531 | 4 | floor `中` vs `低` | B053531-6724138-S; -6745628-S; -6747698-S; -6771462-S |
| B075534 | 3 | floor `中` vs `高` | B075534-6752324-S; -6753818-S; -6757916-S |
| C022529 | 5 | floor `中` vs `高` | C022529-6765868-S; -6766622-S; -6768770-S; -6768870-S; -6772692-S |
| R042664 | 2 | floor `中` vs `高` | R042664-6777336-R; R042664-6777416-R |

The complete all-status conflict-ID set is: A060071 (area); A074399, A075308, B052858, C004331 (bedrooms); A070074, A071622, A074698, A074799, B047841, B051384, B052261, B053531, B054729, B054989, B075534, C017638, C019398, C022529, C033409, R042664, R071806 (floor).

Recommended grouping rule: retain every source row as an alias/history record, choose representatives deterministically, and isolate the five active conflict groups instead of projecting a canonical floor/area as settled truth. Inactive conflicts can remain historical variants without blocking current pairs.

The requested examples are internally consistent: B054645 has 12 active aliases (six sale and six rent), all 515 sq ft, two bedrooms, mid floor, same estate/district; B075535 has three active rent aliases, all 570 sq ft, three bedrooms, mid floor, same estate/district.

## Field-quality results

| Check | Active (431) | Inactive (636) |
|---|---:|---:|
| Missing/non-positive required price or rent | 0 | 0 |
| Missing/non-positive saleable area | 0 | 3 |
| Missing/non-positive gross area | 67 | 150 |
| Saleable area greater than gross area | 0 | 2 |
| Missing bedrooms | 80 | 107 |
| Implausible bedrooms (<0 or >10) | 0 | 0 |
| Missing bathrooms | 431 | 636 |
| Missing estate mapping (`estate_id`) | 163 | 315 |
| Broken non-null estate foreign-key join | 0 | 0 |
| Missing district | 0 | 0 |

The two inverted-area rows are inactive A047420-6646350-S and A053190-6724636-S (1,631 saleable vs 1,608 gross). The three inactive rows missing saleable area are B057556-6622250-S, B057556-6642322-S, and R075604-6708376-R. One inactive rent row, B059380-6643174-R, has rent `1`, the only obvious price outlier under the bounded threshold checks. Active sale prices range HK$1.85m–49.8m and rents HK$11,500–95,000; no active row fell outside the broad PSF sanity bands used (sale 1,000–100,000; rent 5–500).

Only five estates currently receive property joins: Bellagio 184 rows, Sea Crest Villa 178, Hong Kong Garden 109, Lido Garden 76, and Rhine Garden 42. Missing estate mappings are concentrated in Tsuen Wan (276), Castle Peak Road (182), Sham Tseng (13), and Ting Kau (7). These are missing mappings, not dangling references.

## Media, source, and text

- One active listing has no images: A074460-6772724-R. Four inactive listings have no images: A048110-6715368-S, B059625-6706806-S, C008089-6707170-R, and C021908-6708898-R.
- No image entry is blank or non-HTTPS; no row repeats an image within its own array. Video and floor-plan URLs contain no non-HTTPS values.
- 1,840 image URLs are shared across listings (3,700 occurrences; maximum three). Every shared URL remains within one canonical property number; none crosses canonical IDs. This supports alias/history reuse and is not evidence by itself of duplicate physical properties.
- All rows have source URL, legacy URL, source update date, last-seen time, and last-scraped time. All source URLs are HTTPS.
- As of 2026-09-06, 100 active and 561 inactive rows have both source-update and last-seen dates older than 30 days. The newest source/seen date is 2026-08-24, so even the newest inventory is 13 days old. “Stale” here is an age flag, not proof the listing is no longer available.
- Chinese titles and descriptions are present for every row; English titles are absent for all rows. No control characters, HTML markup, or leading/trailing whitespace were found.
- Five records matched a broad placeholder-text expression, but manual inspection shows `NAPA` estate text triggered the `n/a` pattern. These are false positives, not malformed copy.

## Limits

This audit validates internal consistency and URL shape only. It did not bulk-fetch the 1,840 shared images or 1,067 legacy pages, and it did not verify availability, price, address, room, or floor claims against an external source. All media values were already HTTPS, so no bounded invalid-URL fetch was necessary.
