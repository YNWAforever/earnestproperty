# Isolated migration and 112-article import rehearsal — 2026-11-05

**PASS locally. All 112 articles imported with their existing URLs preserved. Production unchanged.**

This completes the user-authorized isolated rehearsal. It is not approval for a production migration/import, push, merge or deployment.

## Baseline and migrations

The rehearsal used a newly owned, loopback-only PostgreSQL **18.6** container, pinned to `pgvector/pgvector@sha256:2547711f871f5d4c02b2dfc7ff86f3eddc438d00a23854cd449513f4ef1af79b`. Production's read-only metadata reports PostgreSQL 18.6 with a Neon fork suffix. The fixed local-image allowlist retains the original PG17 default and all container, database, environment and private-handle checks; it does not accept arbitrary images or database URLs.

All 95 captured production migration versions exist in the repository. The reconstructed baseline matched the captured article/revision schema: 30 columns including null/default attributes, 28 constraints, seven indexes, two triggers and three CMS functions. Function definition bytes differed only in CRLF versus LF line endings. Raw and line-ending-normalized comparisons are retained; no schema definitions were replayed or functional differences ignored.

The three proposed migrations ran in one local transaction, advancing the ledger **95 → 98**:

| Migration | SHA-256 |
| --- | --- |
| `20261105120000_blog_presentation_contracts.sql` | `696695496d08bac32ef36703d0815a8b2a90cdef5fed3635d1c496a06cb3a8be` |
| `20261105140000_blog_repository_mutations.sql` | `95ad01f2d284a07ae50f08d04f89bb883ad6e62f26db7043eb3ec5e9267cffb5` |
| `20261105160000_blog_import_receipts.sql` | `fafb9086445f35aee472db4b716c029d969b50ce07797b7f7c9c4ee23ad72e5f` |

The captured production article/revision baseline was empty. An explicitly synthetic unrelated FAQ-history record tested preservation through migration/import/edit/recovery. Unrelated production rows were not copied.

## Exact captured-source rehearsal

The sealed live snapshot and fresh deployed-source bundle from [live reconciliation](live-reconciliation.md) were verified before use. The bundle's byte hash remains `60f95f002b0b0f1da1ad4145b7a8d02f14ab19066e9bd3a18bd9b3563a71427e`.

| Check | Result |
| --- | --- |
| Import plan | 112 inserts, seven categories, eight settings scopes, zero conflicts/unresolved entries |
| Guarded actual import | 112 articles and 112 matching initial revisions |
| Slugs | 112 unique exact existing slugs, all 112 locked |
| Content preservation | Titles, excerpts, bodies, supplemental links, editorial/comparison references, metadata and publication dates match the converted source |
| Missing dates | Both source null dates remain null |
| CMS editing | All 112 listed across pages of 100 and 12; each previewed, draft-saved, reloaded and reconciled to original content through actual CMS services |
| Draft privacy | Public record unchanged during every private draft edit |
| Public article lookup | All 112 exact slugs resolved with expected content and category |
| Presentation | Main featured buying guide occurs once; 111 regular articles paginate without duplicates; seven category scopes match their exact query keys |
| Repeat import | Zero writes, unchanged snapshot, one durable import receipt |
| Newer work | Reimport preserves newer published edits, private drafts and an intentionally unpublished article |
| Targeted recovery | Stale repair rejected with 409 and no changes; fresh single-field repair preserves intervening title/body, private draft, withdrawal state and unrelated rows |

The complete run passed **eight groups**, exit 0, at `2026-11-05T12:22:12.703Z`–`12:22:51.542Z`. The final database intentionally contains the test edits/private drafts/withdrawal used to prove safety; the pristine post-import snapshot is retained separately. The container was then removed by its owned lifecycle.

## Independent and built-app validation

