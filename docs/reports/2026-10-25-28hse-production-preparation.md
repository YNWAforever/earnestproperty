# Saved capture: production preparation only

No production connection, Vercel CLI, environment pull, real Blob write, push or deployment was performed. The prepared SQL has NOT been executed. This document supersedes earlier development-only target restrictions in the homepage preview report.

## Frozen input and commands

Frozen local file: `/workspace/28hse_capture/import_ready.frozen.json`.
SHA-256: `4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f`.
The hash authorizes exactly the JSON bytes read once by the process; preserve the photo directory too. Photos are checked and hashed separately at planning/upload time.

Owner supplies these environment variables securely, without committing them:

- `IMPORT_TARGET_ENV=production`
- `IMPORT_BLOB_TARGET_ENV=production`
- `IMPORT_DATABASE_URL`: Neon Console → production project/branch → Connect → correct database and role → disable connection pooling. Use the direct TLS URL (`sslmode=require` or stronger). Preflight needs SELECT privileges; apply needs the existing ingestion writer permissions. Verify branch identity in the console before supplying it.
- `IMPORT_BLOB_READ_WRITE_TOKEN`: Vercel Dashboard → Storage → the intended **public production Blob store** → its read/write token. Use the dedicated IMPORT variable, never a fallback from ordinary application credentials.
- `IMPORT_BLOB_STORE_ID`: the store identifier embedded in that token (`vercel_blob_rw_<store-id>_...`). Verify against the store selected in the dashboard.
- `IMPORT_BLOB_HOST`: that store's public host, `<store-id-lowercase>.public.blob.vercel-storage.com`, from its Blob URL/store details. No scheme/path. Host and token/store ID must agree before any write.

Only the first three are needed for read-only commands; all six are mandatory for apply. The importer rejects ordinary DATABASE_URL/UNPOOLED and BLOB_READ_WRITE_TOKEN as fallbacks, and rejects dedicated credentials equal to simultaneously supplied ordinary credentials. Keep application credentials out of the import process environment. Development retains its explicit loopback-only behavior.

From the repository root, after supplying those variables:

```bash
npm run import:28hse-saved:preflight -- --input /workspace/28hse_capture/import_ready.frozen.json --confirm-production=4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f --report /workspace/28hse_capture/import_preflight.md

npm run import:28hse-saved -- --input /workspace/28hse_capture/import_ready.frozen.json --confirm-production=4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f --report /workspace/28hse_capture/import_production_dry_run.md

# Later, only after owner review of a clean target preflight and dry-run:
npm run import:28hse-saved -- --apply --input /workspace/28hse_capture/import_ready.frozen.json --confirm-production=4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f --report /workspace/28hse_capture/import_production_apply.md
```

Preflight and DB dry-run begin `REPEATABLE READ READ ONLY`, verify `transaction_read_only=on`, and always roll back. They only issue SELECT/SHOW within that transaction, never instantiate a Blob client, and produce Markdown plus JSON reports. Missing target prerequisites give exit status 2. Invalid authorization fails before constructing any database or storage client. Apply performs that read-only full preflight first, then uses the existing ingestion and media path; it is the only mode authorized to write.

## Prepared prerequisites — review, do not automatically apply

`scripts/mls/sql/prepare-28hse-saved-import-policy.sql` inserts a missing source policy and embedded company-number-v1 identity policy with owner approval. It is outside automatic migrations, uses ON CONFLICT DO NOTHING, and fills an identity member only when entirely absent. Repeating it preserves existing approvals, mappings, parser settings and explicitly unapproved policies. It deliberately does not enable or replace existing live policies.

`docs/reports/28hse-estate-mapping-proposal.json` and `.md` cover **35 labels: 8 high-confidence, 4 medium-confidence, 23 unknown; 35 blank UUIDs; zero approved**. Suggestions use repo registry aliases and the saved site snapshot, not network access. Unknowns remain blank; phase/parent guesses require review. Property IDs in the site snapshot are not estate IDs. Obtain actual estate UUID/district pairs through an owner-authorized read-only target query and explicitly review/install mappings. No proposal is auto-applied.

Preflight checks required tables/columns, unique keys and safety triggers, the exact source/scope policy, saved parser approval, bootstrap/publication approval, company identity approval, mappings for every captured label, and all three owner-approved refs for unique resolution, open reviews/conflicts and overrides. Full dry-run also runs existing per-row policy validation.

## Local results and limitations

Offline capture: 56 flats → **52 creates + 3 updates + 1 sold skip**, 985 total photo references; selected 972 references deduplicate to 966. No target-production readiness is claimed: production was not contacted. Owner updates preserve IDs/public refs B059801, R068782 and B048068; sold 4028435 is skipped.

Validation: lint (0 errors, 9 existing warnings), price formatting (39 tests), importer (12 tests), property sync (331 tests), typecheck, and build passed. Production guard and positive-dispatch tests use synthetic clients/storage only; no production apply was tested or attempted.

Risks/blockers: all real estate identities need review; missing estate rows require separate owner decisions. An existing live parser or baseline may require a separately reviewed handoff, and policies/overrides/reviews can hold individual flats. Preflight is a point-in-time inspection; apply revalidates under the ingestion locks. Apply is per listing, not an all-or-nothing transaction across DB and Blob: a partial failure can leave owned assets/drafts, with reports and idempotent retry/source dedupe supporting recovery. Preserve the frozen JSON and local photos. Approved photo watermarks remain. Dates and listing details are from the saved capture and may need owner reconfirmation before the later import.
