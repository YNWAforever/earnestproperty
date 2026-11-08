# Live access check — 2026-11-05

Read-only verification in response to the user's explicit request to verify binding/access and collect inventory. No roles, grants, schema, content, deployments or Git remotes changed.

## Application binding

The deployed source at `8b49d0a21c867c401c4d41db393e43c8db76a74d` uses `DATABASE_URL_UNPOOLED || DATABASE_URL` (`src/lib/neon/db.server.ts`). Vercel deployment metadata for `dpl_CdBSXxdBMMjY6muGmCU6wkxktdY5` lists both environment names, but only names, not resolved endpoint values.

The scoped Vercel API returned production setting metadata for `DATABASE_URL_UNPOOLED`: type `sensitive`, createdAt `1782061668451`, updatedAt `1787239214352` (before deployment createdAt `1793625303629`). Its sensitive value was not returned as a parseable URL. No credentials were printed or saved. Stable timestamps support configuration continuity but do not establish its hostname/database contents.

The candidate backend is project `dawn-meadow-79190048`, branch `br-polished-sea-aom4i1ct`, endpoint `ep-divine-frost-aokzrg7f`, database `neondb`. This database name is now directly verified by SQL; its binding to the public application still needs independent evidence or explicit owner confirmation.

## Directly verified session controls

Using the explicitly selected project/branch/database, the connector successfully executed only catalog/session reads inside a transaction beginning with:

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10000ms';
```

The `neondb_owner` session reported database `neondb`, `transaction_read_only=on`, `transaction_isolation=repeatable read`, `statement_timeout=10s`.

The existing `migration_monitor` login also connected successfully with read-only repeatable-read settings. Catalog privilege checks show SELECT on `app_migrations`, but no SELECT or write privileges on `articles` or `cms_content_revisions`. These two tables have RLS disabled. Consequently, this limited login cannot collect article content. No GRANT, role creation, or trial DML was attempted.

The owner connection is a privileged login even inside a transaction that enforces read-only SQL. It must not be described as a dedicated least-privilege reader. The user was asked to confirm use of this existing connection with enforced read-only transactions, or require a dedicated login.

## Schema metadata

Read-only catalog inspection found legacy `articles`, `cms_content_revisions`, and `app_migrations`. New blog presentation tables were absent among the inspected names. Articles lack the new version/content-format metadata. Legacy revisions include all-state/private-draft metadata fields, including `draft_edit_version`, `draft_retired_at`, and `browse_created_at`.

This is a schema observation, not an article inventory. No article bodies, revision payloads or live counts were collected during these access checks. Missing schema will remain explicit in capture/reconciliation; it will not be installed to make the collector succeed.

The limited reader can inspect the migration ledger: 95 applied entries; latest `20261026210000_corridor_estate_editorial_quality.sql`. A prefix-aware check of all three proposed `20261105120000`, `20261105140000`, `20261105160000` versions returned zero installed entries. This supersedes older migration-count memories; it does not establish article/revision counts.

## Execution gate

Database content collection remains pending exact binding confirmation and an approved existing access path. Public/source capture and owned-fixture collector tests can proceed independently. Named release owners remain a later release prerequisite, not a reason to modify production or expose credentials.
