# Property source workers

## Named native publication (offline implementation; separate live approval)

The existing publisher accepts an optional **one-target** `named-publication-v1`
operator sidecar. It does not create another importer or relax publication gates.
The complete accepted payload is retained: selecting one source must not slice
the batch or change its receipt hash. The current-full receipt, successful/current
scope watermark, 36-hour batch and original capture freshness, source identity,
draft, group/direct/peer review, staff ownership and owned-media checks still apply.
Provider provenance requires matching `captured_at` / `fetchedAt`; a fresh acceptance
envelope cannot hide a missing, contradictory or stale original capture.

The sidecar has exactly `version`, `source`, `scope_id`, `policy_version`,
`payload_hash`, `approval_ref` and a one-item `targets` array. A target contains:

- `external_id`, `deal_type`, `property_id`, `agency_property_no`;
- `observation_id`, `source_link_id`, PostgreSQL `canonical_row_hash`;
- `dom_conflict` (null or exact hash/time-bound `accept_dom` evidence);
- `historical` (zero or one exact held-row `reject_reassignment` decision).

Only source `28hse_agent_540` / scope `agent:540` is supported in named mode.
The plan binds the complete payload SHA-256 and has its own canonical SHA-256.
Its non-null reference must start `PUBLICATION-`; this naming convention records
an operator decision, not permission by itself. A controlled price-patch sidecar
or its previous approval is never publication authority. A draft preview retains
`approval_ref: null` and fails validation. Never fabricate hashes or mark an old
partial receipt full to satisfy the schema.

The operator CLI supports paired `--publication-plan` and
`--publication-plan-hash` arguments. Missing/malformed/duplicate arguments reject
before creating a client and never fall back to a broader batch. The legacy
payload/report interface remains compatible. **Both CLI modes are LIVE (`apply=true`),
not dry-runs; do not run either without a new explicit production approval.**
Pure `validateNamedPublicationPlan` / publisher tests create no production client.

Named selection runs after final policy-aware decoding. Only the selected
source/deal can attempt media or canonical publication, even when the full batch
contains other eligible records. Historical exclusions use the existing exact
review-row/binding validator; direct/peer/group/manual holds are never excluded.
Raw DOM conflicts remain `status: "review"`, and a DOM acknowledgement also requires
the canonical bedroom value to agree. Rechecks run before media and again under
bounded, properties-first native locks before COMMIT. A non-publication-column
hash protects price and every other canonical field. The new scoped decision is
recorded in publication audit; it never resolves a review or rewrites source links.
Existing unnamed batches now also hold historical proposed-number reviews and
unacknowledged raw source conflicts.

Saved-HTML content proposals are separate **human-review artifacts**: deterministic
facts and unselected photo URL metadata, with original hash/time and rights/visual
identity unverified. Do not splice them into a receipt-backed payload. Images are
not downloaded by preparing metadata; publication still requires approved content,
at most six selected photos and valid owned assets. No DB migration is needed.

Offline regressions (no `.db.test` files or credentials):

```powershell
npm run test:property-sync
npm run test:property-sync:daily
npm run test:property-sync:python
```

Use an OS-only environment and deny Node/Python sockets for these tests. Real SQL,
concurrency, media upload, authenticated staff acceptance and publication require
separate target-bound authorization; mock/offline PASS does not establish them.

The named publisher also has a synthetic, full-schema PostgreSQL regression:

```powershell
npm run test:property-sync:publication:owned
npm run test:property-sync:publication:owned:db
```

The first command is pure harness/cleanup unit testing. The second creates a new
owned local Docker container using the repository's pinned, already-installed
PostgreSQL image (`--pull never`), applies the current migrations, and exercises
the native publisher with synthetic records and preseeded media metadata only.
It accepts no database URL or provider credentials. Local Docker, container,
loopback port and actual PostgreSQL server identity must pass before migrations
or fixture writes; unavailable or unverifiable targets fail rather than skip or
fall back. No production data, saved source HTML or image bytes are required.
The launcher retains an atomic ownership handoff so that its parent can verify
and remove only its own container if the test child times out. Cleanup errors
remain failures, and retained synthetic output is identified in the test log.
CI runs the units and the full-schema regression in its existing owned-DB job.
These commands do not authorize or exercise real listing publication.

