# Jev Copilot Pilot Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build an offline, observation-only Jev evaluation runner for synthetic Earnest Property content-copilot proposals.

**Architecture:** Keep the Node-only adapter, fixture contract and reporting code under `scripts/jev/`. No application imports, live proposal hooks, database writes or browser bundle changes. The runner defaults to disabled, with an explicit mock mode and a separately enabled live mode.

**Tech Stack:** Node 22+, ESM `.mjs`, built-in fetch and `node:test`; no new runtime dependencies.

## Base and constraints

Remote main was fetched on 2026-09-22 and resolved to `e2598d1`. Existing worktrees contain unrelated edits. Create an isolated worktree from a freshly verified origin/main at execution time; record its exact SHA. Read applicable parent instructions before edits. Copy the approved design and this plan into that worktree's `docs/superpowers/` directories.

Only synthetic fixtures are accepted initially. No customer-data ingestion command is included. Do not load application environment files. No deployment, migration, automatic publishing, authentication change, model routing or hidden reasoning collection. Do not run paid calls during implementation.

## Provider contract verified

Official references:
- https://docs.typesafe.ai/introduction/quickstart
- https://docs.typesafe.ai/primitives/noul

Use POST `https://api.typesafe.ai/v1/systemone` with Bearer authentication and JSON containing `model`, `state`, `questions`. A Noul answer is `{type: 'noul', noul: number}` with probability in [0,1]; it does not supply a separate confidence value. Preserve the response model identifier and reported input/output token usage. Reject missing or malformed required answers instead of inferring success.

## Task 1: Fixture contract and bounded request builder

Files: `scripts/jev/contracts.mjs`, `scripts/jev/contracts.test.mjs`, `scripts/jev/fixtures.mjs`.

Interface: `buildRequest(fixture, model)` returns the provider request, excluding expected labels and fixture-only metadata. `fixtures` exports synthetic cases with stable IDs, language, action, structured authoritative facts, draft fields, evidence IDs/text, and expected labels.

- [x] Write failing tests for allowed fields, rejected unknown fields, duplicate evidence IDs, invalid numeric facts, missing identifiers and oversized strings.
- [x] Run `node --test scripts/jev/contracts.test.mjs`; confirm failure because the builder is missing.
- [x] Implement explicit field copying and validation. Bound state to 24,000 UTF-8 bytes, at most five evidence passages and 2,000 characters per passage. Reject excess input rather than silently truncating it. Allow draft title/description/SEO fields only; facts include synthetic estate name, district, price, area and amenities. These limits are pilot limits, not claims about provider capacity.
- [x] Generate independent Noul questions: unsupported claim, contradiction and review needed, plus one relevance question per passage. Include the passage ID in each relevance instruction because question IDs are not sent to the model. Instructions distinguish evidence text from trusted instructions and identify authoritative facts as the source of truth.
- [x] Add at least eight synthetic cases spanning correct and incorrect English/Traditional Chinese drafts, invented amenities, explicit numeric contradictions, irrelevant passages and instruction injection in evidence. Labels must be declared separately from provider payloads.
- [x] Run tests and review the transmitted JSON for accidental label or private-field leakage.

Representative contract assertion:
```js
const request = buildRequest(fixtures[0], 'jev-latest');
assert.equal('expected' in request.state, false);
assert.equal(request.questions.unsupported.type, 'noul');
assert.throws(() => buildRequest({...fixtures[0], staffEmail: 'private'}, 'jev-latest'));
```

## Task 2: Node-only adapter with explicit unavailable outcomes

Files: `scripts/jev/client.mjs`, `scripts/jev/client.test.mjs`.

Interface: `evaluate(request, {mode, apiKey, fetchImpl, timeoutMs})` returns `{status:'ok', model, observations, usage, latencyMs}` or `{status:'unavailable', reason, latencyMs}`. Default mode is disabled. Reasons are stable codes: disabled, missing_key, timeout, unauthorized, rate_limited, provider_error, invalid_response and network_error.

