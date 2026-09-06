# WP3 atomic ingestion implementation

Scope: only ingestion-service/repository, declaration files, owned tests and shared test fixtures. Base: 6b67c42 on codex/property-sync-no-hermes-v2. Original no-Hermes v1 modules and root integration files preserved.

Implemented a default offline dry run and an apply path using the existing MLS session advisory lock, a defensive same-name transaction lock and the admin-compatible properties table lock. A pre-lock receipt read permits exact replay even while another writer is active; receipt checks repeat inside the transaction. SQL compares exact microsecond receipt timestamps and accepted watermarks. Owner/parser/publish/bootstrap, per-hour quota, source URL verification and snapshot completeness gates precede atomic business writes. COMMIT transport uncertainty returns OUTCOME_UNKNOWN 503; retry of the identical payload recovers the stored response.

The atomic transaction writes run, receipt placeholder, immutable observations, current source state, whole contacts, source links, canonical projections, reviews, conflicts, actual-effective change events, final receipt and full/partial scope progress. Stable SYNC UUID numbers are explicitly internal; source agency numbers are not match keys. Exact source-first relationships preserve existing UUID/public aliases. Material identity changes hold projections and preserve prior raw identity/key for review. New rows stay draft; source collection never uploads/replaces media or changes staff identities.

Manual field overrides and divergence are protected; unknown legacy field ownership is reviewed, not automatically claimed or blanket marked manual. Trigger-effective RETURNING values drive history. Exact decimal money is preserved; fractional integer-area projections remain source evidence and produce review rather than silent rounding. Property.hk URL mismatches are row rejects, never an existing-record bypass. Staged source records can create exactly once once prerequisites are met. Full 28hse absence compares only the previous accepted full receipt's observed IDs; partial-only historical records do not get delisted. Absence retains observation timestamps (no fabricated freshness), with status events tied to the accepted absence run. Secondary updates cannot revive primary absence.

## Server-owned policy configuration

- owner=no-hermes-v2; publish_enabled=true; matching policy/parser version; initial bootstrap_approved_at/by and operator approval note.
- Property.hk id_scope column must be global or branch. It is authoritative on apply; wire id_scope is used only for offline preview count accounting.
- config.source_url_identity: {verified:true,path_template:'/fixture/{branch}/{id}'}. The shown path is explicitly synthetic test evidence, not a live Property.hk path. Require a leading slash and {id}; branch-local scope also requires {branch}. No query/hash/percent-encoded template matching; IDs are ASCII letters/numbers/underscore/hyphen. Verification is fail-closed and operator config must be supplied from authorized fixtures.
- Fixed business quota: at most one NEW accepted FULL sync per source/scope per hour, counted from full receipt accepted_at. Partial success does not consume this full slot; exact replay bypasses it. Separate config.max_batches_per_hour is a positive integer, default 60, and bounds all new receipts. Both 429 errors include details.retryAfter seconds to expiry. Tests explicitly age full receipts in the disposable schema to simulate hourly cadence; the dedicated default-full-quota test calls the service directly without that aging.
- config.absence_enabled:true enables only approved full 28hse absence; Property.hk absence is always disabled.
- config.aliases passes trusted normalization aliases to the reviewed contract.
- Public contact gate is root-owned config.public_contacts_enabled; public read should exclude observation.payload.holdProjection=true.

Full apply response status is success (Python receipt compatibility); partial_success is separate; dry_run has null receipt_id. All return success, full_snapshot and summary.advertisement_count/offer_count/rejected_count/duplicate_count. SnapshotError carries code/status/details.retryAfter.

## Verification evidence

TDD red observed before implementation: missing service export; apply returned dry_run; no receipt/stale/rollback behavior. Real-DB regressions subsequently reproduced and fixed: SQL join ambiguity, trigger-effective provenance, unknown equal legacy ownership, fractional money/decimal scale, staged source completion, replay under active writer lock and existing source URL mismatch. Node dry-run suite: 3/3 passed. ESLint on owned JS/test files passed. Full disposable DB results and final commit will be appended after the final lifecycle check.

All DB runs used node --env-file=.env.astra-disposable --test and asserted ASTRA_TEST_BRANCH_ID=br-quiet-hat-aoxbj2ue. Tests clone table shape into unique atomic_<uuid> schemas and drop those schemas afterwards; no production mutations, migration, activation, deployment, remote crawling or external messages were performed.


