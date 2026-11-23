# 市場註冊成交 — 上線計劃與回滾（需 Willy 具名批准）

**State of this branch:** prepared only. Nothing here has been merged, deployed or
written to the production database, and no production migration has been
applied. The only production action this branch would cause is the one the
approval below names.

## 1. What actually ships

There is **no database migration and no production database import** on this
branch, by design:

- `origin/main` already ships 市場註冊成交 as a **versioned static snapshot**
  (`src/content/eprc-transactions*.ts` + `src/content/fixtures/eprc-transactions-22-estates-20261027.csv`),
  and `src/routes/estate.market-transactions.contract.test.mjs` forbids that
  module from importing `src/lib/neon`, `src/lib/queries` or `createServerFn`.
- The 2026-11-24 handoff data therefore extends the same pattern: a derived,
  reviewed snapshot at
  `src/content/fixtures/market-transactions-62-estates-20261123.json`, generated
  offline by `scripts/market-transactions/build-snapshot.mjs`, read by a pure
  module. No schema change, no `app_migrations` row, no build-migration-gate
  risk (see `docs/incidents/2026-11-06-code-before-schema.md`).
- That means a preview deployment renders the real data, and the **only**
  production action is the merge/deploy itself.

Because the data is a build-time artifact, "import" here means "publish this
snapshot". The rollback is a code revert, not a database restore.

## 2. Pre-merge gate (must all be green)

| Gate                     | Command                                                                                       | Notes                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck                | `npm run typecheck`                                                                           | `tsc --noEmit`, whole repo                                                                                                                                |
| Lint + prettier          | `npm run lint`                                                                                | prettier runs as an eslint rule                                                                                                                           |
| Build                    | `npm run build`                                                                               | `prebuild` = required-env check + migration drift gate; drift gate only warns on previews                                                                 |
| Estate/module tests      | `npm run test:estate-conversion`                                                              | now includes `market-transactions.test.mjs`, `estate-market-search.test.mjs`, `EstateMarketRegistrations.test.tsx`, `ListingEstateMarketSummary.test.tsx` |
| Test wiring              | `node --test src/test-wiring.test.mjs`                                                        | every test file must belong to a `test:*` script                                                                                                          |
| Snapshot reproducibility | `node scripts/market-transactions/build-snapshot.mjs --estates61 <dir> --mount <dir> --check` | regenerating from the same archives must be byte-identical                                                                                                |
| Preview screenshots      | preview URL                                                                                   | estate page, `#B051070`-equivalent listing page, filtered/empty state, mobile                                                                             |

The archives stay outside the repository. `--check` is the human-checkable
proof that the committed snapshot is exactly what those two packages produce.

## 3. Data review checklist before approving (data becomes public on merge)

1. `docs/market-transactions/data-audit.md` — counts, mapping, anomalies all
   MATCH against the brief's verified figures.
2. No contact data, vendor/purchaser, `remarks`, raw HTML or fetch logs in the
   snapshot (`grep` for `contact`, `電話`, `C-018613`, `remarks`).
3. Every public number is a **source-row** count, never labelled 成交宗數,
   except the explicitly-labelled post-pairing count.
4. The three filtered-empty estates (翠景花園 / 海韻臺 / 觀海別墅) show the honest
   empty state, not "no transactions".
5. No third-party chart PNG is embedded or hotlinked; the transcribed-chart
   block is labelled as transcription with an unpublished date basis.
6. 本行成交 (agency `transactions`) and 市場註冊成交 are separate headings,
   separate counts, separate sources on every page.
7. Roster/registry slug mapping reviewed: 62 roster slugs, exact match, no
   alias invented.

## 4. What needs Willy's named approval

> "批准將 feat/market-registered-transactions-20261124 合併及部署到正式網站。"

Merge alone publishes the snapshot on the 59 covered estate pages and on listing
detail pages. **Not authorized by this branch, and not requested here:**

- merging the PR
- deploying to production or promoting a preview
- importing or updating the production database
- applying a production migration
- contacting anyone on Willy's behalf
- spending money

## 5. Rollback

| Trigger                            | Action                                                                                                               | Time to effect                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Wrong row appears on a public page | `git revert <merge commit>` on `main`, push                                                                          | next production deploy, a few minutes |
| One estate looks wrong             | Revert the snapshot generation for that estate by setting its `status`/`note` in the generator, regenerate, PR again | one deploy                            |
| Module crashes an estate page      | Delete the `<EstateMarketRegistrations … />` block from `src/routes/estate.$slug.tsx`                                | one deploy                            |
| Anything worse                     | Re-deploy the previous production deployment from Vercel (Promote)                                                   | seconds, no code change               |

There is nothing to restore: no table was created or updated, so no data is at
risk and no down-migration is needed. The committed snapshot file can be deleted
with no orphaned rows anywhere.

## 6. If a database-backed path is ever approved (not built, not scheduled)

Kept here so a future decision does not silently re-invent it. Requires its own
approval and its own PR:

1. Migration `neon/migrations/<ts>_estate_market_transactions.sql`:
   - `estate_market_transaction` — `id`, `estate_id` (FK), `source_package`,
     `source_ref`, `list_year_filter`, `registration_date`,
     `instrument_date` (two separate columns, never one), `registration_no`,
     `instrument_nature`, `phase_zh`, `tower_zh`, `house_id`, `floor`, `unit`,
     `consideration_million`, `gross_area_sqft`, `price_per_sqft`,
     `psf_basis`, `completion_year`, `source_as_of`, `recorded_at`;
     `UNIQUE (source_package, list_year_filter, source_ref)` = idempotency key.
   - `estate_market_coverage` — per estate `status`, `as_of`,
     `registration_through`, `row_count`, so an estate with zero rows is
     distinguishable from an estate that was never scraped.
2. Importer `scripts/market-transactions/import.mjs` reusing the generator's
   pure mapping step, with `--dry-run` (default) and `--apply` behind the same
   named approval; second `--apply` of the same package hash must be a no-op
   (`ON CONFLICT (source_package, list_year_filter, source_ref) DO NOTHING` then
   `count(*)` comparison).
3. Server functions in `src/lib/neon/market-transactions.ts` + `.server.ts`,
   following the two-file boundary, and only then swap the estate route's read
   path. Until that lands, the static snapshot is the read path.
4. Rollback for that future path: `DELETE FROM estate_market_transaction WHERE
source_package = 'estates-61'` (rows are 100% derived from the archives and
   carry no user-generated data), or drop both tables.
