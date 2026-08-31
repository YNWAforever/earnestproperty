# Component Map

P8 handoff doc. Where every component category lives and what it's for.
Written against `main` at the point all of P0–P7 had merged (2026-08-31).
This is a directory-level map, not a per-component API reference — read the
component's own file for its exact props.

## `src/components/ui/` — 46 files

Generic shadcn/Radix-based design-system primitives: button, dialog, table,
form, calendar, chart, select, sheet, slider, tabs, toast, tooltip, etc. No
business logic, no data fetching, no site-specific copy. Vendored (per
CLAUDE.md: "keep in sync with upstream") — treat these as a third-party
library, not app code to redesign freely.

## `src/components/site/` — 15 files

Public marketing-site building blocks, each tied to real page content:
- `SiteHeader.tsx` / `SiteFooter.tsx` — sitewide chrome (mega-menu nav,
  branch/contact footer), gated off admin/auth/account routes by `__root.tsx`'s
  `showSiteChrome`.
- `MortgageCalculator.tsx` — the `/mortgage` page's full calculator (inputs,
  results, amortization table, saved-scenario comparison, `DataNote`-sourced
  stamp-duty citation).
- `EstateComparisonTable.tsx` / `BlogEstateComparisonTable.tsx` — the two
  comparison-table variants (current-estate-vs-neighbours, and a flat N-way
  comparison for blog articles), sharing pure logic from
  `estate-comparison.ts`.
- `AnswerSummaryCallout.tsx` (P7e) — the shared "重點摘要" callout box, used
  by blog articles, estate pages, and district/corridor pages.
- `IntentWhatsAppCTA.tsx` / `StickyWhatsAppBar.tsx` — the two generic WhatsApp
  CTA patterns (three-button 買/租/估價 grid; a persistent mobile-only bottom
  bar).
- `SearchFallbackCTA.tsx` — the "搵唔到心水盤" WhatsApp hand-off shown on
  zero-result search states.
- `OwnerValuationPanel.tsx` — the structured valuation-request form (offered
  alongside, not replacing, the WhatsApp deep-link).
- `TrustProofPanel.tsx` — licence number / company identity trust block.
- `EstateMarketSnapshot.tsx` / `CorridorInventory.tsx` — estate-level and
  corridor-level live listing/transaction summaries.
- `estate-comparison.ts` — plain `.ts` (no JSX) module holding the
  comparison table's pure row-building/formatting logic, imported directly by
  both table components and by tests (Node's native TS stripping runs it
  without a bundler).
- `property-decision.js` — see `src/components/property/` below; a sibling
  pure-logic file for the property detail page's CTA decision tree.

## `src/components/admin/` — 28 files (14 top-level + 3 subfolders)

Admin/CRM UI shell and feature widgets, all rendered under `AdminShell`
(`AdminShell.tsx`) — the internal CRM's own header/nav/identity block,
deliberately not reusing the public `SiteHeader`/`SiteFooter` (see
`ROUTE_FUNCTION_PARITY.md`-adjacent reasoning in `styles.test.mjs`'s
`isPublicSitePath` comment: a second "banner" landmark and a full marketing
footer on every internal CRM page was pure duplication).
- **Top level**: toolbar, detail panels/dialogs for leads/listings/agents,
  `AdminContentCopilot.tsx` (the AI writing-assistant UI), `AgentProfileForm.tsx`.
- **`estates/`** (2 files): `AdminEstateEditorForm.tsx` (807 lines — the CMS
  revision-engine-backed estate content editor) and `EstatePreviewCard.tsx`.
- **`operations/`** (7 files): the control-plane ops dashboard's tabs
  (health, jobs, migrations, audit) — each a thin view over
  `src/lib/control-plane/`'s server logic.
- **`team/`** (7 files): staff account management (invite, role assignment,
  deactivation) — `AdminTeam.tsx` plus supporting dialogs/forms.

## `src/components/property/` — 3 `.tsx` files + 2 `.js`/`.d.ts` pairs

The property detail page's contact/CTA decision tree:
`PropertyDecisionActions.tsx` (desktop card + mobile fixed action bar,
WhatsApp/phone/mortgage-teaser CTAs, `listing_whatsapp_click` analytics
wired in P7d) and `PropertyMobileContactSummary` (same file, the mobile
sidebar variant). `property-decision.js` + `.d.ts` hold the pure
CTA-selection logic as plain JS specifically so `node --test` `.mjs` tests
can import it with zero build step (this repo's established
`.js`+`.d.ts` pattern for logic shared between the Vite app and
no-bundler tests). `property-media-contact-layout.js` is the sibling
layout-shape helper.

## `src/components/layout/` — 11 files

Shared, content-agnostic page-layout primitives used across both public and
admin surfaces: `Container`, `Section`, `Prose`, `Stat`, `DataNote`
(source/asOf/caveat citation box — the backbone of this app's "hide or cite,
never fabricate" data-honesty convention), `FreshnessStamp`,
`VerificationBadge`, `EmptyState`, `SkeletonBlock`.

## `src/components/dashboard/` — 3 files

Admin-only form components scoped to the property/listing editor:
`PropertyFormContent`, `ImageUploader`, and one supporting file. Distinct
from `src/components/admin/` proper — these are form-field-level building
blocks the admin listing editor composes, not full admin pages/panels.

## `src/components/live-agent/` — 1 file

`LiveAgentWidget.tsx` — the public-facing AI chat bubble, embedded via
`__root.tsx`'s `isPublicWidgetPath` gate (excludes `/admin`, `/auth`,
`/account` — those render a bare `AuthView`/`AccountView` with no header of
their own, so excluding the widget there the same way as `isPublicSitePath`
would leave staff on an unbranded sign-in page instead of removing a
duplicate; see `__root.tsx`'s own comment). Talks to
`api.live-agent.session.ts` / `api.live-agent.message.ts` /
`api.live-agent.handoff.ts`.

## `src/components/media/` — 1 file

`AppImage.tsx` — the sitewide responsive/optimized image component (P1d).
Every `<img>`-equivalent in the public site should go through this, not a
raw `<img>` tag — it's what makes `loading="eager"`/`fetchPriority="high"`
(P7c) and graceful broken-image fallbacks consistent across templates.

## `src/components/` (root) — 1 file

`DefaultErrorComponent.tsx` — the app-wide fallback error boundary,
registered as the default `errorComponent` for routes that don't define
their own (most routes with real data dependencies define a bespoke one
instead — see `ROUTE_FUNCTION_PARITY.md`/route files themselves for the
per-route pattern).
