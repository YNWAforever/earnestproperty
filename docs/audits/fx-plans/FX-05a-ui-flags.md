# FX-05a: Remove the 4 build-time UI flags. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Staff can always complete and save the WhatsApp staff mapping (G-03), and dev and production show the same admin screens (H-10).

**Approach.**
- Delete `src/lib/admin/final-fix-rollout.ts` and every reader of `finalFixUiFlags`.
- Each screen the flags hid becomes always available, and each "尚未啟用" placeholder is removed.
- The props that only existed to carry a flag (`allowReviewedSave`, `enableBatchImport`) are removed, so there is no "off" path left to drift.
- Server role, branch, version and source-scope checks were always the authorisation boundary (`.env.example:53-54`). They stay unchanged.

**Tech stack.** React 19, TanStack Start, `bun test` (`renderToStaticMarkup`), `node --test`, Playwright owned fixtures.

**Spec.**
- Audit findings G-03 and H-10, and simplification S1, in `docs/audits/2026-10-final-audit.md`. That file lives on branch `fix/fx-01-public-form-feedback`; read it with `git show fix/fx-01-public-form-feedback:docs/audits/2026-10-final-audit.md`.
- FX-05a in `docs/audits/2026-10-fix-plan.md`, on the same branch.

**Production fact this plan relies on.** All migrations these screens need were applied to production on 2026-09-28: 69 of 69 versions (`docs/runbooks/final-remediation-rollout.md`, "Production schema change recorded on 2026-09-28"). Merging this PR turns on four screens in production:
- staff directory setup;
- reviewed save for a staff mapping;
- batch link import;
- the sales-performance report.

The PR description must say this plainly.

## Global Constraints

- **No schema migration, no new env vars, no new dependencies.**
- **Copy.**
  - Remove only the placeholder strings that belonged to the off state:
    - 「同事 Inbox 設定尚未啟用。」
    - the 「核實映射的儲存功能尚未啟用」 title and its note at `StaffMappingWizard.tsx:465-475`
    - 「銷售及代理績效暫未啟用」 and its paragraph
  - Change no other copy. Every string matched by other tests must stay.
- **No behaviour change for the "on" path.** Each screen must render and behave exactly as it does today with its flag set to `"true"`.
- **Do not touch server-side checks.** `admin-data*.ts`, `*.server.ts` and the whatsapp-enquiries server modules must not change.
- **Avoid conflicts with open PRs #221, #222 and #223.**
  - Don't touch `admin-data.ts`, `admin-data.server.ts`, `admin-data.types.ts`, `AdminShell.tsx`, `admin.whatsapp.tsx`, `admin.index.tsx` or the Playwright config `testMatch`/`testIgnore` lists.
  - Fixture build scripts may change only their alias line for `final-fix-rollout`.
- **Committing.**
  - Commit only the files you touched (`git add <paths>`). Never use `git add -A`.
  - Never commit `bun.lockb` (it shows a spurious modification in this worktree) or `src/routeTree.gen.ts` build noise.
  - Commit messages are conventional with a scope, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Testing.** Use synthetic data only. No test talks to Neon, WozTell or a model.

## Review Focus

1. **Staff mapping save on a production build.** Save is enabled whenever the mapping is valid, with no flag involved. Test: `StaffMappingWizard.test.tsx` `save enabled when mapping valid`.
2. **An agent or viewer opening `/admin/whatsapp-settings` or `/admin/analytics` now reaches a screen that used to be hidden.** The server must still refuse their reads and writes, and the UI must show the existing refusal, not a crash. Check:
   - each screen's read path already handles a 403 (existing tests);
   - the screens are not linked for roles that cannot use them.

   This is a check, not new code. Note the result in the report.
3. **Fixtures.** No owned fixture may still alias a deleted module or import `resolveFinalFixUiFlags`. Every owned suite must still build.
4. **Removed off-state tests.** Tests that only proved "flag off hides X" are deleted, not rewritten into tests that assert nothing. Tests that proved "the on path makes no extra reads" stay.
5. **Docs.** `.env.example` no longer lists the four variables. The runbook says the flags were removed, and where they were used for rollback, it says to roll back by reverting the deploy.

---

### Task 1: Delete the flags and their off paths

**Files:**
- **Delete:**
  - `src/lib/admin/final-fix-rollout.ts`
  - `src/lib/admin/final-fix-rollout.test.ts`
  - `scripts/browser-fixtures/no-link/synthetic-flags.ts`
  - `scripts/browser-fixtures/link-bulk-owned/synthetic-flags.ts`
- **Modify `src/routes/admin.whatsapp-settings.tsx:5,77-90`:**
  - remove the import and the placeholder;
  - render `StaffMappingWizard` when `agents.length`, without `allowReviewedSave`.
- **Modify `src/components/admin/whatsapp/StaffMappingWizard.tsx:52-58,278,461-475`:**
  - remove the `allowReviewedSave` prop, its guard, the disabled clause, the title and the note.
