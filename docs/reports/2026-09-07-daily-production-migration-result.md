# Production migration and company-number comparison — 2026-09-07

## Completed under explicit approval

User explicitly approved the named migration on production branch `br-polished-sea-aom4i1ct`, database `neondb`, project `dawn-meadow-79190048`, and read-only company-number comparison. Import/publication and the daily schedule remain disabled. No source links, canonical records, ownership or published content were changed.

The exact reviewed migration `20260907120000_propertyhk_ingestion_v2.sql` committed atomically with its `app_migrations` registration. SHA-256: `8748d44513c10e9a987f1f32ae358063af2e9961ac1a0bdc47f942e2b84e11c4`. Applied 50 DDL statements plus prerequisite guard and registration in one transaction with a migration advisory lock, 5-second lock timeout and 60-second statement timeout. The same transaction had already passed on the production clone `br-bold-tooth-ao2crqnn`.

## Actual post-migration checks

| Evidence                         | Before                           | After                            |
| -------------------------------- | -------------------------------- | -------------------------------- |
| Properties                       | 1067                             | 1067                             |
| Existing-column inventory digest | b73235d4cf153c34bb5a8d2e38c3efb2 | b73235d4cf153c34bb5a8d2e38c3efb2 |
| Public membership digest         | a98e0d8ced46ea3228e3146c84db3d7c | a98e0d8ced46ea3228e3146c84db3d7c |
| Migration registration           | 0                                | 1                                |
| Source links                     | 0                                | 0                                |
| Enabled ingestion policies       | unavailable                      | 0                                |
| Properties adopted by v2         | unavailable                      | 0                                |
| Ingestion receipts               | unavailable                      | 0                                |

All seven new ingestion tables are present, all five deferred cross-record integrity constraints are validated, and all three writer/baseline guards are enabled. This verifies schema installation and preservation; it is not a claim of live import, browser acceptance or daily operation.

## Read-only linkage audit

Source: previously captured full agent-540 snapshot, original capture time `2026-09-06T19:16:21.080323Z`. No new collection was performed in this turn. Every one of 247 source advertisements contains exactly one explicit `物業編號 ... (代理提供)` company number. The user confirmed these numbers identify properties. The 28hse numeric advertisement ID remains a separate source identifier.

- 174 distinct company numbers: **104 found, 70 not found** in existing canonical company numbers.
- 183 company-number/deal-type pairs: **105 have existing offer candidates; 78 do not**.
- Of the 105 existing pairs, 43 have one physical row and 62 have multiple historical rows, all within one public property group. No company number or requested offer maps to multiple public groups; no matched row lacks public membership.
- The 78 missing pairs comprise **3 missing offer types on existing properties** and **75 pairs under the 70 not-found company numbers**.
- 140 of the 247 source advertisements have existing company-number/deal-type candidates. The remaining 107 advertisements belong to the 78 missing offer pairs.
- Multiple source advertisements exist in 44 company-number/deal-type groups. No duplicate advertisements were chosen, merged or written during this audit.

“Not found” is limited to the normalized `canonical_property_no` comparison, not proof that a physical property never existed. No title/price/floor-band fuzzy matching was used. Further bootstrap review must preserve the existing public grouping and authoritative offer row, classify unmatched codes, and resolve conflicting source advertisements deterministically before applying.

The three missing offer types on existing properties are: A068025 (rent), A074399 (rent), B053696 (rent).

Per-offer aggregate evidence is saved locally at `.audit-20260905/daily-approved-offer-comparison.csv`. It contains requested company numbers and aggregate match counts, not customer contacts or exported production row IDs.

## Approval review and bounded query

Automatic review rejected a proposed whole-table identity read as broader than the approved comparison. The completed alternative followed its explicit guidance: SQL was restricted to the 183 requested company-number/deal-type pairs (and 174 company numbers) and returned aggregate counts only. No entire production identity table was exported. The authorized migration succeeded; this read-only scope rejection did not block the narrower audit.

## Remaining activation and rollback

No first import or link bootstrap is authorized by this migration-only execution. Next work is a reviewable company-number bootstrap and multi-advertisement selection, then controlled shadow verification, managed runner/database target verification, approved single-owner schedule handoff and first apply. Property.hk stays disabled.

The rehearsal branch remains available and was not deleted. Rollback does not drop history or reverse identity: keep publishing disabled, preserve schema and receipts, and use a reviewed forward correction if necessary. No published inventory changed in this migration.

This report supersedes the blocked status in the earlier activation preflight report. No claim is made that PR #127 was merged or that production application code was deployed in this turn.
