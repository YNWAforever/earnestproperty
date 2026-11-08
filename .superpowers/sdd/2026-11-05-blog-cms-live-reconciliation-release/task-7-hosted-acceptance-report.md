# Task 7: isolated hosted/accessibility acceptance preparation

Date: 2026-11-07 (Asia/Singapore).

**Implementation complete; local validation PASS; hosted acceptance NOT_RUN and
BLOCKED pending exact approved isolated resources.** No production release gate
is closed by this work. No subagents were used.

## Scope and source binding

- Worktree: `C:\Users\laich\.codex\worktrees\earnest-blog-cms\Earnestproperty`.
- Branch: `codex/blog-cms-release`.
- Verified clean starting HEAD: `e33323cf862551d4e341456f36aaf1a9751c75f7`.
- Delivery commit: the local commit containing this report; its exact hash is
  returned with the task handoff. A future deployment must use the final runner
  commit, and approval must bind both to that same full SHA.
- Read the task brief, release request, all 112 checklist entries, existing
  HTTP acceptance/scenario, Playwright config and accessibility suite, auth
  session and staff boundary, blog services/repository/types/editor, upload
  route/service/repository/Blob adapter and relevant database trigger migrations.
  Graph discovery returned no matching symbols for this indexed project query;
  direct source reads supplied the missing current-worktree evidence.

No deployment, Neon project/branch, identity, session, Blob store or credential
was provisioned. No production/provider account metadata was read, no hosted
test writes occurred, and nothing was pushed, merged or deployed. Only public
provider protocol documentation was consulted, without accessing user resources.

## Delivered implementation

| File | Responsibility |
| --- | --- |
| `scripts/blog-cms/hosted-contract.ts` | Strict input/approval schemas, immutable target bindings, production deny rules, real actor/session fingerprints, checklist/content/cleanup identities, expiry, credential/ambient-environment guards, trigger inventory and complete receipt validation |
| `scripts/blog-cms/hosted-cli.ts` | `validate` with no network; explicit sealed `execute`, exact clean branch/commit requirement, generic credential-safe failure output |
| `scripts/blog-cms/hosted-runtime.ts` | Fixed native provider preflight, TLS-bound DB/session checks, real built RPC transport, URL/content/cache/index checks, upload/readback, private intent journal and scoped cleanup; no injectable production executor or fetch callback |
| `scripts/blog-cms/hosted-scenario.ts` | Fixed 112-record CMS scenario, eight page scopes, seven categories, role boundaries, dates, draft privacy, stale CAS and exact request-ID retry |
| `scripts/blog-cms/hosted-browser.ts` | Native Chromium/axe execution, real cookie-to-token actor verification, approved-origin read-only browser routing and all required public/CMS scans |
| `scripts/blog-cms/hosted-lifecycle.ts` | Always attempt cleanup and connection close; preserve primary and cleanup failures together; supplies no receipt authority |
| `scripts/blog-cms/hosted-contract.test.ts`, `hosted-scenario.test.ts`, `hosted-test-fixture.ts` | Pure synthetic guard/receipt/lifecycle/PNG and full scenario tests, explicitly not hosted evidence |
| `e2e/a11y-checks.ts`, `e2e/a11y.spec.ts` | Shared 27 routes, WCAG tags, 375/1440 viewports, navigation/filter/pagination and Chinese font-size checks; stale category corrected to the existing `市場評論` category. Shared assertions now fail immediately; the existing axe assertion remains soft. |
| `tsconfig.hosted-acceptance.json`, `package.json` | Focused TypeScript target and named CLI/guard commands, with no new dependencies |
| `docs/superpowers/evidence/blog-cms/hosted-acceptance-approval-request.md` | Exact resource, configuration evidence, non-secret identity, secret delivery, operation and cleanup approval request; DRAFT, not permission |

The normal `playwright.config.ts` is unchanged. The hosted command launches no
local server and does not reuse the owned HTTP fixture or create auth sessions.
Its browser checks share the existing accessibility implementation and add all
112 articles, eight page scopes and all three staff list/editor states. Missing
dynamic pages and non-200 pages do not skip. Anonymous uses an empty context;
staff browsers must resolve the approved real auth user and exact opaque session
without injected actor headers. Third-party iframe exclusion is retained.

