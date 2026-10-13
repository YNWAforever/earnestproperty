# T-UX06 — Management and settings routes

Source: 826bd69faaac9719e4a7dbb3c06bb5add78381e9 + task diff; final clean-head verification pending

Baseline 549/549 existing owned browser cases passed. The 25 actual route mobile geometry smoke passed before these minor presentation changes; no implementation-mirror spacing tests were added.

All remaining eleven route templates now declare standard width in all branches. Page-level actions move to the common header; CMS follows the active tab with a single primary action. Filters, preview/materialize tools, permissions, business state, CAS and unknown-operation journals remain in their existing owners. Table accepts an optional scroll-region label; public callers retain existing behavior. WhatsApp settings uses the business title WhatsApp 接收設定.

GREEN: 675/675 browser cases: 549 management/workflow + 108 layout (including all 100 normal geometry instances) + 8 navigation + 10 leave-guard cases. Operations: 28 Node and 29 Bun cases passed. Typecheck passed.

Retained failures: initial operations source assertions referred to the old Shell navigation owner and were migrated to the metadata/component owner without weakening route/capability checks. An intermediate typecheck caught a refresh action in the identity-loading branch; it was removed before the completed rerun. An initial Python edit stopped before writing CMS when more tables than five were found; all remaining edits were subsequently read back.

route-guard-inventory.csv covers all 25 templates. Existing CMS revision-engine reads/own-draft saves allow agent independently of admin/manager-only directory navigation; publishing remains admin/manager. No backend role changes were made. Full normal Auth and hosted acceptance remain pending.

Owned UI uses actual React routes with synthetic Auth/API. No normal Auth, real provider or human acceptance claim. Run logs are private under .audit/admin-ux-20261013/. Browser contexts and servers were disposed; no production writes. Historical F/RPK/UC statuses are unchanged.

## T-UX07 evidence correction

The later named-scroll check exposed a campaign fixture actor mismatch: four `/admin/blasts` viewport checks in this task measured its error state, not normal content. The 675 test results are retained, but this run proves only 96/100 normal instances. T-UX07 aligns the synthetic actor and requires successful read outcomes plus content readiness before re-running the complete denominator. Three other routes reproduced the nested scroll-focus issue; the campaign case was a fixture failure, not a fourth observed product failure.
