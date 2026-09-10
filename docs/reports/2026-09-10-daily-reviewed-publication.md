# Daily verified publication

The daily agent:540 workflow now enriches and publishes eligible imported drafts after a successful full ingestion receipt. It does not republish existing public stock or change listing creation dates.

## Collection and cost

Python extracts up to six distinct gallery URLs from the already-fetched, identity-validated source detail page. A factual description is built from estate, floor, area and available room counts. No AI calls or extra detail-page requests are needed. Unknown galleries leave publication evidence empty without turning a valid inventory collection into absence evidence.

Only eligible drafts download images. Existing content, overrides, unresolved reviews/conflicts, multiple source candidates, amount/area mismatches and non-active sources hold the draft. The established media service validates host/DNS, bytes, image decoding, ownership and hashes and stores owned Blob assets. At most 20 eligible drafts are attempted per run; excess drafts wait for the next full collection.

## Receipt and transaction boundaries

Publication requires the exact accepted full snapshot hash, its current scope baseline and a collection timestamp within 36 hours. Replays of older snapshots cannot publish. Images are prepared before the transaction; each property's final checks, content/status changes, sync-field provenance, change events and audit log commit under the shared MLS advisory lock and properties write lock. Media preparation failure leaves the property draft. A partial publication failure is recoverable: rerun the same fresh accepted request; already public properties are skipped. Blob/media records may remain after a failed transaction and are reused by the established media layer.

Collection acceptance/baseline and per-property publication are separate outcomes. Publication failure never rewrites an ingestion receipt to pretend the collection failed. The workflow uploads publication.json separately, including any partial results, and reports published/held counts. Private reports identify the property and hold reason.

## Activation

Existing private repository, branch, database-host and apply gates remain required. Add the existing production BLOB_READ_WRITE_TOKEN as a GitHub Actions secret of the same name; only the gated publication step receives it. DATABASE_URL_UNPOOLED is scoped to the two gated apply/publication steps. No schema migration or schedule change is required. Shadow collection never uploads or publishes.

Commands:

- npm run test:property-sync:python
- npm run test:property-sync:daily
- node --env-file=../audit-20260905/.env.astra-disposable --test --test-concurrency=1 src/lib/mls/daily-publication.db.test.mjs src/lib/mls/daily-publication-next-ingestion.db.test.mjs
- node scripts/mls/publish-daily-listings.mjs --payload <accepted-request.json> --report <publication.json>

The last command applies changes and requires both production-target verification variables and the Blob token. Use the normal daily workflow to collect and accept a new complete snapshot first; do not edit frozen requests to add enrichment.

## Rollback

Revert the workflow publication command to stop future automated publications while preserving collection. Do not blanket-unpublish inventory: use the daily-reviewed-publication-v1 audit entries and their before/after snapshots to select affected properties, verify no subsequent staff edits, and restore through the admin lifecycle. Existing IDs and public aliases are preserved. No schema rollback or asset deletion is necessary.

## Verification and remaining activation gate

Executed: 67 Python tests, 69 shared ingestion tests, 16 daily publication/workflow tests; focused PostgreSQL publication and next-ingestion tests passed on the approved disposable branch. PostgreSQL coverage includes receipt freshness, dry-run, failed-media recovery with successful-photo reuse, rollback on audit failure, staff override hold, idempotent replay and description preservation. Typecheck and focused lint passed. Live read-only verification of R075856, A059642 and A069815 found six gallery photos each and matching company IDs/rents.

A broader legacy database suite was attempted but not claimed passing: its setup lacked main's promotion-tier migration, and overlapping shared locks interfered with isolated tests. Verification was completed with serial focused real-SQL tests that include the required migrations. No production inventory writes were performed.

Automatic approval review rejected copying the production Blob token to GitHub. BLOB_READ_WRITE_TOKEN still needs explicit authorization/configuration before enabling this change on main. The code must not be described as live until that gate and merge are complete. Existing collection baseline is pinned before publication, so publication failure cannot lose an accepted collection baseline.
