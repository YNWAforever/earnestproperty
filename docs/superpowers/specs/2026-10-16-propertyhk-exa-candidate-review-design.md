# Exa-assisted Property.hk candidate discovery and review

Date: 2026-10-16 (Asia/Hong_Kong).
Status: design direction approved; this written specification awaits user review.
Scope: local development and offline verification only.
Base: main `58d055ee89c9acb39d2ef06f51a0f22179a0c453`, including merged PR #266, verified during preflight.
Isolated branch: `codex/propertyhk-exa-candidates`.

## 1. Outcome and completion boundary

Help an operator find potentially missing Property.hk advertisements and inspect differences against an explicitly supplied local comparison file. Every suggested field must carry inspectable evidence. Uncertain identities or values remain unresolved. The first release must run end to end with clearly labelled synthetic fixtures without a credential, network access, database, or paid LLM.

The workflow is:

```text
approved query plan
  -> discovery
  -> URL, advertisement ID and scope validation
  -> contents retrieval
  -> deterministic provider-text parsing and validation
  -> comparison with an optional explicit local reference file
  -> JSON, Markdown and private evidence artifacts
```

Discovery and contents have separate interfaces, counters and failure outcomes. A successful discovery response is not evidence that a detail page was retrieved. Retrieved text is not proof that an advertisement remains active, and a candidate report never authorizes ingestion.

This is a small standalone CLI within the current Python scripts. It does not restructure the sync system or introduce a database schema, admin page, scheduler, queue, daemon, SDK dependency, or alternate source provider. Existing 28Hse Firecrawl and Property.hk HTTP/index workflows retain their entry points and behavior.

## 2. Verified context and unresolved source access

The inspected main includes the PR #266 detail identity and optional 28Hse Firecrawl basic work. Property.hk is still HTTP-only in the existing collector. Its native branch index can verify some listing observations; detail access, inventory coverage and the global uniqueness of advertisement IDs remain unestablished.

The historical set of 563 advertisements is not an inventory baseline, a completeness denominator, or a default comparison file.

Preflight read the official Exa Search, Contents and Pricing documentation on 2026-10-16. A policy-only request to Property.hk robots.txt returned HTTP 200; `/asking_detail/` was not listed among its disallowed paths. This observation does not grant automated access, Exa access, or content reuse rights. Earlier detail HTTP 403 failures have not been resolved by this work. No detail request or paid Exa request was made during preflight.

Source access and reuse permission are **unverified**. The first release must remain fully useful offline while these questions remain open. Neither a configuration flag nor an Exa result is a substitute for permission. No source login, 403, robots restriction or other access control may be bypassed.

Official reference locations, to be rechecked before a separately approved online trial:

- Search: `https://exa.ai/docs/reference/search`
- Contents: `https://exa.ai/docs/reference/get-contents`
- Pricing: `https://exa.ai/docs/admin/pricing`

Private preflight evidence is retained outside the committed deliverable under `.private-sync-evidence/propertyhk-exa-design-20261016/`. It contains documentation snapshots, the policy-only observation and baseline test logs. It is not live listing evidence.

## 3. Module and change scope