The input contract rejects known production IDs even when omitted from a
submitted deny inventory, rejects all production inventory matches, and requires
the owner to supply the actual production DB/auth/Blob exclusion values that
were redacted or unavailable in this task. It rejects local/fixture hosts,
non-HTTPS/custom/alias origins, credentials in origins, mutable/mismatched
deployment or commit bindings, shared/missing/expired actors, omitted fields,
duplicate/substituted checklist IDs, missing cleanup targets, partial check sets,
duplicate/unknown check results and local-seam receipts. Every request checks the
appropriate approval lease; expired test authority cannot create a PASS.

## Data and cleanup boundary

The runner requires an exclusive isolated writer fence and owner-verified
immutable build/runtime configuration evidence, then verifies actual Vercel
deployment metadata, Neon endpoint mapping, database/user identity and active
session/staff mappings. A submitted digest is not evidence provenance by itself.
The owner must review the independent configuration source and approval seal.

Code inspection found `ep_knowledge_articles`, which queues AI repair jobs and
marks knowledge chunks stale on article changes. The runner therefore requires
the owner to disable that trigger and background workers/cron on the isolated
environment before execution. It checks the exact live trigger inventory and
refuses unknown triggers or disabled integrity guards. The runner itself makes
no persistent trigger or worker configuration change. AI/worker integration is
outside this acceptance scope.

Before mutations, a private scoped snapshot is journaled. Each article mutation
request ID is persisted before dispatch. CMS restoration holds the blog/table
locks, removes only newly created approved-actor revisions/audit rows, restores
the exact approved article/category/settings/feature/revision/audit baseline and
removes only run request IDs. Immutable revision/projection triggers are disabled
and re-enabled in the same restoration transaction; this exact operation is
explicit in the pending approval request. Unexpected foreign writers, failed
baseline readback or missing owner privileges prevent successful cleanup.

The image test uses a valid 69-byte 1x1 PNG and the exact deterministic
`article/<admin-staff-id>/<upload-id>` path. Admin upload, byte/content-type and
DB metadata readback, anonymous 401, manager/agent cross-actor ID conflict 409
and exact admin retry are implemented. Manager and agent are permitted upload
roles in the existing product; denying every agent upload would test the wrong
policy. Deletion checks exact URL, bytes and ETag, then verifies public 404 with
bounded polling and exact intent/asset-row absence. Media and CMS restoration
are attempted independently and failures are preserved together.

No `PASS_HOSTED` receipt is written until all ten required check groups and both
cleanup boundaries pass. A crash/kill leaves an incomplete journal, never a
resumable approval or inferred success. Recovery after termination requires
owner review and a new exact recovery decision; the runner does not provision
a replacement, delete a database/branch or replay unknown writes automatically.

## Verification performed

All commands below were local. No HTTP server, database container or browser was
started for these tests.

| Check | Result | Local evidence file beside this report |
| --- | --- | --- |
| `bun test --no-env-file scripts/blog-cms/hosted-contract.test.ts scripts/blog-cms/hosted-scenario.test.ts` | **179 PASS, 0 FAIL**, 234 assertions | `task-7-guards-unsandboxed.log` |
| `tsc --noEmit -p tsconfig.hosted-acceptance.json` | PASS, exit 0 | `task-7-focused-typecheck.log` |
| `tsc --noEmit` | PASS, exit 0 | `task-7-typecheck.log` |
| `eslint .` | PASS, zero errors, nine existing React refresh warnings outside this change | `task-7-lint.log` |
| `playwright test --list e2e/a11y.spec.ts` | PASS discovery: 54 tests, 27 at each viewport; **not browser execution** | `task-7-a11y-discovery.log` |
| `npm run blog:hosted` with no inputs | Verified application refusal, expected exit 1 and `BLOCKED_OR_FAILED`; no journal/hosted action | `task-7-cli-refusal-unsandboxed.log` |
| `git diff --check` | PASS | Local command output |

The first sandboxed guard run reported all 179 tests passing but also emitted a
Bun parent-directory `EPERM` diagnostic. It is retained in `task-7-guards.log`;
the identical pure suite was then rerun through approved local escalation and
passed without that diagnostic. The first sandboxed CLI smoke check failed in
Bun with `CouldntReadCurrentDirectory`, so that is **not** credited as a verified
application refusal. The subsequent approved local rerun verified the actual
CLI refusal message. No automatic approval rejection occurred.

Earlier focused TypeScript/lint issues were corrected before these final checks.
A local image-metadata probe could not load the absent `sharp` package; no
dependency was installed. A standard PNG CRC check found and fixed the initial
test PNG's bad IDAT CRC. The final pure suite now verifies every chunk CRC and
inflates the pixel bytes, so it does not depend on `sharp`.

## Remaining concerns / handoff

