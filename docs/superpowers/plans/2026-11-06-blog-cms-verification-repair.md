# Blog CMS Verification Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (preserved user choice) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the owned navigation fixture and complete local verification before designing production release tooling.

**Architecture:** Keep real routes and navigation components; substitute only the blog service boundary in the standalone browser build. Preserve the setup failure when collecting artifacts. Resume the recorded CI matrix with explicit evidence coverage.

**Tech Stack:** TypeScript, Vite, React, Playwright, Node 24.22.2, existing Bun and owned PostgreSQL harnesses.

**Spec:** `docs/superpowers/specs/2026-11-06-blog-cms-verification-repair-design.md`

## Global Constraints

- No push, merge, deployment, production database change, production writer pause or production backup operation.
- Preserve the managed worktree and private evidence. Do not use production connections for tests.
- Any new failing verification command stops execution: report the failure and do not continue repairing or present integration options in that turn.
- Use the recorded failing navigation run as red evidence; do not deliberately repeat a known failure before the repair.
- Preserve article URLs, all CMS behavior and existing assertions. No dependency upgrades, broad server aliases or unrelated refactors.
- Hosted acceptance remains separate. Installed Bun 1.3.14 differs from CI's 1.3.12; report this qualification.
- Work remains uncommitted in the existing detached worktree during this repair; do not sweep pre-existing changes into a commit.

## Review Focus

1. Denied browser storage: loading the fixture must not introduce new localStorage/sessionStorage access; NAV-07 remains passing.
2. Role changes: admin/agent/viewer retain 17/6/1 destinations; NAV-02/03 remains unchanged.
3. Query/history and mobile focus: NAV-04 and NAV-06 retain their assertions at widths 390 and 768.
4. Unexpected blog calls: synthetic service exports reject visibly; no silent empty data or real provider fallback.
5. Failed setup: archive directory exists before build, and teardown cannot replace the build error with a missing-directory error.

## Task 1: Restore the owned browser fixture boundary

**Files**
- Modify `scripts/browser-fixtures/build-admin-layout.mjs`: exact blog API alias before generic `@` alias.
- Create `scripts/browser-fixtures/admin-layout/blog-boundary.ts`: import-safe rejecting exports.
- Create `scripts/browser-fixtures/admin-layout/blog-boundary.test.ts`: rejection contract.
- Modify `e2e/admin-layout-fixture.ts`: archive directory lifecycle.
- Preserve `e2e/admin-navigation.spec.ts` and `e2e/admin-layout.spec.ts` assertions.

**Interfaces**
- Consume the seven public exports in `src/lib/neon/blog-admin.ts` with matching argument types via type-only imports: `listBlogArticles`, `saveBlogArticle`, `saveBlogSettings`, `saveBlogCategory`, `getBlogAdminState`, `getArticlePreview`, `getBlogCategoryOptions`.
- Produce async functions returning `Promise<never>`, each rejecting with `Unexpected blog call in admin layout fixture: <export name>`. No browser storage, window, auth or database access at import time.
- Keep `createAdminLayoutFixture(suite: string)` and its returned `open` interface unchanged.

- [ ] Read the saved navigation failure and trace the route-to-blog-admin import chain. The current builder has no blog-admin alias; that module imports TanStack server APIs. Confirm this is the relevant path before editing. If application behavior must change, stop and propose revised scope.
- [ ] Add the exact alias `/^@\/lib\/neon\/blog-admin$/` to the new fixture module. Do not reuse the leave-guards synthetic blog module: it accesses browser storage during module evaluation and carries unrelated mutable editor state.
- [ ] Add the seven rejecting exports. Add a table-driven Bun test importing the module without a browser, invoking every export with its typed fixture arguments, and asserting the exact rejection message. Use `expect(call()).rejects.toThrow(...)`; no successful calls or swallowed failures.
- [ ] Move `mkdir(artifactRoot, { recursive: true })` before the build subprocess, after the remote-target refusal. Ensure teardown also creates `artifactRoot` before its exclusive manifest write. Keep the nonzero build assertion, server close, UUID archives and `flag: "wx"` intact.
- [ ] Run `bun test scripts/browser-fixtures/admin-layout/blog-boundary.test.ts`. Expected: all seven rejection cases pass, no browser globals required. Stop on failure.
- [ ] Run `npm.cmd run test:admin-navigation:ui` with portable Node24 first in PATH and no provider environment. Expected: all eight original navigation cases pass. Stop on failure.
- [ ] Run `npm.cmd run test:admin-layout:ui` because it shares the helper. Expected: zero failures and no browser errors. Stop on failure.
- [ ] Have a fresh reviewer inspect the exact alias, type-only imports, all retained assertions and setup/teardown ordering. Review the failed-setup path statically rather than intentionally generating a new failing verification command.

## Task 2: Finish verification and refresh the handoff

**Files**
- Reuse `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/finish-verification/run-matrix.ps1` and its existing logs.
- Update `docs/superpowers/evidence/blog-cms/finishing-remediation.md` and `release-request.md`.
- Update `.superpowers/sdd/2026-11-05-blog-cms-live-reconciliation-release/progress.md`.

**Interfaces:** Consume Task 1's passing commands and scoped review. Produce a command/result/log inventory tied to the current source, with PASS, NOT_RUN and remaining release gates distinguished.

- [ ] Prepend the existing portable Node24 directory to PATH. Preserve the runner's inherited-connection and dotenv refusal checks. Use owned Docker resources only where existing suites require them.
- [ ] Run the matrix script with a new `RunName` and `StartAt test:admin-navigation:ui`. This intentionally repeats the repaired entry suite once so the remaining batch has a continuous recorded start. Expected: every selected command exits zero. Stop at the first failure and report it without further fixes.
- [ ] Run `npm.cmd run lint` and then `npm.cmd run typecheck`, stopping on any nonzero result. Record warnings separately from errors.
- [ ] Reconcile unique local CI commands against earlier batch results, explicit repair results and the new batch. Record affected suites rerun after Task 1; never overwrite failed logs or count an obsolete pass for changed dependencies. Report hosted `test:a11y` as NOT_RUN and optional skips explicitly.
- [ ] Check the current candidate against the saved build receipt. If invalidated, run the existing `scripts/blog-cms/build-acceptance.mjs` and owned `rehearsal-http.mjs` using Node24, sequentially with stop-on-failure. Record new hashes and cleanup evidence; do not reuse stale binding claims.
- [ ] Update the handoff's outdated corridor failure and old build identities with current evidence. Preserve historical failures as history. Keep production executor, writer controls, recovery proof and hosted acceptance open.
- [ ] Review `git diff --check` and the scoped diff. Present the verification outcome. Only a fully reconciled green local matrix permits returning to finishing/integration discussion; no integration action is authorized here.

## Follow-up boundary

After a green result, return to brainstorming for the separate production executor and isolated recovery tooling design. This plan neither implements those systems nor approves external resources or production operations.

## Self-review

Checked against the approved design: fixture boundary, unchanged navigation behavior, failure-stop rule, affected-suite coverage, evidence freshness and separate release gates are covered. No product interface changes are planned. Setup-failure handling is verified by ordering review; no deliberate failing subprocess is introduced under the user's stop-on-failure rule.
