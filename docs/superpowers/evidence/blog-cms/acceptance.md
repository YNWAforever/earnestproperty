# Blog CMS — Task 8 integrated acceptance

Task9 handoff (2026-11-05): Tasks1–8 are reviewed complete per the controller. This document retains the Task8 historical results and fix1 binding. Task9 operations/test changes were rebuilt and exercised through a fresh bound HTTP run; see [cutover package](cutover.md) for the current source/artifact hashes, scoped local pause/recovery results and still-BLOCKED hosted gates. Task9 independent review and final whole-change review remain separate.

2026-11-05. **Local acceptance PASS, with the diagnostics below. Hosted acceptance NOT_RUN; release remains BLOCKED.** Independent controller review follows. No deployment, production/provider calls, external DB, commits, push, merge or subagents were used. Task9 owns the cutover package.

## Candidate identity

Worktree: `C:/Users/laich/.codex/worktrees/earnest-blog-cms/Earnestproperty`.

- Source HEAD: `8b49d0a21c867c401c4d41db393e43c8db76a74d` (unchanged; the candidate includes uncommitted Tasks1–8).
- Pre-Task8 source SHA-256: `28c86b39eb70f7799279af20a18d7aed2eaa8f25fa4186c0a363bd57b81d59a8`.
- Final candidate source SHA-256: `1304da4f7168bb113bccc1780571f999ac16fe90ac4f88b7cd3cf968d1efde76`.
- Tracked HEAD diff SHA-256: `e87270ab9e032b6047cfb5a43ef7f3d984c38988baf6c798309275a8177db879`; this alone excludes untracked files, so use it together with the source manifest.
- Built `.output` tree SHA-256: `2bff48e508d8a6eaee11a69df2354710e2d2ad6b847cc5f61c7b70e181ce6c84`.
- Task8 before/after file-hash delta SHA-256: `0943f40b6da5292271cafd74be2390a5cb09cb3378adfa24bfb2f187a5d16e1e`.

Reproduce the content identity with `node scripts/blog-cms/acceptance-identity.mjs`. It hashes sorted path→byte-SHA256 maps over `src`, `scripts`, `neon`, `e2e`, `.github`, package/lockfile, Vite/TypeScript and owned-browser configuration, including untracked implementation. It separately hashes all `.output` files. Evidence/docs are excluded to avoid a circular receipt. Full manifests and the Task8-only changed-file list are in `.superpowers/sdd/2026-11-05-blog-cms-implementation/task-8-{source-before,candidate,delta}.json`.

## Evidence layers

| Layer | Status | What actually ran / limits |
| --- | --- | --- |
| Pure/component/contracts | PASS | Explicit suites and actual route rendering. Some default-sandbox Bun runs emitted EPERM despite exit 0; see diagnostics. |
| Owned PostgreSQL | PASS | Pinned image, real migrations/import receipts, generated local sessions, real auth/roles/CAS and SQL. Service tests bind the DB dependency to the owned pool; this is not hosted Neon. |
| Built local HTTP + owned DB | PASS | Full clean-environment application build, unmodified Nitro server and auth, actual server-function IDs, installed framework serializer/deserializer, actual HTTP statuses/headers. Only the dummy Neon transport is redirected to owned PostgreSQL. |
| Built public browser | PASS | Actual built HTML/hydration; Blog and article retry clicks after real database-table outages, with no response interception. Outside-origin browser traffic is aborted. |
| CMS owned browser fixture | PASS | 30 unique existing UI scenarios against synthetic ports: 25 `Task6` cases plus 5 `CMS dialogs`. The historical 11+15+6 receipts overlap; they are not 32 unique cases. |
| Hosted signed-in CMS/public/CDN | NOT_RUN | No authorized hosted environment or provider credentials used. Local generated sessions do not prove provider sign-in, hosted Auth/RLS or CDN behavior. |
| Real upload/storage/provider | NOT_RUN | UI upload concurrency/error handling is fixture evidence; no real media storage or AI/provider operation. |
| Release/cutover | BLOCKED | Real inventory, approved target/backup/manifest, hosted checks and Task9 cutover approval remain outstanding. |

## Integrated workflow and HTTP receipt