1. **Hosted execution NOT_RUN.** No exact isolated deployment, resources,
   configuration receipt, real test sessions/state files or approval have been
   supplied. The approval request intentionally leaves these owner values open.
2. Native provider/SQL cleanup and browser behavior have not been exercised.
   Unit seams verify orchestration and refusal behavior, not provider acceptance.
   Any provider API/configuration drift, absent table ownership, unexpected
   triggers, missing seeded dynamic pages or mismatched metadata will fail closed.
3. Cleanup authority must outlive the test lease, and the isolated target must
   remain exclusively fenced through cleanup. Process termination or lease expiry
   can leave isolated artifacts for separately approved recovery; no false PASS
   is emitted. Private snapshots/journals must be retained securely for that case.
4. The immutable preview origin must be the configured canonical origin, and the
   isolated content must support all 112 URLs and the dynamic non-blog a11y pages.
   Browser requests to unapproved third-party origins are blocked. This is not
   acceptance of those third-party services or production CDN activation.
5. Vercel may consume CDN directives. Returned values and absence are recorded;
   returned cacheable directives, HIT/STALE and positive Age fail. This does not
   prove a production purge or custom-domain transition. No purge is implemented.

Production activation remains blocked under the existing release request. The
new command and local evidence do not grant push, merge, deploy, provisioning,
production writes, new sessions or any later hosted execution.


## Fix round 1 — seven review findings (2026-11-07)

Reopened from `19b8e28b080dde228e939998e9bcd671a4aa2643` on
`codex/blog-cms-release`. This appendix supersedes the original implementation
notes where identified below; the earlier verification remains historical.
No hosted/provider request, hosted write, resource provisioning, deployment,
production access, identity/session creation, push or merge occurred. No
subagents were used. Hosted acceptance remains **NOT_RUN / BLOCKED** pending
exact isolated resources and a separate owner approval.

### Changes and covering evidence

1. **Critical — browser redirect credential propagation.** Replaced
   `route.continue()` with one-hop `route.fetch({maxRedirects: 0,maxRetries: 0})`.
   Only terminal responses are fulfilled; every 3xx response fails before
   Chromium can follow it. Unapproved initial origins and redirect destinations
   have distinct `BrowserBoundaryError` codes. All document and subresource
   requests use the same boundary, with service workers blocked and bypass
   headers attached only to the exact app origin. Five real local Chromium
   regressions cover documents, scripts, images, fetch, and a same-origin first
   hop that would subsequently redirect off-origin. Sentinel bearer, bypass and
   cookie values reach the approved loopback app, while the unapproved sink and
   second hop receive **zero requests and zero credentials**. Direct unapproved
   requests also fail with the intended origin code. All redirects, including
   legitimate same-origin redirects, are intentionally unavailable in this
   acceptance runner; approved URLs must be terminal responses.
2. **Important — internal unpublish mutation requests.** The immutable baseline
   and final full readback now include **all `blog_mutation_requests` rows**.
   Client commands are durably recorded before dispatch. Cleanup reconciles
   each direct row to its exact actor/encoded command and each generated archive
   child to one unpublish parent using the same PostgreSQL transaction (`xmin`),
   actor, article, operation, token and archived result. The exact reconciled
   parent/child IDs are journaled before deletion under the cleanup lock.
   Missing/duplicate children, a foreign transaction/actor/resource, incorrect
   operation/result and changed/deleted baseline rows fail. Pure tests remove
   the proven parent and child and assert the complete remaining table equals
   baseline, with zero residual new request rows. Actual PostgreSQL execution
   remains unverified here; no database/provider was started or accessed.
3. **Important — consistent no-op CMS saves.** Article saves are checked against
   the requested title and full article input, then independent reload, public
   API and rendered heading checks. Settings compare every requested field and
   ordered feature IDs independently of the returned record. The native HTML
   check requires the requested heading, introduction, SEO title/description
   and exact ordered featured links. Categories compare requested fields and
   rendered filter names/order; restoration is checked separately. Three
   no-op implementations, reversed feature IDs and a failed rendered feature
   check all reject before their acceptance group can pass.
4. **Important — recoverable journal.** Removed the truncating `journal.json`
   overwrite. A single immutable `baseline.json` is sealed before writes, with
   immutable numbered journal generations linked by hashes. Each generation is
   written exclusively to a new pending file, flushed with `fsync`, closed and
   atomically renamed. Failed writes poison the writer and cannot replace prior
   valid evidence. Tests inject a partial write, flush failure and rename failure
   and compare baseline/previous generation bytes. A real child process exits
   before publication of generation 2; read-only recovery still loads baseline
   and generation 1 and reports the pending file. No automatic resume or repair
   is implied; filesystem power-loss durability is not claimed.
