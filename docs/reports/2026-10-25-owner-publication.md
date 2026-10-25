# Frozen capture owner publication — local preparation only

No production connection, real Blob write, Vercel CLI, env pull, push or deployment was performed. This mode implements the owner's new decisions and supersedes the old 52-create/3-update target strategy. The saved CSV is evidence, not apply authority.

## Local saved-map report

`/workspace/28hse_capture/owner_publication_dry_run.md` and its `.json` companion show **30 updates (22 drafts + 8 inactive), 23 creates, 2 held ambiguous flats, 1 sold skip**. All 56 frozen records parsed; the selected 55 contain 972 photo references, 966 after repeated source URLs are merged. There is no six-photo or 20-per-day cap. All validated unique captured photo URLs are retained, main first; watermarks stay as approved.

This offline report does not assert production readiness. It uses the owner's saved mapping CSV and estate snapshot. Candidate creation dates, prices and complete photo URLs absent from the CSV stay unknown. The later target dry-run obtains full candidates and exact own-review keys in a verified REPEATABLE READ READ ONLY transaction, then rolls back. Both dry-run forms print/write before/after status, internal/public listing numbers, price/rent, photo count, reviews and candidate details. JSON includes the full field mapping.

The two holds are **4065990 / B047469** and **4040895 / A074799**. Supply `--choose REF=<matching-property-UUID>` after reviewing the candidate rows. A UUID outside the ref+deal candidate set is rejected. Keep those choices on subsequent retries. Without choices, apply publishes the 53 eligible flats and leaves the two holds; exit 2 indicates holds and can follow successful partial progress.

## How publication works

- Match by agency ref + deal type against properties and public membership; never select by raw ad ID. Preserve the selected property ID and internal listing_no. Agency ref becomes public_listing_no through existing company-number grouping. A conflicting non-null canonical ref is held.
- New rows reuse the extracted normal ingestion draft-creation helper (SYNC-UUID internal number) and existing company grouping/temporary-group cleanup. No row matching a ref+deal is duplicated. Sold **4028435 is not even queried as a publication target** and remains untouched.
- Use the shared saved-capture parser, local photo validation, cached-byte transport and `prepareListingMedia`. Upload before DB writes. Media registration/records are buffered in memory until the canonical transaction. Files are rehashed before upload. Blob assets/records, property changes, group membership, field ownership, review resolutions and audits commit together per listing.
- After uploads, acquire the existing ingestion advisory lock/table locks and re-read the target, full candidate set, reviews, fields, overrides, group state and catalog. Any unexpected change holds the row without partial DB writes. Changes to a shared group made earlier by this same batch are tracked explicitly; new outside changes still fail the fingerprint. Verify final effective values and that the selected row is the current public offering before commit.
- Set latest captured fields, active status, all owned images, unmatched estate NULL. District is explicitly empty string for **4044249 and 4062592**, as the owner requested. Other unresolved districts remain holds. Do not fabricate missing fields or estate rows.
- Write normal listing_source_observations, property_source_links, property_sync_fields (`operator_publication` / `owner-publication-v1`), listing_change_events, admin_property_source_snapshots and audit_logs, with capture hash, source IDs, before/after, choice and resolved review keys. Do not create admin_property_overrides.
- Provenance uses a stable `owner-capture-<agency-ref>-<deal>` source key and records the real captured ID/aliases in immutable observation payload. **Existing raw-ad-ID links/state are never rebound or updated**, including stale live targets and historical aliases. The namespace cannot collide with numeric ad IDs. It is not added to mls_source_state, because doing so would falsely claim an accepted daily receipt. No ingestion receipt, full baseline, primary parser policy or daily publication limit is changed; the earlier parser-FK SQL is not a prerequisite for this one-off mode.
- Resolve only reviews whose bound property is this selected row, or whose unbound immutable observation identifies the exact ref+deal. A review bound to any different/stale row remains open, even if the new capture reuses its ad ID. Preserve evidence/review keys; resolution audit is tagged `owner-publication` with the frozen hash. Manual overrides and unreviewed conflicts remain holds. For explicit ambiguous choices, only the selected agency group's review flag can be cleared, with the original group state in the audit; other property rows stay untouched.
- Idempotence checks a matching owner-publication audit, input/capture hashes, active public membership, no new own reviews and the exact after-row hash. An unchanged retry uploads nothing and writes no extra audits. Changed active rows hold for review instead of being silently overwritten.

## Commands for the owner later

Supply `IMPORT_TARGET_ENV=production`, `IMPORT_BLOB_TARGET_ENV=production` and dedicated direct TLS `IMPORT_DATABASE_URL` from the intended Neon branch. Apply additionally requires the dedicated matching `IMPORT_BLOB_READ_WRITE_TOKEN`, `IMPORT_BLOB_STORE_ID`, `IMPORT_BLOB_HOST`. No ordinary application-credential fallback. These values are not saved in the repo.

```bash
INPUT=/workspace/28hse_capture/import_ready.frozen.json
HASH=4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f

# Full target dry-run; no Blob client, verified READ ONLY + rollback:
npm run import:28hse-owner -- --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --report /workspace/28hse_capture/owner_publication_dry_run.md

# Later apply; default leaves the two ambiguous flats held:
npm run import:28hse-owner -- --apply --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --report /workspace/28hse_capture/owner_publication_apply.md

# Add these to BOTH dry-run and apply after the owner picks:
# --choose B047469=<property-uuid> --choose A074799=<property-uuid>
```

