# Blog CMS verification repair

Status: approved by the user; implementation plan pending review. Date: 2026-11-06 (Asia/Singapore).

## Intent and scope

Restore confidence in the existing CMS candidate before extending release tooling. Preserve editing for all 112 articles, their URLs, main-blog/category settings and featured placement. This is a small verification repair, not a new CMS feature project.

The observed blocker is `test:admin-navigation:ui`: its browser fixture build fails with missing `#tanstack-router-entry` in `@tanstack/start-server-core`; one case fails during setup and seven do not run. A missing artifact manifest is a secondary teardown error. The exact dependency path still needs diagnosis. Earlier CMS build and local HTTP/browser acceptance passed; they do not establish a green full suite.

## Approaches

1. **Staged repair, then release tooling (selected by the user).** Repair and verify the existing candidate first. Separately design production tooling against that baseline. This adds a checkpoint but keeps changes and evidence attributable.
2. **Combined repair and release-tooling implementation.** Potentially fewer handoffs, but introduces broader changes before existing verification is complete. Not selected.

## Repair design

Trace the browser fixture's import chain and identify where server-only code enters. Prefer a narrow fixture boundary using the existing synthetic API pattern, keeping the real navigation, role filtering, storage, history and focus behavior under test. This is the proposed implementation direction, not an established root cause. Unexpected synthetic calls must fail visibly; do not stub away behavior asserted by navigation tests.

Do not weaken assertions, skip failing cases, broadly alias server packages or change application behavior simply to make the fixture compile. If diagnosis requires a substantive application change, return with the finding and revised scope. Preserve the primary setup error if teardown cannot produce its manifest.

## Verification and stop conditions

Use the recorded failure as the starting evidence, then rerun the repaired navigation suite. After it passes, resume the remaining local CI matrix. Retain earlier passing evidence only where the repair cannot affect it; rerun any suites sharing changed fixtures or helpers. Record commands, runtime versions, skips, logs and candidate identity.

Any new failing verification command stops execution: report the failure and do not continue repairing or present integration options in that turn. Preserve failed logs. A green claim requires all applicable local suites to pass with skips explicitly qualified. Hosted acceptance remains a separate gate; local checks do not replace it.

Complete appropriate lint/type checks and refresh build/HTTP evidence if the changed source invalidates the existing binding. Update the release handoff to distinguish current results from historical failures and stale candidate hashes.

## Boundaries and follow-up

No push, merge, deployment, production database change, production writer pause or production backup operation. Preserve the managed worktree and private evidence. Do not use production connections for tests. Willy remains the named owner; ownership is not execution approval.

After verification is green, prepare a separate design for the production import executor, writer controls and recovery rehearsal in isolation. This document does not authorize implementing that tooling or provisioning hosted resources. Hosted authentication, storage, CDN acceptance and recovery proof remain open release gates.

The builder may choose the smallest fixture/helper edit and affected-suite list based on the diagnosed dependency path. Dependency upgrades and unrelated refactors are outside this repair.
