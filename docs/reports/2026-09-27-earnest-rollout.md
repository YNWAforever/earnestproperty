# Earnest Property rollout and rollback

State: source branch only; no deployment, production migration, data update or external message send authorized by this implementation request.

1. Verify the PR and isolated SQL/browser results before staging. Keep the existing tracking codes and immutable versions readable.
2. Apply only additive batch schema in an isolated staging database, then deploy compatible code. Preview exact legacy rows before any backfill; any uncertain placement remains for manual review.
3. Test one synthetic property/source and one verified staff destination. Keep Inbox assignment, private note, staff phone acceptance and device delivery as separate evidence.
4. Production release requires a distinct authorization. Start with one designated colleague and one test placement, then expand only after delivery is verified.

Rollback: turn off new batch entry points and staff notification dispatch with the existing service switch; revert application code while retaining batch operation records, old link codes and attribution. Do not drop a table containing operation results. For content, restore documented revisions. Cache rollback must purge public entries without republishing withdrawn listings. Reconcile unknown provider sends before retry.