| Proposed file | Responsibility |
| --- | --- |
| `scripts/property-sync/review_propertyhk_exa.py` | Validate inputs, select fixture or explicitly authorized online mode, coordinate the stages, write the report and choose an exit code. |
| `scripts/property-sync/scraping/exa.py` | Independent discovery and contents operations, fixed-origin HTTP transport, response/status validation, bounded retry, reservation ledger and sanitized provider errors. |
| `scripts/property-sync/scraping/propertyhk_candidates.py` | Exact URL allowlist, advertisement ID normalization, scope evidence validation and conservative language-observation grouping. |
| `scripts/property-sync/scraping/propertyhk_text.py` | Parse a recognized main listing block from provider text with deterministic labelled rules and per-field evidence. No CSS parser. |
| `scripts/property-sync/scraping/propertyhk_review.py` | Compare candidate observations to an explicit local reference, classify review outcomes, aggregate metrics and render JSON/Markdown/evidence manifests. |
| `scripts/property-sync/propertyhk-exa.example.json` | Synthetic scopes and queries, explicit offline defaults, route policy and bounded request/cost settings. No real credential or asserted source permission. |
| `scripts/property-sync/tests/test_exa.py` | Provider contract, per-URL failures, retry, cost reservations, gates and secret handling. |
| `scripts/property-sync/tests/test_propertyhk_candidates.py` | URL, ID, scope and language identity regressions. |
| `scripts/property-sync/tests/test_propertyhk_text.py` | Field parsing, ambiguity and contamination regressions. |
| `scripts/property-sync/tests/test_propertyhk_review.py` | Report/diff contract, end-to-end fixture run, deterministic reruns and authority isolation. |
| `scripts/property-sync/tests/fixtures/propertyhk-exa/` | Explicitly synthetic query plan, responses, text, local reference and expected report sample. |
| `scripts/property-sync/README.md` and the existing `.env.example` | Offline execution, configuration, output interpretation and separately gated online operation. |

The implementation may share tiny internal data types across these modules, but must not add a general integration framework or modify shared collectors to accommodate provider text.

The existing files below are reference and regression boundaries, not planned production-code edits:

- `scripts/property-sync/scraping/worker.py`
- `scripts/property-sync/scraping/propertyhk_index.py`
- `scripts/property-sync/scraping/firecrawl.py`
- `src/lib/mls/ingestion-contract.mjs`
- `src/lib/mls/unit-identity.mjs`
- `src/lib/mls/source-selection.mjs`
- `src/lib/mls/source-snapshot-gates.mjs`
- `src/lib/mls/ingestion-repository.mjs`
- `src/lib/mls/propertyhk-http.mjs`

The CLI must not import the ingestion writer, invoke the ingestion HTTP receiver, load an apply payload or read a database connection string. It must not generate canonical property IDs, staff IDs, unit mappings, accepted receipts or ingestion provenance.

## 4. Inputs and offline default

The command takes a configuration file, a fixture bundle in offline mode, an optional explicit known-candidate file, and a new output directory. It never discovers a reference file from the environment, fetches it from a database, or silently loads historical exports.

Configuration distinguishes:

- Operator query-plan scope: approved branch, estate and district identifiers and allowed query terms.
- Observed scope: evidence in retrieved text or a specifically supplied native-index reference; a query label alone cannot establish a page's branch.
- Route policy: exact supported detail patterns and any separately verified language aliases.
- Trial gates: offline by default; source access, reuse rights and online approval references absent by default.
- Operational bounds: request/URL/attempt/batch limits, timeout and USD reservation cap.

The example uses synthetic branch and estate identifiers. Its fixture-only language routes are marked synthetic and rejected in online mode. It must not suggest that an example configuration verifies real agency scope or source rights.

Offline mode must not instantiate a live transport, read `EXA_API_KEY`, resolve DNS or perform network requests, even if an ambient API key is present. Fixtures exercise the same discovery, contents validation, identity, parser and report interfaces as the online adapter.

An online attempt is denied before transport construction unless there is explicit online invocation, an enabled server-side switch, documented source access/reuse approval, an approved query plan, a separate bounded-trial approval reference and an existing environment-provided API key. The switch defaults to `PROPERTYHK_EXA_ONLINE_ENABLED=false`. `EXA_API_KEY` is server-side only; a key's existence grants no permission. This change creates or configures no credentials.

## 5. Discovery contract

The adapter exposes discovery separately from contents and uses the fixed HTTPS Exa API origin. Search requests use `type="fast"`, `includeDomains=["property.hk"]` and at most five results. Build each query from an approved plan entry; do not generate additional free-form branch, estate or district queries.

Discovery requests omit contents, highlights, summaries, synthesis and deep-search options. Returned snippets, titles and provider-estimated dates are discovery metadata, not listing field evidence. Ignore links and text embedded in discovery results for parsing or further navigation.

