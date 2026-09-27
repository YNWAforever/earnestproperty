# Earnest Property rollout and rollback

State: source branch, PR-triggered Vercel preview and isolated staging schema expansion only. The five additive migrations were applied to branch br-young-breeze-ao85rtx1; no staging application deployment, production deployment/migration/data update or external message send was performed.

1. Verify the PR and isolated SQL/browser results before staging. Keep the existing tracking codes and immutable versions readable.
2. Apply only additive batch schema in an isolated staging database, then deploy compatible code. Preview exact legacy rows before any backfill; any uncertain placement remains for manual review.
3. Test one synthetic property/source and one verified staff destination. Keep Inbox assignment, private note, staff phone acceptance and device delivery as separate evidence.
4. Production release requires a distinct authorization. Start with one designated colleague and one test placement, then expand only after delivery is verified.

Rollback: turn off new batch entry points and staff notification dispatch with the existing service switch; revert application code while retaining batch operation records, old link codes and attribution. Do not drop a table containing operation results. For content, restore documented revisions. Cache rollback must purge public entries without republishing withdrawn listings. Reconcile unknown provider sends before retry.

## T04 additive receipt schema

Apply `neon/migrations/20260927080000_staff_notification_receipt_times.sql` to the isolated staging database before deploying the code that reads those columns. It adds nullable evidence timestamps and sources; it does not send messages or backfill claims. Verify that old attempts remain readable and that one synthetic accepted, delivered and read sequence retains three distinct times. For rollback, disable staff notification dispatch, revert application code, and retain the new nullable columns and evidence. Dropping the columns would destroy receipt history and is not part of the ordinary rollback.

## T05 test-notification schema and controls

Apply `neon/migrations/20260927083000_staff_notification_test_attempts.sql` after the T04 receipt migration in isolated staging before enabling the new wizard code. It creates purpose-specific previews and attempts; it does not enqueue any test on migration. Configure a synthetic Inbox member only if its thread is independently verified and has no customer conversation. A real colleague send requires the T13 manifest and explicit submit. For rollback, hide the test UI and stop the test job capability; retain attempts and unknown outcomes for reconciliation. Do not delete test history or replay uncertain sends.

## T06 batch schema

Apply `neon/migrations/20260927090000_whatsapp_link_batch_operations.sql` only to an isolated staging database after the existing tracking-link and staff-reference schema. Check the function and the 50+10 fixture before enabling the batch UI. The migration adds preview, operation, row and placement tables plus a commit function; it leaves legacy links and attribution intact. No historical placement metadata is backfilled automatically. To roll back code, disable new batch entry points and retain operation records and placement keys for reconciliation. Preview exact legacy rows before any later metadata backfill; ambiguous candidates require a human decision.

## T07 link management schema

Apply `neon/migrations/20260927093000_whatsapp_link_management_indexes.sql` in isolated staging after the tracking-link and T06 schemas. It adds read indexes and short-lived export snapshot tables. Run a 650-link paging/export fixture and verify an expired reference can be disabled before enabling the new UI. On code rollback, keep snapshots until their expiry and retain immutable link versions; no link code rotation or attribution rewrite is needed. Expired snapshots are purged in bounded batches during later export requests.

## T12 rate bucket schema

Apply `neon/migrations/20260927100000_whatsapp_redirect_bucket_retention.sql` after the four earlier 2026-09-27 migrations and before exposing the new redirect load. It adds a window-start index only; it neither changes tracking codes nor sends messages. The redirect uses 32 fixed global shards and one bucket per registered link. Operations health shows the effective bounded limits. The old `whatsapp_link_rate_buckets` table remains readable, and a bounded cleanup removes only counters older than one day during active traffic. On code rollback, retain the index and counters; revert the limiter code to the previously deployed version and reconcile any `untracked` overload periods from logs, never reconstruct attribution from clicks.

## Staging sequence and gates