5. **Important — private CDN cache checks.** Private CMS responses retain the
   private/no-store/noindex requirements and now also run the same CDN directive,
   HIT/STALE (case insensitive) and positive Age checks as public responses.
   The RPC transport checks these before parsing both successes and denials.
   Twenty-five negative cases cover statuses 200/401/403/409/503 crossed with
   both cacheable CDN headers, HIT, STALE and Age 1.
6. **Important — outage recovery separate from replay.** The exact-request-ID
   replay remains an idempotency check. `retry` cannot pass until target-bound
   recovery evidence separately proves real page/article RPC 503 responses,
   both HTTP 500 unavailable pages and visible Retry controls, exact restoration,
   successful Retry RPCs and expected rendered titles within the approved bound.
   The future native fault temporarily renames only the exact isolated
   `public.articles` table; its OID, original name and run-bound offline name are
   journaled before dispatch. Timed transactions, `finally`, cleanup and a
   process-local watchdog restore the same OID. The contract now requires an
   exact `recovery` object and `bounded-read-outage` approval action, invalidating
   old approval digests. Tests reject successful RPCs as outage proof, failed
   UI/recovery, deadline expiry and a successful replay with missing outage
   evidence. One real loopback Chromium test observes 503/503, both unavailable
   pages, clicks both Retry controls after restoration, and observes 200/200
   plus correct headings. This is local fixture evidence, never hosted evidence.
7. **Important — intended production isolation refusals.** Production target
   cases synchronize the immutable deployment target and dependent auth
   project/branch/database bindings. They assert `HostedRefusal` plus the exact
   production domain/project/Neon/DB/Blob/auth code, not a generic throw. The
   refusal codes are evaluated before incidental cross-field validation so a
   stale binding or provider hostname mismatch cannot satisfy these assertions.

### Runtime correction discovered by the regressions

The Windows Bun 1.3.14 Playwright launch hung before navigation even outside the
sandbox. A standalone Node Chromium launch succeeded; the final native command
and loopback browser suite therefore use Node with a repository-scoped
TypeScript import hook and the already installed TypeScript compiler. Node does
not load `.env` files. Pure tests continue using Bun with `--no-env-file`.
The browser regressions use the same native browser boundary/recovery code as
future hosted execution. No dependencies were installed or browsers downloaded.
The no-input Node CLI was checked to refuse with `BLOCKED_OR_FAILED` and exit 1,
before any output journal or network operation.

### Round 1 verification

The red test run reproduced **28 failures** (25 private-cache cases plus three
consistent no-op cases) against the original behavior; see `task-7-r1-red.log`.
The sandbox then blocked browser discovery and atomic temporary-file renames;
that failed run is retained in `task-7-r1-tests.log`, not credited as acceptance.
The unsandboxed Bun browser failures are retained in
`task-7-r1-tests-unsandboxed.log` and `task-7-r1-browser-debug.log`. Node loopback
regressions replaced those failed browser executions. Local filesystem/browser
reruns used authorized escalation; no approval rejection occurred.

| Final local check | Result | Evidence beside this report |
| --- | --- | --- |
| `npm run test:blog:hosted:guards` | 228 PASS, 0 FAIL; 2045 assertions across five files | `task-7-r1-guards-final.log` |
| `npm run test:blog:hosted:browser` | 6 PASS, 0 FAIL, no skips; real Chromium, loopback servers only | `task-7-r1-browser-node.log` |
| `tsc --noEmit -p tsconfig.hosted-acceptance.json` | PASS, exit 0 | `task-7-r1-focused-typecheck.log` |
| `tsc --noEmit` | PASS, exit 0 | `task-7-r1-typecheck.log` |
| `eslint .` | PASS, exit 0; zero errors, nine existing React refresh warnings outside this change | `task-7-r1-lint.log` |
| `playwright test --list e2e/a11y.spec.ts` | PASS discovery, 54 tests; not execution of that a11y matrix | `task-7-r1-a11y-discovery.log` |
| `npm run blog:hosted` without input | Expected refusal, exit 1 and `BLOCKED_OR_FAILED` | `task-7-r1-cli-refusal.log` |
| `git diff --check` | PASS | Local command output |

The approval request in
`docs/superpowers/evidence/blog-cms/hosted-acceptance-approval-request.md` now
explicitly describes the outage fields/action, exact child-request cleanup,
immutable recovery files, zero-redirect policy and Node execution requirements.
No concrete resource identifiers or approvals were fabricated.