Retain the plan entry, original result URL, provider document ID as an opaque value, safe request identifiers and result validation outcome. Apply the local URL allowlist even when the provider claims domain filtering succeeded.

Measure planned entries, attempted entries, completed entries, raw results, rejected URLs and unique accepted detail URLs independently. A zero-result query means no candidate was discovered by that query at that time. It does not mean zero source inventory.

## 6. URL, ID, scope and language validation

The initial live route policy accepts only HTTPS on exact hosts `property.hk` and `www.property.hk`, with the full detail path `/asking_detail/<ASCII digits>.html`. Normalize the approved host aliases to `www.property.hk`; preserve the original URL and digit string. Do not convert the ID to an integer or discard leading zeros.

Reject credentials, explicit ports, other schemes or domains, subdomain lookalikes, unsupported paths, query strings, fragments, backslashes, encoded path separators, dot segments, control characters and ambiguous encodings. Do not infer identity from a query parameter or the Exa document ID. Unsupported language routes remain rejected until their exact shape and identity semantics are verified. Do not invent `/eng/` or another live alias.

The same validation applies to every returned contents URL and each URL-keyed status. A returned URL must match an originally requested normalized detail identity. A foreign host, changed advertisement ID, duplicate status/result, unexpected URL, or inconsistent association must not be accepted as the requested page. A synthetic alias is permitted only inside labelled offline fixtures.

Keep the following identifiers distinct:

| Field | Meaning |
| --- | --- |
| `source_advertisement_id` | Digits from the validated source detail URL, checked against main-block content identity when available. |
| `source_property_number` | A separately labelled Property.hk property number; absent values remain null. |
| `agency_reference` | A separately labelled agency custom reference; never interchangeable with the other two numbers. |
| `provider_document_id` | Opaque Exa result ID; not a Property.hk identifier or a stable merge key. |
| `provider_request_id` | Provider request correlation only. |

Use a branch-scoped review key based on source, verified branch and advertisement digit string. This is an internal review key, not a canonical listing ID. Global uniqueness of source IDs remains unverified. The same ID in two branches stays separate. Missing branch evidence remains unresolved and cannot become a new/known matched candidate merely because a query named a branch.

Strong review identity requires a validated URL, consistent advertisement identity evidence from the recognized main content, and verified branch evidence. An explicit native-index reference can supply branch evidence when it binds the exact URL/ID and branch, but cannot silently replace missing or contradictory detail identity. Missing evidence is insufficient data; contradictory identity is an identity conflict.

Chinese and English observations group only when their validated route mapping, advertisement ID, branch evidence and all present property/custom reference identifiers agree. Missing fields may be retained separately; conflicting non-null identities prevent grouping. Preserve both observations, their languages and provenance. Non-identity value disagreements remain explicit field conflicts; never select whichever language happens to be processed last.

## 7. Contents contract and provenance

Contents receives validated `urls`, never opaque provider IDs. Request `text=true`, `maxAgeHours=0` and `subpages=0`. Omit summary, highlights, extras and deprecated livecrawl options. A request for fresh extraction is not a verified active-listing observation.

Validate each requested URL's status separately. HTTP 200 for the API is not enough. A usable observation requires exactly one matching successful status and exactly one matching result containing nonempty text. Correlate statuses by the requested URL, not array order. Preserve the provider status source (`cached`/`crawled`) without rewriting it to an origin HTTP response.

Missing, duplicate, contradictory or unexpected entries produce explicit failures/conflicts and never populate listing fields. Successful URLs in an otherwise partially failed batch may be parsed when their own identity contract holds. Do not retry already successful URLs because a peer failed. A denial or authentication/budget stop preserves earlier observations but prevents further requests.

Store only validated provider text and allowlisted metadata. Each observation retains:

- Original and normalized URL, source, all separate identifiers, query-plan scope and observed scope evidence.
- Language, local receipt time in UTC, provider retrieval metadata if supplied, source publication/update values if explicitly present, and any provider-estimated publication date in a separate field.
- Provider name `exa`, endpoint, safe body/header request IDs, document ID, per-URL status, status source and attempt number.
- Parser version `propertyhk-exa-text-v1`, content format `provider_text`, SHA-256 of the exact stored UTF-8 text and evidence artifact reference.
- Field values, raw fragments, line numbers and character spans into that same text, validation state and review reasons.

Source-advertisement evidence and provider metadata have separate evidence types. If the body request ID and header request ID disagree, retain both safe values and flag the mismatch. If the provider supplies no request ID or retrieval timestamp, preserve null; do not fabricate one. Local receipt time is not source update time or proof of origin retrieval time.

Do not write the text to an HTML file, invent origin headers/status codes, feed it to CSS selectors, follow embedded links, fetch photos or merge contact details from another source.

## 8. Deterministic text parser

Recognize an explicit main-listing heading and a bounded block of labelled fields. Label aliases and section delimiters are versioned and exercised with fixtures. Stop before transaction history, related listings, sponsored content, navigation and footers. Identity matches found only in those excluded sections do not validate the main listing.

If no unique main block is recognizable, retain the text with `unparsed` and an insufficient-data reason. Do not scan the whole page opportunistically, infer values from surrounding cards, add another paid LLM, or promote the best-looking fragment.

Every parsed field keeps its raw evidence. Repeated equal normalized values can retain multiple evidence spans. Conflicting values keep the alternatives and a conflict flag; no last-write-wins behavior.

| Field family | Rule |
| --- | --- |
| Offers | Keep sale and rent as separate entries; a single advertisement may have both. Deal type must be labelled. |
| Price | Preserve raw amount, explicit currency, unit and rental period. Use Decimal for deterministic conversion of explicit HKD amounts, including ten-thousand units, millions and full amounts. Never use binary floating point for money. |
| Ambiguous price | Missing currency/unit/period, negotiable or contradictory text remains null or a raw unnormalized offer with a reason. Do not invent zero, HKD or a monthly period. |
| Area | Keep usable and gross area separate. Preserve raw number, square-foot/square-metre unit and approximation marker. Missing area type/unit remains unresolved; do not substitute one area for another. |
| Location | Parse only explicitly labelled district, estate, address, block, floor and unit. Retain floor bands as bands. Do not guess exact floors or units or manufacture a canonical unit identity. |
| Dates | Separate source update, source publication, local receipt and provider-estimated publication. Keep stated precision and timezone; date-only text remains date-only. Ambiguous or invalid dates stay raw/null. |
| Contacts | Retain whole source contact observations with role/label evidence. Do not concatenate names and phones from different observations, assign internal staff, or match staff by text. |
| Lifecycle | Preserve an explicit main-block status as an observation for manual review. No field or provider success may become an automatic active, sold, withdrawn, delisted or publication action. |

Keep raw currency/unit markers alongside normalized enums. Serialize normalized money as decimal strings. Compare the two offer types independently. The parser does not use a query's estate/district as missing page data.

## 9. Comparison and report contract

The optional known-candidate file has an explicit review schema and provenance manifest, with branch-scoped identity, observed values, observation dates and reference evidence locations. An incompatible or ambiguous reference fails validation. It is not a production apply payload. A supplied native-index reference is measured as a labelled sample, never as full source coverage.

Compare only identities and units that can be matched deterministically. A missing candidate value does not suggest clearing an existing value. If one side's currency, area type/unit or rental period cannot be normalized safely, show the raw observations as insufficient/comparison-unavailable data. Field differences show the reference value, candidate value, normalized comparison and both evidence references.

For the new/known/difference groups, a reviewable candidate requires strong review identity, an explicitly observed estate or address, and at least one fully specified normalized offer. This is a report classification threshold, not an ingestion threshold. Missing optional property/custom references, floor, unit, area, dates or contacts remain null with explicit missing-field flags. They do not become invented data or suggested deletions.

