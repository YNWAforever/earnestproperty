# Property source workers

Python 3.11+; tested on Python 3.14.6. The isolated base requirements include BeautifulSoup 4.13.5 and pytest 8.4.2. No JS lockfile changes are required.

```powershell
python -m venv scripts/property-sync/.venv
scripts/property-sync/.venv/Scripts/python.exe -m pip install -r scripts/property-sync/requirements.txt
scripts/property-sync/.venv/Scripts/python.exe -m pytest scripts/property-sync/tests -q
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/run_28hse_sync.py --dry-run --synthetic-fixture
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/run_propertyhk_sync.py --dry-run --synthetic-fixture
```

The tests also invoke Node against the repository's real ingestion codec/gate and existing 28hse parser. Install the repository's existing JS dependencies for these parity tests. No source-site requests occur in the tests. Synthetic fixtures use deliberately invented Property.hk selectors and paths; they are NOT production configuration or live-site evidence.

Copy config/sources.example.json to a deployment-owned configuration file. Property.hk fails before crawling until every branch URL template, selector, company/licence identity, allowed path expression and operator-verified `global` or `branch` ID scope is supplied. URL templates must contain `{page}`. `selectors.fields` maps canonical field names to detail CSS selectors; `required_detail_fields` lists mandatory non-null fields. `deal_type` can be configured per source, or `selectors.deal_type` can read the explicit sale/rent value per card. Missing unit/floor/block remain null. Contact fields are collected from the same detail page; no cross-agent stitching occurs.

28hse uses the existing verified sale/rent query shape (`buyRent`, `page`, `plan_id`, `propertyDoSearchVersion`). V2 continues to a verified empty page even after the advertised total is reached; this deliberately differs from the older parser's positive-count empty-page rejection. Both sale and rent must terminate with complete detail evidence. Advertised totals are recorded only as diagnostics; actual distinct source IDs and the accepted same-scope baseline govern count checks, so inaccurate or changing advertised totals do not reject a complete crawl. Company prefixes and source IDs remain source data; agency property numbers are not required for identity.

Every request starts with robots permission, HTTPS origin/path checks, a two-to-three second pace or stricter crawl delay, and at most THREE TOTAL attempts. Cross-origin/path redirects, verification pages, unknown DOM, required-detail failures, pagination loops and safety ceilings fail closed. Optional rendering uses `renderer: "crawl4ai"` and requirements-browser.txt. It serializes already policy-fetched HTML with JavaScript disabled and all browser network requests blocked; it is not a live JavaScript bypass. Crawl4AI 0.9.3 distribution availability and current configuration documentation were checked; installation/browser smoke testing remains a deployment check. Base HTTP extraction and all offline tests run without it.

Run artifacts live under `output/snapshots/<source>/<scope>/<UTC-date>/<UUID>/`: BOM CSV, JSONL, manifest, immutable request bytes, raw evidence, and gate result. Receipt files are separate. Raw evidence can contain source contact data and needs restricted storage; general stdout only reports run status and paths. Artifacts are never overwritten. Diff CSVs compare column names and source-ID/offer keys and retain old/new title, money, area and unit-price values. Historical first-seen/reactivation identity remains owned by the Node ingestion sink.

Dry-run performs no POST, Node apply bridge, notification or baseline update. Synthetic mode requires dry-run. The normal 28hse runner invokes only `scripts/mls/apply-source-snapshot.mjs --payload <request.json>`; it adds `--apply` only for explicit `publishEnabled: true`. A shadow/partial/failed receipt never advances the local baseline. Complete successful receipts require success=true, status=success, full_snapshot=true and receipt_id. Baselines advance atomically under the scope lock; an older replay cannot regress them. The 30% drop gate applies globally and per Property.hk branch. Failed crawls block all business submission; individually invalid numbers retain per-ID rejection accounting and disable full-baseline/absence eligibility.

For an uncertain Property.hk response, run `sync_propertyhk.py --payload <original-request.json> --config <config.json> --root <same-output-root>`. The client reuses exact bytes, refuses redirects, permits only configured HTTPS origins, and uses PROPERTYHK_SYNC_URL / PROPERTYHK_SYNC_SECRET from the environment. 400/401/409/413/422 do not retry; 429 respects Retry-After, deferring values beyond 300 seconds for operator replay. Three attempts are the maximum. Receipt replay can advance a successful full baseline without recrawling. `--dry-run` validates locally without submission or baseline advance.

Crawl-only CLIs accept `--output <csv>`; diff_agent540.py accepts `--old`, `--new`, `--output`. Existing outputs fail rather than being overwritten. Locks are exclusive local lock files; after a crashed process an operator must confirm it is stopped before removing a stale lock. No scheduler, production configuration, source terms authorization, live selectors or notification service is created here.


Live adapter verification (2026-09-07): the authorized agent 540 response uses the full bilingual company heading, matching C-018613 licence, same-origin absolute listing links and `table.tablePair` detail fields. Sanitized sale/rent structure excerpts are regression fixtures. Detail headings must match source ID and offer type; main price/area values are separated from per-foot prices, and conflicting duplicate fields reject the page. Exact units are never inferred from floor bands. Full collection evidence remains a separate run result; these fixture tests alone do not attest to every live page.


## Daily inventory recovery (2026-10-01)

