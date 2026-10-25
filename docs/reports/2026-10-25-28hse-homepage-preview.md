# Saved-capture backend importer (supersedes the fixture preview)

Branch: `feat/28hse-homepage-preview`, existing PR #276. No push, merge or deployment. No production database or production Blob access was used. The real captured data has only been dry-run; writes were exercised on a disposable loopback PostgreSQL cluster with synthetic records/photos and a fake Blob adapter.

## Result for the supplied capture

Input: `/workspace/28hse_capture/import_ready.json`, 56 source records / 985 photo references.

- **52 creates + 3 updates**, **1 skipped**, **0 input-validation failures**.
- Skip sold source ID `4028435` (`R067756`), including its 13 photos.
- Update the existing rows/public identities for `4029337 → B059801`, `4034694 → R068782`, and `4015403 → B048068`. Their deal types, active-deal amounts, details and owned photos become the captured source values; the inactive-deal amount is cleared. The existing row IDs and public URLs are preserved.
- 55 selected records have 972 photo references. Six exact repeated source-photo URLs are merged, leaving 966 gallery entries / unique file contents. Main photo first. Owner-approved watermarks remain as-is in the original `_large` bytes.
- Agency references are the public listing numbers. Three pairs among the new rows share an agency reference across sale/rent; the repository's normal public grouping retains both offerings under that one agency reference. “52 creates” counts new offering rows, not 52 distinct public URLs.
- Five explicit `開放式` bedroom values become 0. `5+` for `4065990` and `4042934` remains null because it is not an exact count. `4040071` has null saleable area. No values are guessed.

Review files (not committed with private capture data):

- `/workspace/28hse_capture/import_dry_run.md`
- `/workspace/28hse_capture/import_dry_run.md.json` — field mappings, byte hashes, local paths, owned pathnames, row validation and warnings.

This offline count follows the owner's supplied classification. Actual source IDs, target IDs, approved mappings, bootstrap/parser policy and manual conflicts are rechecked against the selected development target before any apply. Production has not been inspected or changed.

## Commands

Run from the repository root, with installed dependencies. Use Node 24 as in CI.

