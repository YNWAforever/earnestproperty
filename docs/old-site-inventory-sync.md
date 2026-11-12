# Old-site inventory sync (legacy earnestproperty.com.hk → new site)

Phase 1 of the "use the official old website to update the inventory" plan. The
legacy site (`https://www.earnestproperty.com.hk/property/`) is the company's own
listing front-end: plain server-rendered PHP/HTML, 64 list pages, one
`/property-detail/<id>.html` per listing, all photos on `imgs.property.hk`. It
needs **no Firecrawl** — a full pass is roughly 64 list requests + ~635 detail
requests against the company's own host.

The 28hse stream is untouched: it keeps its own workflow, Firecrawl budget and
frozen-payload/publication gates. Only the inventory source changes.

## What runs

- Workflow: `.github/workflows/old-site-sync-daily.yml` (daily 05:45 HKT + manual dispatch).
- Entry point: `scripts/property-sync/old-site-sync.mjs` (`npm run old-site:dry-run`, `npm run old-site:sync`).
- Core parsing/normalisation/write path lives in `src/lib/mls/{parse-old-site,estate-resolver,normalize-old-site,importer,neon-db}.mjs`.
- Post steps: `scripts/property-sync/backfill-old-site-agents.mjs` (contacts → `property_agents`) and `scripts/property-sync/refresh-estate-stats.mjs` (fill null estate facts).

## Prerequisites before enabling apply

1. **Valid TLS certificate for `www.earnestproperty.com.hk`.** The host currently
   presents a certificate whose SAN is only `www.earnestproperty.com`, so the
   `.com.hk` hostname fails validation (`SEC_E_WRONG_PRINCIPAL`). Install a
   Let's Encrypt certificate for `www.earnestproperty.com.hk` (and the apex) on the
   legacy host, or front it with a Cloudflare proxy whose origin is the legacy
   Apache. The sync validates TLS strictly and **fails closed**; there is no
   insecure switch. Verify with:
   `curl -sS -o /dev/null -w '%{http_code}' https://www.earnestproperty.com.hk/property/`
   (no `-k`; expect 200).
2. Migration applied: `neon/migrations/20261112030000_old_site_inventory_capture.sql`
   (`npm run neon:migrate` against Production; `npm run check:migration-drift` green).
3. Repo variable `OLD_SITE_SYNC_APPLY=true`. Until it is set, every run is a
   dry-run; even with the variable set, a manual dispatch must ask for
   `mode=apply`.

## Commands

```bash
# Dry-run against the live site (fetches/parses; with a database URL configured
# it reads the DB READ-ONLY for estate mapping + the change preview; never writes).
npm run old-site:dry-run

# Offline replay of captured HTML (no network): directory contains index.json
# mapping absolute URL -> relative file, e.g. artifacts captured for evidence.
node scripts/property-sync/old-site-sync.mjs --from-dir artifacts/old-site-replay

# Apply (requires TLS fixed); writes properties, deactivates missing listings,
# then backfills agents and estate stats.
npm run old-site:sync

# One-off initial reconciliation only (reviewed dry-run first; never in the workflow):
node scripts/property-sync/old-site-sync.mjs --apply --allow-low-coverage

# Standalone post steps (both default to dry-run; pass --apply to write)
npm run old-site:agents
npm run old-site:locations
npm run old-site:estate-stats
```

Reports land in `artifacts/old-site-sync/<runId>/summary.json` (and
`artifacts/old-site-{agents,locations,estate-stats}/`); CI uploads them for 14
days.

## Safety guards

- **Discovery completeness**: absence is only inferred from the list pages. If a
  discovery pass sees fewer than 300 detail ids, or a detail parse error rate
  exceeds 2%, the run fails and no deactivation happens.
- **Coverage guard**: the DB layer refuses to sweep unless the discovery pass saw
  at least 70% of the currently-active legacy inventory
  (`DISCOVERY_COVERAGE_TOO_LOW`), so a markup change cannot withdraw the stock.
- **Cross-source duplicates are skipped, never overwritten**: `listing_no` is
  unique across feeds and the Property.hk branch feed already serves some of the
  same listings. Rows another feed owns, and rows owned by the `no-hermes-v2`
  writer (the DB fence refuses legacy writes to them), are reported
  (`conflicts.json`, dry-run `crossSourceDuplicates` / `writerOwnedSeenPairs`)
  and left untouched; the existing row keeps serving the listing.
