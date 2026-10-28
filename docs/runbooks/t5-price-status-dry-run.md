# T5 Phase 0 + Property.hk Ask A Yes

This deliverable produces reports only. It performs no canonical writes, migrations,
ingestion, publication, baseline advancement or absence apply. No production command
was run to prepare this PR. Property.hk is the **required fallback** in the later T5
design; a failed primary capture must not silently remove that requirement.

## 28Hse: manual first, 07:00 HKT only after enablement

`.github/workflows/property-price-status-sync.yml` has `workflow_dispatch` and cron
`0 23 * * *` (07:00 HKT). A missing/false `PRICE_STATUS_SYNC_ENABLED` skips scheduled
reports. Manual dispatch works independently of that flag. This PR does not change
repository variables or secrets. A new workflow must first exist on the default
branch before GitHub accepts dispatch; opening this draft does not run it.

After review/merge and operator provisioning, dispatch a report:

```bash
gh workflow run property-price-status-sync.yml --repo YNWAforever/earnestproperty --ref main
gh run list --repo YNWAforever/earnestproperty --workflow property-price-status-sync.yml --limit 5
# Download only the sanitized price-status-dry-run-<run-id> artifact.
gh run download <run-id> --repo YNWAforever/earnestproperty --name price-status-dry-run-<run-id>
```

Prerequisites: the existing private `PROPERTY_SYNC_EVIDENCE_REPO` release named
`property-sync-evidence`; a read-capable `PROPERTY_SYNC_EVIDENCE_TOKEN` (or the default
token when evidence lives in the same private repo); and the dedicated direct
`PRICE_STATUS_SYNC_READONLY_DATABASE_URL`, a SELECT-only role with access to the
export tables. Do not supply the production writer credential as a substitute.
The code enforces `BEGIN READ ONLY` even with a misprovisioned role. Report execution
holds the same `earnestproperty:mls-sync` advisory transaction lock as the writers,
waiting up to ten minutes before failing closed. GitHub concurrency is
`property-sync-agent-540`, `cancel-in-progress: false`. No report or export is read
from the DB before the lock is acquired; rollback releases the lock on all outcomes.

`select_price_status_capture.py` examines existing `handoff-<run>-<attempt>.json`
ready markers and `accepted-*.tar.gz` bundles in that private release. It checks
request hashes, original capture clocks, source/parser/scope, complete contiguous
sale **and** rent pagination with detail proof, and zero failed/rejected records.
The selected handoff also passes the existing request/raw hash verifier; accepted
bundles pass the existing receipt/manifest checks. Selection uses `scraped_at`, not
upload time. Equal timestamps with different content fail closed. Newer partial
captures are ignored; no complete capture is a hard failure. An integrity failure
does not fall back silently. Owner-publication bundles and partial saved patches
cannot pass this full-snapshot contract. This PR adds no HTTP or Firecrawl collection
to Part A. Old complete evidence is still selected, then classified **stale >36h**;
it cannot produce would-change proposals.

Matching uses the existing MLS `buildMatchKey` normalizer for company 物業編號 +
sale/rent (`company-number-v1`). Missing/duplicate/changed references, source-link
conflicts, new unmatched references and group review holds report `ambiguous-ref`.
No new canonical targets are created. Admin overrides, explicit manual ownership
and drift from the last published field value are held. Fields are independently
restricted to `price`, `rent`, `status`. Active observations do not reactivate drafts
or inactive listings. Sold/rented/explicit delisting proposes `status=inactive` with
`reason=sold|rented|delisted` in report metadata. Absence reports `delisted` with
`reason=absent_report_only` and **empty would_change**. Status overrides also hold.

Capture, per-detail and export freshness are capped at 36 hours. Reports contain
hashed match references, category, fixed reason codes, evidence hashes and numeric
amount/status changes only. No source URLs, raw HTML, address, staff identity or
contacts go to logs, summaries or uploaded reports. Counts are categories per offer;
they are not a canonical property count. Evidence selection logs are sanitized.
Private inputs stay on the ephemeral runner and are never uploaded by this workflow.

Offline comparison (no DB connection or lock; use a file snapshot):

```bash
node scripts/property-sync/price_status_diff.mjs \
  --capture PRIVATE/verified-request.json --current PRIVATE/current.json --out PRIVATE/diff
```

## Property.hk: approved normal headless browser on the box

Willy's **Ask A Yes**, 2026-10-28, sanctions normal headless browsing at **≥3 seconds
per page/navigation**, including native challenge reloads. A fresh browser may run
the site's own JavaScript and receive its own in-memory cookies. The supplied probe
facts are index HTTP 200 and detail 403 → 200 in about six seconds. They are not a
new live probe performed by this PR, full inventory proof or permission to apply.
No proxy, stealth, changed identity, copied cookies, persistent profile/storage,
captcha solver or manual challenge manipulation is permitted. The HTTP collector
never attempts to solve a challenge. A persistent browser challenge stops after
about 20 seconds with no challenge retry; any 429 stops the whole run. Transient
transport/server failures have at most four attempts. No failed page becomes empty
inventory. Empty/unrecognized index tables also require review.