The shared `scripts/blog-cms/acceptance-scenario.mjs` runs twice: through authenticated source services on an owned DB, and through the **built application HTTP endpoints** on a different owned DB. Both use the actual importer with a verified container identity, backup digest, complete fixture snapshot and manifest approval. No application auth bypass or repository callback substitute is used in the built run.

It imports **101** mixed legacy-text/rich articles with exact supplemental URLs, a private unpublished article and a future article. Every article is listed across the 100-row boundary, loaded with actual edit tokens, edited (body, title, alt and SEO), saved and reloaded. It preserves slugs, null/future dates, rich marks and links. The built run additionally GETs **all 101 original `/blog/<slug>` routes without following redirects**: 99 public HTTP 200, one private draft 404 and one future article 404, all with no-store headers.

The same workflow changes main/category copy and ordered featured selections independently; rejects stale dual-version category edits; renames/hides the category while retaining exact `成交分析`; races two real editors and rejects the loser/stale save; protects an agent's private draft through newer publication; injects a real write-trigger failure and verifies rollback plus exact request-ID retry; injects a read outage and verifies saved identity/CAS installation before failed refresh; unpublishes and prunes both feature scopes; then repeats the original import with **zero writes** and whole-protected-snapshot equality. A separate still-active private draft, newer body/copy edits and all 101 URLs survive replay. Receipt verification correctly reports `changed`, never overwrites drift.

Final owned-DB receipt: `{"layer":"owned-db","targetIdentity":"owned:7511c809d046aa817cc3a37c1190c01f36ec4fc5d2db674d9ea9c1a7bb365d4f:postgres","systemIdentifier":"7704508936232742952","manifestFingerprint":"054bab5d9b8e8035c1e8ccfe1187fcf7d038f001d8ce6513d4c37154e3b58051","sourceDigest":"991da896da74a89524a156533b7420608798e859b1e84a4794ea6b475bf25e35","articles":101}`.

Final built-HTTP receipt: `{"layer":"owned-db","targetIdentity":"owned:2f1dd16029682bc855198c9f9e5fcd9ae3b423f6290a08e25c9637398a6b6fda:postgres","systemIdentifier":"7704509897539719207","manifestFingerprint":"5d3e4e9669cc4245e0368d8e34fc01862de5d9fe28617caadbebb3738f7d9383","sourceDigest":"b331d4cc46627083e6bb4dd4c33d96079363fe317bba1368e93da8619858dd3e","articles":101}`.

Both targets use `pgvector/pgvector@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0`. They are newly owned random containers with inspected loopback binding and PostgreSQL system identity, removed by the existing harness after testing. These identities are historical test targets, not reusable connection targets.

HTTP assertions cover safe serialized bodies and **200/401/403/404/409/422/503**, including private/no-store/noindex on admin responses and actual `ServerFnResponseError.status/message`. The transport uses the installed `serverFnFetcher` with an empty local serialization context; it performs real network requests to the built server. Normal Origin/Sec-Fetch-Site headers satisfy unchanged CSRF protection. Session tokens resolve through actual `neon_auth` tables and staff-role SQL. The child receives an environment allowlist plus a dummy `.invalid` DB URL; its preload forwards only that transport to the owned bridge and denies external fetches. It changes neither the artifact nor authentication.

Public Blog/category/detail success and not-found HTML, and sitemap/llms responses, assert `Cache-Control`, `CDN-Cache-Control`, and `Vercel-CDN-Cache-Control: no-store`. Publication withdrawal is seen on the next request. Missing/withdrawn/draft/future content is not-found, not an empty success or registry resurrection. Loader outages render the visible unavailable heading and retry button with **HTTP 500** (current router behavior); public server-function and sitemap/llms outages return **503**. These statuses are deliberately distinguished. After the real table is restored, clicking retry refetches and renders current content on both pages. Screenshots: `task-8-public-retry.png`, `task-8-article-retry.png` in the log directory.

## Defect found and corrected

Final screenshot inspection found the article detail category badge/Article JSON-LD still used the immutable key after a display-name rename. A new actual-route rendering regression and the integrated owned-DB expectation both failed first. The public reader now joins **both** `c.key` and `c.name`, exposing `categoryName` separately. The detail display/Article section uses the name; compatibility/query key stays `成交分析`. There is no URL, schema, authorization or mutation change. The built HTTP regression also asserts the renamed text after the CMS mutation.

