# Task 1: verified first-owner bootstrap

Date: 2026-09-05. Working tree: `.worktrees/audit-20260905`, branch `codex/audit-20260905`; source baseline `897f01ac372063113b5a42de9593fe33252d8dc0`. This is local implementation evidence, not production acceptance.

## Reproduction and repair

The new injected-resolver regression was run before editing production code. An allowlisted account with `email_verified: false` received `roles: ["admin"]`; the expected 403 assertion failed (`'admin' !== 403`). Five pre-existing tests passed. The expanded red run had 9 failures out of 18, including missing/unavailable provider data, mismatched provider identity/email, pre-transaction profile binding, and a simulated concurrent bootstrap loser.

`isNeonAuthEmailVerified` now accepts the authenticated account ID and email, and requires the returned provider ID, normalized email, and literal boolean verification flag to match. Missing rows/verification and lookup failures deny access. Existing bound staff continue to use their existing roles without a new verification lookup. Protected-owner role/deactivation policy remains intact.

First-owner creation/binding and admin-role insertion now execute atomically using the existing `transactionRows` facility. A separate first statement locks `staff_users` and `staff_roles` in `SHARE ROW EXCLUSIVE` mode. The next statement at `ReadCommitted` obtains a fresh snapshot and rechecks global bootstrap eligibility, inactive same-email profiles, and the provider's verified ID/email. A CTE reuses one eligible roleless profile or creates one staff row, then inserts its admin role. A competing first-login winner causes the loser to return no bootstrap row and receive 403. Profile-only binding is deferred into this transaction, so it cannot invalidate its own eligibility snapshot. No migration is needed.

The locks also conflict with ordinary staff-table writers, which would not honor a bootstrap-only advisory lock. Missing lock/table privileges or a transaction failure fail closed; those runtime grants still need checking in the approved test environment. An error may require a user retry, but cannot fabricate successful admin access. This change does not redesign the existing invited-staff binding lifecycle.

## Verification

- Final focused `node --test src/lib/neon/auth.server.test.mjs src/lib/neon/staff-security-policy.test.mjs`: **40 passed**, 0 failed. Includes unverified/missing/malformed verification, unavailable provider, mismatched ID/email, non-allowlisted identity, existing admin, disabled bound staff, verified first owner, roleless profile, and simulated race loser. Denied identity cases assert zero staff/role writes.
- `npm.cmd run test:team`: **passed**, including 24 Bun tests. Additional four final malformed/profile regression cases passed in the final focused command above.
- `npm.cmd run test:property-experience`: **passed**, including 131 Node tests at that run; the added policy test passed in the final focused command.
- `npm.cmd run test:neon-auth`: **6 passed**.
- `npm.cmd run typecheck`: **passed**.
- Scoped ESLint for all four changed/new TS/MJS files: **passed**.
- Owned-file `git diff --check`: **passed**. Git emitted normal checkout LF/CRLF conversion notices.
- `node --test src/lib/neon/staff-bootstrap.db.test.mjs`: **1 skipped**, as required with no explicitly identified disposable database. This is not evidence that database concurrency passes.

The database suite uses the production SQL statements against uniquely named synthetic fixture tables. It holds both callers after their empty preflight snapshot, then asserts one bootstrap winner, one 403 loser, one staff row and one role. It also checks disabled profile refusal, role-insertion failure rolling back staff creation, and reuse of a roleless profile. It creates/removes only its generated fixture schema. Its gates are `TEST_DATABASE_URL` and `STAFF_BOOTSTRAP_TEST_DATABASE_CONFIRMED=true`; it never loads `.env` or falls back to application connection strings, and rejects an identical application URL. These guards do not identify an arbitrary URL as disposable by themselves: an operator must explicitly name and authorize the disposable target before running it.

Task 0 owns registration of `test:staff-bootstrap:db` and its explicit environment-dependent suite classification. No package/CI files were edited by this task.

## First-login and recovery procedure

1. In an approved new/reset environment, configure Neon Auth email verification and its mail delivery. Set `ADMIN_BOOTSTRAP_EMAILS` explicitly to the intended owner's address; the shipped example is now empty.
2. The intended owner signs up/signs in and completes the provider verification flow. Confirm the authenticated provider account ID and email correspond to that owner. A boolean provider verification record must be readable by the runtime.
3. With no bound staff identities or assigned roles, the first verified allowlisted request creates or binds the owner and grants admin in one transaction. An inactive profile for that email cannot bootstrap. Existing roles/bindings must not be deleted to force this flow.
4. Keep the intended owner in the allowlist if existing owner protection is required; removing the address also removes the application-level protection against demotion/deactivation.
5. If verification lookup is unavailable, repair the provider/schema/runtime grants, then retry. If another staff identity or role already exists, use an existing authorized admin's Team workflow. If no usable admin remains, prepare an explicit, separately approved database identity recovery after independently verifying ownership. Never bypass provider verification or reset staff tables as an automatic recovery step.

## Remaining actual gates

- Independent authorization/concurrency review of this slice.
- Execute the new race/rollback suite against an explicitly identified disposable database, including runtime permissions review. No target was available; no database or provider credential was loaded.
- Approved staging first-owner and existing staff role matrix, including real provider verification and disabled staff behavior.
- Exact-head Linux/CI and final integrated release acceptance owned by the parent task.

No production auth setting, staff data, migration, seed, outbound message, deployment, push or commit was performed by this task.