## Acceptance coverage mapping (WP3)

- T11/T12/T13: real receipt replay while disabled and while another writer is active; same key changed hash; exact microsecond stale and partial watermark.
- T14: real unique exact cross-source match in both arrival orders, stable canonical UUID, source priority and field provenance.
- T15/T16/T17: matching predicate is the reviewed WP2 unit-identity/source-selection implementation; its pure tests cover non-exact/phase/floor restrictions. WP3 adds no price/area/agency-number matching path.
- T18: real staged source completing and then repeated ingestion preserves its assigned UUID/first_seen; incomplete intermediate identity cannot erase the last-known identity used for correction review.
- T19: real same-source duplicate is staged for review; multi-candidate exact ambiguity selection remains covered by the reviewed WP2 pure tests, not a separately claimed WP3 DB case.
- T20: source state/contact keys and canonical projection preserve deal_type; separate sale/rent behavior is reviewed WP2 coverage, not a separately claimed WP3 DB case.
- T21/T22: real primary conflict ledger, secondary missing bedroom fallback and Property.hk-first/28hse-second priority/provenance.
- T23: whole source contacts persist atomically; actual whole-contact selection is reviewed WP2 pure coverage and root public-reader integration.
- T24: real partial success/count/watermark behavior using invalid record values; invalid branch accounting itself is reviewed WP2 contract/gate coverage.
- T25: real before-COMMIT failure, conflict-ledger trigger failure and final-receipt UPDATE trigger failure each assert rollback; lost COMMIT acknowledgement separately verifies unknown outcome and replay recovery.
- T26: real first-run bootstrap denial with no run persisted, then explicit approved bootstrap; full absence only compares previous full observations and ignores partial-only history.
- T27: real concurrent shared-lock contention and completed receipt replay during that contention; exact receipt uniqueness.
- T28: offline dry-run tests including no connection factory access and branch-local preview accounting.

Additional DB regressions protect issued public aliases, unknown legacy field/status ownership, active admin trigger effective values/history, source media, fractional money and decimal scale, existing source URL identity mismatch, primary delisted lifecycle against secondary revival, fixed one-full-sync hourly quota, replay bypass and separately accepted partial success. Canonical new rows remain draft pending a separate operator-owned media/publication review.

Final review changes retain last known nonempty source identity components without upgrading incomplete observation match eligibility. Run source_status contains policy_version=no-hermes-v2 and publisher=python-snapshot-v2. Immutable observation payloads contain schemaVersion=2, parserVersion, policyVersion, sourceKey and independent unitKey.

District mapping is deliberately server-owned: each policy config.district_slugs maps an exact trimmed source district name to a validated lowercase kebab-case canonical slug (for example the TEST fixture uses Test -> test). The selected field's winning source policy supplies the map. Unknown/invalid mappings preserve an existing canonical slug; a new source without a mapped district stays staged and produces district_mapping_unverified review. No source name is copied to district_slug and no slug is invented. Raw district text stays in immutable observations. Chinese fixture coverage stages an unmapped name, then creates it after an explicit synthetic map is supplied.

## Final verification result

- `node --env-file=.env.astra-disposable --test src/lib/mls/ingestion-service.test.mjs src/lib/mls/ingestion-repository.db.test.mjs`: PASS, 28 tests, 0 failures, 0 skipped; final run 312.3 seconds. This run includes the final district mapping, preserved identity, fixed full quota, lifecycle ownership and conflict/receipt-write rollback changes.
- `node node_modules/eslint/bin/eslint.js src/lib/mls/ingestion-service.mjs src/lib/mls/ingestion-repository.mjs src/lib/mls/ingestion-service.test.mjs src/lib/mls/ingestion-repository.db.test.mjs src/lib/mls/ingestion-test-fixtures.mjs`: PASS after the final implementation edits.
- Formatting applied with repository-local Prettier to all seven implementation/type/test files. Root owns whole-project build/typecheck, HTTP/bridge/public read model, CI and deployment documentation verification.

Remaining operational gates are intentionally unactivated: real source identity URL semantics, ID scope, district maps/aliases, parser policy, bootstrap approval, single writer ownership, publishing and owned-media/publication review. This work does not attest to live Property.hk fixtures, activate production or publish new draft rows.