Pre-Task8 aggregate checks also exposed stale test integration: the Task4 visibility test still expected registry-only fallback removed by reviewed Task7; the editor source contract still expected a single upload setter replaced by reviewed Task6; the secret scanner treated the explicitly owned-only CLI as browser source; and one Task6 fixture line was unformatted. Updated the two obsolete expectations, added an explicit **no application imports of the blog importer** guard alongside its narrow CLI scan classification, and formatted that line. No secret access or staff permission was relaxed.

## Commands and explicit exits

All commands ran in this worktree. Logs below are under `.superpowers/sdd/2026-11-05-blog-cms-implementation/test-logs/`; each ends with `EXIT_CODE`. Node `v26.13.0`, Bun `1.3.14`; installed locked dependencies, no installs. DB tests use `bun test --no-env-file`; Docker/browser elevation was used only after sandbox pipe/loopback restrictions were established. `npm run build` ran with only OS/tool-location environment variables retained, no `.env` file, no production secrets and no Vercel production flag.

| Command | Exit / status | Evidence |
| --- | --- | --- |
| `npm run test:blog-cms` | 0 / PASS, 63 tests | `task-8-final-blog-cms.log` |
| `npm run test:blog-cms:db` | 0 / PASS, 6 wrapper tests, real schema/repository/import/public/integrated groups | `task-8-db-final.log` |
| `npm run test:blog` | 0 / PASS, 107 tests | `task-8-final-blog.log` |
| `npm run test:cms` | 0 / PASS, 100 tests | `task-8-final-cms.log` |
| `npm run test:seo` | 0 / assertion PASS, 133 tests; diagnostics below | `task-8-seo.log`; after category fix `task-8-category-seo.log` |
| `npm run test:content-copilot` | 0 / PASS, 139 tests | `task-8-final-content-copilot.log` |
| `npx tsc --noEmit` | 0 / PASS | `task-8-typecheck-final.log`; after fix `task-8-category-typecheck.log` |
| `npm run lint` | 0 / PASS, 0 errors, 9 existing warnings | `task-8-lint-final.log` |
| `npm run build` (clean environment) | 0 / PASS, full client/SSR/Nitro output | Final fixed artifact: `task-8-category-build.log` |
| `npm run acceptance:blog-cms:http` (installed Chromium path) | 0 / PASS | Final fixed artifact: `task-8-category-http-green.log` |
| `npx --no-install playwright test --config playwright.admin-owned.config.ts e2e/admin-leave-guards.spec.ts --grep Task6` | 0 / PASS, 25 cases | `task-8-browser-fixtures.log` |
| Same Playwright command with `--grep 'CMS dialogs'` | 0 / PASS, 5 cases | `task-8-browser-cms-dialogs.log` |
| `node --test src/test-wiring.test.mjs src/lib/ai/ai-contract.test.mjs src/routes/admin.cms.usability.test.mjs` | 0 / PASS, 39 tests | `task-8-wiring-final.log` |
| `bun test --no-env-file src/lib/blog/public-render.test.tsx --test-name-pattern 'renamed category'` before fix | 1 / FAIL (expected RED), plus sandbox EPERM | `task-8-category-label-red.log` |
| `bun test --no-env-file src/lib/blog/cms-acceptance.integration.test.ts` before fix | 1 / FAIL (expected RED), missing renamed category field from real DB reader | `task-8-category-db-red.log` |
| `bun test --no-env-file src/lib/blog/public-render.test.tsx` after fix | 0 / assertion PASS, 8 tests; EPERM diagnostic | `task-8-category-render-green.log` |
| `bun test --no-env-file src/lib/blog/cms-acceptance.integration.test.ts src/lib/blog/public.integration.test.ts` after fix | 0 / PASS, 2 wrapper tests | `task-8-category-db-green.log` |
| Focused renamed-category render with explicit visible span assertion | 0 / assertion PASS; EPERM diagnostic | `task-8-category-label-final.log` |
| `node --test src/routes/blog.routes.test.mjs` after fix | 0 / PASS, 9 tests | `task-8-category-route-contract.log` |
| `npx --no-install eslint src/lib/neon/blog-public.server.ts 'src/routes/blog_.$slug.tsx' src/lib/blog/public-render.test.tsx scripts/blog-cms/acceptance-scenario.mjs scripts/test-blog-cms-http.mjs` | 0 / PASS, no diagnostics | `task-8-category-lint.log` |
| `git diff --check` | 0 / PASS, line-ending advisory | `task-8-diff-check.log` |