- **One-off initial reconciliation**: the 2026-08 inventory is stale enough that
  the first pass legitimately sees only ~22% of the rows it must withdraw. For
  that single run only, `--allow-low-coverage` (apply runs only; never the daily
  workflow) lets the pair sweep proceed; `summary.json` records
  `coverageOverride: true` and the CLI prints a warning. Every later run must
  leave the override off.
- **Pair sweep**: withdrawal is per `(legacy_detail_id, deal_type)`, so a listing
  that flips deal type (sale added / rent withdrawn, or vice versa) never leaves a
  stale offering of the other deal type behind.
- **Detail failure never withdraws**: a detail page that returns the search page
  (expired listing) is a parse failure counted against the error budget; only
  absence from the list pages marks a listing inactive.
- **Strict TLS**: certificate errors fail the run with exit code 2; never set
  `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## First reconciliation evidence (2026-11-12)

Run against a full offline replay of the legacy site (767 captured pages, 635
detail ids, 707 `(legacy_detail_id, deal_type)` pairs) with the production
database, after the `.com.hk` certificate was still broken (so no network):

| Run                                | Result                                                                                                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dry-run (read-only DB)             | discovered 635 / parsed 707; 0 canonical-missing; estate resolved 700, unresolved 7; coverage 0.222 → override would be needed; 106 cross-source duplicates reported                                                                                            |
| apply #1 (override)                | failed closed with `MLS_INGESTION_OWNERSHIP_CONFLICT` after 141 inserts (trigger fence on `no-hermes-v2` rows) — fixed by skipping fenced rows and reporting them                                                                                               |
| apply #2 (override)                | upserted 571, deactivated 316, skipped 136 owned rows, coverage 0.610 override `true`; agents 551 written; estate stats 53 updated                                                                                                                              |
| apply #3 (no override, idempotent) | upserted 571, deactivated 0, coverage 0.883 (guard passed), agents idempotent (0 written), estate stats idempotent; fixed `canonical_property_no` to be written on every row (first applies wrote NULL because the normaliser only kept it in `source_payload`) |
| locations backfill                 | applied 210 safe corrections (149 `tsuen-wan → castle-peak-road`, 33 → sham-tseng, 2 → tsing-lung-tau, 64 estate fills)                                                                                                                                         |

Final old-site state: 1,533 rows (582 active = 490 legacy-owned + 92
`no-hermes-v2`; 951 inactive), active legacy rows carry canonical (0 missing),
estate (5 missing) and no silent `tsuen-wan` district (1 genuinely unresolved →
`NULL`). 81 of the 571 upserted rows stay hidden because 38 existing
`admin_property_overrides` mark those canonicals inactive — the admin override
trigger legitimately wins over source facts. Public identities were re-assigned
by canonical (sale/rent merge, e.g. `/property/B048730` 200 and the legacy
`/property/B048730-6662188-S` 301 aliases to it); fully-withdrawn canonicals
return 404 and drop out of `sitemap.xml`.

Residual review items for the owner: 136 cross-source duplicates
(`conflicts.json`; `listing_no` also owned by the Property.hk / 28hse feeds),
240 `review_required` public groups (multiple historical rows share a canonical
— needs the existing canonical review flow, not auto-retirement), 7 unresolved
estates / 1 unresolved district, and 1 active row whose contact could not be
matched to a staff user.

## Operator runbook

| Symptom                                                      | Meaning                                               | Action                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Exit code 2 + TLS/certificate message                        | `.com.hk` certificate still wrong                     | Fix the certificate/Cloudflare proxy (above), then re-run dry-run                      |
| `deactivationBlocked=DISCOVERY_TOO_SMALL`                    | Pager markup changed or the site is down              | Inspect `summary.json` + a captured list page; fix parser, re-run                      |
| `DISCOVERY_COVERAGE_TOO_LOW`                                 | Discovery saw too little of the active inventory      | Do not force a sweep; compare live list pages with the discovered set                  |
| `DISCOVERY_COVERAGE_TOO_LOW` on the first reconciliation run | Expected: the stale inventory needs a >30% correction | Review the dry-run `databaseDelta`, then re-run apply once with `--allow-low-coverage` |
| `detail_error_budget_exceeded`                               | >2% of detail pages failed                            | Check the site/source; a run never writes in this state                                |
| New/withdrawn counts spike                                   | Old site really changed, or a bad capture             | Review `summary.json` before enabling apply; artifacts are retained                    |
