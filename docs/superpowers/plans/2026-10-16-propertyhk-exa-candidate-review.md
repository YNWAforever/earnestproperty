# Exa-assisted Property.hk Candidate Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an offline-first candidate discovery, provider-text parsing and evidence review CLI without granting ingestion, publication or absence authority.

**Architecture:** Keep a standalone Python entry point and four focused modules beside the existing collectors. Separate discovery from contents, validate source identity before comparison, and render private JSON/Markdown reports from immutable observations. Use injected transports/clocks for the offline end-to-end path and all provider failure tests.

**Tech Stack:** Existing Python 3.11+ environment, Python standard library, Decimal and pytest 8.4.2; existing Node property-sync regressions. No additional package, SDK, paid LLM or database.

**Spec:** `docs/superpowers/specs/2026-10-16-propertyhk-exa-candidate-review-design.md`, committed as `89c837fb9baef4d69f3d43c65b1d5d53e3574d69`; written specification approved in chat on 2026-10-16.

**Status:** Written plan awaiting user review and execution-method selection. No task below has been executed.

## Global Constraints

- Scope: local development and offline verification only.
- Base: main `58d055ee89c9acb39d2ef06f51a0f22179a0c453`, including merged PR #266; use the existing isolated branch `codex/propertyhk-exa-candidates`.
- The historical set of 563 advertisements is not an inventory baseline, a completeness denominator, or a default comparison file.
- Source access and reuse permission are **unverified**.
- No source login, 403, robots restriction or other access control may be bypassed.
- Offline mode must not instantiate a live transport, read `EXA_API_KEY`, resolve DNS or perform network requests, even if an ambient API key is present.
- The switch defaults to `PROPERTYHK_EXA_ONLINE_ENABLED=false`. `EXA_API_KEY` is server-side only; a key's existence grants no permission.
- Search requests use `type="fast"`, `includeDomains=["property.hk"]` and at most five results.
- Request `text=true`, `maxAgeHours=0` and `subpages=0`. Omit summary, highlights, extras and deprecated livecrawl options.
- Parser version `propertyhk-exa-text-v1`, content format `provider_text`; retain exact stored UTF-8 text and SHA-256.
- Serialize normalized money as decimal strings. Keep advertisement ID, property number, agency reference and provider IDs distinct.
- Report discriminator `propertyhk-exa-review/v1`; always `full_snapshot=false`, `ingestion_allowed=false`, `eligible_for_absence=false`, `publish_allowed=false`, `baseline_advanced=false`, `production_writes=0`.
- Limits: 4 planned queries, 4 discovery requests including retries, 20 unique detail URLs, 5 URLs per contents request, 3 attempts per operation/URL, 12 contents requests and 16 total API requests.
- Reserve USD 0.007 per discovery attempt and USD 0.010 per contents attempt, within a maximum program reservation of USD 0.20. Unknown outcomes retain reservations; estimates are not invoices.
- Fixed HTTPS Exa origin, no redirects, verified TLS, 2 MiB response limit, 20-second transport timeout and 120-second loop elapsed budget. Backoff is 2/4 seconds without Retry-After; defer invalid or greater-than-30-second Retry-After.
- No production database test, read or write is needed. Offline tests must not consume `DATABASE_URL`.
- Existing collector, identity, selection, deduplication, snapshot, bootstrap, absence and ingestion behavior stays unchanged.
- No paid trial, production access change, credential setup, push, merge, deployment, schedule activation, publication or production import is included in approval of this document.

## Review Focus

1. Duplicate JSON keys, boolean limits/status codes, non-finite costs and malformed envelopes must fail before capacity or identity is accepted; Tasks 3, 4 and 6 pin these cases.
2. CRLF, CJK text, supplementary Unicode characters and repeated field text must retain exact hash/span evidence rather than point into normalized text; Task 2 pins this.
3. Fixture/reference artifact traversal or symlink escape and output-directory reuse must never read outside the supplied evidence root or overwrite prior evidence; Tasks 5 and 6 pin these.
4. Two query scopes or languages returning one raw advertisement ID must not cause a global merge, shared last-write-wins value, or repeated successful contents charge; Tasks 1, 4 and 6 pin this.
5. A vendor cost inconsistent with the tariff/reservation or an API-key echo in a result/header/error must stop further requests without exposing or refunding the response; Tasks 3, 4 and 6 pin this.

---

## File Map and Execution Context

Repository root for every relative path in this plan:
`C:\Users\laich\.codex\worktrees\28hse-collection-debug-20261015\Earnestproperty`.
Do not modify the original workspace or its unrelated `bun.lockb`/untracked work.

