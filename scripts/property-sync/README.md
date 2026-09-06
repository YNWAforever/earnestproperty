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

28hse uses the existing verified sale/rent query shape (`buyRent`, `page`, `plan_id`, `propertyDoSearchVersion`). V2 continues to a verified empty page even after the advertised total is reached; this deliberately differs from the older parser's positive-count empty-page rejection. Both sale and rent must terminate, and observed distinct advertisement totals must agree. Company prefixes and source IDs remain source data; agency property numbers are not required for identity.

Every request starts with robots permission, HTTPS origin/path checks, a two-to-three second pace or stricter crawl delay, and at most THREE TOTAL attempts. Cross-origin/path redirects, verification pages, unknown DOM, required-detail failures, pagination loops and safety ceilings fail closed. Optional rendering uses `renderer: "crawl4ai"` and requirements-browser.txt. It serializes already policy-fetched HTML with JavaScript disabled and all browser network requests blocked; it is not a live JavaScript bypass. Crawl4AI 0.9.3 distribution availability and current configuration documentation were checked; installation/browser smoke testing remains a deployment check. Base HTTP extraction and all offline tests run without it.

Run artifacts live under `output/snapshots/<source>/<scope>/<UTC-date>/<UUID>/`: BOM CSV, JSONL, manifest, immutable request bytes, raw evidence, and gate result. Receipt files are separate. Raw evidence can contain source contact data and needs restricted storage; general stdout only reports run status and paths. Artifacts are never overwritten. Diff CSVs compare column names and source-ID/offer keys and retain old/new title, money, area and unit-price values. Historical first-seen/reactivation identity remains owned by the Node ingestion sink.

Dry-run performs no POST, Node apply bridge, notification or baseline update. Synthetic mode requires dry-run. The normal 28hse runner invokes only `scripts/mls/apply-source-snapshot.mjs --payload <request.json>`; it adds `--apply` only for explicit `publishEnabled: true`. A shadow/partial/failed receipt never advances the local baseline. Complete successful receipts require success=true, status=success, full_snapshot=true and receipt_id. Baselines advance atomically under the scope lock; an older replay cannot regress them. The 30% drop gate applies globally and per Property.hk branch. Failed crawls block all business submission; individually invalid numbers retain per-ID rejection accounting and disable full-baseline/absence eligibility.

For an uncertain Property.hk response, run `sync_propertyhk.py --payload <original-request.json> --config <config.json> --root <same-output-root>`. The client reuses exact bytes, refuses redirects, permits only configured HTTPS origins, and uses PROPERTYHK_SYNC_URL / PROPERTYHK_SYNC_SECRET from the environment. 400/401/409/413/422 do not retry; 429 respects Retry-After, deferring values beyond 300 seconds for operator replay. Three attempts are the maximum. Receipt replay can advance a successful full baseline without recrawling. `--dry-run` validates locally without submission or baseline advance.

Crawl-only CLIs accept `--output <csv>`; diff_agent540.py accepts `--old`, `--new`, `--output`. Existing outputs fail rather than being overwritten. Locks are exclusive local lock files; after a crashed process an operator must confirm it is stopped before removing a stale lock. No scheduler, production configuration, source terms authorization, live selectors or notification service is created here.
