# Finishing-gate remediation — 2026-11-06

Status: local integration gate PASS on 2026-11-06. The consolidated matrix records all 111 applicable local CI commands as PASS after sequential stop/repair/resume runs. Lint exits zero with nine pre-existing warnings, typecheck passes, the current source has a fresh Node24 build receipt, and the built HTTP/Chromium acceptance passes. Hosted accessibility and provider/runtime acceptance remain separate NOT_RUN/BLOCKED gates. Production remains unchanged.

Latest matrix evidence: `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/finish-verification/finishing-20261106-fixed*` plus `.superpowers/sdd/2026-11-06-blog-cms-verification-repair/final-matrix-reconciliation.json`. The earlier failed navigation/layout logs remain preserved as history.

## Root causes and repairs

1. Five corridor cases failed before query execution because data-URL harnesses only inlined one import level. The new blog server dependency introduced nested server-only imports; queries.ts also gained a blog transport import. Seven non-blog harnesses now substitute a narrow throwing blog boundary, preserving real listing/corridor SQL, mapping and assertions. Added checks prove unexpected blog callbacks never execute, and the performance loader is covered without an external database. Targeted result117pass/1optional externalDBskip; actual CI corridor passed.
2. Aria-current route fixture relied on the removed registry-on-DB-error fallback. It now supplies a typed successful CMS article, retains the actual route/router/header/footer/aria assertions, and additionally verifies unavailable rendering cannot resurrect the registry body. Exact layout suite40pass.
3. Three new blog selects lacked the repository's shared field style. ArticleEditor category and BlogManager category/state selects now use nativeFieldClassName, preserving values/options/handlers. Styles33pass.
4. Homepage cache contract still classified estate.$slug as CDN-cached. Its live related-CMS references require the approved no-store behavior. Contract now explicitly checks no-store/live read and retains request-reader scans; other cached-parent protections remain. Homepage49pass.
5. An existing owner-publication timezone subprocess imported a raw Windows C: path as ESM. A file URL fixes platform resolution without changing its date/UTC assertions. Import fixture suite31pass; no owner publication was performed.
6. Lint scanned Git-ignored .superpowers scratch evidence and found formatting/redundant types in new inventory tools. Evidence is now excluded like the existing .audit/private directories; actual tool/test directories remain checked. Removed redundant anys/useless quote escapes and ran Prettier on rehearsal script only. Inventory23pass, escaped-JSON focused1pass; lint0errors/9existingwarnings, typecheckPASS. Rehearsal formatting-only status is controller-observed from formatter command; exact pre-format bytes were not retained for independent equivalence review.
7. NAV-07 reached an import-time `localStorage.getItem` in the shared synthetic blog fixture. The fixture now falls back to its in-memory records when storage is denied. Navigation8pass, including the denied-storage case.
8. The admin-layout browser build initially substituted a rejecting blog API even though the real CMS article UI loads categories and opens the editor. It now uses the existing synthetic blog service and initializes the same role key used by the app and fixture; layout221pass and leave-guards40pass.
9. The Windows Python locale decoded a UTF-8 property fixture as cp950. The test helper now reads UTF-8 explicitly; property-sync Python447pass.
10. The estate projection contract assumed LF line endings. It now accepts LF or CRLF while retaining the real projection and publication assertions; estate-conversion131 Node +5 Bun pass.
11. The old ArticleDialog source contract followed the component into ArticleEditor. The test now verifies dirty-edit, upload, save and navigation guards directly; command-center127 Node +94 Bun pass.
12. Two time/line-ending-sensitive fixtures were corrected without weakening behavior: the C-09 routing receipt is seeded inside the default window, and the 28HSE SQL parser-guard marker normalizes CRLF. Operations-owned DB20pass; 28HSE import DB3pass.

The layout suite's isolated `ERR_NO_BUFFER_SPACE` did not reproduce in the focused case or the complete 221-case rerun and is retained as transient Windows browser pressure, not claimed as a code fix.

## Scope and safeguards

Application changes in this phase are limited to the three shared select-class assignments/imports. Later changes are repository test/browser-fixture portability and binding fixes; no production application behavior was added. Prior evidence and failed attempts remain preserved.

Node24.22.2 is used for Node/build commands; package scripts invoke installed Bun1.3.14 (CI pins1.3.12). Python3.14.6 local ignored venv was populated from repository-pinned requirements. Hosted test:a11y is excluded from the local CI matrix because no staging deployment is approved. Optional externalDB fixture remains skipped; never point tests at production to clear a skip. Sandbox parent-directory EPERM messages in some Bun runs were nonfatal but are retained; an import fixture temporary-directory rename failed in sandbox and passed outside it. No automatic approval rejection occurred.

## Evidence

All logs under .superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/finish-verification/.

- Original failure: test-corridor.log and corridor-reproduction.log.
- Worker loader repair: public-data-loaders-red.log, public-data-loaders-final.log, corridor-helper-format.log.
- Sequential local CI batches: next-phase-matrix*, each with planned-suites.txt/results.json/per-suite logs. A failure stops that batch; its later passing repair is recorded in manual-results.json or a later batch, never rewritten over the failure.
- Reviews: ../test-remediation-review.md; implementer reports ../test-loader-fix-report.md and ../next-phase-aria-report.md.
- Fresh candidate build: remediation-build.log; final identity/HTTP evidence will be recorded after completion.
- Final fixes: `.superpowers/sdd/2026-11-06-blog-cms-verification-repair/`, including focused suite logs, the 111-command reconciliation, final build, HTTP acceptance and final review.

Fresh Node24 build and built CMS HTTP/Chromium acceptance passed after these repairs, using the existing 101-record synthetic scenario on owned PG18.6. Receipt SHA-256 `a6e01fd917caf6f77eada4589dd18111cc46a2cc3a9ae582ced690f07f1f31d0`; full source `b9cc3b2c23526f3714529f1c3f092c2bc4973668026acd4ed070cc9046929e4d`; built output `8e7f17a09709f539ff846d93280bb6c8e2fa57cce4a0bd187a58bccc5b262251`. Built at 2026-11-06 00:09:11 SGT. HTTP build bindings matched at start and end; owned container cleanup was independently verified. Existing build warnings and expected unconfigured WhatsApp warning remain qualified.

Current Node24 build receipt SHA-256 `301ee2f8b18da25786f92dd88fdb560d6a8cc2a8a5dffae854af8f4323de4936`; full source `d7635e7bc53f12d045cb18d1b6a46ae4fa2a70582670a15fad29f88a0599d361`; built output `e1a950e32e977359fe616c245155905abcb87a97180b485d1fd05c9687d2e062`. Built at 2026-11-06 03:14:01 SGT. The built HTTP/Chromium run verifies the receipt before and after, the 101-article synthetic scenario on owned PostgreSQL18.6 and owned-resource cleanup. Hosted provider acceptance is NOT_RUN.

The local repo is green. Production executor, sustained writer fence, recoverable backup/media restore and hosted acceptance remain separate open release gates. Willy owns release/database/platform/editorial decisions; ownership is not action approval.