The report has six exclusive primary groups, selected in this priority order:

1. `fetch_failures`: transport, per-URL or response-integrity failures prevent a usable observation.
2. `identity_conflicts`: a retrieved observation contradicts URL, content, scope or language identity evidence.
3. `insufficient_data`: an unmet review classification threshold, unrecognized structure, unresolved field conflicts or incomparable observations.
4. `field_differences`: a verified known review identity has comparable changed fields.
5. `known_candidates`: a verified known review identity has no comparable changed fields.
6. `new_candidates`: a verified review identity has no match in the supplied reference.

Each entry also retains independent reason codes, observations and any safe comparisons; the primary group must not erase other problems. With no supplied known-candidate file, new candidates mean "not matched against a provided reference", explicitly marked `comparison_performed=false`. They are not claimed to be absent from production.

Every JSON report uses a discriminator separate from ingestion:

```json
{
  "kind": "propertyhk-exa-review/v1",
  "mode": "fixture",
  "synthetic": true,
  "full_snapshot": false,
  "ingestion_allowed": false,
  "eligible_for_absence": false,
  "publish_allowed": false,
  "baseline_advanced": false,
  "production_writes": 0
}
```

These authority values are invariant, including in a later approved online trial. The report must not contain an accepted v2 snapshot envelope or represent its evidence as an original Property.hk response. Missing candidates, failed URLs, zero search results and source terminal observations never advance a baseline or trigger an import or absence action.

Outputs in a newly created private run directory:

- `report.json`: structured observations, six groups, evidence references, metrics, stop reasons and invariant authority values.
- `report.md`: human-readable group counts and field comparisons with raw evidence, timestamps and limitations.
- `evidence/text/<content_sha256>.txt`: validated provider text; synthetic text clearly identified by its manifest.
- `evidence/manifest.json`: source/provider/synthetic provenance, relative artifact references, byte lengths and SHA-256 hashes.

Do not overwrite an existing run directory or automatically delete evidence. Markdown escapes source-supplied markup so it cannot masquerade as report instructions or insert executable HTML. Console output contains counts and artifact paths, not raw contacts, text, credentials or provider response bodies. Real evidence remains untracked; only explicitly synthetic samples may enter Git.

Metrics separately cover query execution, URL rejection, unique discovery, contents requests, per-URL attempts/success/failure, parsed/unparsed/identity-conflicting observations, language grouping, comparable fields and reservations. If a reference sample is supplied, report its size and scoped overlap. Do not label these measures whole-source recall or full inventory coverage.

Stable ordering and Decimal/identifier serialization make reruns consistent. Given the same input, fixture clock and parser version, reports and text hashes must be identical. An actual run's receipt time stays truthful; differing run timestamps do not imply listing field changes.

## 10. HTTP, failure, retry and reservation policy

Use a small standard-library HTTP transport with injectable fake transport, clock and sleeper for tests. The API origin is fixed and redirects are disabled so a credential cannot follow a redirect. Verify TLS. Limit response size to 2 MiB and use a 20-second transport timeout; the request loop also has a 120-second elapsed budget checked before attempts and backoff. No parallel requests in the MVP.

Retry only explicitly transient network/timeouts, API 429 and API 5xx or corresponding documented transient per-URL errors. Limit each discovery operation and each detail URL to three attempts, including the first. All attempts consume global request and reservation bounds. Contents retries include only failed eligible URLs.

Use bounded delays of two and four seconds when Retry-After is absent. Respect valid delta-seconds or HTTP-date Retry-After up to 30 seconds and the remaining elapsed budget. An excessive or invalid Retry-After defers/stops the run rather than retrying immediately. A 429 at the source is not permission to change provider or route.

API authentication, permission, payment, quota or budget errors stop all further requests. A per-URL source access denial, robots/login restriction, or equivalent provider tag also stops further fetching; never retry it through a different service or route. A source 404 is a failed candidate observation, not withdrawal evidence. Unknown error tags fail closed for that URL without retry. Missing/invalid response structure is not accepted as success.

