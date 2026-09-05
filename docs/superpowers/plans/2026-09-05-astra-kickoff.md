# Codex 6 Astra execution brief

Work in `C:/Users/laich/Documents/Earnestproperty/Earnestproperty/.worktrees/audit-20260905` on `codex/audit-20260905`. This branch begins at audited main `897f01ac372063113b5a42de9593fe33252d8dc0` and contains local audit fixes/documents. Inspect and preserve its diff before switching or updating anything.

Read these first:

1. `docs/audits/2026-09-05-current-status.md`
2. `docs/superpowers/plans/2026-09-05-astra-development-completion.md`

Execute the plan in dependency order, starting with Task 0 verification/integration. Use fresh graph indexing for this worktree. Delegate independent CMS, messaging and public-performance slices with disjoint file ownership; review authorization and concurrency work independently.

Prioritize CMS save/reopen/publish/restore correctness and messaging cancellation/idempotency over a visual redesign. Preserve the existing Neon/TanStack architecture. Do not treat old Supabase or GA4 worktrees as current main, or merge their entire branches.

Each completed slice needs an original-failure reproduction, a focused fix, meaningful regression checks, and a short reviewable diff. Use disposable database fixtures for races/rollback and fake providers for delivery tests. Keep Windows tooling failures distinct from application regressions and exact-head Linux CI results.

Resolve the few named product decisions narrowly: WhatsApp-to-lead trigger, affirmative marketing consent, video/FAQ editorial versus upstream authority, and analytics provider. Continue independent work while waiting for those answers.

Production schema/data changes, deployments, provider charges and real outbound messages require approval of the concrete prepared action. Do not infer production authority from this execution brief. Report completion only against the plan's final acceptance checklist; leave a clear record of any external gate still outstanding.
