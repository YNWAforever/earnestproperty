# No-Hermes v2 repository mapping

Baseline: b3c1929ab6e1758a6003d7b48c5a8e1c63163776. Development branch: codex/property-sync-no-hermes-v2. The original specification is preserved byte-for-byte, SHA-256 36075ecfbba247c7c8b3152d21366a2c28aa768b2b09ee52a4dfb3d8e579d164.

## Versioned decisions

| Requirement | Repository home and resolution |
|---|---|
| D01 Python workers | scripts/property-sync; Python collects immutable payloads. scripts/mls/apply-source-snapshot.mjs applies collected 28hse observations through the shared Node ingestion service, without recrawling. |
| D02 exact identity | unit-identity.mjs; estate/phase, block, exact floor, unit and deal type; complete and one eligible cross-source canonical offer only. Legacy property-number matching is unchanged. |
| D03 real source IDs | ingestion-contract.mjs v2 codec; real source identity and publication eligibility are separate. No forged agency number. |
| D04 observed counts | source-snapshot-gates.mjs and Python completeness; distinct advertisement counts and terminal-page evidence. Advertised totals are diagnostics. |
| D05 source/scope gate | v2 scope state keeps newest accepted write watermark separate from last applied full snapshot and reviewed bootstrap. Partial success cannot infer absence or advance full baseline. |
| D06 lifecycle | Source delisted maps to canonical inactive, never sold/rented. Primary absence only after a full applied baseline. Property.hk absence disabled. |
| D07 human ownership | Reuse property_sync_fields plus admin_property_overrides protections; preserve unknown ownership for review, do not manufacture staff overrides. |
| D08 description | v2 primary raw description eligible; Property.hk fallback allowlist gross_area/saleable_area/bedrooms. Legacy reconciliation unchanged. |
| D09 public identity | Preserve property UUIDs/members/aliases. New v2 rows need explicit identity-policy guard because 20260906090000 groups by agency number alone. Rejected v2 matching must not be undone by that trigger. |
| D10 source names | Wire 28hse maps to 28hse_agent_540. Add propertyhk separately. old_site observations, media, history and links retained. |

## Storage responsibilities

Canonical offers remain properties. Reuse listing_source_observations, property_source_links, property_sync_fields, property_sync_state, listing_change_events and listing_sync_runs. Add only missing receipts, current accepted source/scope state, whole source contacts, conflicts, branch memberships and matching review evidence. Every accepted business outcome and eligible baseline must commit with its receipt on one dedicated PostgreSQL session.

All canonical publishers coordinate using earnestproperty:mls-sync. A persistent owner/policy fence also prevents sequential legacy overwrite after cutover. Exact PostgreSQL update tokens and staff row locking remain required. New records without required public fields/media remain drafts or in review. Crawled contacts never become staff profiles and cannot change agent IDs, namecards, QR codes or media.

## Work package ledger

- WP0: complete; all handoff-listed implementation files read across inventory agents and primary. Baseline test:mls passed 603/603 on 2026-09-07.
- WP1: complete. Pure contract/identity/gates reviewed (18 tests pass). Migrations f1bb685/be03c23 validated in an isolated schema on the approved disposable branch, including deferred evidence integrity and public/override/ownership guards. Atomic operator helper has 3 passing tests. The initial WP1 named suite ran 29 passing offline tests.
- WP2: complete; commits de2eb26/d61b8b7, scoped review approved, 28 Python offline tests including real Node codec/parser parity. No live-source readiness claim.
- WP3: complete, commit 8e27e4d; scoped review approved and 28/28 real isolated DB tests passed. Node bridge dry-run verified against a collected synthetic artifact.
- WP4: authenticated bounded thin HTTP route and frozen client implemented; core review approved, 5 HTTP behavior tests plus 2 route contracts pass.
- WP5: public contact/freshness transport reviewed; real SQL group/provenance test passed. Named Node/Python/DB scripts and CI wired; final whole-branch review follows.

## Required live inputs

Property.hk EPW/EPS/EPT branch URLs, pagination/DOM rules, authorized fixture provenance and global versus branch-local ID semantics are unverified. Missing configuration must stop the worker before collection/submission. Synthetic fixtures must be labelled and do not establish live readiness. 28hse live parser parity, full pagination and authorized source access also require an operator smoke test; prior single-page probes do not establish those properties.

No production migrations, deployments, schedules, secrets, inventory deletions or real messages are authorized by this coding task. Publishing stays disabled.

## Test traceability (updated as implementation progresses)

| Cases | Automated evidence |
|---|---|
| T01/T07 | Python duplicate/branch identity tests and Node ingestion-contract tests |
| T02/T03/T09/T10 | Python challenge/unknown-template/page/detail/branch/drop tests; Node source-snapshot gates |
| T04/T05/T06/T08 | Python named-column diff and receipt-based baseline tests; real DB source reappearance/previous-full absence |
| T11/T12/T13 | ingestion-repository.db.test.mjs receipt replay/hash conflict, precise stale and partial watermark cases |
| T14/T15/T16/T17/T18/T19/T20 | unit-identity/source-selection pure exact/phase/floor/offer/ambiguity tests plus DB both arrival orders, source reuse and incomplete identity history |
| T21/T22/T23 | Source-selection primary/fallback/whole-contact tests, actual DB conflicts/provenance, public metadata unit and SQL group/contact proof |
| T24/T26 | Partial/full gate tests, real bootstrap denial/approval and partial no-baseline/no-absence behavior |
| T25/T27 | Real before-COMMIT/conflict-ledger/final-receipt failure rollback, COMMIT uncertainty recovery, concurrent shared lock and replay |
| T28 | Python runners, Node bridge/service and migration-helper default dry-run tests; synthetic CLI artifacts verified |

No static schema contract is counted as proof of successful business rollback or concurrency. Required Node/DB/Python/live outcomes will be reported separately.

Additional mappings: raw district names require the winning source policy's `config.district_slugs`; unknown names are staged instead of corrupting canonical filters. Monetary values retain decimal strings; fractional areas stay in evidence and are held from integer projection. Source quoted unit prices remain in snapshots/observations/conflicts; existing public PSF remains derived from canonical price/area. New rows are explicit internal SYNC drafts, never fabricated agency numbers. Source contacts are separate metadata, require opt-in/current observation/freshness and do not replace staff profiles. GET MLS status reports the actual latest publisher marker while retaining legacy compatibility. One new full receipt/hour is independent of the general partial-batch ceiling.
