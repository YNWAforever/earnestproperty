# Blog CMS release v2 — isolated rehearsal evidence

- Candidate: `feat/blog-cms-release-v2` @ `d231d640` (rebuild of PR #302 + #303 on top of
  current `main`, plus the deploy gate from #306 and three incident fixes).
- Rehearsed: 2026-11-08, Windows local, Docker `29.8.1`, owned containers only.
- **Production is untouched.** No production migration, import, deploy or provider change
  is included or implied by this document.

This file replaces the missing evidence that PR #303 itself recorded as `NOT_RUN` /
`BLOCKED`. It exists because the 2026-11-06 incident happened precisely because the code
shipped without it.

## 1. Exact migration identity (final bytes)

Committed bytes, LF (what a Linux/Vercel build applies):

| Migration | `git` blob (sha1) | sha256 (LF) | bytes |
| --- | --- | --- | --- |
| `20261105120000_blog_presentation_contracts.sql` | `3b40a2d1b76a888b8f0b06eff00746415d2d5b4a` | `65aa7d481168475550406939381bf37e888ed64d24152580de62d29368e79606` | 6942 |
| `20261105140000_blog_repository_mutations.sql` | `3245ebcb67c67cc96bba4c627bf87ef5c6bf4909` | `f4ec7400d043f688bf3d69b3e8090483fc2250fd6b9dafb6d16bfe0b91c2a895` | 29227 |
| `20261105160000_blog_import_receipts.sql` | `be8f6198dc198f796037c81916c47c330ad2e562` | `fafb9086445f35aee472db4b716c029d969b50ce07797b7f7c9c4ee23ad72e5f` | 846 |

Repository `MIGRATION_VERSIONS` count at this candidate: **98**. Production
`app_migrations` count: **95** (last applied
`20261026210000_corridor_estate_editorial_quality.sql`).

### Why this matters

The only rehearsal PR #303 recorded used different bytes for two of the three files:

| Migration | rehearsed (PR #303 packet) | this candidate |
| --- | --- | --- |
| `...120000_blog_presentation_contracts.sql` | `696695496d08…` | `65aa7d481168…` |
| `...140000_blog_repository_mutations.sql` | `95ad01f2d284…` | `f4ec7400d043…` |
| `...160000_blog_import_receipts.sql` | `fafb9086445f…` | `fafb9086445f…` (identical) |

So the rehearsal below is the **first** time the exact merged bytes were exercised
end to end. Treat the old packet's schema fingerprint as superseded.

## 2. Environment

| Item | Value |
| --- | --- |
| Rehearsal database | throwaway owned Docker container, `pgvector/pgvector@sha256:2547711f871f5d4c02b2dfc7ff86f3eddc438d00a23854cd449513f4ef1af79b` (PostgreSQL **18.6**, `linux/amd64`) — the same pin PR #303 specified for production parity |
| Second pin also present | `pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0` (PostgreSQL 17, used by the default harness) |
| Connection | loopback-only, full random container id, harness-generated name; the harness refuses any `DATABASE_URL*` in the environment and loads no dotenv |
| Schema build | the **real** `neon/migrations/*.sql` files applied in order (`scripts/acceptance/migrated-schema.mjs`), not hand-copied tables |
| Cleanup | every container removed by the harness; no container left running |

## 3. Commands and results

All run from the candidate checkout with `DATABASE_URL` / `DATABASE_URL_UNPOOLED` cleared.

### 3.1 Full blog DB suite (default harness, PG17 pin)

```
npm run test:blog-cms:db
```

Result: **6 pass, 0 fail** (`63.67s`), covering:

- `PASS 23 owned PostgreSQL groups; real request auth, no external target`
- `PASS blog schema: preservation, integrity, independent scopes, slug locks, CMS projection/authority/rollback`
- `PASS real sessions: admin/manager publication, agent private draft, anonymous/viewer/revoked denial and role spoof rejection`
- `PASS atomic published Save, dates, rich metadata, links and original replay result`
- `PASS atomic rollback includes draft, publication, audit and request receipt`
- `PASS concurrent identical request creates exactly once; changed action rejected`
- `PASS locked/reserved slugs, invalid rich data and legacy routes cannot bypass`
- `PASS feature picker uses published category title and date while editing retains private drafts`
- `PASS settings/category dual CAS and publication authority`
- `PASS future dates stay exact and are ineligible for features`
- `PASS stable page 3 of 101, counts/search/category/state and own draft privacy`
- `PASS public readers and registry suppression exclude future and withdrawn entries`
- `PASS anonymous eligibility treats unknown, draft, withdrawn and future slugs alike`
- `PASS failed reads return typed unavailable, never empty success`
- `PASS rich document round-trip and historical restore pairs legacy content/format while preserving omitted links`

### 3.2 Import rehearsal on the production-parity pin (PG18.6)

```
node scripts/test-blog-import-db.mjs --pg18
```

Result: exit 0, **9 owned import DB groups**, including the one that matters most:

> `PASS 112 deployed registry articles and 7 categories/8 settings import with exact copy and feature scope`

plus:

- `PASS explicit identity, backup and approval gates`
- `PASS atomic import creates matching locked live/revision, null date, links and editorial metadata`
- `PASS lost-response retry resumes committed checkpoint with zero duplicates`
- `PASS Task4 CMS tokens edit imported article without first-publish/date fabrication`
- `PASS all revisions including another actor draft-only identity block static collision`
- `PASS freshness detects intervening version/history/source changes before any write`
- `PASS database failure rolls back article/revision/checkpoint; same manifest can resume`
- `PASS unpublished imports retain draft-only behavior with Task4 edit tokens`

### 3.3 Feature-order rehearsal on the production-parity pin (PG18.6)

```
node scripts/test-blog-import-feature-order-db.mjs --pg18
```

Result: exit 0 — `PASS fresh reconciliation preserves reverse-ID editorial feature order in all three scopes`

### 3.4 Non-DB suites on the candidate

| Suite | Result |
| --- | --- |
| `npm run test:blog-cms` | **95 pass, 0 fail** (8 files) |
| `npm run test:blog` | 34 pass / 1 timeout on the 112-article contract at the 5 s default; passes in isolation and with `--timeout 30000` (12 pass). Local-machine flake, not a regression — the files are untouched by this candidate. |
| `npm run test:cms` | 12 pass, 0 fail |
| `npm run test:control-plane` | 179 pass, 0 fail |
| `node --test src/routes/sitemap.contract.test.mjs src/routes/estate.district-driven.contract.test.mjs src/routes/blog.routes.test.mjs` | 26 pass, 0 fail |

## 4. What this rehearsal does and does not prove

**Proven (owned, isolated):**

- The three migrations apply cleanly, in order, to the real 95-migration baseline schema
  and produce a working blog schema.
- The 112 registry articles and 7 categories / 8 settings import atomically with exact
  copy and feature scope.
- Repository auth, CAS, rollback, idempotency, feature eligibility and public-read
  filtering behave against real PostgreSQL.

**Not proven here (still owner-gated):**

- That production Neon accepts the migration (needs a fresh snapshot, an isolated restore
  proof and the production execution window).
- Hosted acceptance: real Vercel build, real sessions, CDN behaviour, hosted `test:a11y`.
- The signed release packet (`authority.json` / `credential.json` / `active-fence.json`
  under `C:\ProgramData\Earnestproperty\blog-release`), which does not exist on this
  machine.
- Writer-fence activation and per-writer denial proof.

## 5. Production sequence (owner-run, not executed)

The new `prebuild` gate makes the ordering safe by construction: until
`app_migrations` = 98, a production build of this candidate **fails**, and the previous
working deployment keeps serving.

1. `[RO]` Confirm baseline: `app_migrations` = 95, `articles` = 0, `check:migration-drift`
   reports exactly these three pending.
2. `[WP]` Fresh Neon snapshot / confirm PITR window.
3. `[WP]` Apply the three migrations during a quiet window
   (`npm run neon:migrate`, run from a Linux checkout so the LF bytes above are the ones
   applied), then `check:migration-drift` → exit 0 with 98.
4. `[RO]` Verify: 6 `blog_*` tables, 14 `blog_*` functions, `articles` = 0,
   `blog_settings` has the seeded main row.
5. `[WP]` Import the 112 articles with the same manifest/source bundle used in §3.2.
6. `[RO]` Verify: `articles` = 112, all 112 slugs unchanged, `/blog` 200 with 7 category
   chips, `/sitemap.xml` contains 112 `/blog/` URLs, `/estate/<slug>` 200.
7. `[WP]` Merge this PR → Vercel builds; the gate now passes and the deploy proceeds.
8. `[RO]` Post-deploy: `/blog`, `/blog/<slug>`, `/estate/<slug>`, `/estate-reviews`,
   `/sitemap.xml`, admin articles tab list + save.

**Stop conditions:** any 5xx, `articles` ≠ 112, any changed slug, or a `cms_mutate`
regression on estates/videos/FAQs/media → keep the current deployment, restore the
snapshot, do not retry blindly.
