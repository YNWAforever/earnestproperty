# No-Hermes property ingestion delivery — 2026-09-07

Implementation branch: `codex/property-sync-no-hermes-v2`, based on `b3c1929ab6e1758a6003d7b48c5a8e1c63163776`. Worktree: `.worktrees/audit-20260905`. No production migration, deployment, schedule/secret change, inventory deletion or real messaging was performed. Publishing remains disabled. Unrelated working-tree changes were preserved.

The original v2 specification is unchanged (SHA-256 `36075ecfbba247c7c8b3152d21366a2c28aa768b2b09ee52a4dfb3d8e579d164`). The handoff and original specification are checked in at their requested paths. WP0–WP5 code is implemented. Final independent review found two important transition defects; both were fixed and re-reviewed with no remaining important or critical finding. Publishing and live-source activation remain separately gated.

## Changed-file map

| Area                                   | Files                                                                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirements and mapping               | `docs/specs/28hse_propertyhk_scraping_merge_spec_no_hermes_v2.md`, `docs/codex/28hse-propertyhk-no-hermes-implementation.md`, `docs/mls-no-hermes-v2-mapping.md`                                                                            |
| Python workers and frozen HTTP replay  | `scripts/property-sync/{crawl_agent540,crawl_propertyhk,diff_agent540,sync_propertyhk,run_28hse_sync,run_propertyhk_sync}.py`, `scraping/worker.py`, requirements, fail-closed example configuration, labelled synthetic fixtures and tests |
| Validation and deterministic policy    | `src/lib/mls/{ingestion-contract,unit-identity,source-snapshot-gates,source-selection}.mjs` and declarations/tests                                                                                                                          |
| Atomic server ingestion                | `src/lib/mls/{ingestion-service,ingestion-repository}.mjs`, declarations, fixtures and real database tests                                                                                                                                  |
| Receiver and collected-snapshot bridge | `src/routes/api.admin.propertyhk-sync.ts`, `src/lib/mls/propertyhk-http.mjs`, `scripts/mls/apply-source-snapshot.mjs`, generated route registration and tests                                                                               |
| Additive schema                        | `neon/migrations/20260907120000_propertyhk_ingestion_v2.sql`, `src/lib/control-plane/migration-versions.js`, dedicated atomic migration helper and tests                                                                                    |
| Public read compatibility              | `public-source-metadata.mjs`, Neon public-data server/types, listing-search regression harness, MLS publisher status helper/route/tests                                                                                                     |
| Verification and operations            | `package.json`, `.github/workflows/ci.yml`, `src/test-wiring.test.mjs`, `.env.example`, migration-drift CLI guard/test, `docs/deployment/property-sync-no-hermes.md`                                                                        |

For the exhaustive committed list, run `git diff --name-only b3c1929ab6e1758a6003d7b48c5a8e1c63163776..HEAD` on this branch. Local evidence logs are not application inputs.

## Schema and policy mapping

Canonical offers remain in `properties`; existing observations, links, field state, runs, change events, UUIDs, public aliases, media and staff overrides are reused. `old_site` remains historical and distinct; wire `28hse` maps to `28hse_agent_540`. The additive migration supplies versioned policies, atomic receipts, accepted scope/source state, whole contacts, conflicts and matching reviews. Deferred foreign keys bind accepted evidence and full baselines to their receipts.

Source-ID lookup precedes creation. Complete exact estate/block/floor/unit identity and one compatible cross-source offer are required for matching. Same-source duplicates and identity corrections are held for review. Primary 28hse values win; approved Property.hk fallback is limited to missing gross area, saleable area and bedrooms. Source quoted unit-price conflicts remain evidence; public PSF remains derived. Unknown field ownership is held, not relabelled as a staff override. New rows remain drafts.

Every accepted receipt/state/projection/contact/conflict/event/baseline commits on one PostgreSQL session. Writers share the existing MLS lock and a persistent ownership fence. Exact replay precedes quota; SQL timestamps prevent stale reversal. A new full sync is limited to one per source/scope/hour. Incomplete traversal or a greater-than-30-percent drop prevents business writes. Partial success advances neither full baseline nor absence. Property.hk absence is disabled and cannot revive an inactive primary listing.

## Executed verification

These are observed results, not projected CI outcomes. Suites overlap; counts must not be added into a unique-test total.

