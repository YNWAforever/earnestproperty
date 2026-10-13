# T-UX09 review decisions (draft for final reporting)

One fresh whole-branch review examined 433ab194..ce6e9a69. It found no Critical issue, three Important issues and no Minor issue. The implementer completed one regression-first fix pass; no second reviewer approval is claimed.

- R1 / SEC-03, SEC-04: own route state above AdminShell using the existing verified staff workspace identity. Twelve route owners now remount only on identity/role changes. Agent editor capability is freshly read from the same server resolver after the route-loader preflight; this adds one GET on opening the editor, but cannot promote a role based on a client guess. Async continuations stop before later batches/readbacks/toasts/navigation. Existing provider receipts and original intents remain untouched.
- R2: default/remote Playwright collection excludes the owned admin-layout suite. Read-only discovery went from 193 incorrectly collected layout cases at the initial probe to zero layout/navigation cases. The earlier ux09 statement about both ignores was incorrect and is explicitly corrected.
- R3: agent profile and transaction record failures have persistent read-error/retry states. Successful null reads still mean missing/unavailable records; exceptions no longer claim this. The record read can fail while the agent capability preflight succeeds.

Evidence already obtained: four focused browser RED failures followed by four GREEN passes; 239/239 complete layout/navigation/leave passes after correcting a new test's overly broad selector; 148 existing daily cases passed in the preceding combined run. CMS 91, transactions 81, estates 27, agents 17, command-center 228 and operations 62 passed. The operations count includes five new real-callback lifetime tests with current/retired controls. Typecheck, lint (0 errors, 9 unchanged warnings), and local production build passed. The final clean bd044145 run and manifests are recorded separately after completion.

The intermediate combined run had 375 passes and 12 failed tests: the shared first-login checklist was legitimate extra body text. The corrected assertions target the access status and also require zero table/input/textarea/form/dialog content. No timeout was raised and no private-data assertion was removed. Eight existing CMS recovery tests required the new lifetime dependency in their VM harness; the original CAS, stale-draft, delayed typing and publish assertions remain. Agent source contracts still require a server-derived capability; they now point to the current-workspace reader instead of stale loader data. Poll and glossary checks no longer depend on obsolete statement/JSX adjacency.

Rulings and costs:

1. The supplied implementation plan is already authorized. Proceed without another design approval; cost is implementing the explicit proposal rather than inventing a reference UI.
2. Keep the original dirty checkout untouched and use the managed worktree with scoped tool approval. Cost is retaining a separate checkout and its dependencies for review.
3. Match the original audit ZIP by its required SHA256; the user-supplied folder led to the exact sibling ZIP. No guessed or replacement audit content was used.
4. Preserve source evidence, historical failures and immutable input CSVs, even where a generic skill would clean up its workspace. Cost is additional local evidence storage.
5. Run applicable named suites and behavioral regressions; simple spacing does not need implementation-mirroring tests. Cost is that unrun unrelated suites are not locally claimed green.
6. Keep existing server ACL/capability, CAS and receipt/reconciliation algorithms. Add route lifetime gates and UI read-state fixes proven by regressions. Cost is a larger client regression surface and the agent editor capability GET.
7. Preserve CMS agent own-draft/resource behavior independently of directory navigation. The new gate permits admin/manager/agent on CMS/resource editors and admin/manager on the estate directory. Cost is an existing spec/navigation-versus-backend policy difference still requiring business/normal-session review.
8. The first screenshot writer reused paths. Preserve the overwrite disclosure, create UUID directories and immutable manifests, and obtain fresh captures. Cost is that the old overwritten PNG bytes cannot be represented as retained evidence.
9. The review declined normal Auth, production ACL and hosted parity without an isolated target and sessions. Accept that limitation: 50 cases remain partial and 100 normal Auth role-route reads remain blocked. Local/SQL evidence cannot substitute for those checks.
10. The review declined native mobile IME/keyboard, real browser zoom, human accessibility and authenticated HKWTIA comparison. Keep them unverified. The 200% font-size probe is synthetic reflow evidence, not native zoom or human acceptance.
11. The review declined provider delivery/canary without specific authorization. Do not dispatch. Cost is no live provider acceptance claim.
12. The review declined historical F/RPK remediation completeness and CMS business-policy judgment. Keep every legacy status unchanged and leave the policy decision to its separate backlog.
13. The user authorized commits/PR and forbade merge/deploy. Deliver a held draft PR, retain the worktree and require the listed release gates before rollout. Cost is an unmerged review candidate, not a released product.

Deferred minors: none from the reviewer. External acceptance gates remain unresolved as above; they are not silently downgraded to minor issues.

Final exact-source confirmation: bd044145d324fcdf5c748df1425c621db7cdc6fb; 387/387 owned browser cases passed, comprising 221 layout/state/scope, 148 daily-work, 10 leave-guard and 8 navigation cases. Both layout/navigation manifests recorded a clean working tree. See final-verification.md.
