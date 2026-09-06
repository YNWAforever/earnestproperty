# Daily full collection and differential import — delivery, 2026-09-07

Implementation branch: `codex/daily-property-sync`. Base: main `9d79c66` (PR #126 merged). Includes the separately verified live 28hse adapter from `87deda8` and the daily implementation. Production activation is **blocked**, not completed.

## Delivered behavior and changed files

- `scripts/property-sync/scraping/worker.py`, sanitized fixtures and worker tests: agent 540 full sale/rent traversal, observed distinct IDs and verified terminal pages; explicit sold/rented lifecycle, negotiable null amounts, parser `python-v2.1`.
- `scripts/property-sync/replay_28hse_sync.py`, Node bridge and tests: exact frozen payload replay, bounded transient retries, immutable attempt receipts. No crawler in the API or bridge.
- `src/lib/mls/ingestion-{contract,repository,service}.*` and `ingestion-daily.db.test.mjs`: persisted source lifecycle, changed-only canonical updates, atomic actual-write counters, preservation of staff overrides and public identity.
- `.github/workflows/property-sync-daily.yml`, `daily_artifacts.py` and tests: daily 02:17 HKT, explicit activation/branch/policy gates, private durable request/baseline evidence, timestamp-ordered recovery, 7-day compressed raw and 90-day compact artifacts.
- `package.json`, `.github/workflows/ci.yml`: named daily test command and database test wiring.
- Design/plan in `docs/superpowers/`; operational instructions in `docs/deployment/property-sync-daily.md` and `property-sync-no-hermes.md`.

## Schema and policy mapping

No additional migration is needed for this daily increment. It depends on the existing additive `20260907120000_propertyhk_ingestion_v2.sql` migration. Source lifecycle is retained in existing observations/source state; accepted full receipts, policy, source links, field ownership, conflicts and source sync metadata remain the authority. Canonical `properties` remains the only listing database.

28hse retains source name `28hse_agent_540`, scope `agent:540`, policy `no-hermes-v2`, parser `python-v2.1`. Property.hk remains disabled and emits `python-v2.0`. Never mutate a parser policy already referenced by receipts; an existing v2.0 installation requires a separately reviewed compatibility upgrade. Source terminal states project to inactive, not a claimed completed transaction. New negotiable/terminal entries stage for review. The counters `properties_created`, `properties_changed`, `fields_changed` and `unchanged_properties` describe actual committed writes; dry runs report zero actual writes.

Source-ID lookup, complete exact cross-source identity, primary-source priority, overrides, contacts, UUIDs/aliases/media, shared writer lock and ownership remain enforced. Missing pages or a greater-than-30% drop rejects business writes. Partial batches cannot establish absence or a full baseline. Replay reuses original bytes and timestamps; it does not turn stale evidence into a fresh collection.

## Executed verification

| Check                                                                 | Actual result                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `npm.cmd run test:property-sync:python`                               | 52 passed, 0 skipped                                 |
| `npm.cmd run test:property-sync`                                      | 61 passed, 0 skipped                                 |
| `npm.cmd run test:property-sync:daily`                                | 3 passed, 0 skipped                                  |
| `npm.cmd run test:mls`                                                | 603 passed, 0 skipped                                |
| `npm.cmd run test:control-plane`                                      | 95 passed, 0 skipped                                 |
| `node --test src/test-wiring.test.mjs`                                | 9 passed, 0 skipped (also included in control-plane) |
| Dedicated `ingestion-daily.db.test.mjs` on approved disposable branch | 5 passed; uniquely named schema cleaned up           |
| `npm.cmd run typecheck`                                               | Passed                                               |
| `npm.cmd run build`                                                   | Passed                                               |
| ESLint on changed JavaScript modules/tests                            | Passed after formatting corrections                  |

Final review found and fixed one lifecycle sequence: inferred absence followed by explicit sold/rented now escalates the owned reason without rewriting the canonical property. A later active source observation cannot revive it. The new database regression first failed on the old reason, then the full dedicated daily suite passed 5/5 in 113.816 seconds at `9efe5e4`, including override protection and zero canonical-change counters. Named Node tests and focused ESLint were rerun after this fix and passed. Do not interpret earlier predecessor-suite results as rerun here. Full historical database suite, deployed GitHub runner, production apply, live Property.hk, and automatic schedule operation were not executed as part of this daily change.

## Captured-source verification

The prior full authorized collection visited 19 index pages and 247 distinct details (192 sale, 55 rent). This task reprocessed those captured HTML responses offline with parser v2.1: **247 records, zero rejected, full completeness gate passed**. Two records explicitly delisted (sold), one negotiable; 245 source-active records, of which 244 have eligible priced active offers. The Node contract accepted all 247, with no rejected records. These are source advertisements, not a claim of 247 distinct canonical properties.

No new live source request was needed for this reprocessing. The new immutable snapshot preserves original capture time `2026-09-06T19:16:21.080323Z`; original evidence remains unchanged. Restricted local candidate: `.audit-20260905/daily-final-parser/snapshots/28hse/agent-540/2026-09-06/302a69fb-7020-4fe9-a754-90591ebe945d`. Raw HTML/contact evidence is not committed. Offline verification does not establish GitHub-hosted source access.

## Production readiness — read-only observations

On 2026-09-07, production `br-polished-sea-aom4i1ct` / `neondb` had no v2 policy/receipt/source-state tables. Latest recorded migration was `20260906120000_admin_property_management.sql`. Existing `property_source_links` had **zero rows**. All 1,067 properties were old-site records (431 active), with no 28hse/Property.hk source URL matches. `old_site` is not Property.hk.

Therefore, enabling the workflow alone cannot safely update current inventory. Required separate operator steps:

1. Review/apply the v2 migration and versioned policy/bootstrap under the shared writer lock.
2. Establish trusted existing-property/source links, with complete source identity and reviewed unit evidence. Do not weaken identity matching to agency number alone, or bulk-enable new duplicate drafts through an unreviewed district map.
3. Provision the private `property-sync-evidence` release; verify Actions permissions and the managed `DATABASE_URL_UNPOOLED` target. The secret name exists, but its value/target was not read or verified here.
4. Run controlled Linux shadow collection; verify access, complete pagination, lifecycle counts and evidence upload/recovery.
5. Review a single-owner handoff from the old 28hse schedule. Do not touch CRM/WhatsApp drains.
6. Configure the documented branch/policy/enable variables and perform the explicitly approved bootstrap apply; verify receipt and accepted baseline before declaring daily service active.

No production migration, policy update, source-link bootstrap, deployed schedule/secret change, deployment, inventory deletion or real message was performed.

## Exact local commands

From this worktree in PowerShell:

```powershell
npm.cmd run test:property-sync
npm.cmd run test:property-sync:python
npm.cmd run test:property-sync:daily
npm.cmd run test:mls
npm.cmd run test:control-plane
npm.cmd run typecheck
npm.cmd run build
```

For separately authorized collection (performs source HTTP requests; no database writes):

```powershell
scripts/property-sync/.venv/Scripts/python.exe -X utf8 scripts/property-sync/run_28hse_sync.py --root .audit-20260905/operator-collection --dry-run
```

For local synthetic verification without source requests:

```powershell
scripts/property-sync/.venv/Scripts/python.exe -X utf8 scripts/property-sync/run_28hse_sync.py --root .audit-20260905/operator-synthetic --dry-run --synthetic-fixture
```

For frozen replay validation, replace the example path with an existing immutable request:

```powershell
scripts/property-sync/.venv/Scripts/python.exe -X utf8 scripts/property-sync/replay_28hse_sync.py --payload <saved-request.json> --root <new-replay-directory>
```

Only after operator activation, append `--apply`; inject the approved database connection through the managed environment, never through a command argument. The dedicated database suite requires approved `ASTRA_TEST_DATABASE_URL` and `ASTRA_TEST_BRANCH_ID=br-quiet-hat-aoxbj2ue`; it must not target production.

## Cost controls and rollback

The daily job uses deterministic Python/Node, no AI tokens, no browser, no app build and no always-on worker. It fetches all indexes/details once daily; only changed canonical fields produce property writes. A full snapshot still writes audit/source-state evidence, so differential import does not mean zero database/storage work. Failed transport reuses the collected payload with at most three bounded retries.

Hosted run duration, compressed storage and actual account quota remain unmeasured. Do not promise zero cost. Measure the first controlled run, then review monthly Actions and retained-release usage. Frozen requests/latest baseline/unresolved evidence persist until operator reconciliation; raw artifacts expire after seven days, compact after ninety.

Rollback: set `PROPERTY_SYNC_DAILY_ENABLED=false`, allow any active transaction to finish, then inspect the receipt. Keep history, source links and public identities. Re-enable the legacy collector only after a reviewed ownership handoff. Stopping automation does not undo already accepted data; correct any bad accepted batch through a reviewed compensating update, not receipt deletion or timestamp rewriting.
