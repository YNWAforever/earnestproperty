# FX-06: Managers can see and act on every WhatsApp conversation. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Write every behaviour change as a failing test first.

**Goal.** A manager sees every WhatsApp conversation, including unassigned ones and other branches, and can act on it. Today a manager with no `branch_id` sees none, and nobody but an admin sees unassigned conversations (B-01, a root cause of L-01).

**Owner decisions:**
- **D2 (approved):** admins and managers are org-wide; agents see only their own.
- **2026-10-06 follow-up:** managers both **see and act** org-wide. `wa_can_read_conversation` is also the gate for:
  - status change (`admin-data.server.ts:3118-3142`);
  - assignment (`whatsapp-enquiries/assignment.server.ts:58,64`);
  - replies on conversations with no linked enquiry (`woztell/outbound-intent.server.ts:85`).

  Widening the read gate therefore widens these three as well, and the owner approved that.
  `wa_can_reply_enquiry` (`20260929105000_whatsapp_no_link_effects.sql`) is **unchanged**. Replying on a linked enquiry still requires `c.assigned_agent_id = actor` and `c.confirmed_staff_id = actor`.

**Spec.**
- Audit B-01: `git show fix/fx-01-public-form-feedback:docs/audits/2026-10-final-audit.md`, line ~164.
- FX-06 in `git show fix/fx-01-public-form-feedback:docs/audits/2026-10-fix-plan.md`, line ~352.

## Current function (`neon/migrations/20260929104000_whatsapp_enquiry_access.sql`, the latest definition)
```sql
SELECT a.active AND (
  admin
  OR (manager AND a.branch_id IS NOT NULL AND a.branch_id = assignee.branch_id)
  OR (agent AND c.assigned_agent_id = a.id))
```

## Global Constraints
- **The migration is a function replace only.** No table change, no data rewrite.
  - The new body is the old body with the manager branch condition removed: `OR EXISTS(… role='manager')`.
  - Keep `a.active`, `STABLE`, the signature, the `COALESCE(…, false)` wrapper, the admin branch and the agent branch exactly as they are.
- **Revert file.** It restores the previous body verbatim. It must **never** be applied by the migration runner or flagged by the drift check.
  - Check `scripts/neon/apply-migrations.mjs`, `scripts/neon/check-migration-drift.mjs` and `src/lib/control-plane/migration-versions.js` to see how files are discovered.
  - Put the revert where neither picks it up, for example `neon/reverts/20261007100000_wa_access_unassigned_revert.sql`. A test must prove the runner and drift check ignore it.
- **No app code change**, unless a test proves a caller depends on the old manager rule.
- **Never run against production Neon.** Use only PGlite or owned Postgres.
- **Open PRs:**
  - #225 also appends a migration (`20261006110000_duty_manager.sql`) to `migration-versions.js`, and bumps two pinned `migrationCount` tests (85→86).
  - This branch is based on `main`. Append after the current last entry and bump those same counts to 86.
  - The resulting conflict with #225 is expected and trivial: keep both entries, count 87. The PR must say so.
- **Committing.** Only touched files. Never `bun.lockb` or `src/routeTree.gen.ts`. Use conventional commits with a scope, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus
1. **Agents gain nothing.** An agent still cannot read, assign, change the status of, or reply on any conversation not assigned to them, including unassigned ones.
2. **Inactive and viewer accounts still see nothing.** That includes a manager who is inactive.
3. **Linked-enquiry replies are still gated.** A manager can **not** reply on a conversation with a linked enquiry unless it is assigned to them and confirmed. `wa_can_reply_enquiry` is unchanged.
4. **Existing tests that pinned the old branch rule are retargeted to the new rule.** They must not be deleted. The wrong-branch manager case now expects `true`.
5. **The revert really restores the old behaviour.** A test applies the forward migration, then the revert, and checks a wrong-branch manager reads `false` again.

---

### Task 1: Replace `wa_can_read_conversation`, add the revert, retarget tests

**Files:**
- Create `neon/migrations/20261007100000_wa_access_unassigned.sql`.
- Create the revert file (location per Global Constraints).
- Modify `src/lib/control-plane/migration-versions.js`: append the new file.
- Modify the two pinned migration-count tests to 86: `src/lib/analytics/performance-readback-owned.db.test.mjs` and `src/lib/whatsapp-enquiries/link-bulk-owned.db.test.mjs`. Grep for any other pinned count.
- Create `src/lib/whatsapp-enquiries/enquiry-access.owned.db.test.mjs`. It uses `withOwnedPostgres` from `scripts/acceptance/owned-postgres-test.mjs` with all migrations, in ONE container. Wire it into the CI-run script `test:no-link:local-postgres`, or into a new `test:*` script listed in `.github/workflows/ci.yml` in the `no-link-local-postgres` job. `src/test-wiring.test.mjs` must stay green.
- Retarget, don't delete, existing tests that assert the old manager branch rule:
  - `src/lib/whatsapp-enquiries/enquiry-access.db.test.mjs:64-88`;
  - any others found by grepping `wa_can_read_conversation` in tests, e.g. `inbox-query.db.test.mjs`, `assignment-role-enum.db.test.mjs`, `forwarded-enquiries.db.test.mjs`, `conversation-assist-bounded.db.test.mjs`, `scripts/no-link-local-postgres.test.mjs`.

  If a test loads the old migration file by path, add the new one after it.

- [ ] **Step 1: write the failing tests** in `enquiry-access.owned.db.test.mjs`. Use synthetic staff, branches and conversations.
  - `manager without branch sees unassigned conversation`: `wa_can_read_conversation(manager_no_branch, unassigned)` is true.
  - `manager sees other-branch conversation`: the conversation is assigned to an agent in branch B, and the manager is in branch A. Expect true.
  - `manager can assign an unassigned conversation`: through the real assignment server path, or its SQL predicate at `assignment.server.ts:58/64`.
  - `agent cannot see unassigned or others'`: unassigned → false; assigned to another agent → false; own → true.
  - `inactive manager and viewer see nothing`.
  - `reply permission (wa_can_reply_enquiry) unchanged`: a manager on a linked enquiry not assigned and confirmed to them → false. The assigned and confirmed agent → true, as before.
  - `revert restores the branch rule`: apply the forward migration, run the revert SQL, and check a wrong-branch manager reads false again. Re-apply the forward migration afterwards so the container is consistent.
  - `revert file is ignored by the migration runner and drift check`.
- [ ] **Step 2: run the tests and confirm they FAIL** (RED).
- [ ] **Step 3: implement** the migration, revert, registry entry, count bumps and test retargets.
- [ ] **Step 4: verify.** Run:
  - `npm run test:no-link`
  - `npm run test:whatsapp-enquiries`
  - the new owned suite
  - `npm run test:control-plane` (registry + test-wiring)
  - `npm run test:admin-link-bulk:db`, `npm run test:admin-performance:db` (pinned counts)
  - `npm run test:command-center`
  - `npm run lint`, `npm run typecheck`
  - `npm run acceptance:whatsapp-no-link:synthetic`
- [ ] **Step 5: commit** as `fix(whatsapp): let managers see and act on every conversation (B-01)`.

## Owner actions (gated; Claude does none)
1. Apply `20261007100000_wa_access_unassigned.sql` on a Neon branch, verify, then apply it to production with explicit approval.
2. Sign in to staging as a manager with no branch. Confirm an unassigned conversation appears and can be assigned.
3. **Rollback:** apply the revert file. This needs approval.