1. Confirm a verified **isolated** Neon branch and deployment/DB regions. Capture current migration versions, policy version, existing link code/version reads and attribution counts. Do not use production data or credentials for automated fixtures.
2. Expand the isolated schema in order: `20260927080000_staff_notification_receipt_times.sql`, `20260927083000_staff_notification_test_attempts.sql`, `20260927090000_whatsapp_link_batch_operations.sql`, `20260927093000_whatsapp_link_management_indexes.sql`, `20260927100000_whatsapp_redirect_bucket_retention.sql`. Check migration drift and existing link/attribution reads after each step. The migrations are additive; no historical attribution or version is rewritten.
3. Deploy the reviewed code to staging with provider dispatch and bulk publish controls off. Run the guarded Neon DB suites with its verified branch identity, then test canonical A074714/SYNC, sale/rent/withdrawn precedence, expired disable, 650-link pagination/export, 60-row 50+10 lost-response recovery and multi-connection batch concurrency. Verify old links continue to resolve and the prior code can still read the expanded schema.
4. Preview exact legacy placement rows and record ambiguous candidates for manual review. Only after review, run a small controlled metadata backfill with operation IDs and pre/post counts. Do not backfill or rotate immutable link versions or EPWA references. If a batch fails, stop, reconcile its durable result and restore that batch's metadata from its preview; retain operation evidence.
5. Run authenticated desktop/mobile/keyboard browser journeys with synthetic staff fixtures. Measure five warm and separate cold samples from Hong Kong on homepage, listing after redirects, detail and staff screens. Record regions, TTFB, DB/SSR timings, request count, transferred bytes and remote property-photo size. Run `EXPLAIN (ANALYZE, BUFFERS)` on canonical/count/page queries before indexes or caching. Run >300/minute normal campaign, single hot link and simultaneous-campaign load only on this isolated staging setup under two bounded limiter configurations.
6. Complete the private recipient manifest and verify provider template JSON and endpoint isolation. Submit one explicit test to one designated colleague, using one test handset and one current link; keep Inbox private note and staff WhatsApp evidence separate. Do not expand notifications or placement publishing on provider acceptance alone. Require signed delivery/handset confirmation, then verify the colleague's work-item response before any wider pilot.

The verified nondefault staging branch br-young-breeze-ao85rtx1 is in aws-ap-southeast-1, and its five additive migrations are applied; see 2026-09-27-staging-migration-evidence.md. Its inherited parent-data snapshot is not a synthetic test fixture. The supplied PR Preview URL is not a verified staging application: it has production Neon Auth and `NEON_BRANCH=production`, while its database connection hosts are redacted. No authenticated synthetic browser fixtures were supplied, and the user confirmed that the staff WhatsApp endpoint and approved tenant template have not been created. The user confirmed Willy Lai is staging staff account 72285986-c82c-46bd-98d9-c6b021d91b0d. Staging steps 3–6, backfill, live message and production release remain pending. No manual or production deployment, production migration, production data/config change, backfill or real message was performed.

## Rollback decisions

- Public listing/search/CTA: revert code; preserve canonical identity records and current offering precedence. Do not republish withdrawn stock.
- Bulk creation/management: disable new entry points, return to the prior UI/API code, retain additive tables, operation results, immutable link versions, export snapshots and old tracking codes. Reconcile any uncertain chunk by its operation ID before another submit.
- Staff notification: use the existing dispatch kill switch, keep provider `unknown` and signed receipt history, and investigate each uncertain attempt before any manual resend. Do not infer delivery from provider acceptance.
- Rate limiter: revert code while keeping the harmless retention index; review overload logs and public fallback impact. Generated static image variants can remain, or revert the manifest and assets together.
- Content: restore a documented approved revision after source-owner review; no CMS source data was changed by this branch. No public cache or region move was introduced, so neither needs a purge/move rollback.

Production deployment, migrations, live message send and broad activation require separate execution authority after PR review and staging evidence. The remaining operational inputs are exact, not a general request to proceed: a verified isolated Neon branch/region, staging URL and auth fixtures, one designated colleague plus verified Inbox/phone endpoint and test handset, and the tenant's approved template contract for an outside-window send.
