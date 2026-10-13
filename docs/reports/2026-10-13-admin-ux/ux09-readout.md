# T-UX09 — Local release gates and review handoff

Source: bb13af29045bcbe35a001bfc66b41fde69e94393 + task diff; final clean-head verification pending

Local validation at bb13af29045bcbe35a001bfc66b41fde69e94393, whose application source is identical to 2a23c48e84b78ac756f9314bf95fcb70e0125b50:

- Typecheck passed; local production build passed. Local prebuild deliberately does not require VERCEL_ENV contact settings; contact CTA fallback warning remains. No hosted environment configuration was injected or verified. Existing Vite/builder version and deprecated inputValidator warnings were retained; no dependency/backend rewrite.
- Lint initially reported 37 errors (35 contract formatting, two Playwright factory names interpreted as React hooks). Renamed the factory to createAdminLayoutFixture and formatted the migrated contract tests. Full lint then passed with 0 errors /9 warnings in unchanged files; targeted final fixture lint and typecheck passed.
- 244/244 browser cases passed: 189 actual-route layout/state/interaction, 8 navigation and 47 public mobile chrome/axe checks. 100 normal geometry records and 50 screenshots were captured. Public chrome remained scoped correctly. Layout unit/component 38 and styles 33 passed. Route/wiring contracts 61 passed after formatting.
- Evidence writer now stores a UUID run directory, immutable manifest and source snapshot captured before execution. Two repeated overview probes passed with different readable screenshot paths and two retained manifests. Initial anchored grep selected no tests; that diagnostic is retained and is not a pass. Earlier screenshot overwrite limitation is disclosed in ux07-readout.md. Final delivery will reference an archived clean-head run.

CI already invokes both new named UI suites and the default remote config ignores them. Remote main rechecked as 433ab194f9e51c789d89d49216fe2983f2791616. Rollout/rollback steps are in rollout-rollback.md. A fresh whole-branch review, exact-head evidence capture and draft PR publication are the remaining T-UX09 steps; no merge/deploy is planned.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.

## Additive final-review correction

The preceding statement that both new suites were ignored by the default remote config was incorrect at ce6e9a69. The fresh reviewer identified the missing layout ignore and two client state/read-error issues. All three were reproduced and fixed at bd044145d324fcdf5c748df1425c621db7cdc6fb. The exact clean-source rerun passed 387/387; 100/100 normal geometry instances are fixture evidence, not normal Auth. Full details, retained failures and review limitations are in review-fixes.md and final-verification.md.