## Exact controlled review plans (offline first)

The optional operator sidecar `controlled-review-v1` is **not** a blanket review
override or an instruction to resolve a formal review. It is limited to one
already-bound draft target in one saved-capture controlled payload. The native
writer retains all original review rows, raw conflict markers, source bindings,
manual ownership, capture timestamps and publication gates.
The target must have an existing active source link matching its source ID,
offer and canonical; this mode cannot recreate a missing link or bind a new ID.

- A `reject_reassignment` historical decision freezes one exact review key and
  server-computed review-row MD5, its held source/previous agency/binding and the
  different proposed agency/target. Under the existing native table locks it may
  exclude only this rejected proposal from the historical-number check for that
  target. Direct/peer reviews, field conflicts and held relations still veto.
- `accept_dom` only acknowledges the exact bedrooms DOM/JSON-LD discrepancy. It
  binds the full conflict-array SHA-256, original HTML SHA-256 and capture time,
  and verifies every occurrence and normalized DOM value. It does not erase or
  change `status: "review"` in raw evidence. Other conflict types remain blocked.
- Canonical SHA-256 binds the complete sidecar to the frozen payload (computed
  with `meta.controlled_patch.review_plan_hash` omitted), then binds the sidecar
  hash back into that payload. Receipt identity includes that reference. The new
  observation stores `reviewAdjudication`, including the plan hash, approval
  reference, precise target/decisions and `formalReviewMutation: false`.
- The payload reference alone cannot authorize anything. Server-only options
  must provide the sidecar and matching operator-approved hash before a client
  can be created. Existing HTTP endpoints do not populate those options.

Offline schema/plan validation, **without `--apply`**, credentials or DB access:

```powershell
node scripts/mls/apply-source-snapshot.mjs --source 28hse --patch --payload <frozen-payload.json> --review-plan <operator-plan.json> --review-plan-hash <canonical-plan-sha256>
```

Both sidecar flags and `--patch` are required. The CLI is an operator trust
boundary, not proof that production mutation has been approved. Dry-run is not
a DB diff, review-row verification, ingestion permission or publication approval.
Never invent row hashes or atomic before-images to make it pass. Use the
synthetic `controlled-review-fixtures.mjs` and tests as the field-level format
reference, not as real production evidence. No schema migration is required.

## Controlled saved-capture patch preconditions (offline first)

New controlled applies require `evidence_mode: "saved-capture-v1"`, the existing
source/observation/field expectations, and `atomic_guards.version: "before-images-v1"`.
There must be one source guard per deduplicated source ID/deal and one canonical
guard per existing property UUID. A missing contact/promotion row is explicitly
`null`, not an empty object. Existing rows retain their complete PostgreSQL JSON
before-image (including observation and timestamps). Canonical guards pin the
whole-row PostgreSQL `md5(to_jsonb(p)::text)`, field ownership, group/membership
sets, and admin override row hashes. Description/images ownership values are
redacted with their PostgreSQL JSON hashes; a hash is a concurrency fingerprint,
not permission or cryptographic proof of source identity.

Inside the same native writer transaction, controlled mode forces READ COMMITTED,
then takes the existing properties-first lock and SHARE ROW EXCLUSIVE locks on
the contact, promotion, ownership, group, review/conflict and source-binding
tables. Table locks also protect absent-row slots and review insertions: merely
locking existing rows is insufficient. Lock timeout is 3 seconds, statement and
idle-in-transaction timeouts are 15 seconds; errors roll back without automatic
retry. These are coarse locks and can briefly block other writes. No provider,
image or external work belongs inside this transaction. Real PostgreSQL lock,
trigger and commit acceptance must be separately authorized and verified.