| Command / scope                                                                                                                    | Actual result                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run test:property-sync`                                                                                                       | 58 passed, 0 failed, 0 skipped after final review fixes                                                    |
| `npm run test:property-sync:python`                                                                                                | 30 passed after final review fixes                                                                         |
| `node --env-file=.env.astra-disposable --test src/lib/mls/ingestion-service.test.mjs src/lib/mls/ingestion-repository.db.test.mjs` | 28 passed, 0 skipped, 312.3 seconds; real isolated transaction, rollback, concurrency and replay tests     |
| Isolated `ingestion-v2.db.test.mjs`                                                                                                | Passed; schema, public identity, overrides, ownership and deferred evidence constraints                    |
| Isolated `public-source-metadata.db.test.mjs`                                                                                      | Passed; real group-member and current-observation contact reads                                            |
| `npm run test:mls`                                                                                                                 | 603 passed                                                                                                 |
| `npm run test:control-plane`                                                                                                       | 95 passed                                                                                                  |
| `npm run test:cron`                                                                                                                | 5 passed                                                                                                   |
| `npm run test:listing-search`                                                                                                      | 75 Node + 12 Bun passed                                                                                    |
| `npm run test:admin-properties`                                                                                                    | 4 Node + 4 Bun passed                                                                                      |
| `npm run test:property-experience`                                                                                                 | 143 Node + 141 Bun passed                                                                                  |
| Test-script wiring guard                                                                                                           | 9 passed                                                                                                   |
| Focused ESLint on changed implementation/tests                                                                                     | Passed                                                                                                     |
| `npm run typecheck`                                                                                                                | Passed on integrated branch                                                                                |
| `npm run build`                                                                                                                    | Passed; local Vite/Nitro output generated, no deployment                                                   |
| Collected synthetic 28hse artifact through Node bridge dry-run                                                                     | Accepted 2 advertisements / 2 offers; null receipt; no DB application                                      |
| Property.hk default configuration dry-run                                                                                          | Expected fail-closed `id_scope_unverified`; no collection                                                  |
| `npm run check:migration-drift`                                                                                                    | Blocked: no `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in this invocation; not production drift verification |

DB evidence used only the approved disposable branch `br-quiet-hat-aoxbj2ue`, with unique isolated schemas. No production schema was applied. Detailed atomic evidence is in `../../.audit-20260905/wp3-report.md`. T01–T28 are mapped to Python, pure Node and real SQL assertions in `../mls-no-hermes-v2-mapping.md`; synthetic and DB coverage are explicitly distinguished.

## Repeatable local commands

From this worktree in PowerShell:

```powershell
python -m venv scripts/property-sync/.venv
scripts/property-sync/.venv/Scripts/python.exe -m pip install -r scripts/property-sync/requirements.txt
npm run test:property-sync
npm run test:property-sync:python
npm run typecheck
npm run build
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/run_28hse_sync.py --dry-run --synthetic-fixture
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/run_propertyhk_sync.py --dry-run --synthetic-fixture
node scripts/mls/apply-source-snapshot.mjs --payload <collected-request.json>
```

After injecting only the approved disposable `ASTRA_TEST_DATABASE_URL` and `ASTRA_TEST_BRANCH_ID=br-quiet-hat-aoxbj2ue` through the managed environment:

```powershell
npm run test:property-sync:db
```

The DB script deliberately skips without its explicit test connection and rejects an incorrect branch/production target. Do not interpret that skip as verification. Never paste credentials into commands or reports.

## Remaining prerequisites and rollback

The [deployment runbook](../deployment/property-sync-no-hermes.md) contains exact operator migration, policy, replay, scheduler and rollback commands. Activation requires separately approved additive migration/deployment, verified source configuration, reviewed shadow/bootstrap evidence, and one writer's ownership. None was activated here.

Still unverified: authorized Property.hk EPW/EPS/EPT URLs, DOM/detail/pagination fixtures, global versus branch-local ID semantics; live 28hse access/selector/full traversal parity; optional Crawl4AI browser runtime; real payload size, ingestion latency and deployed endpoint smoke test. No live selector, source licence or production-readiness claim follows from the labelled synthetic fixtures. Cloudflare deployment tests were not run because its deployment package was not changed.

Replay must retain the exact immutable request bytes/timestamp. Partial or dry-run responses never advance local full baselines. After an uncertain commit, replay recovers the persisted receipt. Rollback stops the new publisher/schedule and retains inventory, aliases, contacts and all history; legacy ownership must not be restored without a separate reviewed transfer.

A final repeat of the migration helper preview was rejected before execution by automatic approval because it did not establish an isolated database target and could be interpreted as database mutation. The helper's earlier local-only preview/unit evidence remains; no production migration was attempted.

## Final review corrections

The final review caught advertised totals still rejecting otherwise complete Python crawls, and previously selected Property.hk text surviving after primary arrival made that fallback ineligible. Advertised totals are now per-page diagnostics only; actual terminal and observed-ID checks remain. Explicit null removal applies only to previously source-owned nullable fields, records `no_authorized_source` provenance and preserves manual, diverged and unknown ownership. Required title/district are not cleared. New Python and real SQL regressions reproduced both failures before the fixes. Independent re-review accepted both corrections.

Final correction commit: `1b20afd`. After that correction, the affected real-DB subset passed 6/6 (five substantive cases plus their parent), 54.46 seconds: initial atomic creation, rollback, exact cross-source matching, manual/alias/absence protection, and both-arrival-order nullable clearing. Other cases were deliberately excluded in this follow-up; the earlier full 28-test result is separate evidence. Exact executed command:

```powershell
node --env-file=.env.astra-disposable --test --test-skip-pattern='bootstrap|replay before|stale timestamp|partial writes|identity correction|quota blocks|lost COMMIT|concurrent writers|Property.hk first|DB admin|unknown legacy|valid fractional|previously staged|existing source URL|partial-only|primary full absence|incomplete identity|default full-sync|conflict-ledger|server-owned district' src/lib/mls/ingestion-repository.db.test.mjs
```

The named offline suite (58/58), named Python suite (30/30), typecheck and local build were repeated successfully after the corrections. No production action was added to resolve the review findings.