Before each attempt, reserve cost and request capacity. A timeout or unknown outcome retains the reservation; do not refund it to make room for retries. Do not blindly resume an interrupted online run; produce a partial report and require a separately reviewed continuation. Offline report reruns use stored observations without new requests.

Proposed bounds for a future, separately approved trial:

| Bound | Maximum |
| --- | --- |
| Planned queries | 4 |
| Discovery HTTP requests, including retries | 4 |
| Requested results per discovery request | 5 |
| Unique detail URLs across scopes/languages | 20 |
| URLs in one contents request | 5 |
| Attempts per operation/detail URL | 3 |
| Contents requests, including retries | 12 |
| All API HTTP requests | 16 |
| Program cost reservation | USD 0.20 |

Contents uses three retry rounds, each with at most four five-URL batches. A URL consumes one attempt whenever included, even when the HTTP outcome is unknown. A global cap can prevent exhausting a URL's attempt allowance. Validate and cap input collections before constructing requests.

The observed pricing is USD 0.007 for a fast search with up to ten results and USD 0.001 per contents text page. Four searches plus twenty text pages would be approximately USD 0.048 before retries. The controller conservatively reserves USD 0.010 per contents request, equivalent to ten text pages even though batches contain at most five; this is a risk reserve, not an assertion of a minimum vendor charge. Four search attempts plus twelve contents attempts reserve USD 0.148, below the USD 0.20 program cap.

Keep reservation totals and provider-reported estimated `costDollars` separately. If reported estimates exceed the approved bound or contradict the assumed tariff/options, stop further calls and flag the discrepancy. This program reservation cannot guarantee a vendor invoice or account-wide cap. Recheck pricing and obtain separate trial/billing approval before any live call; do not change an account, buy credits or enable recharge.

Sanitize request IDs, error tags and messages before output. Do not persist request headers, environment dumps, raw HTTP error bodies or exception representations containing secrets. If a provider response unexpectedly echoes the live credential, stop and discard that response from stored evidence. Credential-redaction tests generate a fake sentinel in memory; fixtures contain no credential.

## 11. Existing ingestion safety boundaries

Keep the current source-policy checks, operator-verified Property.hk ID scopes/routes, branch/page/detail completeness, rejected-record gates, quantity-drop checks, bootstrap checks, policy/parser compatibility, receipts, deduplication and contact selection unchanged.

The Exa report cannot mark itself `full_snapshot`, satisfy a native completeness gate, confer global ID scope, create an exact unit identity, advance an accepted baseline or qualify for absence detection. Property.hk absence inference remains disabled. Existing historical payloads and receipts remain untouched.

No production database test, read or write is needed. Offline tests must not consume `DATABASE_URL`. If implementation later reveals a real need for a database test, stop that dependent test until an independently verified isolated target exists; never fall back to the ambient database.

## 12. Offline acceptance matrix

All new fixtures and report samples declare `synthetic=true`. Fixture contents represent designed parser examples, not verified Property.hk page layouts or Exa retrieval success. Mock transports exercise the real adapter contract without paid calls.

