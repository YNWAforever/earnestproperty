# T-UX07 — Every route layout, role presentation and failure recovery

Source: 86184c11a1bb5b3dfa09e2080dfed3a858ca36af + task diff; final clean-head verification pending

Final task run: 239/239 owned browser cases passed (189 layout/state/interaction, 8 navigation, 42 operations recovery). Layout includes 100/100 successful normal-content instances, 22 agent/viewer geometry instances, 25 read-error and 12 empty-state instances, six form read-retry cases, and keyboard/table/dialog/deep-link checks. Browser errors were zero. 50 synthetic screenshots were captured; overview, inbox, campaign, transaction editor, managed property, team and operations samples were visually inspected.

Existing property maintenance 144/144 and leave guards 10/10 passed in the preceding combined run. That same run had 8 layout failures due to the deliberately failing inherited service-health fixture; those failures remain recorded. A stricter success-read check exposed that issue, which was fixed with a typed, disabled-service synthetic response. Two new role regressions failed before hiding the admin/manager-only service-health reader from agent/viewer, then passed. Its server ACL is unchanged.

Other reproduced defects: three nested table wrappers received focus but did not own horizontal scrolling; six editor error states were missing a persistent error or the common header, or misreported a failed read as missing data. Focus now lands on the actual named table container. Forms retry reads without clearing input; estate read failure stays distinct from not-found; agent loader failures retain the common shell and can retry. Safe-area padding is scoped to the admin page and mobile Sheet.

Retained intermediate results: states2 31 passed/6 failed; states3 42 passed/one test-selector timeout (transaction label corrected to its existing price input); missing required description caught by typecheck and corrected. The original T-UX04 property timeout remains historical; the unchanged full 144-case suite now passed. T-UX06 campaign normal-state evidence correction is additive.

Typecheck passed; wiring+agent contracts 27/27, transaction 76 Node/PGlite +5 component, estate 27/27, operations 28 Node+29 Bun passed. No normal Auth, hosted, native IME or provider result is inferred. Same clean source version will be rerun in T-UX09.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.

## Evidence retention correction (T-UX09)

The first screenshot writer reused title-based filenames across reruns; the T-UX09 run superseded the initial T-UX07 PNG files. Original logs, geometry and recorded hashes remain, but those earlier PNG bytes are no longer claimed available. The writer now archives every worker run under a fresh UUID with an immutable manifest and source snapshot captured before execution. Final delivery binds its screenshots to that archived run.