Before new observations or receipts are inserted, all before-images are compared.
A nonempty source contact cannot be cleared by an empty incoming field. Existing
identity, open historical company-number review, projection/manual ownership and
draft gates remain in force. Immediately before COMMIT, draft/status, description,
images, staff assignment and manually owned field rows are checked again. New
promotion writes reference their native observation for receipt-bound rollback.
Partial snapshots still cannot demote promotion tiers or infer absence. This
does not authorize publication, clear reviews, or restore inactive listings.

`readPatchBeforeImages` is an injected-query reader, not an importer or an approval
mechanism. Freeze its result for review; never silently regenerate expectations
at apply time to accept drift. Previously receipted payloads remain idempotently
replayable; an unreceipted legacy controlled payload without these guards cannot
write. Legacy codec-only dry-run support is not permission to apply.

Offline validation (no `--apply`, no credentials, no database client connection):

```powershell
node --test src/lib/mls/controlled-patch-safety.test.mjs
npm run test:property-sync
node scripts/mls/apply-source-snapshot.mjs --source 28hse --patch --payload <private-preview.json>
```

The bridge dry-run validates schema/gates only, not production DB differences or
permissions. Keep real before-images, source contact data and saved HTML private;
only synthetic test data belongs in Git. Rollback still requires the actual
forward receipt/observation IDs, committed after-images, concurrency checks and
separate approval. A review preview alone is not an executable rollback.

## Public block/phase display (read-only)

Public property details may enrich `source_location.block` / `source_location.phase`
from current accepted 28Hse observations. This is not a canonical property update:
it does not replay a receipt, promote a draft, alter timestamps, advance a full
snapshot baseline or infer absence. Listing cards and existing contact/freshness
selection are unchanged. No migration or provider call is required.

The detail reader uses only the page's selected active offers. Verified source
links, current valid observations, approved agent:540 company identity and native
source selection must agree. Held identities, open source reviews, unresolved
location conflicts, differing physical identity across sale/rent, and manual
location ownership/override keys suppress the enrichment. Missing fields remain
unknown; the UI omits them and never infers an exact floor from a floor range.
Manual description, images and all existing canonical fields remain unchanged.

Offline coverage (synthetic in-memory SQL and rendered detail facts):

```powershell
npm run test:property-sync
npm run test:property-experience
npm run test:listing-search
```

These tests do not prove which live listings will pass the guards. Production
readback, publication and deployment each need separate authorization. Do not
repeat a controlled apply to make this display-only change visible.

## Worker setup

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

Live adapter verification (2026-09-07): the authorized agent 540 response uses the full bilingual company heading, matching C-018613 licence, same-origin absolute listing links and `table.tablePair` detail fields. Sanitized sale/rent structure excerpts are regression fixtures. Legacy detail headings bind source ID and offer type. Modern headings use the additional page-URL checks below. Main price/area values are separated from per-foot prices, and conflicting duplicate fields reject the page. Exact units are never inferred from floor bands. Full collection evidence remains a separate run result; these fixture tests alone do not attest to every live page.

## Optional 28Hse Firecrawl basic transport

The default remains `transport: "http"`. To select the optional adapter, set
`sources.28hse.transport` to `firecrawl-basic` in a deployment-owned config, or
set `PROPERTY_SYNC_28HSE_TRANSPORT=firecrawl-basic` for the 28Hse CLI.
`FIRECRAWL_API_KEY` is read from the environment; there is no key in config,
request evidence or command arguments. The daily workflow forwards the
repository variable `PROPERTY_SYNC_28HSE_TRANSPORT` (default `http`) and secret
`FIRECRAWL_API_KEY` only to the collection step. This code does not create or
change either setting, enable a schedule, or grant ingestion/publication authority.
Validate the opt-in with an explicitly authorized dry-run before activation.

The adapter calls only `https://api.firecrawl.dev/v2/scrape`, using `proxy: basic`,
`maxAge: 0`, `storeInCache: false`, `skipTlsVerification: false` and a 25-second
provider timeout within the existing HTTP timeout. There is no auto/enhanced
proxy or direct-HTTP fallback. The approved source scope is robots.txt,
agent 540's exact sale/rent query shape and same-origin detail URLs without
query/fragment credentials. The same Fetcher applies robots, pacing, attempt
bounds and fail-closed source status handling to this transport.