| Case | Required evidence |
| --- | --- |
| Offline end-to-end | Query fixture through discovery, contents, parsing, comparison and both reports; network/key access forbidden by the test harness. |
| URL whitelist | Accept the exact configured native route; reject domain suffix tricks, subdomains, credentials, ports, non-HTTPS, queries/fragments, encoded separators and unsupported paths. |
| Wrong advertisement ID | Reject a contents URL/status/main-block ID mismatch without extracting accepted fields. |
| Wrong or missing scope | Query label cannot prove scope; wrong branch conflicts, missing evidence remains insufficient, same raw ID in two branches remains separate. |
| Three identifier kinds | Preserve distinct advertisement/property/custom values and nulls without cross-substitution. |
| Language duplicates | Fixture-only alias mapping groups consistent identities, keeps both provenance records, and refuses conflicting identity/value evidence. |
| Sale and rent | One advertisement retains two distinct offers; no rental price replaces a sale price. |
| Money | Explicit HKD ten-thousand, million and full amounts convert exactly; missing currency, negotiable text, conflicting prices and missing rent period remain reviewable. |
| Area | Usable/gross and square feet/metres stay separate; approximation markers survive; missing type/unit does not populate another field. |
| Dates and location | Missing, ambiguous and contradictory values stay null/raw with reasons; no inferred floor, unit, address, update date or timezone. |
| Contacts | Whole observation evidence retained; no concatenated contact or assigned staff identity. |
| Contamination | Transaction history, related cards, advertisements and footers cannot supply listing identity, offers or contacts. |
| Unknown text structure | Text/hash retained with `unparsed`; no opportunistic whole-page extraction. |
| Partial URL failure | An API 200 with mixed statuses, missing/duplicate results or unexpected URLs does not count all pages as successful. |
| Freshness metadata | `maxAgeHours=0`, cached/crawled status and provider date never set active, original-HTML, or source-update authority. |
| Retry | Mock 429/timeout/5xx, bounded Retry-After, three-attempt limit, successful URL exclusion and exhaustion of global request caps. |
| Permission stop | API 401/402/403 and per-URL source denial stop further requests and never switch providers. |
| Budget stop | Reserve before every attempt, keep unknown-outcome reservations, reject over-cap work and keep vendor estimates separate. |
| Rerun consistency | Identical fixture/clock/version produces identical reports and hashes; output-directory collision does not overwrite evidence. |
| Redaction | Fake in-memory credential absent from logs, Markdown, JSON, evidence and error paths, including provider echoes. |
| Comparison | All six groups, old/candidate/evidence columns, missing-value non-deletion, same-identity field conflicts and no-reference disclaimer. |
| Authority isolation | Report invariants always hold; no accepted ingestion envelope, DB access, HTTP apply, publication, absence or baseline advance. |
| Live default denial | Missing approval/access/reuse/config/key gates block before transport; synthetic route aliases cannot be used online. |

Run the existing Python and Node suites to preserve 28Hse Firecrawl basic/identity behavior, Property.hk HTTP and branch-index validation, deduplication, source selection and snapshot/absence gates. Do not weaken existing assertions, skip cases to pass, or rewrite existing fixture evidence as Exa evidence.

Pre-change baseline on the verified main: Python 240 passed; Node property-sync 76 passed. These are baseline results, not evidence that this unimplemented feature passes. Planned implementation verification commands from the isolated checkout:

```powershell
& 'C:\Users\laich\.codex\worktrees\full-property-sync-20261001\Earnestproperty\scripts\property-sync\.venv\Scripts\python.exe' -m pytest scripts/property-sync/tests -q
npm run test:property-sync
git diff --check
```

The implementation handoff must record the actual interpreter path, executed commands, result counts and any failures. Reuse the existing working Python environment; no dependency installation is part of this specification. If that environment is unavailable, resolve a verified local alternative without silently connecting to external services or a database.

## 13. Delivery and approval stages

The implementation deliverable is the scoped modules/config/docs, clearly synthetic fixtures and sample reports, runnable offline instructions, actual test results and a list of unverified live assumptions. A sample fixture invocation will use the standalone CLI and produce the documented report/evidence files; the README must identify fixture output explicitly.

Report four independent statuses at handoff:

| Status | Current value |
| --- | --- |
| Offline feature completed | Not implemented; awaiting written-spec and plan review. |
| Real Exa retrieval verified | Not run; source permission and trial approval unresolved. |
| Import authorized | No; candidate reports cannot authorize ingestion. |
| Production deployed | No; no push, merge, deploy or production configuration is authorized. |

The conversational design direction is approved. This specification is the next review artifact. Under the selected architectural brainstorming process, its approval permits writing the implementation plan. The written plan then receives its required review and execution-method selection before product implementation.

No paid trial, production access change, credential setup, push, merge, deployment, schedule activation, publication or production import is included in approval of this document.