| File | Owner and purpose |
| --- | --- |
| `scripts/property-sync/scraping/propertyhk_candidates.py` | Task 1: URL/ID/query-scope contracts, review identity and conservative language grouping. |
| `scripts/property-sync/scraping/propertyhk_text.py` | Task 2: bounded labelled provider-text parser and exact field evidence. |
| `scripts/property-sync/scraping/exa.py` | Tasks 3-4: provider operations, safe HTTP boundary, retry and reservation controller. |
| `scripts/property-sync/scraping/propertyhk_review.py` | Task 5: explicit reference validation, comparison, six groups and evidence/report rendering. |
| `scripts/property-sync/review_propertyhk_exa.py` | Task 6: strict CLI/config/fixture loading, gates and orchestration. |
| `scripts/property-sync/propertyhk-exa.example.json` | Task 6: synthetic approved-for-fixture scopes and disabled live configuration. |
| `scripts/property-sync/tests/test_propertyhk_candidates.py` | Task 1 regressions. |
| `scripts/property-sync/tests/test_propertyhk_text.py` | Task 2 regressions. |
| `scripts/property-sync/tests/test_exa.py` | Tasks 3-4 provider and policy regressions. |
| `scripts/property-sync/tests/test_propertyhk_review.py` | Tasks 5-6 comparison, artifacts and CLI end-to-end regressions. |
| `scripts/property-sync/tests/fixtures/propertyhk-exa/` | Task-owned, explicitly synthetic bundles/text/reference/expected samples. |
| `scripts/property-sync/README.md`, `.env.example` | Task 6: offline use, exact gates, output limits and server-only names. |

Reuse the current pytest convention of adding `scripts/property-sync` to `sys.path`. Test helpers stay in their owning test file; do not change the global collector test harness. Fixture text may use UTF-8 Chinese because those labels and units are part of the feature.

For the commands below initialize these task-local PowerShell variables:

```powershell
$taskRepo = 'C:\Users\laich\.codex\worktrees\28hse-collection-debug-20261015\Earnestproperty'
$taskPython = 'C:\Users\laich\.codex\worktrees\full-property-sync-20261001\Earnestproperty\scripts\property-sync\.venv\Scripts\python.exe'
Set-Location -LiteralPath $taskRepo
```

Check branch/HEAD/status before editing. The expected starting HEAD is the local plan-document commit on top of `89c837fb`; only the reviewed design and this plan may differ from main at that point. If the interpreter is unavailable, resolve a verified local interpreter without installing dependencies or loading production configuration. An access failure for this worktree is a local tool/permission issue, not a source failure.

## Shared Data Contracts

Use JSON-compatible dictionaries with these exact keys; no shared framework or new model module is needed. Each producing module owns validation. Functions below return these shapes, not ingestion records.

| Shape | Required keys and semantics |
| --- | --- |
| Detail URL | `original_url`, `normalized_url`, `source_advertisement_id` (digit string), `language` (nullable). |
| Query scope | `query_id`, `branch_id`, `branch_labels`, `estate_terms`, `district_terms`, `query_terms`; identifiers/labels are approved configuration, never recovered from arbitrary search snippets. |
| Field | `value`, `state` (`valid`, `missing`, `conflict` or `unparsed`), `raw` (list), `evidence` (list), `alternatives` (list). Missing values are null. |
| Text evidence | `kind="source_text"`, `content_sha256`, `line_start`, `line_end` (one-based), `char_start`, `char_end` (zero-based Unicode code-point offsets, end exclusive), `raw`. Span indexes refer to the unchanged text. |
| Identity | `state` (`verified`, `missing` or `conflict`), `branch_id`, `source_advertisement_id`, `source_property_number`, `agency_reference`, `review_key`, `reasons`. Verified review keys serialize as `["propertyhk", branch_id, advertisement_id]`; all others are null. |
| Observation | `detail`, `query_scopes` (list), `identity`, `language`, `fields`, `provider`, `text`, `content_sha256`, `parser_version`, `parse_state`, `reasons`. Preserve each language/text observation after grouping. Failed fetches use null text/hash, empty fields and `parse_state="fetch_failed"`. |
| Discovery result | `query_id`, `results` (validated detail dictionaries plus safe provider metadata), `rejected_results`, `request_ids`, `errors`. |
| Contents result | `pages` (one outcome per requested normalized URL), `request_ids`, `stop_reason`; each page has `detail`, `status`, `text` (nullable), `provider`, `attempts`, `reasons`. |

Provider metadata is an allowlist: provider/endpoint, opaque document ID, body/header request IDs, per-URL status and cached/crawled source, provider-estimated publication/retrieval metadata, local UTC receipt time and attempt. It contains no request headers or raw error body. Field evidence and provider metadata use distinct evidence types.

Normalize the host while preserving an approved language route in `normalized_url`. A native route and a fixture English alias have distinct fetch URLs but may share a verified review key. Repeated discoveries of the same normalized URL share a fetch and retain all query scopes; never deduplicate contents requests by advertisement ID alone.

