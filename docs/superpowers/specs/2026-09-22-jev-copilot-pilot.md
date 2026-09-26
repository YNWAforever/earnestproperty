# Earnest Property: Jev content-copilot pilot

Date: 2026-09-22
Status: Design for review; not implemented or activated.

## Objective

Measure whether Jev identifies unsupported or contradictory claims in content-copilot drafts, using an observation-only evaluation. Staff decisions and existing deterministic validation remain authoritative.

## Verified starting point

The copilot service loads authorized resource context, optionally gathers web evidence, generates a proposal with OpenCode Go, validates the result, and records it for staff review. Application checks include resource fingerprints and allowed fields.

The graph points to `.worktrees/saas-admin-team-management`, currently on `codex/fix-copilot-audit`, 573 commits behind the locally recorded origin/main and containing unrelated changes. The root checkout is on `codex/fix-neon-auth-get-user`, also contains unrelated changes, and has the copilot service. These are local observations, not a fresh remote comparison. Before coding, identify the current integration base and create an isolated branch without copying unrelated work.

## Approach

Start with an offline evaluation runner and a server-only Jev adapter. Feed synthetic or explicitly approved, sanitized examples shaped like validated copilot proposals. This provides observation-only results without adding latency or a new failure dependency to live draft generation.

An inline observer could later collect representative live results but would introduce latency and data-handling requirements. Immediate blocking or model routing would change behavior before accuracy has been established. Both are deferred.

## Evaluation contract

Each example contains a stable case ID, requested language and action, allowlisted listing facts, selected draft fields, and bounded evidence passages with local evidence IDs. Do not include staff records, lead details, contact information, credentials, or full request objects. Use synthetic fixtures initially.

Ask independent questions about unsupported factual claims, contradiction with authoritative facts, passage relevance, and need for closer staff review. Treat answers as model estimates, not proof of factual correctness. Numeric comparisons of prices and areas remain deterministic checks.

The adapter owns authentication, request construction, response validation, input limits, timeout and error normalization. Verify the current request and response contract against official TypeSafe documentation before implementing it. The caller receives either validated observations with model/version and usage, or an explicit unavailable result. Never convert an error or missing answer into a passing observation.

Record case ID, check version, provider/model version, normalized observations, latency, reported usage and outcome. Exclude source text and secrets from operational logs. Evaluation artifacts may contain synthetic fixture text.

## Activation and failure behavior

Default mode is disabled. Synthetic tests use a mock adapter without credentials or network access. Live evaluation requires an explicitly configured server-side provider key and authorization to incur provider charges. Missing credentials, invalid responses, timeouts and rate limits produce unavailable outcomes; they do not affect the application or staff workflow. Use a bounded timeout and no automatic retries for the initial runner.

## Verification

Cover correct drafts, invented amenities, contradictory price or area, irrelevant passages, Traditional Chinese and English examples, and adversarial instructions embedded in evidence. Verify malformed responses, missing answers, timeout, authentication failure and disabled mode. Ensure secrets and excluded fields are absent from requests and reports.

Use independently labeled held-out examples to report false positives, missed claims, unavailable rate, latency and usage. Keep any threshold tuning set separate. Do not claim speed or cost savings without a measured baseline; this pilot adds a check to the existing generation workflow.

## Completion and later decisions

The first implementation is complete when the adapter and runner pass deterministic tests and produce a documented synthetic evaluation report. A live provider benchmark is separately reported as run or pending. Advancing to live observation requires a data policy and measured acceptance criteria; blocking, automatic regeneration, model routing and retrieval changes each require a subsequent decision.

## Exclusions

No deployment, database migration, automatic publishing, auth changes, customer-data transfer, model switching, or hidden reasoning-trace collection is part of this pilot.
