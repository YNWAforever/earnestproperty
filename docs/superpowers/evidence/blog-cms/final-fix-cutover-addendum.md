# Final-fix cutover addendum — 2026-11-05

**Release remains BLOCKED; no live action authorized or performed.** The six local fixes change the candidate and proposed blog migrations, so the historical Task9 cutover/recovery rehearsal does not bind current source. Keep original cutover.md, receipts, backups and sealed index intact.

| Field | Current local binding |
| --- | --- |
| HEAD | `8b49d0a21c867c401c4d41db393e43c8db76a74d` |
| Source v2 (2012 files) | `dc9745b9f642d4246dba1f348a414789a1cdb03e76c62d365eec7d8f396784db` |
| Output (926 files) | `464d1d571caf48f0e529f87cdb0c7ab420adbbe4842f77c57297213915a4e734` |
| Successful build receipt bytes | `feb7b234d8344d8d64a545420ca4d281ec73061f1e1441f7a81bba437a2fa8ae` |
| Build UTC / Node | `2026-11-05T04:14:51.103Z` / `v26.13.0` |

Local current-source build/actual HTTP/owned DB and affected browser/validation suites pass; see [acceptance addendum](./final-fix-acceptance-addendum.md) and the final-fix report for the inherited broad boundary-check failure and full diagnostics. No current-source full cutover/recovery rehearsal or live inventory was performed in this bounded wave. Historical Task9 pause/import/recovery evidence must remain labelled historical.

Operational consequences for the same package: article restore/archive commands require explicit draft/public CAS tokens and request IDs; exact restore retry returns its prior receipt. Withdrawal preserves independently owned drafts. Authors explicitly reconcile stale drafts rather than silently rebasing. Draft slug claims now fail before persistence and new draft URLs remain editable until first publication; existing/imported fixed URLs remain locked. Exact legacy category key `全部` is unresolved and blocks reconciliation; never silently rename or map it to main. Blank category heading means current display name, independently from required main heading.

Before any future live cutover, the controller must first complete its scoped rereview, bind the exact final candidate, establish the actual target and complete fresh inventory/approved manifest, a reliable all-writer pause/drain/reopen procedure, the production adapter, target backup and current-source targeted recovery rehearsal, hosted/Auth/RLS/storage/CDN acceptance and explicit live authorization. Existing Task9 STOP conditions remain. None is cleared by this local acceptance. No production migration, import, deployment, invalidation, provider operation or approval request occurred in this wave.


## Marker correction — superseding binding and classification (2026-11-05)

The earlier description of the staff-server-function marker failure as an inherited/out-of-scope baseline problem was incorrect. Task9 was an earlier state of this same implementation; Task7 introduced the import ordering regression. It is now fixed in the same final fix wave by putting the server-only marker on line1, without behavioral changes. Full `npm run test:staff-server-fn` passes (exit0, 9+118+11 tests), the affected public boundary tests pass (exit0, 3), focused lint/diff check pass, and the refreshed bound build plus actual HTTP acceptance both pass. Existing Bun environment diagnostics and build warnings remain recorded; no unrelated broad suites were run.

**Current source:** `9477dd72c86039715c3c5409cf9c8b8570da64e48a6e96958cd02802552dfd20`.
**Current output:** `9737663c869ad53f30689792b8929f4f84e08054e4e19262a3fe50dae04a06e9`.
**Current receipt SHA-256:** `4ac475a203f12a3cf10e18d35acf4a96afd33e69cda8e8abbb3d29c946f38236`, built `2026-11-05T04:25:17.043Z`, Node `v26.13.0`, same HEAD `8b49d0a21c867c401c4d41db393e43c8db76a74d`.

`final-fix-marker-http.log` verifies identical starting/ending bindings with the 101-article workflow, six-finding regressions and actual browser outage retry. Retained candidate/receipt/index use the `final-fix-marker-` prefix under `.superpowers/sdd/2026-11-05-blog-cms-implementation/`. The appended [final-fix report](../../../../.superpowers/sdd/2026-11-05-blog-cms-implementation/final-fix-report.md) contains exact commands, exits and preservation proofs. Pre-supplement report/addendum bytes are preserved in `final-fix-marker-originals/`; original indexes, receipts, logs and controller initial diff remain unchanged. Old bindings are historical, never current. No remaining scoped check failure; controller supplemental snapshot and one scoped rereview follow. Production/cutover remains BLOCKED on unchanged live gates, with no external action or release authorization.
