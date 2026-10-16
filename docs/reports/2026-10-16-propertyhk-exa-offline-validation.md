# Property.hk Exa candidate review: offline validation

Date: 2026-10-16 (Asia/Hong_Kong).
Branch: `codex/propertyhk-exa-candidates`.
Base: `58d055ee89c9acb39d2ef06f51a0f22179a0c453`.
Implementation reviewed: `148def56dbd1fc4a54602a053130f009ecc0851f`.
Verified fixes: `d0c084f251d3b8a138000e2b0c3793b1b2ff4a1e`.

The written design and implementation plan were approved in chat. The user
selected Native execution with a fresh independent whole-branch review.
Authorization covers local development and offline tests only.

## Delivery

The standalone CLI separates approved query discovery, URL/ID/scope validation,
provider contents, deterministic text parsing and manual comparison reports.
The existing sync collectors, Node ingestion contract, DB writer, source
selection, canonical identity and snapshot/absence gates were not modified.

Main implementation files:

- `scripts/property-sync/review_propertyhk_exa.py`
- `scripts/property-sync/scraping/exa.py`
- `scripts/property-sync/scraping/propertyhk_candidates.py`
- `scripts/property-sync/scraping/propertyhk_text.py`
- `scripts/property-sync/scraping/propertyhk_review.py`

Regression files: `scripts/property-sync/tests/test_exa.py`,
`test_propertyhk_candidates.py`, `test_propertyhk_text.py` and
`test_propertyhk_review.py` in the same directory. Configuration/documentation:
`scripts/property-sync/propertyhk-exa.example.json`,
`scripts/property-sync/README.md` and `.env.example`. Synthetic inputs, source
text and sealed expected reports are under
`scripts/property-sync/tests/fixtures/propertyhk-exa/`; the approved spec and
plan are under `docs/superpowers/`.

See `scripts/property-sync/README.md` for configuration and the offline command.
The example is `scripts/property-sync/propertyhk-exa.example.json`; source
access/reuse/trial approval references are null, online is disabled by default,
and no real key is provided. No paid API, DB, credential configuration,
production data, schedule, push, PR, merge or deployment action was performed.

Synthetic report samples are in
`scripts/property-sync/tests/fixtures/propertyhk-exa/expected-report/`.
The samples include JSON, readable Markdown, unchanged provider-text examples
and a byte-length/SHA-256 evidence manifest. Fixture-local Git attributes keep
the sealed synthetic text/report bytes in LF form across checkouts.

## Executed verification

Interpreter:
`C:\Users\laich\.codex\worktrees\full-property-sync-20261001\Earnestproperty\scripts\property-sync\.venv\Scripts\python.exe`.

Commands ran from the isolated repository root:

```powershell
python -m pytest scripts/property-sync/tests -q
npm run test:property-sync
python scripts/property-sync/review_propertyhk_exa.py --config scripts/property-sync/propertyhk-exa.example.json --fixture-bundle scripts/property-sync/tests/fixtures/propertyhk-exa --known scripts/property-sync/tests/fixtures/propertyhk-exa/known.json --output .private-sync-evidence/propertyhk-exa-offline-final-reviewed
git diff --check
```

Before independent review:

- Python property-sync: 402 passed, including the unchanged 240-test baseline.
- Node property-sync: 76 passed, 0 failed, 0 skipped; no DB suite was run.
- CLI: exit 0, `synthetic=true`, no global stop, all six report groups count 1.
- Manifest: all 8 files' byte lengths and SHA-256 checked; copied sample hashes match.
- Diff whitespace check: passed.

Synthetic demonstration metrics: 4 discovery requests, 2 contents requests,
7 unique URLs, 6 returned texts and 1 per-URL 404; 5 parsed observations,
1 unknown layout, 1 identity conflict, 1 grouped language identity and
6 comparable fields. Reserved USD 0.048 and provider-estimated USD 0.035 are
fixture values, not real API spend or invoices.

After the review fix pass:

- Python property-sync: **419 passed** (179 feature regressions plus the unchanged 240-test baseline).
- Node property-sync: **76 passed**, 0 failed, 0 skipped.
- Final offline CLI: exit 0; six groups count 1 each; all authority flags false.
- The original private run remains intact; the refreshed sample includes explicit `one_sided_fields`.
- Final report SHA-256:
  `0007928daab7e4f9b4434471c2a08e0422da5db8b3d9785c53ebbf00dcbcf18c`.

The original pre-review report SHA-256 was
`1123d0798ec45874c92e14b74a352221774d62d1c386cfdd460834a4d4528531`.
The pre-review and final reports are separately retained; earlier results were
not rewritten as final-head evidence.