The fixed [19-agent manifest](../../scripts/property-sync/config/propertyhk-agents.json)
comes from the recorded agentblog discovery; `full_branch_scope_verified=false`.
It is not authority for complete company absence. The HTTP collector uses an honest
bot UA, reads robots, waits ≥3 seconds after each response, checks `C-018613`, follows
the actual jumpForm fields to the declared last page, verifies scope/page continuity,
deduplicates repeated agents' ads and rejects conflicting duplicates. No slug guessing
or rediscovery runs here. The operator should review the manifest weekly against the
company's published roster; add agents only after explicit scope verification.

Pin an absolute `PROPERTYHK_BROWSER_EXECUTABLE` to the installed, operator-managed
Chromium/Chrome binary (for example `/usr/bin/google-chrome` on the verified box).
The collector fails if it is missing; there is no automatic bundled-browser fallback.
Record the binary version with private run evidence and rerun offline checks after
upgrades. Playwright's [executablePath](https://playwright.dev/docs/api/class-browsertype#browser-type-launch)
and fresh [browser contexts](https://playwright.dev/docs/api/class-browser#browser-new-context)
are used directly. There is no GitHub Actions Playwright source probe in this PR.

The following is an operator template, **not executed during this task**:

```bash
mkdir -p .private-sync-evidence/t5
scripts/property-sync/.venv/bin/python scripts/property-sync/propertyhk_index_http.py \
  --out .private-sync-evidence/t5/index.json
node scripts/property-sync/propertyhk_daily_diff.mjs plan \
  --index .private-sync-evidence/t5/index.json --current PRIVATE/propertyhk-current.json \
  --urls .private-sync-evidence/t5/urls.json
PROPERTYHK_BROWSER_EXECUTABLE=/usr/bin/google-chrome \
node scripts/property-sync/propertyhk_detail_browser.mjs \
  --urls .private-sync-evidence/t5/urls.json --out .private-sync-evidence/t5/details.json
node scripts/property-sync/propertyhk_daily_diff.mjs \
  --index .private-sync-evidence/t5/index.json --current PRIVATE/propertyhk-current.json \
  --details .private-sync-evidence/t5/details.json --out .private-sync-evidence/t5/diff
```

Phase 0 confirms every present ad before comparing: the index alone cannot verify
lifecycle or company reference. An unchanged-detail cache is deferred. The planner
therefore emits all index detail URLs, including new ads. New/unlinked company refs
are held for review. The diff requires complete details, exact exported `propertyhk`
source links, agreement on index/detail amounts for active offers and company number

- sale/rent uniqueness. A missing, stale, failed or mismatched detail fails/holds;
  absence remains report-only. No Firecrawl is used for Property.hk.

## Read-only export contract — SQL template, do not execute as part of this PR

The SQL source is [price_status_export.sql](../../scripts/property-sync/price_status_export.sql).
Its only parameter `$1` is `propertyhk` or `28hse_agent_540`. It selects current amounts,
status, canonical company reference, active source IDs and held field names. It
includes staff patches from shared/deal-specific admin overrides and sync fields.
No PII-bearing columns are selected. An operator with a separately provisioned
SELECT-only session can export it under the writer lock:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10min';
SELECT pg_advisory_xact_lock(hashtext('earnestproperty:mls-sync'));
-- PREPARE t5_export(text) AS <paste the SELECT from price_status_export.sql>;
-- EXECUTE t5_export('propertyhk');
-- Save the rows privately as JSON, and record the real export clock below.
ROLLBACK;
```

No query above was executed on Neon in this task. Do not reuse a credentials-bearing
URL in chat, a fixture, PR body or artifact. Wrap the exported rows in:

```json
{ "exported_at": "<actual UTC export timestamp>", "properties": ["<SQL result rows>"] }
```

The checked-in synthetic fixture provides the exact types. In particular,
`override_fields` is a required array even when empty; never fabricate it for a real
export. Keep `source_ids` as returned by SQL. The Property.hk diff has no DB driver
or online export mode. Read/export code in Part A is a read-only report adapter,
not Phase 1's guarded writer.

## Later T5 wiring and failure recovery

Keep `.github/workflows/property-sync-daily.yml` at 09:00 HKT and the gold/owner
publication flow untouched. Daily 28Hse Firecrawl-basic belongs in a **separate later
T5 workflow**, never gold. Wire the required Property.hk fallback and its normal
browser stage there only after the report contract and runtime are reviewed. This
PR enables no box cron, no source schedule, no absence auto-apply and no guarded writer.

On a rejected index/detail, challenge timeout, 429, missing evidence, stale report
or lock timeout: preserve private evidence, report the failure to the operator and
stop. Do not re-stamp an old capture or infer withdrawal. Retry a transport failure
as a new capture only after reviewing access/freshness; do not bypass the failing
gate. Disable future scheduled **reports** with `PRICE_STATUS_SYNC_ENABLED=false`.
There is no DB rollback operation because there are no data writes.

Offline checks (no Neon or source HTTP/browser navigation):

```bash
npm run test:property-sync:daily
npm run test:property-sync:python
```
