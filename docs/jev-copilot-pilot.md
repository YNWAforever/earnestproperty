# Jev content-copilot observation pilot

This is an offline, Node-only evaluation tool. It does not run inside the application, change drafts, block staff actions, rerank live retrieval, or route generation models. It requires Node 22 or newer and no installed packages.

## Run without a provider

From the repository root:

```powershell
node scripts/jev/evaluate.mjs
node scripts/jev/evaluate.mjs --mock
node --test scripts/jev/contracts.test.mjs scripts/jev/client.test.mjs scripts/jev/evaluate.test.mjs scripts/jev/report.test.mjs
```

The first command is disabled even when credentials exist. The second uses fixed canned probabilities, independent of expected labels, and prints a MOCK ONLY report. Neither makes network requests. Mock accuracy figures describe the canned responses only; they are not Jev performance measurements. Mock token usage and latency are zero because there is no provider call.

## Live synthetic evaluation (not run during implementation)

Live calls require explicit authorization to incur provider charges. Create a server-side key in the [TypeSafe console](https://console.typesafe.ai/). Supply it through the process environment; never commit it or place it in client-side configuration.

| Variable            | Source / meaning                                             |
| ------------------- | ------------------------------------------------------------ |
| `TYPESAFE_API_KEY`  | Secret created in the TypeSafe console                       |
| `JEV_PILOT_ENABLED` | Set to `1` only for an authorized live run                   |
| `JEV_MODEL`         | Optional provider model identifier; defaults to `jev-latest` |

With those variables configured, `node scripts/jev/evaluate.mjs --live` sends only the eight bundled synthetic fixtures. There is no input-file option and no automatic loading of application `.env` files. Do not replace fixtures with customer content. A future data-ingestion workflow requires a separate data policy; allowlisting field names alone cannot sanitize arbitrary text values.

The adapter uses the [official API contract](https://docs.typesafe.ai/introduction/quickstart) and [Noul probabilities](https://docs.typesafe.ai/primitives/noul). Every call has a five-second total timeout and no retries. Redirects are rejected. Authentication errors, rate limits, invalid replies, network failures and timeouts become unavailable observations. Missing answers never count as passes. Any unavailable result causes a live CLI run to exit nonzero while still emitting its report. Refused configuration/arguments emit stable errors to stderr.

## Scope and interpretation

Requests carry allowlisted synthetic facts, selected draft fields and at most five evidence passages. Each passage is limited to 2,000 characters; serialized state is limited to 24,000 UTF-8 bytes. These are pilot limits, not provider capacity claims. Oversized input is rejected, not truncated. Labels, case IDs, staff records and unrecognized fields are excluded from provider payloads. Passage IDs occur explicitly in relevance instructions.

Reports contain case ID, language, check version, requested/actual model, normalized probabilities, reported token usage, latency and status. They omit source text, credentials, headers and provider error bodies. Stdout is the only report output; redirect it explicitly to save a file.

The illustrative threshold is 0.5; it never authorizes a product action. Confusion counts and error rates use only available results, with unavailable coverage reported separately. Latency mean/p95 and token totals cover available results; individual unavailable latency remains in each row. Undefined rate denominators are null. `missedClaimRate` is the false-negative rate for each check, including relevance/review checks. Price/area comparisons in application code remain deterministic.

Labels are developer-authored synthetic examples, not independently labeled held-out data. Before enabling any live product observation or enforcement, collect independently reviewed bilingual cases, separate threshold tuning from held-out evaluation, measure false positives and missed claims, and agree acceptance criteria. A generative baseline is required before claiming cost or speed savings. This pilot adds an evaluation; it does not establish savings.

## Implementation verification

Base: `e2598d133eff596108818f5195a64062dca95d85` (freshly fetched main).

Focused pilot tests and default/mock CLI runs require no application dependencies. An unrelated baseline style test could not load `@fontsource-variable/noto-sans-tc/wght.css` in the fresh checkout without installed dependencies. No full application build or live provider benchmark is claimed.
