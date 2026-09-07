# Admin property bulk management — 2026-09-07

## Delivered

- One company property number per row, with independent existing sale/rent prices, publication status and agents. Missing offers use a dash on desktop and no fake summary on mobile. Existing draft/offline/sold/rented statuses remain truthful.
- Whitelisted server sorting before pagination: updated time, company number, estate, area, sale price, rent; both directions, nulls last and stable number tie break. URL filters include source inactive and page sizes 30/50/100.
- Current-page selection, scoped status/agent operations, immutable before/after confirmation, preflight blocked reasons, success deselection and retained failure details.
- Five unique properties per authenticated request, independent existing atomic transactions, exact expectedVersion. Missing offers cannot be created. Publication validates the selected offer title and positive deal-specific amount.
- Unknown write acknowledgements and network failures stop further submissions and require result verification. Browser-history navigation is blocked during submission, including same-path search changes. Idle search changes discard old confirmation.

## Architecture and release

Existing TanStack Start server function authentication, Neon raw SQL grouped reads and admin_property_manage remain authoritative. Existing permissions, source snapshots, overrides and audit logging are reused. No new schema migration, dependency or schedule. No production business writes or deployment were performed by this task.

The branch also contains the earlier two-file public metadata join fix prepared in PR #131; the feature commit is separate. Production detail-page restoration is not claimed until that code is deployed.

## Executed verification

- npm run test:admin-properties: 26 Node tests and 10 Bun tests passed (36 total), no skips.
- node --env-file=../audit-20260905/.env.astra-disposable --test src/lib/neon/admin-properties.db.test.mjs src/lib/neon/admin-property-management.db.test.mjs: 2 passed, no skips. Uses isolated temporary schemas on approved br-quiet-hat-aoxbj2ue, then removes only those test schemas.
- npm run typecheck: passed.
- npm run build: passed on the final code; existing bundler warnings are non-fatal.
- Focused ESLint: passed after formatting and helper-export cleanup.
- Browser fixture: real UI components on loopback with synthetic properties and fake write API. Desktop and 390px mobile checks passed, including scoped before/after confirmation, absent-opposite-offer exclusion, success deselection, blocked-item retention and no horizontal overflow. Screenshots inspected locally. This is not an authenticated production admin test.
- Independent review identified selected-offer title, stale confirmation and uncertain save issues; all addressed. Final narrow review found no further actionable issues.

Local evidence lives in .audit/admin-bulk-*.log and .audit/bulk-ui/. No credentials are included in this report or fixtures. The live authenticated production admin workflow was not exercised; no actual properties were bulk edited for testing.

## Deployment and rollback

After approved merge, use the existing CI/Vercel release workflow. No migration is needed. Verify an authorized admin can sort/page, preview a scoped change and see the resulting status; any real batch requires its operator's intentional confirmation. Check public pages separately for the metadata fix.

To roll back this UI/backend feature, revert its feature commit and deploy the previous application version. Do not remove inventory or revert unrelated data: operations intentionally submitted by staff have their own existing property.manage audit and ADMIN_BEFORE snapshots and must be assessed separately.