An offer field value is a list of records with `deal_type` (`sale`/`rent`), `amount` (decimal string/null), `currency`, `unit`, `period`, `raw` and `evidence`. Area fields remain separate with decimal-string `amount`, `unit` (`sq_ft`/`sq_m`) and `approximate`. No inferred currency, period, floor, unit, date or staff identity.

## Task 1: Validate Candidate URLs and Scoped Review Identity

**Files:** Create `scraping/propertyhk_candidates.py` and `tests/test_propertyhk_candidates.py` under `scripts/property-sync/`.

**Interfaces:**
- Consumes: raw URLs, query-scope dictionaries, parsed field dictionaries and optional explicit native-index bindings.
- Produces: `CandidateError(code: str)` with safe reason code only.
- Produces: `normalize_detail_url(raw_url: str, *, fixture_aliases: dict[str, str] | None = None, online: bool = False) -> dict`.
- Produces: `validate_query_plan(entries: list[dict], *, synthetic: bool) -> list[dict]`.
- Produces: `validate_review_identity(detail: dict, fields: dict, scope: dict, *, native_index: dict | None = None) -> dict`.
- Produces: `group_language_observations(observations: list[dict]) -> list[dict]`, returning groups with `review_key`, `observations`, `reasons` and any field conflicts.

- [ ] **Step 1: Write failing identity and scope tests.**

```python
def test_native_url_keeps_advertisement_digits():
    actual = normalize_detail_url("https://property.hk/asking_detail/00101.html")
    assert actual["normalized_url"] == "https://www.property.hk/asking_detail/00101.html"
    assert actual["source_advertisement_id"] == "00101"

def test_url_rejects_spoofing():
    with pytest.raises(CandidateError, match="url_not_allowed"):
        normalize_detail_url("https://www.property.hk.evil.invalid/asking_detail/101.html")
```

Parameterize `test_url_rejects_ambiguous_forms` over HTTP, credentials, `:443`, foreign/subdomains, query/fragment, backslash, `%2f`, `%2e`, dot segments, non-ASCII digits, controls and unknown paths. Assert zero accepted results. Test fixture alias `/fixture-en/asking_detail/{id}.html` maps to the native identity offline and is rejected online.

Add `test_identity_requires_main_id_and_observed_branch`: main ID matches but no observed/index branch gives `state="missing"` and no key; a conflicting ID/branch gives `state="conflict"`. An exact URL/ID/branch native-index binding may supply missing branch evidence but never replace missing/conflicting detail ID. Mismatched requested scope stays reviewable; never relabel it silently.

Add `test_query_terms_are_approved_and_bounded` for unknown/duplicate query IDs, unknown terms, empty labels and a fifth plan entry. Add `test_language_grouping_is_scoped_and_preserves_conflicts`: same ID in branches A/B yields separate keys; consistent A Chinese/English yields one group with two observations; property/custom ID conflict blocks grouping; value conflict retains both values. Build the minimal dictionaries described in Shared Data Contracts directly in this test file.

- [ ] **Step 2: Run RED.**

Run `& $taskPython -m pytest scripts/property-sync/tests/test_propertyhk_candidates.py -q`.
Expected: failure for the missing module/functions, not a fixture/network/database error.

- [ ] **Step 3: Implement the five interfaces.**

Accept only exact HTTPS source hosts and `/asking_detail/[0-9]+.html`; preserve original URL and digit string. Inspect the raw string before URL normalization so control/encoded-path tricks are rejected. Fixture aliases are explicit template-to-language mappings, disabled online. Keep source property/custom IDs separate; compare identities only inside approved branch scope.

- [ ] **Step 4: Run GREEN.**

Repeat the Task 1 pytest command; all cases must pass without network or environment reads.

- [ ] **Step 5: Commit the independently tested identity contract.**

Stage only the two Task 1 files. Commit message: `feat: validate scoped Property.hk review identities`.

## Task 2: Parse Bounded Provider Text with Exact Evidence

**Files:** Create `scraping/propertyhk_text.py`, `tests/test_propertyhk_text.py` and synthetic text fixtures under `tests/fixtures/propertyhk-exa/text/`.

**Interfaces:**
- Consumes: Task 1 detail/query scope/identity functions, exact text and safe provider metadata.
- Produces: `parse_provider_text(text: str, *, detail: dict, scope: dict, provider: dict, native_index: dict | None = None) -> dict`, returning an Observation.
- Produces no HTML, canonical unit identity, staff assignment or lifecycle command.

- [ ] **Step 1: Write failing parser tests and minimal labelled fixtures.**

Use synthetic main headings `# Listing details` / `# \u6a13\u76e4\u8a73\u60c5` and explicit Advertisement ID, Branch, Property number, Agency reference, Estate, Sale price, Rent, Usable area, Gross area, Source updated, Published, Floor, Unit and Contact blocks. Include Chinese label aliases for advertisement/property/custom ID, branch, sale/rent, usable/gross area and dates. Mark the fixture manifest synthetic; these are designed contracts, not verified live layouts.