The broad suite pass preceded the final two-file category-label product fix; affected rendered-route, public/integrated DB, SEO, typecheck, lint, route contracts, full build and built HTTP acceptance were rerun for that change. Unaffected broad suites were not repeated. CI wiring adds the pure suite to ordinary CI and the DB suite after the existing pinned-image pull. No remote CI was run.

## Failure and warning classification

- **Environment, not product RED:** initial `task-8-blog.log` exit 1 includes Bun parent-directory EPERM and its subprocess failure. Elevated required rerun passed. Default Docker API access was denied before owned elevation. SEO and final focused render logs can report EPERM with assertions passing and exit 0: these are **assertion passes with an access diagnostic**, not pristine runs.
- **Pre-Task8 candidate integration failures, corrected:** initial CMS/copilot/lint logs exit 1; first explicit DB aggregate `task-8-final-blog-cms-db.log` exit 1 at the stale fallback assertion. They existed when combining reviewed Tasks1–7, not introduced by Task8 implementation. They are not labelled clean-HEAD baseline failures. All have covering green results above.
- **New actual product finding:** renamed category detail label, expected RED→GREEN as above. No remaining observed local functional failure.
- **Harness-development failures, corrected:** `task-8-integrated-{first,second,third}.log` exit 1 (module-load ordering, test SQL parameter typing, incomplete fixture category inventory). `task-8-http-{first,second,third,fourth,fifth,sixth,seventh}.log` and `task-8-http-diagnostic.log` exit 1 (client runtime context, normal CSRF headers, actual `x-tss-raw` header name, dummy Neon hostname mapping, first-page/curated-llms fixture expectations). These are retained and are not called application defects or passing evidence.
- **Existing lint warnings:** nine Fast Refresh warnings in `design-states.tsx`, `EnquiryResolutionPanel.tsx`, and `FolderLoadNotice.tsx`. Those files have no HEAD diff. The separate Task6 fixture formatting error was fixed.
- **Toolchain/build warnings:** Node module.register deprecation, ignored dependency `use client` directives, mixed static/dynamic imports, unused external imports and large chunks. Present in the initial Task8 full build too; no clean-HEAD build was run, so no stronger baseline provenance is claimed. Builds exit 0; warning-free build acceptance is not claimed.
- **Browser fixture warnings:** NO_COLOR/FORCE_COLOR, module.register deprecation and staff-session mixed imports. Browser assertions passed; these are not provider or production acceptance.
- **Known configuration warning:** missing WhatsApp contact in no-secrets local tests. The built runtime asserts exactly that expected stderr message and rejects unexpected server stderr. No real contact setting was supplied to silence it. Expected Node module-mocking warning is explicitly checked by DB wrappers; unexpected child stderr fails them.
- **Git advisory:** LF→CRLF warning for generated route tree during identity/diff inspection; no source delta for that file and `diff --check` exits 0.

## Review and remaining release gates

Author integration review checked the importer snapshot/receipt seam, CMS tokens and install-before-refresh ordering, both settings versions, all existing article mutation/restore/archive paths through `cms_mutate`/`blog_lock`, role rechecks, public live-only reads, immutable keys, category display, discovery outputs and cache headers. Required tests cover alternate paths rather than relying only on this reading. Independent controller review is still pending; this author review is not a substitute.

**NOT_RUN:** authorized hosted sign-in and full browser-to-provider-to-DB journey, real media upload/storage, hosted RLS/session revocation/CDN behavior, CI, real account inventory and complete backup/restore rehearsal. No production inventory count is inferred from either the synthetic 101 or the existing 112-registry test. Real live/draft/history inventory remains unknown. Registry-free readers must not be released before separate approved complete reconciliation and hosted acceptance. Operational recovery and cutover artifacts belong to Task9; no rollout or activation is authorized by this report.

## Review fix round 1/5 — 2026-11-05

**PASS for the two reviewed P2 fixes and refreshed local HTTP acceptance.** This supplement supersedes the earlier narrow v1 candidate identity and implicit source/build association. Earlier logs, manifests and screenshots remain historical evidence; they did not establish the new receipt binding. The import receipt's `sourceDigest` identifies fixture import data, **not application source**.

### Changes and focused coverage