Robots uses markdown; inventory and detail pages require `rawHtml`. Cleaned
`html` removes head/meta elements needed to verify identity and is rejected.
The provider's original and final URLs must both match the requested URL, its
reported proxy must be basic, and source status must be explicit. Provider
errors, unexpected proxy/redirects, cache-hit markers, empty output, truncated
output and documents missing their full HTML structure fail closed.
Provider response bytes are saved before interpreting success or metadata in
`checkpoints/.../provider-responses/`; frozen raw evidence also retains the
exact provider bytes as base64 and SHA-256. Source HTML is saved separately by
the existing checkpoint. Keep all these files in restricted evidence storage;
provider responses and source pages can contain personal/contact data.
Provider HTTP/credential/network failures use bounded `PROVIDER_*` diagnostics
through the workflow and recorded run, rather than source HTTP diagnostics.
Only a provider-reported source status can become `SOURCE_HTTP_*`.
The HTTP envelope has a separate 16 MiB limit so JSON escaping does not reduce
the existing 2 MiB UTF-8 source-document budget. The private frozen raw archive
still has its existing 512 MiB limit; larger runs fail the evidence gate rather
than dropping provider bytes or accepting a partial archive.

The October 16, 2026 bounded public-source experiment found modern headings
without the previous `#ID` marker. For that layout the parser requires the
index's requested detail URL, one matching `og:url`, and one matching
`al:web:url` or canonical URL, plus an unambiguous sale/rent heading.
All supplied identity URLs must agree on origin, path, advertisement ID and
offer type, including for legacy headings; conflicting or duplicate identity
tags reject the page. Live collection also refuses synthetic/structured detail
roots that could otherwise bypass public-page identity. Sanitized modern
fixtures explicitly identify their reconstruction from captured headings,
primary fact rows and provider-returned page metadata; they are not full raw
responses or production acceptance evidence.

Both sale and rent must finish contiguous pagination through verified empty
pages, with complete detail evidence. The 28Hse gate now checks that page proof
directly instead of trusting only `crawl_complete`. Existing rejected-record,
count-drop, baseline scope/version, receipt and absence rules remain in force.
Dry-run cannot submit, publish or advance a baseline. The optional transport
does not turn a few successful pages into a complete snapshot.

## T5 Phase 0 price/status dry-run + Property.hk Ask A Yes (2026-10-28)

[`property-price-status-sync.yml`](../../.github/workflows/property-price-status-sync.yml)
is a separate manual-first report workflow. Its 07:00 HKT cron defaults off unless
`PRICE_STATUS_SYNC_ENABLED=true`. It selects the newest existing **complete** 28Hse
artifact from the private evidence release; it adds no collector. It queues in
`property-sync-agent-540` and waits on the MLS writer lock inside a read-only
transaction. Only price/rent/status proposals are reported; staff overrides hold,
absence has no proposed change and evidence older than 36 hours is stale. Reports
contain hashed references and no PII. No Neon query or write was run for this PR.

Property.hk is a required later T5 fallback. `propertyhk_index_http.py` reads the
fixed 19-agent manifest with an honest UA and ≥3 seconds between requests;
`propertyhk_detail_browser.mjs` uses the approved normal headless path with a pinned
`PROPERTYHK_BROWSER_EXECUTABLE`, ≥3 seconds between requests (including redirects
and subresources), at most four transport attempts,
a ~20-second challenge cutoff and immediate stop on 429. `propertyhk_daily_diff.mjs`
compares browser-confirmed evidence against a read-only export/fixture with staff
overrides held and `absence_enabled=false`. These tools are not wired to the 09:00
owner workflow. No Firecrawl for Property.hk; later daily 28Hse Firecrawl-basic must
be a separate T5 workflow, never gold. See the [runbook](../../docs/runbooks/t5-price-status-dry-run.md)
for dispatch, SQL export templates, file-only commands and failure recovery.

## Daily inventory recovery (2026-10-01)