- [x] Write failing tests for disabled mode making zero requests, missing credentials, valid probability endpoints 0/1, malformed JSON, wrong answer type, omitted answers, probabilities outside [0,1], invalid usage, 401/403, 429, 500 and network failure.
- [x] Run `node --test scripts/jev/client.test.mjs` and confirm the adapter is absent.
- [x] Implement the fixed HTTPS endpoint, injected fetch, bounded timeout covering both response headers and body, no retries and generic errors. Never return raw provider error bodies or exception messages. Default timeout 5 seconds; permit test override between 1 and 10,000 milliseconds. Clear timeout resources on every completion path.
- [x] Validate the actual response model identifier, required answer keys and finite nonnegative integer token counts. Copy only known fields into the normalized result. Extra provider metadata must not enter reports.
- [x] Add delayed-header and delayed-body timeout tests and ensure abort is triggered. Use local/injected transport; no external calls.
- [x] Run the full contracts and client tests, then commit explicit files only.

Representative disabled-mode test:
```js
let calls = 0;
const result = await evaluate({}, {fetchImpl: async () => { calls++; }});
assert.equal(result.status, 'unavailable');
assert.equal(result.reason, 'disabled');
assert.equal(calls, 0);
```

## Task 3: Runner, report and operating instructions

Files: `scripts/jev/evaluate.mjs`, `scripts/jev/report.mjs`, `scripts/jev/evaluate.test.mjs`, `scripts/jev/report.test.mjs`, `docs/jev-copilot-pilot.md`.

Interfaces: `runEvaluation({fixtures, evaluateCase, mode})` returns per-case observations and a report. `summarize(results, labels, threshold)` returns per-check confusion counts, false-positive and missed-claim rates, unavailable rate, latency summary and token totals. Labels never reach `evaluateCase`. Undefined denominators return null, not zero.

- [x] Write failing tests for mixed success/unavailable results, all-unavailable runs, zero-positive/negative denominators, threshold boundaries and unknown CLI flags. Test subprocess default mode with credentials present to prove it still makes no live request.
- [x] Run `node --test scripts/jev/evaluate.test.mjs scripts/jev/report.test.mjs` and confirm the missing runner/report failures.
- [x] Implement CLI modes: no flag means disabled; `--mock` uses fixed canned probabilities with explicit mock labeling; `--live` additionally requires `JEV_PILOT_ENABLED=1` and `TYPESAFE_API_KEY`. Obtain that key from the TypeSafe console; never from browser code. Optional `JEV_MODEL` defaults to `jev-latest`; reports preserve requested and actual versions. Reject simultaneous mock/live flags.
- [x] Run cases sequentially, at most the bundled fixture count, without retries. Output JSON to stdout only; unexpected failures print stable error codes to stderr. No default persistent logs. Disabled mode exits zero with a disabled report; live runs with any unavailable cases exit nonzero while preserving the report.
- [x] Use 0.5 only as a declared illustrative evaluation threshold, never an enforcement threshold. Mock results demonstrate report mechanics, not model quality. Initial labels are developer-authored synthetic labels, not an independent held-out benchmark. Explicitly mark live accuracy and baseline cost comparison as pending.
- [x] Include case ID, language, check version, actual model, probabilities, usage and latency; omit raw text, key, headers and exception details. Compute aggregate metrics only on available cases and separately report unavailable coverage.
- [x] Document commands, limits, credential source, no-network defaults, mock-report interpretation, and later independent bilingual labeling/held-out evaluation requirements. Numeric comparisons remain ordinary application checks.
- [x] Run all four suites plus contracts: `node --test scripts/jev/contracts.test.mjs scripts/jev/client.test.mjs scripts/jev/evaluate.test.mjs scripts/jev/report.test.mjs`.
- [x] Run `node scripts/jev/evaluate.mjs` and `node scripts/jev/evaluate.mjs --mock`; save the mock JSON as a clearly labeled user-facing artifact. Run `git diff --check` and review explicit changed paths for application or secret leakage.
- [x] Commit only pilot files and documentation. Report test count, disabled/mock results, branch/base and the pending live benchmark. Do not deploy or publish without further instruction.

## Self-review

The offline boundary removes application latency and persistence dependencies. Failures remain unavailable, not passing results. Synthetic-only input and explicit field rejection make the initial data policy enforceable. Provider correctness and cost claims remain unverified until a separately authorized live benchmark. Observation findings cannot block or apply content.


Execution notes: Completed inline. Tests were observed failing before implementation and then passed 38/38. Related pilot work is committed as one reviewed change rather than intermediate commits. Disabled and mock reports generated; no live calls. The full application suite was not run; the baseline style test needs uninstalled font dependencies. Existing bun.lockb checkout differences are excluded.