```python
def test_dual_offers_and_ten_thousand_amount(synthetic_observation):
    offers = synthetic_observation["fields"]["offers"]["value"]
    assert [(item["deal_type"], item["amount"]) for item in offers] == [
        ("sale", "7100000"), ("rent", "22000")
    ]
    assert offers[0]["currency"] == "HKD"
    assert offers[1]["period"] == "month"
```

Define `synthetic_observation` locally by parsing labelled `HK$ 710 \u842c` and `HK$ 22,000 / month`, exact ID `00101` and branch `SYNTHETIC-A`. Test full HKD, `7.1M`, malformed grouping, missing currency/period and negotiable text. Unknown/contradictory price stays null/raw with reasons; Decimal amounts never become float.

Add named tests with these assertions:

- `test_areas_keep_type_unit_and_approximation`: usable `70 sq m` approximate and gross `900 sq ft` stay separate; missing type/unit remains unresolved.
- `test_dates_and_floor_are_not_inferred`: ISO date `2026-10-15` remains date-only; `01/02/26` and invalid dates stay null/raw; high floor is not an exact floor; absent unit stays null.
- `test_number_kinds_and_contacts_remain_separate`: the three ID labels differ, whole source contacts remain independent, no staff field is produced.
- `test_history_related_ads_and_footer_cannot_validate_listing`: end the main block at Transaction history/Related listings/Advertisement/Footer and Chinese equivalents; excluded values cannot populate identity, offers or contacts.
- `test_unknown_multiple_or_conflicting_main_blocks_are_unparsed`: preserve text/hash/reasons and no accepted identity; repeated equal labels retain evidence, differing labels retain alternatives.
- `test_unicode_crlf_and_repeated_text_evidence_is_exact`: use CJK, an emoji, CRLF and repeated amounts; each `text[char_start:char_end]` equals evidence `raw`, line numbers match the original text, and hash equals SHA-256 of unchanged UTF-8 bytes.
- `test_provider_date_and_receipt_are_not_source_update`: provider-estimated date and local receipt never fill a missing source date or active status.

- [ ] **Step 2: Run RED.**

Run `& $taskPython -m pytest scripts/property-sync/tests/test_propertyhk_text.py -q`.
Expected: missing parser contract fails; Task 1 remains green.

- [ ] **Step 3: Implement `parse_provider_text`.**

Use a small versioned heading/label/delimiter table. Parse only one recognizable main block, retain exact code-point offsets without newline normalization, and call Task 1 identity validation. Require explicit HKD markers for monetary normalization; distinguish sale/rent, area types, date precision and whole contact blocks. Keep unknown structures and conflicts instead of guessing.

- [ ] **Step 4: Run GREEN.**

Run the Task 1 and Task 2 files together; all cases pass, including exact text evidence and conflicting-language observations.

- [ ] **Step 5: Commit parser and synthetic text cases.**

Stage only Task 2 files/fixtures. Commit message: `feat: parse Property.hk provider text with field evidence`.

## Task 3: Implement Separate Exa Discovery and Contents Contracts

**Files:** Create `scraping/exa.py`, `tests/test_exa.py` and synthetic API response cases under `tests/fixtures/propertyhk-exa/provider/`.

**Interfaces:**
- Consumes: Task 1 URL validation and approved query scopes.
- Produces: `ExaError(code: str)` with sanitized metadata only.
- Produces: `exa_http_request(endpoint: str, payload: bytes, token: str | None, *, timeout_seconds: float, max_bytes: int) -> tuple[int, dict[str, str], bytes]`.
- Produces: `ExaClient(*, request: Callable, now: Callable, monotonic: Callable, sleep: Callable, limits: dict, token: str | None = None, fixture_aliases: dict[str, str] | None = None, online: bool = False)`.
- Client methods: `discover(scope: dict) -> dict`, `contents(urls: list[str]) -> dict`; properties `metrics: dict`, `stop_reason: str | None`. Task 4 adds retries/ledger without changing these signatures.
- The injected request callable uses the `exa_http_request` signature. Offline clients require an explicit fake request; construction never reads credentials.

- [ ] **Step 1: Write failing provider/transport tests with local fakes.**

```python
def test_request_shapes(recording_client):
    recording_client.discover(recording_client.test_scope)
    search = recording_client.recorded_json[0]
    assert search["type"] == "fast"
    assert search["includeDomains"] == ["property.hk"]
    assert search["numResults"] == 5
    assert set(search) == {"query", "type", "includeDomains", "numResults"}
    recording_client.contents(["https://www.property.hk/asking_detail/00101.html"])
    contents = recording_client.recorded_json[1]
    assert contents == {
        "urls": ["https://www.property.hk/asking_detail/00101.html"],
        "text": True, "maxAgeHours": 0, "subpages": 0
    }
```