### Remaining round 1 limitations

- Native provider/SQL identity, cleanup and hosted app outage behavior are still
  **NOT_RUN**. Pure reconciliation tests and loopback browser fixtures cannot
  clear those gates or produce hosted receipts.
- The bounded outage needs newly approved isolated-table DDL authority, an
  exclusive writer fence and cleanup lease. A process kill, disk failure or
  lost DB connection may outlive the process-local watchdog; keep the target
  fenced for separately approved exact-OID recovery. The runner will not pass
  on timeout, partial evidence or unverified restoration.
- Browser redirect refusal is deliberately strict. The future approved target
  must serve terminal URLs and only approved origins. The owner must arrange
  exact isolated resources and sessions; no provisioning is part of this work.


## Fix round 2 — excluded iframe coverage (2026-11-07)

Reopened cleanly from `683fa35d251ab7522206d92b2c353e8abe022d47` on
`codex/blog-cms-release`. The scoped finding was confirmed: `/contact` renders
Google Maps iframes, and the shared accessibility scanner excludes iframe
markup, but the request boundary previously made every foreign iframe request
fatal before axe could scan the parent page.

The accessibility context now explicitly enables the same third-party iframe
exclusion at the request boundary. Only a direct, credential-free GET document
navigation into an actual iframe directly owned by the approved main page is
classified as `BROWSER_EXCLUDED_IFRAME_BLOCKED`. It is **aborted before fetch**
and journaled as `browser-excluded-frame`; it never becomes an allowed network
origin and does not set the viewport's fatal-boundary flag. Other contexts,
including outage recovery, retain the default strict policy.

Top-level navigation, foreign scripts/images/fetches, redirects (including a
redirect from an approved iframe URL), credential-bearing requests, writes and
expired approval still fail. Classification checks URL credentials and actual
request headers, including bearer/proxy authorization, cookies and bypass
headers. Detached/unidentifiable frames or other classification failures also
remain fatal. No iframe content is inspected or accepted as accessible.

The existing parent scanner is now a shared `scanHostedPage` function used by
both native acceptance and the local regression. It checks the fatal boundary
before and after scanning, retains the same axe tags/iframe exclusion and
navigation/mobile assertions, and emits PASS only after all assertions succeed.
The approval request documents the distinction between an excluded frame and
a fatal origin violation.

### Round 2 verification

The new regression first failed on the original behavior with
`browser identity/approval boundary failed`; see `task-7-r2-red.log`.
After the fix, a real Chromium parent-page scan succeeds while the excluded
loopback iframe server receives **zero requests**. Injecting an unnamed button
then makes the same scanner report axe's `button-name` violation and emit no
additional PASS. The iframe server remains at zero requests throughout.

The browser suite also adds an iframe redirect case and runs all redirect
cases with the exclusion enabled, preserving exact fatal codes and zero
credential propagation. A separate browser test covers six cases: exclusion
disabled, bearer authorization, bypass header, cookie, POST iframe navigation,
and expired approval. Each is fatal, records no benign exclusion, and sends
zero requests to the foreign server.

| Final local check | Result | Evidence beside this report |
| --- | --- | --- |
| `npm run test:blog:hosted:browser` | 9 PASS, 0 FAIL, no skips; actual Chromium/axe and loopback servers only | `task-7-r2-browser.log` |
| `npm run test:blog:hosted:guards` | 228 PASS, 0 FAIL; 2045 assertions | `task-7-r2-guards.log` |
| `tsc --noEmit -p tsconfig.hosted-acceptance.json` | PASS, exit 0 | `task-7-r2-focused-typecheck.log` |
| `tsc --noEmit` | PASS, exit 0 | `task-7-r2-typecheck.log` |
| `eslint .` | PASS, exit 0; zero errors, nine existing React refresh warnings | `task-7-r2-lint.log` |
| `playwright test --list e2e/a11y.spec.ts` | PASS discovery, 54 tests; not full matrix execution | `task-7-r2-a11y-discovery.log` |
| `git diff --check` | PASS | Local command output |

Focused lint of all three changed TypeScript files also passed with zero errors
or warnings (`task-7-r2-focused-lint.log`).

Browser and filesystem guard tests used authorized local escalation for the
installed Chromium and temporary-file operations. No hosted/provider request,
production access, provisioning, deployment, push or merge occurred. No
subagents were used. Hosted acceptance remains **NOT_RUN** pending the exact
isolated resources and approval described above; local iframe/axe verification
does not close that gate. The existing outage/cleanup recovery limitations
remain unchanged.
