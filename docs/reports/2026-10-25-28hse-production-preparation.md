# Saved capture production preparation — corrected against saved production schema

This revision supersedes the earlier strict estate-mapping/parser assumptions. All work in this revision was local. No production connection, Vercel CLI/env pull, real Blob write, push or deployment. The owner supplied read-only production reports/snapshot; no new production checks were attempted here.

## Estate resolution

The runtime reads `estates(id,slug,name_zh,name_en,aliases,district_slug)` and `districts(id,slug,name_zh,name_en)` from the target in the read-only transaction. There is no estate_mappings table and this importer no longer requires `config.estate_mappings`. Resolve exact names/aliases, ignoring case and normalizing Unicode/whitespace, within the captured district. No fuzzy, parent or phase identity guesses. A broad captured district may resolve through a named locality explicitly present in the captured address. Unmatched estates keep `estate_id=NULL`; ambiguous estate identities hold for review. No estate/district rows are created automatically. Runtime rechecks the catalog at staging and publication.

The local saved production snapshot gives **35 labels: 5 matched, 0 ambiguous, 30 unmatched-left-null**. The matched labels are OMA OMA, 上源, 浪翠園, 海韻花園 and 縉皇居. Exact matching intentionally leaves decorated/phase names unmatched if no production alias exists. The proposal JSON contains actual snapshot estate UUIDs only for exact matches and null for the others. Target reads remain authoritative at execution time.

Two active flats have unresolved districts: **4044249 富麗花園 (荃灣)** and **4062592 凱旋門 (九龍站)**. Neither has a matching district among the four saved production rows; do not silently assign a different locality. 海濤花園 resolves to 汀九 from its captured address, 青山公路汀九段103號. A normal NULL estate is not a validation error; an unresolved required district is a blocker. Owner must decide how these two districts should be represented before all 55 active offerings can apply.

## Schema and driver corrections

No saved-capture code depends on source_updated_at. The observation schema check uses only migration-backed columns. The unique-index check reads pg_index for unique/primary/partial indexes, explicitly casts attribute names to text[], and accepts JS arrays as well as PostgreSQL array text (and JSON array text) from driver parsers. The media content-hash partial unique index is accepted. A disposable schema built from actual migrations verified all required columns/keys.

`pg` remains default. `--driver=neon-ws` uses a session-based @neondatabase/serverless Client with ws, preserving the transaction, advisory locks and session-local writer guards; it does not use the HTTP neon() API. Driver selection does not bypass target/hash/credential checks. ws is a direct, locked dependency using the already present package version. All six IMPORT_* operator variables are registered in .env.example.

## Owner-review SQL — NOT applied to production

Exact self-contained SQL: `scripts/mls/sql/prepare-28hse-saved-import-policy.sql`.

The production policy already exists. Keep its `parser_version=python-v2.2`, publication/bootstrap settings, absence settings and full baseline unchanged. Add only `config.saved_capture_import` with parser_version `saved-capture-import-v1`, approved=true and approved_by=owner; fill company-number-v1 identity only if the member is absent. Never override partial/unapproved/revoked approval members. No policy row is inserted, so the partial one-owner-per-scope index remains intact.

The existing migration's four-column receipt→policy parser FK otherwise makes two parser versions on one policy impossible. The review SQL replaces ONLY that redundant four-column FK with a deferred receipt-parser guard, while retaining the original three-column policy FK. The guard accepts the primary parser as before, or the exact secondary parser only for this source/scope/policy, a non-full receipt, explicit owner approval and the importer's transaction-local authorization setting. Receipt/run/observation evidence retains the true saved parser. A second guard prevents changing the primary parser while accepted primary receipts reference it, preserving the original FK protection. No new tables/columns are introduced. These two new guards are explicit preflight prerequisites; until the owner approves/installs this script, preflight reports them missing. Applying the script requires DDL ownership as well as policy-update permission; importer apply itself does not install it.