- Fixed-image/target guards: **44 tests passed**, zero failures/skips. Independent spec/quality review passed.
- Existing real owned PG17 importer regression: **nine groups passed**, including rejected target/backup/approval inputs, transaction rollback, lost-response retry, stale source/history checks, private-draft collisions and the original 112-source import path.
- Independent rehearsal review verified all 13 sealed files and both input bundles, confirmed the migration/content/editability/recovery evidence, and found no actionable issue in scope.
- Fresh full build passed. The actual built Nitro HTTP suite then passed against another owned PG18 container, using the existing **101 synthetic article** acceptance scenario. It exercised every synthetic URL (99 public 200, one draft 404, one future 404), editing, role/status boundaries, concurrency, private drafts, restore/retry behavior, features, unpublishing, no-store headers and Chromium retry after a real local database outage.
- The 112 captured-article checks are real SQL/service checks; the separate 101-article suite supplies actual built HTTP/browser coverage. These counts and evidence layers are not interchangeable.
- Controller independently verified all 13 rehearsal seal entries with zero mismatches, checked 112 locked slugs in the post-import snapshot, verified the build binding after HTTP acceptance, and confirmed the two exact PG18 containers no longer exist.

Build passed with existing dependency/chunk/import warnings and Node DEP0190; built HTTP logged its expected unconfigured WhatsApp warning and no unexpected server stderr. Initial local rehearsal attempts failed before migration on SQL transport quoting and raw function-definition line endings. Those attempts remain preserved; the later successful run applies only the documented transport/line-ending normalization. No failed attempt was counted as acceptance.

## Current candidate binding

| Field | Value |
| --- | --- |
| Base HEAD | `8b49d0a21c867c401c4d41db393e43c8db76a74d` |
| Full source SHA-256 | `0e453dc46dda125ca6203be37624dafdf42beb0514f3744ac124cc4373e01566` |
| Built output SHA-256 | `5af479b923cd451907255962604efc59ba80951cf601b321ebf57c34ac0740b7` |
| Build receipt SHA-256 | `4f88fd958fb980bc483740f10f655df348efc196c07ea6363b87f83842cb99b1` |
| Built at UTC / local Node | `2026-11-05T12:25:21.837Z` / `v26.13.0` |

The prior pre-rehearsal receipt is retained. The worktree remains uncommitted.

## Artifacts and reproduction

Harness: `scripts/blog-cms/rehearse-live-inventory.mjs`.

```powershell
node --experimental-test-module-mocks scripts/blog-cms/rehearse-live-inventory.mjs
```

It requires the verified captured inputs and installed pinned image, refuses external database environment variables, creates a new local target, and writes a new evidence directory per run. It does not connect to production.

Successful private evidence: `.private-sync-evidence/blog-import/isolated-rehearsal-2026-11-05T12-22-12-703Z/`. Contains the exact local manifest, pre-import backup, import/retry receipts, migration/schema comparisons, all-article coverage, newer-work/recovery evidence and final snapshot. Seal SHA-256: `fe21b368c5d548bfa00f919cb6fd28ffb929fbae47ade7a8925e385d3edc2b34`. Raw content remains ignored; create-new files, hashes and read-only attributes are not WORM storage or a full recoverable production backup.

Local manifest fingerprint: `0fe0ae25bab90f8c3cafccc0b1cf87e92735619dfb820630626f40cc37a656f0`, bound to the now-removed owned container. **It cannot be reused as a production manifest/approval.**

Reports/logs and source/build receipts: `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/`, including `pg18-support-report.md`, `pg17-import-regression.log`, `rehearsal-report.md`, `rehearsal-build.log`, `rehearsal-http.log`, `rehearsal-build-receipt.json`, `rehearsal-candidate.json` and `http-1793881568176/`.

## Remaining release gates

Prepare and independently review a production-specific adapter and exact target-bound manifest. Establish real recoverable backup/PITR/media restoration, all-writer fencing/drain/reopen controls, named release owners, hosted authentication/storage/CDN acceptance and fresh under-fence inventory checks. Local PostgreSQL is not the Neon fork; locally seeded auth is not hosted-auth acceptance. Vercel's configured Node24 runtime also remains a separate hosted acceptance boundary from local Node26.

No production migration/import, role/grant change, content write, push, merge or deployment occurred. Request each consequential action separately only after the release packet is concrete.
