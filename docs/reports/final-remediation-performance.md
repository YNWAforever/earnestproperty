# Final remediation performance acceptance — 2026-09-28

## Current result

No load measurement was run. The user confirmed that there is no disposable staging URL/database, Haze test tenant, or consenting test recipient. The structured run at `docs/reports/final-remediation-results.json` records 13 skipped cases, zero passed and zero failed. It is not performance evidence. Production traffic, customer records and provider sends were untouched.

The local production build and contract suites check source integration, not response latency, Core Web Vitals, database plans or provider behavior. Baseline and revised timings, cold samples, warm p50/p95, error rates and `EXPLAIN (ANALYZE, BUFFERS)` are unavailable.

## Acceptance matrix

| Case | Fixture | Product target | Status |
| --- | --- | --- | --- |
| Batch preview | 1, 50, 300, 1,000 rows | 1,000 row warm p95 ≤ 5 s | Skipped |
| Batch commit | 50 rows | Warm p95 ≤ 3 s | Skipped |
| Source mix | 20 rows each from website, 28hse and YouTube | Scope and row count correct | Skipped |
| Recovery edges | Duplicate, expired, revoked and disconnect | No duplicate commit or unsafe retry | Skipped |
| Ninety-day report | 10,000 and 100,000 events | Warm p95 ≤ 2 s | Skipped |
| Mobile public listing | Owned responsive media fixture | Laboratory LCP ≤ 2.5 s; CLS ≤ 0.1 | Skipped |

These are proposed acceptance targets, not measured current performance. INP needs field data and has no result here.

## Runner and evidence contract

`scripts/acceptance/final-remediation.mjs` emits one record per case with `sha`, `target`, `fixtureId`, `caseId`, `durationMs`, `passed`, `skipped`, `reason` and `evidencePath`. With no evidence it emits explicit skips. An evidence file must contain paired baseline and revised samples for the same named case, fixture, branch, database and row count. Each phase needs one cold sample, at least 20 warm samples, an error count and a SQL plan for database cases. The evaluator computes p50/p95 and applies the thresholds. A missing measurement stays skipped.

The evidence path is intentionally gated: `TEST_DATABASE_URL` must pass the repository's disposable Neon database identity check using `ASTRA_TEST_DATABASE_CONFIRMED=true` and the exact `ASTRA_TEST_BRANCH_ID`; `FINAL_REMEDIATION_FIXTURE_OWNER` must own every named fixture in `acceptance_fixture_registry`. The runner reads this registry and the supplied measurement file. A staging fixture loader and measurement probes are still required to produce real evidence; this evaluator does not seed data or generate load by itself. It must never be pointed at a production database.

When an isolated target exists, create and record a reversible fixture ownership registry in that disposable database, seed the matrix above, run each baseline and revised probe under the same conditions, capture 20 warm samples and one cold sample per phase, store actual SQL plans and errors, then run the evaluator with `--evidence=<workspace-relative-json>`. Record browser `currentSrc`, image response bytes/dimensions and layout shift separately. Do not infer a passing status from this report or from exit 0 with skipped cases.

## Local integration evidence

- `npm run test:media`: 13 Bun + 5 Node passed.
- `npm run test:mls`: 641 Node passed.
- `npm run test:property-experience`: 199 Bun + 146 Node passed.
- `npm run test:listing-search`: 90 Node + 12 Bun passed.
- `node --test scripts/acceptance/final-remediation.test.mjs`: 4 passed.
- `npm run typecheck`, repository-wide `npm run lint` and `npm run build`: passed. The build emitted dependency and large-chunk warnings; no build error.
- The remaining named suites are recorded in the task ledger after their final run.

Performance targets, database migration checks, authenticated browser journeys and provider delivery remain unverified until the disposable environment and owned fixtures exist.