Omit `--driver=neon-ws` for pg. The local offline report can be regenerated without any credentials:

```bash
npm run import:28hse-owner -- --offline-map /workspace/28hse_capture/existing_drafts_map.csv --report /workspace/28hse_capture/owner_publication_dry_run.md
```

## Separate review queue script — prepared, not run against the saved/production queue

`scripts/mls/resolve-owner-reviews.mjs` defaults to read-only. Summary estimates are **1,173 keep-current-value ownership cases + 26 redundant reviews**, retaining approximately **102 real cases** (46 ID changes, 16 group conflicts, 30 ambiguous sources, 10 mappings), before targeted publication resolves its own cases. Counts are estimates until a full target snapshot is exported/reviewed; changed values, ambiguous bindings, conflicting existing ownership or substantively different evidence hold.

Run publication before bulk ownership cleanup; cleanup deliberately protects remaining current values and can otherwise hold a captured row for review.

The planner verifies the historical observation's agency ref/deal and unique bound property (including normal v2 refs stored in payload when property_no_normalized is NULL), exact current-value evidence and field whitelist. It records `property_sync_fields` keep-current ownership under `owner-keep-current-v1` with a per-field manual override, never an admin override. Ordinary ingestion skips already-reviewed keep-current ownership only while actual value, override value and last-published value still agree exactly; standard manual overrides retain their existing behavior. Genuine cases remain open. Duplicate resolution retains a representative, ignores only generic owned-media hold noise/candidate ordering, and preserves substantive identity/candidate evidence. Reviews remain in the DB with their evidence, and each resolved key gets an audit record.

A full review snapshot is required for queue apply; the summary JSON cannot authorize a bulk write. The plan hash is separately confirmed, in addition to the frozen capture production confirmation. The script re-plans under the ingestion lock and table locks before atomically writing ownership/audit/resolutions. No age/inactive-status blanket resolutions.

```bash
# Later: export a full review snapshot inside READ ONLY; exclusive local file creation.
npm run reviews:owner -- --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --export-plan /workspace/28hse_capture/owner_review_plan.json > /workspace/28hse_capture/owner_review_export_report.json

# Review exact eligible/held decisions without writing the DB:
npm run reviews:owner -- --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --review-plan /workspace/28hse_capture/owner_review_plan.json > /workspace/28hse_capture/owner_review_dry_run.json

# Compute the reviewed plan's hash locally, then supply it as REVIEW_HASH:
sha256sum /workspace/28hse_capture/owner_review_plan.json
# REVIEW_HASH=<owner-reviewed SHA-256 from the preceding command>

# Later, only after owner review of that exact file:
npm run reviews:owner -- --apply --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --review-plan /workspace/28hse_capture/owner_review_plan.json --confirm-review-plan="$REVIEW_HASH" > /workspace/28hse_capture/owner_review_apply.json
```

## Verification and risks

Disposable Postgres tests verified 53 default publications, both explicit choices, original IDs, all seven synthetic photos per listing (>6), NULL estates, blank approved districts, stable shared sale/rent grouping, untouched sold/stale rows and original ad-ID journal, no admin overrides, scoped review audit, zero-upload retry, changed-target rollback, keep-current ownership and duplicate resolution. The original saved-import integration test also passed after the shared creation helper extraction. Tests use only synthetic media/fake Blob storage, and the disposable database is stopped afterward. Final sequential checks passed: lint (0 errors, 9 existing warnings), typecheck, 24 importer/publication unit tests, 331 property-sync tests (one test file at a time), 39 format tests, 12 env checks including the registry, and both disposable Postgres integration suites. The final owner integration also verifies a late audit failure rolls back all canonical/media effects and a subsequent ordinary ingest does not recreate an owner-reviewed field case. CI’s existing importer test commands now include owner-publication tests with test-concurrency=1.

**Build verification is incomplete:** npm run build was attempted alone and terminated with exit 143 before completion. A bounded-memory retry was requested but approval was rejected, so no further build attempt was made. No build success is claimed.

Uploads can leave unattached content-addressed Blob objects if the later transaction is held; reports record the failed phase. A commit-acknowledgement failure stops as unknown: run dry-run before retrying. The owner should retain a backup/snapshot and the frozen capture/photos/reports before a future production apply. The collector's robots 403 and stale daily full receipt remain unfixed; this mode does not withdraw stale listings or repair automated freshness/absence detection. Snapshot values can change, so only a fresh target dry-run can establish actual readiness. No production actions are authorized by this implementation task.

## Daily schedule added after this report

The 09:00 Asia/Hong_Kong GitHub schedule now calls this same CLI with `--apply` when the operator gates in `docs/deployment/property-sync-daily.md` are set. It consumes a private `owner-capture-<sha256>.tar.gz` bundle. It does not switch the Actions collector to Firecrawl or to direct HTTP, and it does not apply `scripts/mls/sql/prepare-28hse-saved-import-policy.sql`.
