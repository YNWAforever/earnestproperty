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
- WP1: pure contract/identity/gates implemented and reviewed (18 tests pass). Additive migration f1bb685 applied in a disposable isolated schema; public identity/override/ownership guards passed. Referential-integrity review follow-up in progress.
- WP2: pending Python workers, snapshots, diff and frozen client transport.
- WP3: pending atomic ingestion, source-first matching and Node bridge.
- WP4: pending authenticated bounded HTTP route.
- WP5: pending regressions, test wiring and operator handoff.

## Required live inputs

Property.hk EPW/EPS/EPT branch URLs, pagination/DOM rules, authorized fixture provenance and global versus branch-local ID semantics are unverified. Missing configuration must stop the worker before collection/submission. Synthetic fixtures must be labelled and do not establish live readiness. 28hse live parser parity, full pagination and authorized source access also require an operator smoke test; prior single-page probes do not establish those properties.

No production migrations, deployments, schedules, secrets, inventory deletions or real messages are authorized by this coding task. Publishing stays disabled.