The engine permits the secondary parser only with the internal operator option AND controlled partial mode AND owner approval. The daily route cannot enable this option. For this authorized partial only, the gate accepts the differently versioned existing baseline without replacing it; absence inference remains off. Local DB regression verified the original python baseline survives import and normal python full sync succeeds afterward. The proposed policy seed was not run; only its guard DDL was exercised in an isolated disposable schema with a synthetic policy.

## Exact commands for the owner, later

Frozen input SHA-256 is `4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f`.

Supply securely in a dedicated shell (never commit values):

- IMPORT_TARGET_ENV=production and IMPORT_BLOB_TARGET_ENV=production.
- IMPORT_DATABASE_URL: Neon Console → intended production branch → Connect → direct/unpooled TLS connection string for the correct database/role. Port 5432 need not be accessible when selecting neon-ws.
- Apply additionally needs IMPORT_BLOB_READ_WRITE_TOKEN, IMPORT_BLOB_STORE_ID and IMPORT_BLOB_HOST from Vercel Dashboard → Storage → intended public production Blob store. Store ID must match the token's vercel_blob_rw_<store-id>_... part, and host must be <store-id-lowercase>.public.blob.vercel-storage.com, without scheme/path.

Ordinary DATABASE_URL/DATABASE_URL_UNPOOLED/BLOB_READ_WRITE_TOKEN never serve as fallbacks. Keep ordinary app credentials out of this import shell; values equal to simultaneously supplied ordinary credentials are rejected. Read-only commands need no Blob credential. Development remains explicitly loopback-only.

```bash
INPUT=/workspace/28hse_capture/import_ready.frozen.json
HASH=4f871030287abb25c55b87326c22a897f3e0c12462f7bd4853baee9f1317e88f

npm run import:28hse-saved:preflight -- --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --report /workspace/28hse_capture/import_preflight.md

npm run import:28hse-saved -- --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --report /workspace/28hse_capture/import_production_dry_run.md

# Only later, after approved prerequisites and a clean full target dry-run:
npm run import:28hse-saved -- --apply --driver=neon-ws --input "$INPUT" --confirm-production="$HASH" --report /workspace/28hse_capture/import_production_apply.md
```

Omit --driver=neon-ws to use default pg. Preflight/dry-run verify REPEATABLE READ READ ONLY and always roll back; neither constructs a Blob store. Markdown + JSON reports contain missing items, field mapping, photo counts and target resolutions. Wrong/missing hash or dedicated credentials fails before client construction.

## Results, verification and remaining risks

Local input remains **52 creates + 3 owner updates + 1 sold skip**, 985 photo references, 972 selected, 966 after URL dedupe, zero offline field/photo validation failures. Production target readiness is not claimed: the saved snapshot exposes two district blockers, and owner SQL/identity approval still needs review and installation.

Local migration-backed regression passed: read-only preflight accepted the actual migration columns and unique/primary/partial indexes; 52 creates + 3 updates, NULL estate publication, retained IDs/public refs, retries, source-journal race protection, retained python baseline and subsequent daily full sync. Synthetic media/Blob store only; disposable Postgres stopped afterward. Sequential verification passed: lint (0 errors, 9 existing warnings), typecheck, build, 15 importer tests, 12 env checks (including the repo-wide registry), 39 price-format tests, 331 property-sync tests, and the local PostgreSQL integration regression. The latter also rejects secondary receipts without operator authorization, any full saved-parser receipt, and primary-parser changes that invalidate accepted receipts.

Apply is per listing, not an all-or-nothing DB+Blob transaction; interrupted uploads can leave assets/drafts. Preserve the frozen JSON, local photos and reports for idempotent recovery. The JSON confirmation binds file bytes; photos are separately validated/hashed at execution. The saved snapshot may become stale; target preflight/apply read the live catalog later. Owner-approved watermarks remain. Staff overrides/reviews and concurrent daily changes remain grounds to hold rows. Schema-guard installation is a separately reviewed privileged operation, not part of importer apply.
