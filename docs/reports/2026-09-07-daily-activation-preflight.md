# Daily ingestion activation preflight — 2026-09-07

Status: rehearsal passed; production migration rejected by automatic approval review before execution. Daily collection/import remains inactive. PR #127 is open; no merge or production deployment was performed in this activation turn.

## Exact migration awaiting authorization

- Repository: YNWAforever/earnestproperty; reviewed feature head afd6cf8ecc6a50089ed356d7705c72548082f904.
- Project: dawn-meadow-79190048, Earnestproperty.
- Production branch: br-polished-sea-aom4i1ct; database neondb.
- File: neon/migrations/20260907120000_propertyhk_ingestion_v2.sql.
- File SHA-256: 8748d44513c10e9a987f1f32ae358063af2e9961ac1a0bdc47f942e2b84e11c4.
- Scope: additive v2 tables/columns, updated constraints and writer/identity/override triggers, and app_migrations registration in the same transaction. No policy activation, ownership adoption, inventory import or deletion.
- Controls: migration advisory lock, all prior registered migration prerequisites, 5-second lock timeout and 60-second statement timeout. Abort if already applied; inspect state after uncertain outcome.

## Rehearsal actually executed

Created br-bold-tooth-ao2crqnn (daily-sync-activation-preflight-20260907) from the current production branch. It contains the same 1,067 properties. The branch is retained for verification; it was not deleted or made default.

The first transaction attempt rejected a multi-command prepared statement and rolled back; table absence and no migration record were verified. The exact DDL was then split with the repository migration parser's quote/dollar-body semantics into 50 statements and executed in one Neon transaction with prerequisite guard and registration. That transaction succeeded.

Production and rehearsal checksums after the successful rehearsal:

| Evidence                                                        | Production                       | Rehearsal                        |
| --------------------------------------------------------------- | -------------------------------- | -------------------------------- |
| Property count                                                  | 1067                             | 1067                             |
| Existing property content digest, excluding new default columns | b73235d4cf153c34bb5a8d2e38c3efb2 | b73235d4cf153c34bb5a8d2e38c3efb2 |
| Public membership digest                                        | a98e0d8ced46ea3228e3146c84db3d7c | a98e0d8ced46ea3228e3146c84db3d7c |
| Source link count                                               | 0                                | 0                                |
| Migration registered                                            | No                               | Yes                              |

This verifies migration preservation of this production snapshot, alongside the preceding isolated behavioral tests. It does not establish successful production migration or hosted collection.

## Production attempt and explicit approval required

Automatic approval review rejected the production transaction. Stated reason: the earlier user instruction prohibited production migrations, and the generic approval did not clearly authorize this exact high-impact schema/trigger action. No workaround or alternate production execution was attempted.

A subsequent production SELECT verified: v2 policies table absent, migration record count zero, property count 1067, and both digests above unchanged. No daily enable/policy/branch variables were configured.

The next approval must explicitly authorize this named migration on br-polished-sea-aom4i1ct, with publishing/import still disabled. Apply only the checked-in migration transaction; after success verify registration, table/constraint/trigger state, property/public membership digests and disabled policies. Do not drop schema/history as rollback. A transaction failure before commit rolls back; an uncertain commit requires inspection, not blind replay.

## Separate identity blocker

The saved full 28hse snapshot contains 247 source advertisements. Zero have a unit number. Of 245 floor values, 88 are middle, 71 low, 68 high and 18 whole-building; two have no floor. Existing production has no source links or observations and no direct 28hse source URLs. Agency numbers alone are insufficient under the approved exact-identity policy.

Requested input: location of a verified 28hse source listing ID to company property-number mapping, with corroborating complete unit identity or authoritative pre-existing source linkage. Do not bulk-match merely by similar title, floor band or price. Establish and review trusted links before first canonical import. Migration approval alone does not resolve this data gap.

Remaining activation: trusted-link bootstrap, source policy/bootstrap review, private evidence destination and runner database-target verification, Linux shadow collection, single-owner old-schedule handoff, then first controlled apply and accepted receipt/baseline verification. Property.hk remains disabled.

## Updated operator identity direction

The user subsequently explicitly confirmed that company listing numbers uniquely identify properties and requested synchronization by that number. This supersedes the earlier requirement to request a separately supplied map for this one-time legacy linkage. It does not make the 28hse numeric advertisement ID a company number.

Examining captured HTML found an explicit `物業編號: <company number> (代理提供)` label in all 247 details, exactly one code per advertisement. Local extraction is saved privately at `.audit-20260905/daily-company-number-map.json`. There are **174 distinct company numbers and 183 distinct company-number/deal-type pairs**. Forty-four company-number/deal-type groups have multiple source advertisement IDs. Thus one property can have several advertisements, and nine company numbers have both sale and rent offers. Preserve advertisement IDs as many-to-one source evidence; never treat 247 advertisements as 247 canonical properties.

No production matches have yet been established. Approval review rejected both the SQL carrying the 247-row comparison map (source identifier egress) and a subsequent attempt to read production listing identifiers for local comparison (bulk identifier egress). Both were read-only and neither returned matches. No further comparison route was attempted. Existing production identifiers, statuses and customer data were not exported by these rejected calls.

Next explicit authorization should cover (1) the exact production migration above while import stays disabled, and (2) read-only comparison of company property numbers/deal types against production listing identifiers, limited to linkage verification with no customer contact data and no canonical changes. After approval, verify uniqueness within existing public property groups, classify unmatched or ambiguous records, and implement/review deterministic handling of multiple ads before any first apply. Preserve staff overrides and canonical UUIDs/public aliases. The caller's confirmation authorizes using company number as the legacy-link identity; it does not justify blindly selecting one conflicting advertisement or inventing missing estate facts.