`recording_client` is a local fixture wrapping the real ExaClient with a request fake that decodes and records payload bytes and returns explicit synthetic Search/Contents envelopes. Its first scope uses only `SYNTHETIC-A` and approved fixture terms. Return URL-keyed `statuses`, an opaque result document ID and nonempty text.

Add `test_contents_checks_each_url_not_http_200`: mixed success/error, shuffled arrays, missing/duplicate status/result, empty text, returned foreign URL and changed ID produce distinct outcomes without accepted fields for failures. Test original/normalized URL provenance and no `ids` payload.

Add `test_provider_metadata_does_not_impersonate_origin`: preserve cached/crawled, null/mismatched body/header request IDs and provider-estimated dates separately. Discovery snippets/links and extra returned subpages are never parsed or followed.

Add `test_strict_json_and_error_redaction`: reject duplicate JSON keys, invalid envelopes and boolean HTTP codes; generated in-memory credential sentinels in text, request IDs, headers and exception messages never appear in stored outcomes. An echo stops/discards the response.

Add `test_http_boundary_has_fixed_origin_tls_no_redirect_and_size_timeout_bounds`: mock standard-library opener/response; only `https://api.exa.ai/search` and `/contents` are accepted, redirects are refused before a second request, default verified TLS is used, reads stop at 2 MiB and timeout is 20 seconds. No test performs real HTTP or opens a browser.

- [ ] **Step 2: Run RED.**

Run `& $taskPython -m pytest scripts/property-sync/tests/test_exa.py -q`.
Expected: missing Exa adapter fails.

- [ ] **Step 3: Implement the provider contracts and safe transport.**

Send only the specified options. Strictly correlate status IDs to validated requested URLs, ignoring array position and opaque provider IDs. Return safe page outcomes without persisting raw envelopes/errors. Allowlist metadata, reject invalid numeric/status shapes and disable redirect following at the HTTP boundary. Keep provider text separate from all original-HTML transports.

- [ ] **Step 4: Run GREEN.**

Run Task 3 tests plus Tasks 1-2. All transport fakes and validation cases pass with no real key/network.

- [ ] **Step 5: Commit the adapter contract.**

Stage only Task 3 files/fixtures. Commit message: `feat: add independent Exa discovery and contents adapter`.

## Task 4: Bound Retries, Requests, Time and Cost Reservations

**Files:** Modify `scraping/exa.py` and `tests/test_exa.py`.

**Interfaces:**
- Consumes: Task 3 operations and injected clock/sleeper/request callable.
- Produces: `AttemptLedger(limits: dict, *, monotonic: Callable)`, `reserve(operation: str, ids: tuple[str, ...]) -> None`, `observe_cost(amount: Decimal | None) -> None`, `snapshot() -> dict`.
- Ledger snapshot keys: `search_requests`, `contents_requests`, `total_requests`, `unique_detail_urls`, `url_attempts`, `reserved_usd`, `provider_estimated_usd`, `stop_reason`.
- ExaClient owns one ledger for the whole run; snapshots serialize Decimal as plain decimal strings.

- [ ] **Step 1: Write failing retry/reservation tests using a fake monotonic clock and advancing sleeper.**

```python
def test_unknown_outcome_keeps_reservation(timeout_then_success_client):
    client = timeout_then_success_client
    client.discover(client.test_scope)
    assert client.ledger.snapshot()["search_requests"] == 2
    assert client.ledger.snapshot()["reserved_usd"] == "0.014"

def test_retry_only_failed_urls(partial_then_success_client):
    client = partial_then_success_client
    client.contents(client.test_urls)
    assert client.recorded_json[1]["urls"] == [client.test_urls[1]]
    assert client.ledger.snapshot()["url_attempts"] == {
        client.test_urls[0]: 1, client.test_urls[1]: 2
    }
```

Define these local factories in `test_exa.py`: the first raises TimeoutError once then returns a search response; the second returns success for URL 1 and an error with `httpStatusCode=503` and no tag for URL 2, then success for URL 2. Do not invent retryable provider tags: an unrecognized nonempty tag is non-retryable; recognized denial/robots/login indicators stop the run. Numeric 429/5xx without an unknown tag can be retried under the same provider and bounds.

Parameterize `test_every_attempt_reserves_before_request` for search/contents 429, 5xx and timeout; assert 2/4-second fallback delay, at most three attempts, no refund and no retry of success. Parameterize valid delta/date Retry-After, invalid values, values above 30 and remaining elapsed budget; assert deferral instead of immediate retry. Mock clocks; never sleep in tests.