The property workflow runs at 09:00 Asia/Hong_Kong (`0 1 * * *` UTC), subject to GitHub scheduling delays. The schedule publishes an operator-approved owner-capture bundle through `owner-publication-v1`. It does not run `run_28hse_sync.py` and does not read `PROPERTY_SYNC_28HSE_TRANSPORT` or Firecrawl. It stays inactive unless `PROPERTY_SYNC_DAILY_ENABLED=true` and `OWNER_PUBLICATION_DAILY_ENABLED=true`. Keep `PROPERTY_SYNC_EXPECTED_BRANCH=main`. Manual HTTP shadow/apply/replay still requires `PROPERTY_SYNC_POLICY_APPROVED=python-v2.2` and the exact verified direct Neon database host in `PROPERTY_SYNC_EXPECTED_DATABASE_HOST`. Those manual modes are not the 09:00 schedule. See `docs/deployment/property-sync-daily.md`.

The paragraphs below describe the manual HTTP collector, its private baseline, and the 20-draft publication cap. They are not the steps for the 09:00 owner-capture write.

For a public code repository, set `PROPERTY_SYNC_EVIDENCE_REPO=owner/private-evidence-repository` and its restricted `PROPERTY_SYNC_EVIDENCE_TOKEN` with contents read/write for that repository. Create its private `property-sync-evidence` release and transfer the **latest accepted** baseline there with its exact request/receipt/hash intact before enabling collection. Never bootstrap over an existing production baseline just to make the job run. An existing private code repository can retain the default destination and GitHub token. The workflow checks destination privacy before collection or database access and fails closed. These variables, secrets, release and baseline are operational prerequisites; this change does not provision them.

Frozen requests, accepted baselines, raw evidence and compact outcomes go to the private release. Publication results are included in compact evidence. Actions artifacts are optional copies only for private code repositories, so Actions artifact quota cannot turn an otherwise successful run into a failed ingestion. Private release upload failures remain hard failures. Release assets do not expire automatically: the operator must apply a retention policy that preserves the current accepted baseline and unresolved request/receipt pairs; the 7/90-day Actions artifact settings do not delete release assets.

Before enabling writes, run shadow collection with a restored accepted baseline. Check complete sale AND rent pagination, expected company/license, no rejected details, acceptable count change and the three reported 28Hse source IDs. Run the exact frozen request through the existing apply path, then inspect publication outcomes: imported inventory is not automatically public; publication is capped at 20 attempted drafts per run and held items need review. Existing content, staff overrides, identity conflicts and media validation remain protected.

Absence handling stays disabled until a complete fresh snapshot and reviewed reconciliation exist. Network errors, security challenges, partial pagination and failed detail parsing are not evidence of withdrawal. The current absence algorithm compares only the previous accepted full snapshot; switching it on cannot clean up all historical stale source IDs. Historical reconciliation must be a separate reviewed, reversible operation, with source identities, before/after status, reason and receipt recorded.

Historical HTTP verification returned a Property.hk browser security check (403). Under Willy's **2026-10-28 Ask A Yes**, the sanctioned detail path is a fresh normal headless browser at ≥3 seconds per page, pinned by `PROPERTYHK_BROWSER_EXECUTABLE`, with a ~20-second challenge cutoff and immediate stop on 429. The site may set its own in-memory cookies; copied cookies, proxies, stealth and captcha solvers remain forbidden. Failed fetches never mean empty inventory. Full branch scope, ID semantics, ingestion and absence authority remain unverified/disabled. The old HTTP worker still fails closed on 403. See the [T5 Phase 0 runbook](../../docs/runbooks/t5-price-status-dry-run.md) for the separate agentblog HTTP index + browser detail + file-only diff tools.

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

## Exa-assisted Property.hk candidate review

`review_propertyhk_exa.py` is a standalone operator workflow. It does not join
the current sync schedule or call an ingestion/publication endpoint. The default
is offline and reads neither `EXA_API_KEY` nor `DATABASE_URL`. No new dependency
or credential is needed.

From the repository root, using the existing Python environment:

```powershell
python scripts/property-sync/review_propertyhk_exa.py `
  --config scripts/property-sync/propertyhk-exa.example.json `
  --fixture-bundle scripts/property-sync/tests/fixtures/propertyhk-exa `
  --known scripts/property-sync/tests/fixtures/propertyhk-exa/known.json `
  --output .private-sync-evidence/propertyhk-exa-offline-example
```

Choose a new output directory for each run; an existing directory is refused.
The bundled data is **synthetic**, including its timestamps, query scopes,
source identities, contacts and provider responses. It demonstrates behavior;
it does not verify live Property.hk layouts, real Exa retrieval or source rights.
The historical 563-advertisement export is never loaded automatically.

The pipeline separates discovery from contents, validates exact detail URLs,
then parses a bounded labelled main listing block from provider text.
Unsupported layouts stay unparsed. Only exact HTTPS `property.hk` /
`www.property.hk` hosts and the approved native `asking_detail/<digits>.html`
route are supported live. Fixture language aliases are offline-only and retain
their own fetch URLs. Review identities are branch-scoped; query labels are
not observed branch evidence. Advertisements, property numbers, agency custom
references and provider document/request IDs remain separate.

Outputs are `report.json`, `report.md`, exact provider text under
`evidence/text/`, and a SHA-256/byte-length `evidence/manifest.json`. Field
comparisons retain the old value, candidate value, raw fragments and evidence.
Sale/rent offers and usable/gross areas remain separate. Missing values do not
recommend clearing known fields. Source contacts never assign internal staff.

The six exclusive primary groups are `new_candidates`, `known_candidates`,
`field_differences`, `insufficient_data`, `identity_conflicts` and
`fetch_failures`. Independent reason codes and all language observations remain
available within each entry. Without `--known`, new means not matched against
a supplied reference; it does not mean absent from production.
Reference files use `propertyhk-exa-known/v1`, explicit provenance, branch-scoped
`review_key` values, fields, timestamps and evidence. Artifact references must
stay beneath the reference file's directory; duplicate/ambiguous identities fail.
Observed branch labels must match the review key's branch or an explicit
`branch_labels` list on that reference entry; this keeps human/source aliases
separate from the stable branch identifier. Advertisement/property/custom ID
fields cannot contradict the declared reference identity.
Source evidence and references remain private. Only clearly synthetic samples
may be committed.
Fields present on only one side are labelled `candidate_only` or
`reference_only`, with their raw evidence retained in `one_sided_fields`;
they are not counted as confirmed changes or comparable fields. A complete
sale/rent offer can keep a candidate reviewable while an optional offer/area
remains unparsed. Actual field conflicts, missing identity and genuinely
incomparable reference values still require review as insufficient/conflicting.

Config keys are `kind`, `synthetic`, `query_plan`, `fixture_aliases`, `limits`
and `approval_refs`. The example lists all bounds and four synthetic queries.
Query terms must come from the configured branch/estate/district terms.
Every API attempt, including retries and unknown outcomes, consumes capacity
and cost reservation. Request limits are at most 4 searches, 20 unique URLs,
5 URLs per contents batch, 3 attempts per operation/URL, 12 contents calls and
16 total calls. The program reserves USD 0.007/search and USD 0.010/contents
attempt, capped at USD 0.20. Provider estimates are separate from reservations
and neither is an invoice guarantee. Timeout, bounded Retry-After, permissions,
quota, budget and credential-echo errors stop or defer as documented in the
design. Interrupting an HTTP attempt/backoff preserves reservations and prior
successful observations; do not blindly resume an online run.

Online operation is **not approved or enabled** by this deliverable. Source
automated-access and content-reuse rights remain unverified; robots observations
do not establish those rights or resolve historical detail 403s. Exa cannot be
used to bypass access restrictions. `--online` requires separately confirmed
rights/trial/query approvals, `synthetic=false`, no fixture aliases, the
server-only switch `PROPERTYHK_EXA_ONLINE_ENABLED=true`, and an existing
server-provided `EXA_API_KEY`. Each approval record names the exact source host,
an external reference and literal `approved=true`; query/trial approvals bind
the sorted compact JSON SHA-256 of the plan and effective limits. These records
document external human/source approval; they cannot grant rights themselves.
No account, key, recharge, schedule or production setting is configured here.
Recheck official Exa Search, Contents and Pricing documentation before a
separately approved trial. `maxAgeHours=0` requests fresh extraction; cached/
crawled metadata or HTTP 200 does not verify an active listing.