Default offline dry-run needs **no DB or Blob credentials**, ignores ordinary `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and `BLOB_READ_WRITE_TOKEN`, and performs no network requests:

```sh
npm run import:28hse-saved -- --input /workspace/28hse_capture/import_ready.json --report /workspace/28hse_capture/import_dry_run.md
```

For an additional **read-only development DB preflight**, export `IMPORT_TARGET_ENV=development` and `IMPORT_DATABASE_URL` for the disposable loopback database, then run the same dry-run command. Its DB transaction is explicitly read-only.

To apply later **to a development target only**, export all six variables:

| Variable                       | Required value                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `IMPORT_TARGET_ENV`            | `development`                                                                                                                         |
| `IMPORT_DATABASE_URL`          | Explicit PostgreSQL connection string to `127.0.0.1`, `localhost` or `::1`; never a production URL or forwarding tunnel to production |
| `IMPORT_BLOB_TARGET_ENV`       | `development`                                                                                                                         |
| `IMPORT_BLOB_READ_WRITE_TOKEN` | Dedicated development Vercel Blob read/write token; provided securely, never put in a report or Git                                   |
| `IMPORT_BLOB_STORE_ID`         | Exact development store ID matching that token                                                                                        |
| `IMPORT_BLOB_HOST`             | Exact `<development-store-host>.public.blob.vercel-storage.com` host expected in upload metadata                                      |

Then run:

```sh
npm run import:28hse-saved -- --apply --input /workspace/28hse_capture/import_ready.json --report /workspace/28hse_capture/import_apply.md
```

There is no fallback to ordinary database/Blob credentials. Apply rejects non-loopback DBs, production mode, connection parameters that can redirect the target, and a token equal to the ordinary `BLOB_READ_WRITE_TOKEN`. Actual returned Blob host metadata must match `IMPORT_BLOB_HOST`. `--apply` was **not** run on production or on the real capture in this task.

## Existing schema and pipeline reuse

Implementation: `scripts/mls/import-saved-capture.mjs` and `src/lib/mls/saved-capture-import.mjs`. No new tables, migrations or public listing model were introduced.

1. Normalize the supplied fields into the existing snake_case listing contract. `agent_listing_ref` is `agency_property_no`; `source='28hse'` maps to existing internal source `28hse_agent_540`, with `source_id` stored as `external_listing_id` in the source-state/link journals. Broad floor labels do not become invented exact-unit identities.
2. Freeze a per-record hash over normalized listing fields, source URLs, ordered photo hashes and merged repost IDs. Validate real paths beneath `photos/<source_id>/`, file sizes, detected MIME, full image decoding and pixel/dimension limits. Photo headers are never trusted instead of actual bytes.
3. Use `decodeSnapshot`, `evaluateSnapshotGate`, exact unit identity and `applyIngestion` with the existing `saved-capture-v1` controlled-patch guards. This is an operator-selected partial import: **never a full stock snapshot, never eligible for absence inference, never a baseline reset**. Before-images are checked by the existing writer. The importer uses its own explicit parser identity, `saved-capture-import-v1`; it does not impersonate the live crawler parser.
4. Standard ingestion assigns internal `SYNC-<uuid>` row keys and the existing approved company-number/public-group mechanism issues the agency-reference public numbers. For the three replacements, standard unpublished staging offers are folded into the exact owner-selected existing rows only in the final locked publication transaction, after media preparation. There are no additional active/public duplicates. A failed media operation leaves the original active listing unchanged and a resumable unpublished staging offer.
5. Reuse `prepareListingMedia`, `createSyncRepository`, `buildOwnedMediaPathname` and `createVercelBlobStore`. The shared media pipeline receives only frozen local bytes through a closed URL-to-local-file transport; it never fetches the source website. Originals retain the existing content-addressed `mls/<hash-prefix>/<sha256>.<extension>` storage layout, hash dedupe, `media_assets` registration and `listing_media_records` evidence. Optional responsive variants use the existing pipeline. Original photo bytes and watermarks are not edited.
6. Publication re-locks and checks the property row, source-state/link journal, observation fingerprint and public identity after uploads. Concurrent source changes or staff overrides/reviews prevent stale publication. Conditional source rebinding must affect exactly one row. The effective stored field values are verified before commit. Public changes and source/alias links commit atomically per listing with field ownership and change-event evidence.
7. Exact repeat runs skip already completed records and upload nothing. Interrupted draft publication resumes using registered hashes. Changed inputs for an existing source are held for review rather than silently overwriting a later edit. Superseded opposite-deal links on the three owner-approved replacements are retained as rejected historical evidence.

The ingestion receipt records staging activity; the import's own apply report records the final business outcome (52 new rows and 3 existing-row updates). These are separate stages, not duplicate public listings.

## Field coverage and first-party UI

Prices/rents, areas, rooms, floor/orientation, title, estate/district, address, description, feature tags, source update date and supported agency YouTube video go into the existing property fields. Parsed unit, kitchen, fee-inclusion, school-net, developer, estate/parking and management details are appended as labelled text in the existing description field. Unsupported/external VR pages, remote estate floorplans, contact/QR assets and source advertising grades are not imported as gallery images or redirects.

The JSON fixture, preview component/catalog, feature flag and preview-only Vite environment hook have been removed. Homepage `最新放盤`, `/listings`, and `/property/<agency-reference>` use the ordinary DB feed/model and existing first-party card links. No new public 28hse links or source-label UI remain; source URLs are retained only as internal provenance. Owner-approved photo watermarks are the stated exception. Existing production rows are not replaced by a preview fixture.

## Target prerequisites / production blockers

The importer does not enable policies, apply migrations, infer estate aliases or clear staff overrides. The selected disposable/development DB must already have the deployed ingestion/media schema and:

- `mls_ingestion_policies`: source `28hse_agent_540`, scope `agent:540`, policy `no-hermes-v2`, owner `no-hermes-v2`, publication and bootstrap approved, parser `saved-capture-import-v1` explicitly approved.
- Approved `company-number-v1` identity policy with an approver, plus exact `estate_mappings` from each captured estate label to an existing estate UUID and matching district slug. Captured phase/building variants need explicit mappings; they are not guessed.
- The three agency references resolve to the unambiguous existing target IDs. Unexpected existing source bindings, conflicting public groups, open reviews or staff overrides require resolution before publication.
- A dedicated development Blob store/token/host. No production Blob credentials were used in tests; the fake adapter retains the same upload metadata contract without making a network call.

**Production apply is deliberately blocked by the target guard.** A production import is a separate release operation requiring explicit authorization, reviewed target configuration and verified policy/mapping/identity evidence. This branch does not silently unlock production access. Until such an import is separately performed, the captured flats are not live on the production site.

## Verification

- Offline dry-run on the actual supplied manifest: 52 creates, 3 updates, 1 sold exclusion, no local validation failures.
- Unit tests cover mapping/nulls, owner-approved watermarks, path validation, duplicate source IDs, target rejection, fixed owner replacement references, sold exclusion, retired fixture UI and network-free default dry-run even when ordinary production credential variables are present.
- Real disposable PostgreSQL test applies relevant repository migrations, then exercises 52 synthetic creates + 3 same-ID replacements, source/deal/price/detail replacement, main-photo ordering, media ownership, repost links, no sold import, unchanged unrelated stock, partial-snapshot receipts, duplicate-free second run with no uploads, changed-input rejection and concurrent source-journal changes during upload. Blob writes are fake; no production/provider access.
- The source-journal race test first failed against the pre-review implementation and then passed after transaction-time journal/observation/link locking and fingerprint verification.
- Existing ingestion regression suite, format tests, lint, typecheck and build are recorded with final results below. No DB integration assertion is represented as a skipped pass.

Local integration invocation used in this task (the test database is temporary, not a production endpoint):

```sh
IMPORT_TEST_DATABASE_URL='postgresql://<local-test-user>:<local-test-password>@127.0.0.1:<owned-port>/<disposable-db>' npm run test:28hse-import:db
```

In CI with no URL supplied, the suite creates its own owned Docker Postgres using the repository harness. Neither test path accepts a remote target.

Final results: **6 unit tests**, **1 real PostgreSQL end-to-end suite** (including the concurrency regression), **331 existing ingestion tests**, and **39 format tests** passed. Lint passed with the same 9 existing warnings; typecheck and build passed. Independent code review reported no remaining findings after the source-journal fix. Test data/schema were disposable and the Blob adapter was fake.