Add `test_all_global_caps_are_enforced_before_http`: fourth discovery allowed/fifth denied, twentieth unique URL allowed/twenty-first denied, batches at most five, at most twelve contents/sixteen total calls, and a lowered USD cap stops before the next request. Track each URL at most three times across three retry rounds, even on timeout.

Add `test_auth_source_denial_and_unknown_errors_fail_closed`: API 401/402/403/payment/quota and per-URL denied/robots/login stop further requests; 404 and unknown tags stay failed observations without withdrawal or fallback. Prior successful pages survive a later stop.

Add `test_invalid_limit_or_cost_never_opens_capacity`: reject bool/negative/NaN/Infinity cost/limit values, above-spec limits, malformed tariffs and estimates exceeding the reservation/tariff or program cap. Lower valid estimates are retained without refunding reservations. Unknown outcomes keep reservations. A 120-second elapsed deadline blocks attempts/backoff; a credential echo also stops without refund.

- [ ] **Step 2: Run RED.**

Run the newly added Task 4 cases in `test_exa.py`. Expected: missing ledger/retry behavior fails, while the Task 3 contract cases still pass.

- [ ] **Step 3: Implement ledger and retry orchestration.**

Reserve before every attempt and count discovery retries against the four-request allowance. Deduplicate normalized URLs for fetching, preserve all scope references, and process contents in up to three rounds/four batches per round. Retry eligible failed URLs only. Use Decimal reservations and separate estimated costs. A global stop prevents all later requests and returns partial outcomes; never auto-resume or switch services.

- [ ] **Step 4: Run GREEN.**

Run `& $taskPython -m pytest scripts/property-sync/tests/test_exa.py -q`.
Expected: all adapter/retry/budget cases pass with fake time and no network.

- [ ] **Step 5: Commit bounded request policy.**

Stage only the two Task 4 files. Commit message: `feat: bound Exa requests retries and cost reservations`.

## Task 5: Compare Candidates and Write Private Evidence Reports

**Files:** Create `scraping/propertyhk_review.py`, `tests/test_propertyhk_review.py`, and synthetic reference/expected samples under `tests/fixtures/propertyhk-exa/`.

**Interfaces:**
- Consumes: Task 1 grouping function, raw Task 2 observations, failed-fetch observations, Task 4 metrics and explicit local reference. `build_review_report` owns grouping; callers do not pre-group its input.
- Produces: `load_reference(path: Path) -> dict`, accepting only `kind="propertyhk-exa-known/v1"`, explicit provenance and branch-scoped entries.
- Produces: `build_review_report(observations: list[dict], *, known: dict | None, metrics: dict, stop_reason: str | None, mode: str, retrieved_at: str, synthetic: bool) -> dict`.
- Produces: `write_review_artifacts(report: dict, output_dir: Path) -> dict[str, Path]`, returning report/Markdown/manifest paths.
- Reference entries have `review_key`, separate property/custom IDs, comparable `fields`, `observed_at` and `evidence`; optional native-index bindings additionally identify the exact URL/ID/branch. Never accept an ingestion payload.

- [ ] **Step 1: Write failing comparison and artifact tests.**

```python
def test_report_cannot_confer_apply_or_absence_authority(six_group_report):
    report = six_group_report
    assert report["kind"] == "propertyhk-exa-review/v1"
    for name in ("full_snapshot", "ingestion_allowed", "eligible_for_absence",
                 "publish_allowed", "baseline_advanced"):
        assert report[name] is False
    assert report["production_writes"] == 0
    assert set(report["groups"]) == {
        "new_candidates", "known_candidates", "field_differences",
        "insufficient_data", "identity_conflicts", "fetch_failures"
    }
```

Build `six_group_report` locally from six explicit observations/reference entries. Assert one primary group per observation in the spec priority order. New/known/difference groups require verified identity, observed estate/address and at least one complete offer; optional missing fields are flagged, never filled.

Add `test_diffs_show_old_candidate_and_evidence_without_null_deletions`: sale `7000000` to `7100000` is one change, rent `22000` stays independent, absent floor/unit/area is not a deletion, and incomparable currency/period/area stays insufficient. No-reference reports set `comparison_performed=false` and disclaim production absence.

Add `test_reference_is_explicit_scoped_and_not_a_snapshot`: reject wrong discriminator, duplicate/conflicting keys, ambiguous branch identity, malformed values and traversal/absolute/symlink artifact references outside the supplied manifest root. A reference sample reports only scoped overlap; unmatched reference entries never become missing-source/withdrawal recommendations.

Add `test_artifact_hashes_markdown_safety_and_collision`: rehash exact UTF-8 text, verify manifest byte lengths and evidence links, escape malicious Markdown/HTML source labels, reject path separators as artifact names and refuse existing output directories before writing. No automatic evidence deletion; no `.html` output or executable source markup.

