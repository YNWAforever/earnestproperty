# EarnestProperty Admin UX — final local verification

Release recommendation: **HOLD**. All 25 route templates were migrated. A draft PR is the delivery surface; merge, production deployment and normal-session acceptance are not claimed.

Verified source: `bd044145d324fcdf5c748df1425c621db7cdc6fb`. Base and latest checked main: `433ab194f9e51c789d89d49216fe2983f2791616`. Subsequent reporting commits must leave the source/build/test objects in `verified-source-trees.json` unchanged.

Implementation pack SHA256: `fe18f3103a8967d83c644addd8297b6bf41d8d743c0b09450e67a5b4695666b8`. The original audit ZIP was found beside the user-supplied extracted folder and matched `ffcfe4160a23080caee6b0bf7ca126df298cf29a3ae60bd14394486ba6acb2d2`. No audit contents were guessed.

| Layer | Actual result | Version / limit |
|---|---|---|
| Final owned browser | 387/387: 221 actual-route layout/state/scope, 148 daily, 10 leave, 8 navigation | Clean `bd044145d324fcdf5c748df1425c621db7cdc6fb`; synthetic Auth/API, loopback Chromium |
| Normal geometry | 100/100 = 25 routes × four specified viewports; 50 PNGs | Explicit executed fixture denominator; not normal Auth |
| Review regression gates | CMS 91; transactions 81; estates 27; agents 17; command-center 228; operations 62 | Same source inputs as `bd044145d324fcdf5c748df1425c621db7cdc6fb`; tests overlap, not unique UAT cases |
| Local build/type/lint | Passed; lint 0 errors / 9 existing warnings | Local build, no hosted configuration or runtime parity claim |
| Existing workflow sweep | 772/772 owned browser | `2a23c48e`; see ux08-readout.md; not rerun wholesale after review fixes |
| Owned PostgreSQL | 225/225, 0 skipped, 93 migrations, seven disposable harnesses | `2a23c48e`; unchanged server/migration product sources at `bd044145d324fcdf5c748df1425c621db7cdc6fb`; mocked staff/provider/model boundaries |
| Public mobile chrome/axe | 47/47 | T-UX09 before review fixes; public chrome/style source unchanged |
| Normal Auth role-route matrix | 100/100 blocked | No isolated complete app and four-role sessions supplied |
| New UAT cases | 50 partial, 0 fully accepted | Immutable input remains 50 not-tested; per-case actual/SHA/role/env/scope/evidence/cleanup updated |

The fresh whole-branch reviewer found three Important issues, no Critical issue and no Minor issue. All three received one RED→GREEN fix pass: staff workspace retirement and capability revalidation, default remote test collection, and persistent agent/transaction read-error retry. The implementer ran the post-fix regressions; no second reviewer approval is implied. See [review findings, decisions and costs](review-fixes.md).

Final layout archive: `.audit/admin-ux-20261013/runs/layout-797acc08-175e-4f5f-b8be-41d235c575bf/manifest.json`. Navigation archive: `.audit/admin-ux-20261013/runs/navigation-9c117405-2d01-4e36-adc9-ff4e0c0e3270/manifest.json`. Each recorded the exact SHA and an empty worktree-change list before execution. The 221 individual records are in [ux09-geometry.json](ux09-geometry.json). Screenshots and runner logs remain private; SHA256 entries are in [ux09-review-log-hashes.json](ux09-review-log-hashes.json). UUID archives are immutable. Earlier overwritten screenshot bytes and intermediate fixture/test failures are disclosed in ux07/readout and review-fixes; no failed result was backfilled.

Cleanup: browser contexts and loopback HTTP servers disposed; no DB writes in the UI run. All seven owned PostgreSQL containers were removed by their harnesses, with empty before/after inventories. No production DB/config mutation, real-recipient send, paid app-model/provider canary, merge or production deployment occurred.

Remaining gates: normal Auth→server→DB/provider, direct API denial/readback, deployed app/worker/schema/flag parity, native mobile IME/keyboard and actual browser zoom, human accessibility/UAT, and authenticated HKWTIA reference comparison. The implementation follows the supplied sidebar proposal; no one-to-one authenticated reference claim. Font-size reflow probes are not native zoom. Historical F01–08, RPK01–07 and UC01–20 remain independently open at their historical states.

[Rollout and rollback](rollout-rollback.md) require exact preview/runtime version checks, isolated normal-session acceptance and explicit release authorization. Current local evidence supports code review only. CI and automatic preview status, when available, are reported separately from acceptance.
