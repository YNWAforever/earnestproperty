# 28Hse native schedule readback — 2026-10-07

Independent read-only GitHub and production SQL evidence correlates three `event=schedule` runs with exact app SHAs, immutable full receipts and succeeded collection/ingestion/publication/verification stages. Each run also has successful preflight, collect, ingest, publish, verify and record GitHub jobs. No manual run, relabel or dispatch was performed.

Configuration readback: daily cron `17 20 * * *` (04:17 HKT), collect/ingest/publish/verify timeouts 120/20/45/10 minutes; enabled true, expected branch main, approved parser python-v2.2. Source `28hse_agent_540`, scope `agent:540`. These counts are per-run observations/publication decisions, not interchangeable inventory totals.

| Native run | App SHA | GitHub created UTC | Ads observed | Published | Held |
| --- | --- | --- | ---: | ---: | ---: |
| [37243007099](https://github.com/YNWAforever/earnestproperty/actions/runs/37243007099) | `4965d484137a` | 2026-10-04T23:14:00Z | 270 | 2 | 77 |
| [37398559047](https://github.com/YNWAforever/earnestproperty/actions/runs/37398559047) | `4965d484137a` | 2026-10-06T01:19:18Z | 264 | 0 | 76 |
| [37548837306](https://github.com/YNWAforever/earnestproperty/actions/runs/37548837306) | `73d41c8c6bdd` | 2026-10-06T23:51:28Z | 268 | 3 | 79 |

The configured trigger time and actual GitHub created/job times are separate facts. Observed starts were hours later than 04:17 HKT; no cause is inferred or punctuality accepted. All three operation-registry rows also have `started_at` later than `finished_at` by under two seconds, because summary insertion supplies a default start rather than the actual collection start. Exact original values and actual GitHub job times are preserved in the JSON. No historical DB timestamps were rewritten.

**READY:** three genuine full native pipeline records, 3/3 evidence. **NOT_READY:** truthful operation start chronology and punctuality acceptance. **PARTIAL:** EP-08/21 overall acceptance; schedule count alone does not prove all Golden journeys, roles, viewports, restore, worker/provider/model or Property.hk readiness. Earlier manual/skip evidence remains unchanged. Property.hk real detail/media and comparable full EPS/EPT/EPW/dt scope remain blocked.

Both CSVs append new execution columns and preserve all historical cells: 29 PASS / nine FAIL / 22 BLOCKED and 22 planned NEW cases. Private native log hashes remain durable; raw data and credentials are not published. No runtime/configuration/migration change or production write results from this readback. Rollback is unnecessary for this read-only evidence; preserve the full receipts and operation history.