Add `test_rerun_is_identical_with_same_clock_and_order_independent_inputs`: permute input order; fixed timestamp/version yields identical reports/hashes. Assert no staff/canonical-unit/receipt/apply envelope and no credential sentinel anywhere in generated artifacts/stdout.

- [ ] **Step 2: Run RED.**

Run `& $taskPython -m pytest scripts/property-sync/tests/test_propertyhk_review.py -q`.
Expected: missing report interfaces fail; no database/reference auto-discovery occurs.

- [ ] **Step 3: Implement comparison and report output.**

Compare only branch-scoped proven identities and unambiguous compatible values. Keep raw/reference/candidate/evidence columns and independent reason codes even when primary classification is insufficient. Freeze authority fields at construction and revalidate before writing; expose no option to override them. Write only allowlisted artifacts into a new private run directory with deterministic ordering.

- [ ] **Step 4: Run GREEN.**

Run Task 5 tests plus Tasks 1-2; all grouping/comparison/artifact checks pass.

- [ ] **Step 5: Commit review reports.**

Stage only Task 5 files/fixtures. Commit message: `feat: render scoped Property.hk candidate evidence reports`.

## Task 6: Integrate Offline CLI, Fixtures, Documentation and Regression Evidence

**Files:** Create `review_propertyhk_exa.py`, `propertyhk-exa.example.json` and the complete synthetic fixture bundle; modify `tests/test_propertyhk_review.py`, `README.md` and repository `.env.example`. All Python paths are under `scripts/property-sync/`.

**Interfaces:**
- Consumes: Tasks 1-5 exact interfaces and validated configuration.
- Produces: `load_review_config(path: Path, *, online: bool) -> dict`.
- Produces: `load_fixture_request(bundle_dir: Path) -> Callable`, matching the Task 3 request signature, with all paths bound beneath a synthetic fixture manifest.
- Produces: `validate_online_approval(config: dict, environ: Mapping[str, str]) -> str`, returning an existing key only after every approval gate succeeds.
- Produces: `run_review(config: dict, *, client: ExaClient, known: dict | None, now: Callable) -> dict` and `main(argv: list[str] | None = None) -> int`.
- CLI arguments: required `--config`, `--output`; default offline requires `--fixture-bundle`; optional `--known`; mutually exclusive `--online`. No apply, replay, publish or cron flag. Exit 0 = report completed (review issues may remain); 2 = invalid config/input/approval; 3 = fetch/budget/access/response-integrity stop with a partial report where valid input permits it.

- [ ] **Step 1: Write failing CLI/config/end-to-end tests.**

The example config has exact keys `kind="propertyhk-exa-config/v1"`, `synthetic`, `query_plan`, `fixture_aliases`, `limits`, `approval_refs`; reject unknown/duplicate keys and credential fields. Each query-plan entry follows Task 1 scope keys. `approval_refs` has `query_plan`, `source_access`, `content_reuse`, `online_trial`, all null in the example; synthetic plans are approved for fixture execution only.

For a future separately approved live configuration, each approval entry requires a nonempty external `reference`, literal `approved=true` and `hostname="property.hk"`. Query approval additionally requires `query_plan_sha256`; trial approval requires both `query_plan_sha256` and `limits_sha256`, equal to SHA-256 of the respective sorted-key, compact UTF-8 JSON values. These fields record separately confirmed human/source permission and bind the reviewed input; they cannot establish rights or grant permission themselves. Tests construct synthetic approval records in memory only. No approval registry, new credential or external verification service is added.

Create `manifest.json`, `query-plan.json`, `discovery.json`, `contents.json`, `known.json` and text/expected report files inside the bundle. All manifests/reports state `synthetic=true`; every observation carries source/provider provenance. The bundle describes four queries and seven unique URLs: six native IDs `00101`-`00106` and one fixture English alias of `00101`. Design outcomes are one field difference (00101 dual offers), one new (00102), one known (00103), one unparsed (00104), one identity conflict (00105), and one 404 failure (00106). Match language evidence before grouping 00101; fetch each normalized route once.

```python
def test_fixture_cli_is_complete_without_network_credentials_or_db(fixture_run):
    assert fixture_run.exit_code == 0
    assert fixture_run.api_key_reads == 0
    assert fixture_run.database_reads == 0
    assert fixture_run.network_calls == 0
    assert fixture_run.report["synthetic"] is True
    assert {key: len(value) for key, value in fixture_run.report["groups"].items()} == {
        "field_differences": 1, "new_candidates": 1, "known_candidates": 1,
        "insufficient_data": 1, "identity_conflicts": 1, "fetch_failures": 1
    }
```

Define `fixture_run` locally using the real CLI with fake fixture transport/time and `tmp_path`. Fail the test on EXA_API_KEY/DATABASE_URL reads, socket/URL opening, HTTP apply or subprocess calls; ambient fake values must not change behavior. A handled per-URL 404 is a completed report, not a global run stop or absence action.

