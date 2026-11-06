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