Reports always use `propertyhk-exa-review/v1`, `full_snapshot=false`,
`ingestion_allowed=false`, `eligible_for_absence=false`, `publish_allowed=false`,
`baseline_advanced=false` and `production_writes=0`. Search disappearance,
403/404 and timeout never mean sold, withdrawn or zero inventory. Reports
cannot satisfy native completeness, policy, count-drop, bootstrap or absence
gates. A completed report may contain review/fetch issues (exit 0); invalid
input/approval/output is exit 2; a global fetch/budget/access stop with partial
evidence is exit 3. Console output contains counts and artifact paths.

Offline verification:

```powershell
python -m pytest scripts/property-sync/tests -q
npm run test:property-sync
```

Do not run `:db` suites for this feature. Offline functionality, real Exa
retrieval, import authorization and production deployment are separate states;
only offline functionality can be established by the fixture command.

## Reviewed saved-capture patches (offline preparation)

`scraping.worker.parse_28_detail()` is still the detail-parser entry point. Its labelled
location DOM supplies block/phase; a high/middle/low band or a range is not an exact
floor/unit identity. Explicit room/bathroom DOM wins over conflicting JSON-LD, with
the disagreement retained as evidence. No provider or schedule is enabled by this change.

For a newly reviewed saved-HTML subset, use the existing native request and `--patch`
bridge, with `meta.controlled_patch.evidence_mode = "saved-capture-v1"`:

- Every record has `captured_at`, the original UTC capture time (up to six fractional
  digits). Any supplied provider provenance must agree with that time and source URL.
- `scraped_at` is the new acceptance-envelope/receipt key in this mode, not a new fetch.
  Observations, source first-seen/link clocks and promotion evidence keep `captured_at`;
  scope/source `last_accepted_at` retains its acceptance meaning. Site publication/update
  dates remain separate. Saved captures cannot replace a newer current observation.
- `projection_fields` is an explicit canonical-column allowlist; `[]` requests no canonical
  field projection. Description, staff, images and status are not permitted in it. A partial
  patch never clears an absent value. The observation persists this restriction so later
  ordinary ingestion cannot reselect excluded saved fields, clear missing values or infer
  lifecycle changes from that partial capture. Full page/identity evidence remains intact;
  a separately accepted normal primary capture can replace the restricted observation.
  Independently accepted future full-snapshot absence still follows the existing lifecycle
  policy; the saved patch itself never authorizes absence or inactive revival.
  Creating a new property still initializes a draft.
- `expectations` freezes each source ID/deal, current observation ID, expected canonical
  ID (null for a new draft group), and reviewed prior field values. These are assertions,
  never alternate matching instructions. The native identity/company policy still decides
  the relationship. Drift aborts the transaction, including observations already staged.
- Inactive/terminal sources, identity ambiguity, open reviews/conflicts or a newly required
  field review stop a controlled patch. Manual ownership/overrides remain authoritative.
  Duplicate occurrences retain every source-conflict veto, regardless of input order.
  Neither `full_snapshot` nor absence inference can be enabled by this mode.

Public source freshness and contact expiry use the observation's original `fetched_at`,
not its later acceptance time. Accepting saved evidence is not evidence of a new fetch.

Run `npm run test:property-sync` and `npm run test:property-sync:python` with no credentials
and network blocked for offline regressions. The native bridge **without `--apply`** validates
format/completeness only; it does not calculate a production DB diff. SQL-port tests are not
PostgreSQL trigger/constraint or production acceptance evidence. Before any separately approved
execution, revalidate the named database/policy/baseline/quota and frozen IDs; publication,
media and any receipt-bound rollback require their own explicit approval. Never use a fabricated
sold/absence record or a restamped old capture as a rollback shortcut.