Add `test_online_gate_precedes_transport_creation` for each missing switch/access/reuse/query/trial/key gate, changed approved query/limits, synthetic aliases online and key presence alone. Assert exit 2, zero transport construction/calls and no token in output. Do not create real credentials or approval documents asserting source rights.

Add `test_config_fixture_paths_and_partial_run_are_safe`: missing/malformed JSON, bool limits, unknown keys, traversal/symlink fixtures, same raw ID across scopes, no results, interruption after one successful page and budget/denial stop. Assert safe failure/partial artifacts, stable provenance, request counters and no blind resume.

- [ ] **Step 2: Run RED.**

Run the new CLI cases in `test_propertyhk_review.py`; expect missing CLI/config behavior to fail without real network or DB.

- [ ] **Step 3: Implement orchestration, example configuration and usage documentation.**

Keep fixture and online transport construction separate. In offline mode open only explicit synthetic files and use the fixture clock; never load dotenv or read key/DB variables. In online mode validate all independent gates first, then obtain the existing server environment key and fixed-origin transport. Join discovered URLs to all query scopes, fetch unique validated URLs, parse successful pages, retain failed-fetch observations and pass the ungrouped observations plus explicit known file to Task 5. A completed report with handled per-URL failures and no global stop exits 0; a global `stop_reason` exits 3.

Add empty `EXA_API_KEY=` and `PROPERTYHK_EXA_ONLINE_ENABLED=false` beside operator transport settings in `.env.example`; do not modify actual environment files, workflow/cron or production configuration. README must include the command below, config keys, each report group, provenance limits, source-rights uncertainty, estimated versus reserved costs and the absence of live/import/deployment acceptance.

- [ ] **Step 4: Run final offline verification and record actual results.**

```powershell
& $taskPython -m pytest scripts/property-sync/tests -q
npm run test:property-sync
& $taskPython scripts/property-sync/review_propertyhk_exa.py --config scripts/property-sync/propertyhk-exa.example.json --fixture-bundle scripts/property-sync/tests/fixtures/propertyhk-exa --known scripts/property-sync/tests/fixtures/propertyhk-exa/known.json --output .private-sync-evidence/propertyhk-exa-offline-final
git diff --check
```

Expected: all existing/new Python tests pass; the existing 76 Node regressions pass; the real CLI produces the six-group synthetic JSON/Markdown/text/manifest set with exact hashes and no authority. The output directory must not pre-exist; select a new explicit run suffix for a later verification rather than deleting evidence.

The pre-change Python 240/Node 76 baseline is historical evidence, not a result for this implementation. Record actual counts, commands, interpreter path, fixture report hash and exit codes. Confirm existing Firecrawl basic/detail identity, Property.hk HTTP/native-index, scoped dedup/contact selection, bootstrap/count-drop/full-snapshot and absence tests retain their assertions. Do not run any `:db` suite or access production to supplement these results. Do not rerun unrelated suites without a new concern.

- [ ] **Step 5: Commit integration and prepare the whole-branch review handoff.**

Stage only the Task 6 files and explicitly synthetic samples. Commit message: `feat: integrate offline Property.hk Exa candidate review`. Request the chosen execution method's final independent reviewer against the complete branch and spec; resolve blocking findings with targeted RED/GREEN tests and ordinary commits. Do not push or create a PR.

## Spec Coverage and Review Handoff

| Spec sections | Implementing tasks |
| --- | --- |
| 1-4: standalone boundary, files, offline/default/rights gates | 1, 3, 5, 6 |
| 5-7: separate discovery/contents, URL/ID/scope/language/provenance | 1-4 |
| 8: deterministic labelled fields, evidence and contamination | 2 |
| 9: comparison, six groups, artifacts, invariants and metrics | 4-6 |
| 10: retries, finite limits, reservations, stop policy and secrets | 3, 4, 6 |
| 11: existing ingestion safety and no DB | 5, 6 |
| 12-13: acceptance matrix, regression commands and delivery states | 1-6 |

Before execution, self-check that test names/assertions cover every row in the spec acceptance matrix and the five Review Focus inputs. Check signature/key consistency, remove unfinished decisions and keep production collector code out of the change scope.

At delivery, list changed files, local commits, usage/config, sample reports, exact test commands/results and unresolved live assumptions. Report these four statuses separately: offline feature complete; real Exa retrieval verified; import authorized; production deployed. Only the first can be satisfied by this plan's offline work.

The user has approved the written spec, not this plan or an execution method yet. Present this plan for review before implementation. Recommend **Native** execution because the six tasks share strict dictionary/identity/budget contracts and run sequentially in one small offline workflow; a fresh reviewer checks the complete branch afterward. **Subagent-driven** execution adds a fresh implementer/reviewer gate per task if the user prefers it. Either choice retains all authorization limits.