- The independent `no-link-local-postgres` CI job now installs its own Bun via `oven-sh/setup-bun@v2`, selecting `bun-version: 1.3.12` before either Bun-backed DB suite. A job-scoped wiring regression checks this ordering and version. Remote execution of that CI job remains NOT_RUN; local Bun is still 1.3.14.
- Identity v2 hashes all Git-visible tracked/untracked files except documentation/evidence, plus all `public/` assets (including ignored assets) and root build/config inputs even when ignored. It covers `bunfig.toml`, `eslint.config.js`, `playwright.config.ts`, Vercel/Wrangler/Prettier/component configuration and other existing source/operations inputs. The new manifest contains 2,006 source files and 926 output files. Evidence exclusions prevent circular hashes; symlinks encountered in the maps/walks are rejected.
- `npm run acceptance:blog-cms:build` runs the full fixed `npm run build` command with the OS/tool-location environment allowlist and rejects dotenv files. It invalidates any previous receipt, removes the verified workspace `.output` directory, requires exit 0 and fresh Nitro/server output, and rejects source/HEAD changes during the build. Only then does it record source/output hashes, Node version, build time and command/exit in `.audit/blog-cms/build-receipt.json`.
- HTTP acceptance verifies the receipt against current source and every output file **before Docker/server/browser initialization**, logs `BUILD_BINDING`, and re-verifies/logs the identical `BUILD_BINDING_VERIFIED` after successful assertions. Missing/invalid receipts, stale source and altered output fail closed. This is local reproducibility evidence, not a signed supply-chain attestation; installed dependency bytes are not independently attested.
- Five identity tests cover omitted/ignored input changes, failed/incomplete/stale/no-output builds, source drift during a build, dotenv rejection, edited/deleted/extra output and invalid receipt rejection, plus actual HTTP-runner subprocess refusal of stale source and tampered output before initialization. They use isolated synthetic build output, not the real HTTP success evidence. `test:blog-cms` explicitly includes them; the focused run also covers the existing wiring tests (16 total).
- The actual built public page and article server functions are now called directly during the real database-table outage. Both assert HTTP 503, safe `BLOG_UNAVAILABLE`, `x-tss-raw` and no-store via the framework transport. This closes the earlier direct-endpoint assertion gap. Public unavailable HTML remains the separately observed router HTTP 500; both real browser retry checks pass after restoration.

Round-one implementation paths: `.github/workflows/ci.yml`, `package.json`, `src/test-wiring.test.mjs`, `scripts/blog-cms/acceptance-identity.mjs`, new `scripts/blog-cms/acceptance-identity.test.mjs`, new `scripts/blog-cms/build-acceptance.mjs`, and `scripts/test-blog-cms-http.mjs`. No product/auth/schema change in this round.

### Bound candidate and actual HTTP run

All hashes below are SHA-256 except Git HEAD:

| Identity | Exact value |
| --- | --- |
| HEAD (unchanged) | `8b49d0a21c867c401c4d41db393e43c8db76a74d` |
| Source v2 | `bc267629e6208d7c4c7e12e01cf1faca49b41adeba33b68170ada91fa8f676fd` |
| Tracked HEAD diff (supplementary; untracked files are in source map) | `e3b1f373cee429f321a657211277b62fa5787fe8b6fe2263f5f14c39e7ab7ee1` |
| Fresh `.output` | `0f885fe4d7e585deae645d3b7a5a5f0a76fffd389608b6b0208b2ae45df560de` |
| Successful build receipt bytes | `973b647c10d5337e7ae20eacc05cf5d600a6e820ced3dcc2ef60f36246a498c5` |
| Build time / Node | `2026-11-05T02:52:13.302Z` / `v26.13.0` |

Full maps: `.superpowers/sdd/2026-11-05-blog-cms-implementation/task-8-r1-candidate.json`. Preserved receipt copy: adjacent `task-8-r1-build-receipt.json`. The real HTTP log's starting and ending bindings match all source/output/receipt values above. No source changes followed this build.

The refreshed run again executes import → CMS edit/reload for all 101 → independent copy/features/category rename → stale/concurrent edits and private draft preservation → failed reads/writes and retry → unpublish → read-only repeat import. All 101 original URLs are checked (99×200, draft/future×404), admin serialization/status/private headers pass, and both built browser retries pass. Its owned database receipt is:

```json
{"layer":"owned-db","targetIdentity":"owned:095ed2d78bad572e055c026661b92aad5e61bb9fec292632308b03d6d5cdf0f0:postgres","systemIdentifier":"7704515131629219879","manifestFingerprint":"0253fc697d728e9d421fe706e8d70974a6989c79f4ebc73f04169c131ea50683","sourceDigest":"1ee5d7a7d3e361e472a911c7b93c158bf7e1ee326a0890d85870c48782715f4e","articles":101}
```

That `sourceDigest` is fixture-data identity only. Actual HTTP evidence uses the unchanged built app/auth and the same owned-only SQL bridge/pinned Docker image described above. New screenshots and server stdout/stderr are in `test-logs/task-8-r1-http-artifacts/`; original artifacts are retained.

### Commands, exits and warning provenance

Log names below are under `.superpowers/sdd/2026-11-05-blog-cms-implementation/test-logs/`.

| Command / execution | Exit / status | Log |
| --- | --- | --- |
| `node --test scripts/blog-cms/acceptance-identity.test.mjs src/test-wiring.test.mjs` before implementation | 1 / expected FAIL: missing new export and missing job-local Bun setup; not an assertion-level tamper RED | `task-8-r1-red.log` |
| Same, initial implemented sandbox run | 1 / BLOCKED by sandbox temporary Git config write; not application failure | `task-8-r1-focused-first.log` |
| Same, local elevated run | 0 / PASS, 16 tests | `task-8-r1-focused-green.log` |
| Same, final expanded HTTP-runner source/output tamper checks | 0 / PASS, 16 tests, no skips | `task-8-r1-focused-final.log` |
| `npx --no-install eslint scripts/blog-cms/acceptance-identity.mjs scripts/blog-cms/acceptance-identity.test.mjs scripts/blog-cms/build-acceptance.mjs scripts/test-blog-cms-http.mjs src/test-wiring.test.mjs` | 0 / PASS, no diagnostics | `task-8-r1-lint.log` |
| `git diff --check` | 0 / PASS | `task-8-r1-diff-check.log` |
| `npm run acceptance:blog-cms:build` (full `npm run build`, sanitized environment) | 0 / PASS with warnings | `task-8-r1-build.log` |
| `npm run acceptance:blog-cms:http` with installed Chromium path | 0 / PASS, real HTTP/owned DB/built browser, binding verified before and after | `task-8-r1-http.log` |

The changed regressions, full build and bound HTTP were refreshed. Unrelated broad blog/CMS/SEO/copilot/typecheck/lint/aggregate-DB/browser-fixture suites were **not repeated**; their earlier evidence remains scoped to the earlier candidate and product changes. Focused test fixtures only initialize temporary Git repositories; no commits are created. Elevation was limited to local temporary Git metadata restrictions and authorized Docker/loopback execution.

Build warnings are retained: Node `module.register` deprecation, `createServerFn().inputValidator()` deprecations, dependency `use client` directives, mixed/unused imports, large chunks and a dependency Rollup annotation warning. No clean-HEAD build was performed, so newly enumerated toolchain warnings are not claimed baseline-proven. **New wrapper diagnostic:** Node DEP0190 for Windows `shell: true` with arguments; this invocation uses fixed literal `npm.cmd run build`, without user-interpolated arguments. It exited 0; warning-free execution is not claimed. The built server again emitted only the asserted missing-WhatsApp configuration warning. Earlier nine lint warnings and environment diagnostics remain recorded above; targeted round-one ESLint is clean.

**NOT_RUN:** hosted/provider/CDN/sign-in/upload checks and remote CI. **BLOCKED:** release until the separate inventory/reconciliation/hosted gates are met. No external operations, deployment, subagents, commits, push or merge occurred. Independent review follows; Task9 still owns cutover packaging.

Final documentation handoff check: `node --input-type=module -e "import {verifyBuildReceipt} from './scripts/blog-cms/acceptance-identity.mjs'; console.log(JSON.stringify(verifyBuildReceipt()))"` exited **0 / PASS**, retaining the exact source/output/receipt binding above (`task-8-r1-handoff-binding.log`). `git diff --check` exited **0 / PASS** (`task-8-r1-handoff-diff-check.log`), with the existing generated-route LF→CRLF advisory. Only excluded evidence text was appended after these checks.