- **Modify `src/routes/admin.whatsapp-links.tsx:10,93`:** remove the import and the `enableBatchImport` prop.
- **Modify `src/components/admin/whatsapp/WhatsappLinkWizard.tsx:46,55,622`:** remove the `enableBatchImport` prop. Batch import always renders.
- **Modify `src/routes/admin.analytics.tsx:8,133,153,182,465,484-492`:**
  - remove the import and every `finalFixUiFlags.salesPerformanceReporting` condition, keeping the enabled branch;
  - delete the 「銷售及代理績效暫未啟用」 section.
- **Modify tests:**
  - `src/components/admin/whatsapp/StaffMappingWizard.test.tsx`: add the new test, and drop any `allowReviewedSave` usage.
  - `src/components/admin/whatsapp/WhatsappBatchImport.test.tsx`: delete the `pausing batch import keeps the ordinary link wizard available` test (`:29-42`).
  - `src/lib/analytics/reporting-server.test.mjs:236`: drop the `final-fix-rollout` mock entry. Add passthrough mocks for anything the always-on dashboard path now imports, so the rendered-aggregate test keeps asserting the same things.
- **Modify fixtures:**
  - Remove the `final-fix-rollout` alias entry from the 6 builders:
    - `build-whatsapp-no-link.mjs:35`
    - `build-admin-daily-work.mjs:24`
    - `build-admin-campaign-review.mjs:24`
    - `build-admin-performance-readback.mjs:24`
    - `build-admin-link-bulk-owned.mjs:32`
    - `build-property-maintenance.mjs:21`; remove only the `admin\/final-fix-rollout|` alternative from its combined regex.
  - Remove `finalFixUiFlags` from `scripts/browser-fixtures/property-maintenance/synthetic-staff.ts:51-56`.
- **Modify e2e tests:**
  - Delete `e2e/admin-link-bulk-owned.spec.ts:749-760`, `disabled import flag performs no CSV lookup or batch mutation`.
  - Delete `e2e/admin-performance-readback.spec.ts:1522-…`, `disabled flag explains unavailable report and makes no performance reads`.
  - Remove the `enabled` parameter of `open()` (`:95-110`) and its `analytics-fixture-enabled` line.
  - Delete the `analytics disabled capability is explicit and obtains no performance report` case in `scripts/test-whatsapp-no-link-synthetic-browser.mjs:2402-2416`. Lower that script's expected case count if it pins one.
- **Modify `package.json`:** remove `src/lib/admin/final-fix-rollout.test.ts` from whichever `test:*` script lists it. `src/test-wiring.test.mjs` must stay green.
- **Modify docs:**
  - `.env.example:50-58`: delete the block.
  - `docs/runbooks/final-remediation-rollout.md`:
    - In section 3, replace the "build-time UI switches" paragraph with one sentence: "The four build-time UI switches were removed in FX-05a (2026-10); the screens are always available and server checks remain the boundary."
    - In section 6, replace "set the relevant `VITE_*` UI switch to `false` and rebuild/redeploy" with "revert the deployment".

**Interfaces:**
- `StaffMappingWizard` props are now `{ isWorkspaceCurrent, agents, initialStaffId?, initialStep? }`, with no `allowReviewedSave`.
- `WhatsappLinkWizard` loses `enableBatchImport`.

- [ ] **Step 1: Write the failing test.** In `StaffMappingWizard.test.tsx`, add `save enabled when mapping valid`. Render the wizard at its review step with a valid, reviewed mapping, using the same setup the existing review-step tests use, and pass no `allowReviewedSave` prop. Assert:
  - the save button is not `disabled`;
  - the markup has no `核實映射的儲存功能尚未啟用`.

  If the default is already `true` and the test passes before any change, make it fail first by having the route pass the production flag value. Alternatively, add a route-level source test in `src/routes/admin.routes.test.mjs` asserting that `admin.whatsapp-settings.tsx` has no `finalFixUiFlags` and no `allowReviewedSave`. Show RED.
- [ ] **Step 2: Run to verify it fails.** Run `bun test src/components/admin/whatsapp/StaffMappingWizard.test.tsx`, plus the route test if you added one. Expected: FAIL.
- [ ] **Step 3: Implement** every change in the file list.
- [ ] **Step 4: Run to verify it passes.**
  - `npm run typecheck`, `npm run lint` and `npm run build`
  - `npm run test:staff-notifications`, `npm run test:analytics`, `npm run test:no-link`, `npm run test:control-plane` (test-wiring) and `npm run test:command-center`
  - `npm run test:staff-setup:ui`, `npm run test:admin-link-bulk:ui`, `npm run test:admin-performance:ui` and `npm run test:property-maintenance:ui`
  - `npm run acceptance:whatsapp-no-link:synthetic`
  - the full owned run: `npx playwright test --config playwright.admin-owned.config.ts`
  - `grep -rn "final-fix-rollout\|finalFixUiFlags\|VITE_STAFF_DIRECTORY_SETUP\|VITE_STAFF_REVIEW_ENFORCEMENT\|VITE_LINK_BATCH_IMPORT\|VITE_SALES_PERFORMANCE_REPORTING" src scripts e2e .env.example package.json` should return nothing. Historical reports under `docs/reports` may keep their mentions.
- [ ] **Step 5: Commit** with `fix(admin): remove the build-time UI flags so staff mapping can be saved`.

**Rollback:** revert the PR. Production then hides the four screens again unless the `VITE_*` variables are set to `"true"` in Vercel.
