# 2026-11-06 — code deployed ahead of its schema

**Impact:** `/blog` and all 112 `/blog/<slug>` URLs, all 62 `/estate/<slug>` pages,
`/estate-reviews` and `/sitemap.xml` returned 500/503 for ~2 days. The admin
articles tab failed on mount with a misleading "operation not completed, changes
retained, retry" message. No data was lost; production Neon was never modified.

## What happened

| Time (SGT)           | Event                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-05           | Blog CMS implementation merged into `codex/blog-cms-release` with three new migrations (`20261105120000`, `20261105140000`, `20261105160000`). |
| 2026-11-06 20:11Z    | PR #302 merged to `main` (`1d38be96`). PR body said merge/deploy/production DB changes were **NOT_AUTHORIZED**.                                |
| 2026-11-06 20:11Z    | The `Migration drift` workflow ran on that push and **failed** — 3 pending migrations.                                                         |
| 2026-11-06 20:12Z    | Vercel deployed the same commit to production anyway.                                                                                          |
| 2026-11-08 07:18Z    | PR #303 merged (`29d5f47d`) — release-gate tooling only, still no migration. Vercel deployed again.                                            |
| 2026-11-08 15:51 SGT | Production promoted back to the last pre-#302 deployment (`8b49d0a2`). Blog, estate pages and sitemap restored.                                |
| 2026-11-08 17:02 SGT | PR #304 reverted both merges on `main`; PR #305 re-landed the four unrelated fixes that had been bundled in.                                   |

## Root cause

The new code queried tables and functions (`blog_categories`, `blog_settings`,
`blog_require_actor`, `blog_article_document`, …) and columns (`articles.category_id`,
`articles.editorial_metadata`, …) that did not exist. Postgres raised
`42P01` / `42703` / `42883`; the blog error mapper collapsed those into
`BLOG_UNAVAILABLE` (503); the admin client had no 5xx branch and rendered the
generic "retry" copy.

But the schema mismatch was only the mechanism. The **process** failure was that
nothing connected "this code needs that schema" to "the database does not have
it" before traffic reached the new build:

1. `npm run build` never checked the live schema.
2. The drift workflow ran on **push to main** and only **reported** — it went red
   on the merge commit while Vercel created the deployment 84 seconds later.
3. The health check is pull-based (`/admin/operations`), so nobody looked.

## What now prevents a repeat

- **`scripts/neon/build-migration-gate.mjs`** runs in `prebuild`. On production
  Vercel builds it diffs `MIGRATION_VERSIONS` against `app_migrations` and
  **fails the build** when the database is behind, leaving the previous working
  deployment serving. Previews warn; local/CI builds skip. Deliberately fails
  _open_ when the database is unreachable — a Neon outage must not also freeze
  deploys. Override: `MIGRATION_DRIFT_GATE=warn|off`.
- **`.github/workflows/migration-drift.yml`** now also runs on `pull_request`, so
  drift is visible before merge. Add it as a required status check on `main` to
  make it blocking.
- Re-introducing the blog CMS still requires the gated release (migrations +
  article import in one transaction) documented in the PR #303 release packet.

## Rules for the next change that needs new schema

1. Apply the migration **before** the deploy that needs it, or ship both behind a
   flag.
2. Never bundle unrelated fixes into a release branch — the rollback had to give
   them back and re-land them separately.
3. Optional content must not fail a page: a "related articles" lookup should not
   be able to 500 an estate page, and one sitemap source should not 503 the whole
   sitemap.
4. Error copy must distinguish "your change is at risk" from "the server is
   broken". `BLOG_UNAVAILABLE` is not "重試，修改已保留".