RED/GREEN logs and intermediate failures are retained in the private execution
evidence. Invalid observer runs were retained and excluded from feature
evidence: one PowerShell argument-array error ran no tests, and a test read
UTF-8 output using Windows cp950 before its encoding was made explicit.

## Independent review

Fresh reviewer `01a14348-ac9f-7131-89ea-c3219b78a952` reviewed the exact
implementation SHA above using a separate context and a read-only checkout.
Four findings were reproduced and fixed in one pass:

| Finding | Disposition and regression |
| --- | --- |
| Optional unparsed field incorrectly demoted a threshold-meeting candidate | Keep a verified identity/estate/complete offer reviewable; preserve optional unparsed reasons. Actual conflicts and incomparable values still require review. |
| A field missing from the reference was treated as a confirmed change | Record candidate-only/reference-only values and raw evidence explicitly; count only comparable pairs. No inferred deletion. |
| HTTP protocol exceptions escaped sanitized partial outcomes | Catch HTTPException/IncompleteRead, preserve reservations, bound transient retries, and discard message/partial-body credential echoes. |
| Reference identity fields contradicted their review key | Reject conflicting advertisement/property/custom identifiers; validate branch labels against explicit reference mappings. |

The last two findings were treated as Important based on their safety/identity
impact, rather than deferred because the online path is currently disabled or
the reviewer used a lower grade. All 15 finding-specific cases were watched
RED then GREEN. A verified-branch-alias case and an oversized comma-money case
also ran RED then GREEN. The latter prevents long comma-form amounts bypassing
the plain-number bound and rounding into an incorrect Decimal result.

The independent reviewer also reran the original offline CLI and verified its
JSON, Markdown and manifest were byte-identical to the pre-review sample.
Its suite attempt recorded **401 passed, 1 failed**: a Windows junction probe
was denied with WinError 5 in that sandbox. This is retained as an observer
limitation, not a green independent suite. The authorized host environment
passed the real junction test in the full 419-test final run.

The final fixes were verified by the author with failing regressions and the
full suites, as required by the selected Native workflow. There was no second
independent review of the post-fix SHA. No deferred minor finding remains.

## Implementation rulings

- Raw currency/unit markers remain in observations but are excluded from
  normalized-value comparisons; changing notation alone is not a field
  conflict. If this choice is wrong, a notation-only discrepancy is still
  visible as preserved raw evidence.
- Windows file-symlink creation failed with WinError 1314. A real directory
  junction exercises outside-root resolution instead. Native file-symlink
  creation remains unverified here; the common resolution/confinement check
  is exercised against an actual reparse-point escape.
- Integration extended the new adapter/report seams for HTTP/backoff
  interruption, complete parser/comparison counters and strict reference
  value/index shapes. An interruption yields preserved partial evidence
  instead of an uncaught signal. Counters remain descriptive, with all
  ingestion/publication/absence authority false.
- Protocol sanitization and contradictory reference identity were treated as
  Important. If this grading is too strict, its cost is narrow validation and
  regression tests rather than any production activation.
- Full text remains in both portable JSON and sealed text artifacts. The cost
  is larger private reports within the fixed response/URL bounds.
- Reference-only fields do not imply deletion. If a removal is real, a human
  still needs source verification; both one-sided values remain inspectable.
- Provider retrieval time stays null without verified metadata; local receipt
  time is separate. Exact origin retrieval time remains unknown.
- Foreign provider URL results and truly incomparable values still fail
  closed. The cost is lower coverage rather than accepting uncertain data.
- Real retrieval, access/reuse rights, live costs and production acceptance
  remain unverified under the user's authorization; offline completion cannot
  establish those states.
- Branch labels use an explicit per-entry `branch_labels` mapping when they
  differ from a stable branch ID. The cost is supplying that local mapping;
  it does not establish any global ID authority.

## Acceptance boundaries

| State | Evidence |
| --- | --- |
| Offline feature | Completed; four review findings fixed and 419/76 regressions passed. |
| Real Exa extraction | Not run or verified. |
| Import permission | Not granted; reports are permanently ineligible for apply/publication/absence. |
| Production deployment | Not performed. |

Property.hk automated-access/content-reuse rights, real Exa response/layout
compatibility, active-listing freshness, full inventory coverage, global
advertisement ID uniqueness and live language route aliases remain unverified.
Historical 563-record exports are not completeness/current-inventory evidence.
A later online trial requires separate confirmed rights, query/trial/billing
approval and fresh official API/pricing checks.