The property workflow runs at 04:17 Asia/Hong_Kong (20:17 UTC), subject to GitHub scheduling delays. It remains disabled unless `PROPERTY_SYNC_DAILY_ENABLED=true`. Keep `PROPERTY_SYNC_EXPECTED_BRANCH=main`, `PROPERTY_SYNC_POLICY_APPROVED=python-v2.2`, and the exact verified direct Neon database host in `PROPERTY_SYNC_EXPECTED_DATABASE_HOST`.

For a public code repository, set `PROPERTY_SYNC_EVIDENCE_REPO=owner/private-evidence-repository` and its restricted `PROPERTY_SYNC_EVIDENCE_TOKEN` with contents read/write for that repository. Create its private `property-sync-evidence` release and transfer the **latest accepted** baseline there with its exact request/receipt/hash intact before enabling collection. Never bootstrap over an existing production baseline just to make the job run. An existing private code repository can retain the default destination and GitHub token. The workflow checks destination privacy before collection or database access and fails closed. These variables, secrets, release and baseline are operational prerequisites; this change does not provision them.

Frozen requests, accepted baselines, raw evidence and compact outcomes go to the private release. Publication results are included in compact evidence. Actions artifacts are optional copies only for private code repositories, so Actions artifact quota cannot turn an otherwise successful run into a failed ingestion. Private release upload failures remain hard failures. Release assets do not expire automatically: the operator must apply a retention policy that preserves the current accepted baseline and unresolved request/receipt pairs; the 7/90-day Actions artifact settings do not delete release assets.

Before enabling writes, run shadow collection with a restored accepted baseline. Check complete sale AND rent pagination, expected company/license, no rejected details, acceptable count change and the three reported 28Hse source IDs. Run the exact frozen request through the existing apply path, then inspect publication outcomes: imported inventory is not automatically public; publication is capped at 20 attempted drafts per run and held items need review. Existing content, staff overrides, identity conflicts and media validation remain protected.

Absence handling stays disabled until a complete fresh snapshot and reviewed reconciliation exist. Network errors, security challenges, partial pagination and failed detail parsing are not evidence of withdrawal. The current absence algorithm compares only the previous accepted full snapshot; switching it on cannot clean up all historical stale source IDs. Historical reconciliation must be a separate reviewed, reversible operation, with source identities, before/after status, reason and receipt recorded.

Property.hk EPW/EPS/EPT are not live-enabled by this patch. Live verification returned a browser security check (403). Obtain a supported feed/export or resolve access with the provider before validating branch pagination, selectors and global-versus-branch ID scope. Do not copy challenge cookies or treat failed fetches as empty inventory. The supplied EPS link starts at page 9; a full branch crawl must start at page 1.

### Private real Property.hk index evidence

The native `agent.php` collector now uses this verified parser directly, without
inventing production selectors or ID scope. Supply the original approved
page-one URLs in a private JSON object keyed by the exact branch/district pair
(for example `EPS-NTM`). Preserve the SID and dt; a different district needs its
own approved entry. The collector follows only the published `jumpForm` through
its last nonempty page, checks the exact company/licence and unchanged filters,
rejects duplicate advertisements within each scope, and retains sale/rent as
separate offers. It stops the source on 401/403/429, redirects or robots refusal.
An advertisement with both prices rendered as `--` is preserved in
`unclassified-advertisements.jsonl` with `reason=no_quoted_offer` and no inferred
deal type or lifecycle. It still counts as an advertisement and participates in
duplicate-page checks, but it does not create a sale/rent offer or stop pagination.

```powershell
scripts/property-sync/.venv/Scripts/python.exe scripts/property-sync/crawl_propertyhk.py `
  --index-only --entries PRIVATE/approved-entry-urls.json --root PRIVATE/output --dry-run
```

This mode has no database/POST/apply path, even without `--dry-run`. Its unique
`index-observations/<UUID>/` directory contains CSV/JSONL observations, raw
responses, both attempt and final-response manifests, SHA-256 hashes and a frozen
report. Raw evidence and URLs remain private; stdout reports aggregate counts
and paths. CSV rows retain branch, district filter, advertisement ID, offer type,
source update date and observed page/hash. Counts sum scope advertisements and
offers; they are not canonical property counts, and overlapping districts are
not deduplicated globally.

Exit 0 and `status=index_complete` mean **only the approved indexes** were
collected. `sync_status=blocked_detail_verification`, `full_snapshot=false`,
`details_verified=false`, `id_scope_verified=false`,
`full_branch_scope_verified=false`, `eligible_for_absence=false`,
`publish_allowed=false`, `baseline_advanced=false` and `production_writes=0`
remain explicit. Missing pages, changing totals/filters, unknown empty pages or
`--max-pages` ceilings return exit 1 with a partial/failed report and preserve
only validated observations. Accepted snapshots and receipts are untouched.
This command neither enables the scheduler nor claims a full ingestion receipt.

`verify_propertyhk_index_evidence.py --manifest PRIVATE/capture-manifest.json --entries PRIVATE/approved-entry-urls.json --out PRIVATE/report.json` runs offline. It verifies exact raw bytes and contiguous published index pages, then checks the observed agent.php table contract. Approved entry URLs/SIDs and original HTML stay private. The inspector does not grant full-snapshot, detail, ID-scope, branch-scope, absence or publication authority; blocked details remain a provider gate. See `docs/reports/propertyhk-access-verification.md` for real evidence and remaining acceptance.
