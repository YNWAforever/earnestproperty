# Final remediation rollout and recovery

**State, 2026-09-28:** PR #203 is merged and production deployment `382bc7541c2c30eba40e47883b625a50b45fb795` is ready. The nine additive migrations in section 2 were applied to the approved Neon production branch. There is still no staging URL, Haze test tenant or consenting recipient. No provider test message was sent, feature switch enabled or further deployment made. After a signed-in refresh, the user reported that the migration warning cleared. The raw authenticated health response and full production smoke were not independently captured. The remaining steps below are a runbook, not evidence that those checks happened.

### Production schema change recorded on 2026-09-28

- Target: Neon project `dawn-meadow-79190048`, branch `production` (`br-polished-sea-aom4i1ct`), database `neondb`, endpoint `ep-divine-frost-aokzrg7f`. The database itself attested its branch and endpoint before the write.
- Dry run: disposable branch `earnest_audit_acceptance_20260928` (`br-hidden-sunset-aookjknk`) was copied from production. All nine migrations applied there in order; the application drift check reported 69 of 69 versions recorded.
- Restore point: branch `earnest_pre_final_fixes_20260928` (`br-divine-pine-ao49ud9d`) was copied from production immediately before the migration at parent LSN `0/23B94578`. It has no compute. Preserve it until the rollout is reviewed; restoring it over production would require a separate assessment of subsequent writes.
- Production result: the repository migration runner skipped 60 existing versions and applied exactly the nine files listed in section 2. Its read-only drift check reported 69 of 69. An independent Neon query confirmed the branch identity, nine new version rows and the expected new tables. Running the merged source's read-only health function locally against this verified branch reported `database.tables` healthy (7/7), `database.columns` healthy (20/20) and `database.migrations` healthy (69/69). The public `/admin/operations` route returned HTTP 200.
- Limit: the route's HTTP 200 response is unauthenticated and does not prove that its protected health panel cleared. Vercel exposes the production database variable names but withholds their sensitive values from the local read-only environment pull, so the live deployment's exact connection URL was not independently read. No authenticated post-migration health request was observed in the available Vercel logs at the time of the initial check. The user subsequently reported that the migration warning cleared after a signed-in refresh.

## 1. Freeze target and evidence

Record the commit SHA, intended Neon project, exact database name, branch ID, endpoint ID, staging URL, fixture owner, backup/snapshot ID and operator before running any migration or provider check. Use a disposable branch/database whose name matches the repository's `earnest_audit_acceptance_YYYYMMDD` guard. Set the test confirmation and exact branch ID only after inspecting that target. Keep secrets in the deployment environment; do not put them in the runbook, CSV, logs or commits.

For the T17 evaluator, create the following registry only inside the disposable database and seed one row per documented fixture ID with the same unique owner label:

```sql
CREATE TABLE acceptance_fixture_registry (
  fixture_id text PRIMARY KEY,
  owner_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

The evaluator reads this table; the fixture loader must record ownership after it creates the actual synthetic rows. The registry alone is not a substitute for the fixture data.

Run the existing schema inventory and pending-migration check against that isolated target. Verify current `app_migrations` rows, table/column existence, FK counts and a pre-change row-count snapshot. Preserve an actual restore point before any write. Compare the app at the prior commit against the expanded schema, then compare the new app against the fully migrated schema.

## 2. Expand schema, in repository order

All nine migrations are additive; inspect each SQL file and the resolved target before applying. The repository migration runner records versions in `app_migrations`. The pending list is:

1. `20260927110000_staff_mapping_review_versions.sql`
2. `20260927120000_named_inbox_folders.sql`
3. `20260927130000_staff_notification_test_evidence.sql`
4. `20260927140000_whatsapp_link_reference_scope.sql`
5. `20260927150000_whatsapp_link_batch_mapping_guard.sql`
6. `20260927160000_transaction_sales_attribution.sql`
7. `20260927170000_performance_event_quality.sql`
8. `20260927171000_inquiry_quality.sql`
9. `20260927172000_media_asset_variants.sql`

For each stage, confirm the version row exactly once, constraints and FKs, old and new row counts, and the relevant embedded/isolated DB tests. Keep legacy mapping evidence and transaction rows; unknown attribution remains unknown. Do not rewrite historical commission or fabricate event quality. The original media URLs remain available. No destructive down migration is part of rollback; a data correction needs a separate, reviewed compensating migration.

## 3. Verify and enable by capability

| Capability | Initial gate | Pilot evidence required before wider use |
| --- | --- | --- |
| Staff directory and Folder | Tenant and Channel configured; provider exact-user and named-Folder readback | Haze local staff, Inbox user, Folder access and version-bound review evidence |
| Strict staff routing | Per-staff reviewed mapping stays disabled until its own evidence is complete | Assignment, private-note and staff-phone capabilities checked independently; unknown/failed receipt does not imply delivery |
| Batch link import | Actor role, source-scoped staff reference, preview token and 50-row commit guards | 1/50/300/1,000 preview fixtures; 60-to-59 eligible subset; reconnect recovery without duplicate commit |
| Website link coverage | Exact sale/rent current-offer denominator and explicit preview | Missing/conflicted rows reviewed; small backfill committed only after confirmation |
| Sales performance | Attribution migration and source event projection complete | Scoped totals reconcile to transaction/detail rows, 60/40 credits, null commission and unknown/test/spam coverage |
| Responsive media | Always on since FX-15; exact owned Blob host allowlist for the backfill | Dry-run and limited checkpointed backfill, real WebP response bytes/dimensions and mobile `currentSrc`/layout checks |

The four build-time UI switches were removed in FX-05a (2026-10); the screens are always available and server checks remain the boundary. Responsive photo variants have no switch since FX-15 (2026-10): pages attach ready variants whenever they exist and use the original URL otherwise, and the daily sync makes variants for each new owned photo. A variant failure never blocks a listing or drops its original photo.

Backfill existing photos (Owner action 5, production writes, owner only). On your machine, with production `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN` and `MLS_OWNED_BLOB_HOSTS=<the Blob host, e.g. sehe3hq90qgbyxqa.public.blob.vercel-storage.com>`:

1. `node scripts/media/backfill-remote-variants.mjs` (dry run, the default; SELECTs only) prints `dbHost`, `remaining`, `estimatedBlobWrites` (`remaining` x 5) and `estimatedStorageMb`. It stops with the migration name if `20260927172000_media_asset_variants` is not applied.
2. Check those numbers against your Vercel Blob plan's monthly operation and storage limits on the Usage page. Each photo adds about 0.2 to 0.4 MB across its variants.
3. `node scripts/media/backfill-remote-variants.mjs --apply --limit=50 --confirm-db-host=<host part of DATABASE_URL>`. The host must equal the `dbHost` the dry run printed, or the script refuses before any query. Repeat until `remaining` is 0. The checkpoint `.cache/media-variant-backfill.json` resumes where it stopped, a rerun skips finished photos, and the first failure stops the batch with the asset ID, without touching the original photo or any listing row.
   If a batch stops on a source error (`Owned source read failed`, `Image source hash mismatch`, `Invalid or oversized image`, a size limit), rerun the same command with `--skip-failed`. Skipped photos are logged with a reason, the run ends with exit code 1 and a `skipped` list, and you send those IDs to the developer. Write errors (Blob or save) still stop the run with their reason.
4. Finish with one dry run on a fresh checkpoint: `node scripts/media/backfill-remote-variants.mjs --checkpoint=.cache/final-check.json`. Confirm `remaining` is 0. Anything left is a photo narrower than 160 px (no variants needed), a skipped photo, or one added during the backfill; rerun step 3 with that checkpoint for the last case.
5. Spot check: a property page's `img` now has a `srcset`.

Undo: none needed. Pages use the original URL whenever a variant set is missing. The script never prints `DATABASE_URL` or the Blob token, only the host.

## 4. Acceptance before any live change

Run the repository's named local suites, typecheck, lint and build. On the disposable target, run the guarded DB suites and authenticated browser journeys, record target identity and SHA, inspect SQL plans on 10k/100k event fixtures, and fill the performance evidence file described in `docs/reports/final-remediation-performance.md`. An exit code of zero with skipped cases is not approval.

For Haze, use the specific test card in `docs/runbooks/whatsapp-staff-onboarding.md`. Confirm recipient consent, test conversation and destination before the first send. Preserve assignment, provider acceptance, signed delivery receipt, manual recipient confirmation and acknowledgement as different evidence. Do not resend an unknown outcome. No production smoke should create arbitrary messages.

## 5. Production gate and smoke checklist

Only after the isolated evidence is reviewed: record a fresh production backup/restore point, apply the reviewed expand migrations, deploy the exact tested SHA, and verify configuration. Check public listing date and public-number search, six contextual CTAs, listing/detail breadcrumb and SEO copy, Haze readiness without a send, dashboard inventory count, report filters/detail totals and original-image fallback. Record actual deployment SHA, environment, sample IDs, timestamps and pass/fail evidence. A production-verified label requires those observations.

## 6. Stop and recover

If schema or data checks fail, stop pending migrations and new work. If UI or report behavior fails, revert the deployment, disable the media flag as applicable, pause new batch/notification jobs and return to the last compatible app revision after checking its compatibility with the expanded schema. Preserve additive columns, mapping evidence, link/audit rows and original media. Do not drop new tables as a reflex, erase history, replay a provider send, or reissue an unknown batch chunk. For a wrong committed link or attribution, use the existing reasoned correction/retirement flow or a reviewed compensating migration. Restore a snapshot only after determining that it will not erase legitimate writes made after it.

## Open handoff gates

- Disposable Neon migration dry run and pre-change restore branch: recorded above. An isolated browser target, named acceptance database and owned fixtures remain unavailable.
- Haze tenant, exact Folder/user capability readback, test conversation and consenting recipient: unavailable.
- Actual baseline/revised load measurements, SQL plans, browser currentSrc/Core Web Vitals and full production smoke: unverified. The user reported that the signed-in migration warning cleared, but the raw authenticated health response was not independently captured.
- Production schema migration: completed as recorded above. The merged production deployment predates that migration; no later deployment, provider send or feature-switch change was performed.

See `docs/runbooks/final-remediation-operations-zhHK.md` for the staff operating guide, `docs/reports/2026-09-27-final-fixes-ledger.md` for each finding and local tests, and `docs/reports/final-remediation-results.json` for the explicit performance skips.
