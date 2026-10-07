# Property.hk held readback and ingestion refusal — 2026-10-07

Baseline main `99f1ce8712ce0900487467904c06ad2c4c3ef313`; verified code `970f56a5c9220f35229f2f03064816546b2498c6`. This continues EP-09/10/11 after PR #232. The native index slice remains complete for its four approved entries; full source readiness remains blocked.

## Defect and change

A Property.hk envelope with complete-looking branch/page flags could pass the ingestion gate while a row explicitly said `observation_kind=index_only`, or the envelope/meta explicitly said `full_snapshot`, `details_verified`, `id_scope_verified` or `full_branch_scope_verified` was false. The named Node and Python suites each reproduced acceptance before the corresponding fix.

Both gates now refuse that evidence with `index_only_source_evidence`. Omitted markers retain the existing full-parser contract; positive markers confer no new authority. Existing source-policy, URL identity, full-detail, page, branch, baseline and publication checks still apply. This does not solve the unavailable real detail/media or prove missing dt coverage.

## Frozen acquisition and independent production readback

The existing collection `c5294512-9a4b-44c2-9671-bb28f026cc6c` contains 23 pages, 414 branch/dt advertisements, 465 quoted offers and one unclassified advertisement. Input JSONL hashes were checked before the review. No new source requests were made.

A single read-only SQL snapshot at `2026-10-07T13:23:38.605441+00:00` targeted `dawn-meadow-79190048 / br-polished-sea-aom4i1ct / neondb`. Property.hk had zero policy rows, source-state rows and source links. All 466 index records are held in a private review artifact with original branch/dt/raw-ad/offer identity, no canonical target and no proposed create/update/merge/withdrawal.

| Readback                                         |                     Result | Meaning                                                           |
| ------------------------------------------------ | -------------------------: | ----------------------------------------------------------------- |
| Advertisement IDs sharing old `legacy_detail_id` |                        181 | Numeric aliases only; no accepted Property.hk source relationship |
| Old canonical candidate rows for those aliases   |                        200 | 162 IDs have one row, 19 have two; no rows were merged            |
| Index advertisements with no numeric alias       |                        233 | This does not establish a new canonical unit                      |
| Active / inactive alias candidate rows           |                   143 / 57 | Current inventory states only                                     |
| Alias candidate rows with active 28Hse links     |                         39 | Other-source relationships retained                               |
| Property.hk canonical targets assigned           |                          0 | No inferred source, branch or unit identity                       |
| Inventory with active manual overrides           | 77 properties / 154 fields | 76 active properties, one inactive; none modified                 |

The current 28Hse read models remain distinct: 448 active source-state offers across 261 non-null canonical IDs, five delisted source states, and 430 active links across 264 canonical IDs. These are different models, not interchangeable inventory totals. Historical 132 withdrawal candidates were not reclassified or downlisted from this index data.

The private `production-readback.json` SHA256 is `f42966b9ba1b0572f3caadf851b38e330e74a65550c53d255faae8467dbdd214`; held JSONL SHA256 is `cb2b5ee58b4026260e45324998e542dda3810fa1106c205e5c2627cd1bccba9f`. Raw acquisition URLs/SIDs, HTML, contacts and per-record candidate identities stay private.

## Verification and historical traceability

Node red: 75 pass / one expected missing-rejection failure; green: 76/76. Python red: 142 pass / one gate-acceptance failure; green: 143/143. Daily receipt/publication: 38/38. Owned Postgres: 4/4, including 13 negative variants preserving complete canonical-row fingerprints, receipt hashes/responses and the accepted full baseline. The positive synthetic full publication/replay test still passes. Total: 261 outcomes, zero failures/skips.

Typecheck and build separately exited 0. Lint exited 0 with three pre-existing React refresh warnings. This is local/owned evidence, not real detail/provider, four-viewport, every-role, Golden A/B/C, restore or schedule acceptance. Their previous layers remain unchanged.

Five new `execution_2026_10_07_propertyhk_gate_*` columns append SHA/environment/evidence/result/status to both original CSVs. Every old column/cell and existing execution-evidence root is preserved, including the 29 PASS / nine FAIL / 22 BLOCKED audit history and 22 NEW planned cases.

## Configuration, migration and rollback

No Property.hk publishing configuration is proposed or applied until full acquisition and identity authority exists. No migrations are added or applied by this slice. Latest main reports six additional pending migration versions listed in the JSON; they are outside the four exact production migrations previously approved, so no production migration runner was invoked.

Production writes, dispatch, manual schedule runs, sends, provider/model calls and budget are all zero. Revert `970f56a5c9220f35229f2f03064816546b2498c6` through a reviewed PR to roll back this gate-only change; no schema/data restore is needed. Preserve the immutable private collection and held review evidence.

## Capability status

- **READY:** Node/Python index-only refusal and owned SQL preservation; frozen index review available as held data.
- **NOT_READY:** production Property.hk ingestion; verified full identity and approved source policy are absent.
- **BLOCKED:** real detail/media access and full authorised EPS/EPT/EPW/dt acquisition; comparable absence/withdrawal and three genuine native accepted schedules. The earlier ordinary detail GET returned 403; it was not retried or bypassed in this slice.
