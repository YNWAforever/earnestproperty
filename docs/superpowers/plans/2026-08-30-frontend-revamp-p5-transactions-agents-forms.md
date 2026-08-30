# P5 — Transactions, Agents, Forms Implementation Plan (Infrastructure Scope)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The infrastructure half of P5 per `docs/superpowers/plans/2026-08-28-frontend-revamp.md`'s P5 section — transactions, agents, branches-as-entity, contact + owner valuation, and `MortgageCalculator.tsx`'s full zh-HK translation.

**Explicit scope decision (confirmed with the user before writing this plan):** P5's own editorial items (blog categories/ToC/author+reviewer, rewriting the two flagship articles, `/estate-reviews` filters, `/videos` category polish) are **deferred** — several require genuine long-form content authorship, a different kind of work than the schema/code tasks here. Legal pages (`/privacy`, `/disclaimer`, `/terms`) get **structure only** — effective/last-updated date fields and explicit `TODO(client/legal)` markers, per the master plan's own instruction to keep those markers "until a Hong Kong legal/privacy professional signs off... this is a release blocker, not a nice-to-have." No real legal copy is drafted in this plan. The `SITE_URL` production-domain fix (open input #1, unresolved) is also out of scope — nothing to build without the real domain.

**Architecture:** Branch `feat/frontend-revamp-p5-transactions-agents-forms` off `main` (P0-P4 are fully merged; the CI lint ratchet was reset to 381 in a separate PR before this branch was created). Nine tasks.

---

## Ground truth already verified (do not re-derive)

- **成交快訊**: exactly 6 runtime occurrences across 4 files — `index.tsx:463`, `transactions.tsx:25,29,52`, `SiteFooter.tsx:160`, `SiteHeader.tsx:127` — plus two test assertions in `src/config/site.test.mjs:217,314`. (Line numbers have shifted from the master plan's original citations across P1-P4's work — these are the current, real ones on `main`.)
- **`transactions` table** (`neon/migrations/20260622060000_public_content.sql:103-113`): `id, estate_id, unit, deal_type, price, saleable_area, saleable_psf, deal_date, created_at`. None of `source`, `source_url`, `verification_state`, `verified_at`, `agent_id`, `published`, `block`, `floor_band`, `social_state` exist yet.
- **`/transactions` today**: no filters, no Zod search schema, `fetchRecentTransactions(24)` hardcodes three districts and just slices to 24 most-recent, no `deal_type` column shown despite the data having one, no shareable per-transaction URL of any kind.
- **`staff_users`** (`neon/migrations/20260623090000_neon_admin_crm_whatsapp.sql:31-44`): `branch TEXT` is free-text, no FK, no `languages` column anywhere. The real historical bug (`CHANGELOG.md:79-87`) was `branch ?? DEFAULT_AGENT_BRANCH.name` silently defaulting a `NULL` branch to 麗都分行 for 15 of 23 agents — already fixed by removing the fallback (confirmed at `agents.tsx:85-87`, `agents_.$slug.tsx:44-45`), but the underlying fragility (free text, no real entity) is what this plan's branches-as-entity task closes properly.
- **A separate, apparently-legacy `src/config/site-team.ts`** exists with a hardcoded per-agent roster (including its own `branch` field) alongside the real Neon-backed `staff_users` — its consumers weren't exhaustively traced. Flag it, don't silently touch it — if a task finds it's genuinely dead, that's worth noting in the eventual PR description, but don't assume without checking its actual import graph.
- **`/agents` today**: no name search, no filters at all (a flat unfiltered 2-column card grid). `agents_.$slug.tsx`'s "查看代理放盤" button is mislabeled — it links to plain `/listings`, not scoped to that agent, even though the SAME page correctly shows the agent's own listings inline via `fetchListingsForAgent`. `/listings` already supports an `agentId` filter at the query layer (`ListingFilters.agentId` / `listingWhere`'s `agent_id` predicate, confirmed working via an existing contract test) — but the `/listings` route's own Zod search schema doesn't expose an `agent` URL param yet (confirmed absent from `listings.tsx`'s schema as of P3). This needs adding before the CTA fix can work.
- **`site-branches.js`**: `SITE_BRANCHES` (3 entries: `lido`, `rhine`, `hong-kong-garden`), each `{ id, name, address, phone, whatsapp (all null today), estateSlugs, districtSlugs, photo, photoWidth, photoHeight }`, plus `resolveBranchContact()`. This stays the seed source for a new `branches` table, per the master plan's explicit instruction ("keep the config as the seed, not the runtime join key").
- **`contact.tsx` today**: `name`/`phone`/`email`/`message` fields, one WhatsApp-marketing consent checkbox (unchecked by default, real label quoted in this plan's research), a separate unconditional disclaimer sentence for the operational reply (already structurally distinct from the marketing checkbox, just needs enquiry-type/preferred-contact fields and PICS added). No duplicate-submit guard beyond the submit button's own `disabled={submitting}` — no re-entrancy check inside the handler itself.
- **`OwnerValuationPanel`**: confirmed genuinely just a WhatsApp deep-link, zero form fields, zero DB write, used on `index.tsx` and `estate.$slug.tsx`.
- **Two existing consent-capture patterns**, pick the second: Pattern A (`createWebsiteInquiry`/`crm_contacts.opt_in_whatsapp`) is a bare boolean with a documented one-way-door limitation. Pattern B (`listing_alerts`, P3's own work) has its own table, `consent_text`/`consent_version`/`consented_at` columns, server-supplied consent constants (never client-trusted), `z.literal(true)` in the Zod schema forcing consent to actually be true to submit at all. **`valuation_leads` should follow Pattern B exactly** — same two-file `.js`/`.d.ts` shape, same server-supplied-constants discipline.
- **`MortgageCalculator.tsx`**: confirmed 611 lines, only the `<h1>` is Chinese, everвсичко else enumerated in full in this plan's research (labels, results, notes, table headers — treat that enumeration as the authoritative checklist, not a re-derivation). No cash-required-at-closing sum, no scenario comparison, no amortisation collapse — all three genuinely absent, not just unlabelled.
- **`calculateResidentialStampDuty`** (`src/lib/mortgage.ts:216-231`): real bracket table, zero source/effective-date citation anywhere near the numbers themselves (the only date mention is a disconnected UI sentence in the component, 40+ lines and one file away from the actual constants). `src/content/school-nets.ts` is the only existing precedent for a `source`/`sourceUrl`/`verifiedOn`-shaped content file — use it as the template for a new `policy-rates.ts`, adapted to stamp-duty brackets.
- **Migration conventions**: unchanged from prior phases (see the P2/P3/P4 plans for the full template if needed) — most recent migration is `20260830130000_estate_expansion.sql`, so a new P5 migration needs a timestamp after that, registered in `src/lib/control-plane/migration-versions.js`.
- **Lint/prettier**: **RESOLVED as of this branch.** `main`'s lint baseline is now 381 (down from 6321), and real Prettier output is genuinely 100-col again (PR #76 merged, the stack was reformatted). Implementers on THIS plan do not need the "never run prettier --write" workaround from every prior phase's dispatch prompts — `npx prettier --write <file>` on files you touch is safe and expected now. Still never touch `.prettierrc`/`eslint.config.js` (the `config-protection` hook still blocks that regardless).

---

## Task 1: Rename 成交快訊 → 晉誠地產最新成交

**Files:** `src/routes/index.tsx`, `src/routes/transactions.tsx`, `src/components/site/SiteFooter.tsx`, `src/components/site/SiteHeader.tsx`, `src/config/site.test.mjs`

Straightforward text replacement at all 6 runtime sites listed in "Ground truth" above, plus updating the 2 test assertions in `site.test.mjs` that check for the old string. After the change, a repo-wide grep for 成交快訊 across `src/` should return zero hits (only `docs/*.md` planning documents may still mention it historically).

**Verify:** `npx tsc --noEmit`, whatever test script covers `site.test.mjs`/`SiteHeader.tsx`/`transactions.tsx` (check `test:contact`, `test:homepage`).

Commit: `refactor(content): rename 成交快訊 to 晉誠地產最新成交 everywhere`

---

## Task 2: `/transactions` — migration + real filtering/verification

**Files:**
- Create: `neon/migrations/<timestamp>_transaction_provenance.sql`
- Modify: `src/lib/control-plane/migration-versions.js`, `src/routes/transactions.tsx`, `src/lib/queries.ts`, `src/lib/neon/public-data.server.ts`, `src/lib/neon/public-data.types.ts`
- Test: extend whatever covers `transactions.tsx` (check `package.json`)

### What to build

1. Migration adding to `transactions`: `source TEXT`, `source_url TEXT`, `verification_state TEXT NOT NULL DEFAULT 'unverified'` (or an enum, matching this repo's precedent of using enums for small fixed sets like `properties.status`/`listing_alerts.status` — your judgment, but a `CHECK`/enum constrained to something like `unverified | pending | verified` is more in this repo's style than a bare string), `verified_at TIMESTAMPTZ`, `agent_id UUID REFERENCES staff_users(id)`, `published BOOLEAN NOT NULL DEFAULT false`, `block TEXT`, `floor_band TEXT`, `social_state TEXT`. Explain-why comment per this repo's convention.
2. Public query layer: `fetchRecentTransactions`/`fetchDistrictTransactions` (and any other public transaction query) must add `AND published = true AND verification_state = 'verified'` to their WHERE clauses — per the master plan's explicit acceptance criterion, only published+verified rows render publicly. Existing rows have no `verification_state` set (defaults to `unverified`), so **after this migration, `/transactions` will legitimately show nothing until someone verifies real rows** — that's the correct, honest behavior (matching this whole plan's "don't fabricate, gate on real verification" discipline established since P2's DR-5), not a bug to work around.
3. `/transactions` route: add a Zod search schema (estate, district, month, deal type, price range — mirror `/listings`' established filter-schema shape from P3 rather than inventing a different pattern), add filter UI, add the missing `deal_type` column to the results table, add a shareable per-transaction reference — a `?tx=<id>` query param highlighting/scrolling to that row is a reasonable, low-risk choice given no dedicated detail route exists yet and this plan doesn't want to invent a whole new route+its own SEO/sitemap handling for a single-transaction page; use your judgment if you find a cleaner approach that fits this repo's conventions better. Cite source + verification date per visible transaction (or per page, if per-row is too dense) using the `DataNote` pattern already established across P2/P4. Swap the current empty-state paragraph for the shared `EmptyState` component if it isn't already using it.
4. Keep the existing conditional-noindex/sitemap-exclusion behavior for an empty result set — it already exists, just make sure the NEW "empty because published+verified filters exclude everything" case also triggers it (it should, automatically, since it's the same `transactions.length === 0` check — verify this rather than assuming).

### Tests

Extend whatever test file already covers `transactions.tsx` (find it — likely folded into `test:contact` or needs a new script, check `package.json` and this repo's convention for "what script covers what route" before deciding). Cover: the public query genuinely filters on `published`/`verification_state` (a contract test against the SQL, matching this repo's established query-injection test pattern); the filter UI wires to real search params; the `deal_type` column renders; the empty-state/noindex behavior still works when filters produce zero rows.

**Verify:** `npx tsc --noEmit`, `node --test src/lib/control-plane/migration-versions.test.mjs` (after Task registers the new migration), whichever test script you extended. No live-DB commands.

Commit: `feat(transactions): add provenance/verification migration and real filtering`

---

## Task 3: Agents — languages, search, filters, fix the mislabeled CTA

**Files:**
- Create: `neon/migrations/<timestamp>_agent_languages.sql` (or fold into the same migration as Task 2 if you judge that's cleaner — your call, but if separate, keep it small and focused)
- Modify: `src/routes/agents.tsx`, `src/routes/agents_.$slug.tsx`, `src/routes/listings.tsx`, `src/lib/queries.ts`, relevant `.server.ts`/`.types.ts` files
- Test: extend whatever covers these routes

### What to build

1. Migration: `staff_users.languages TEXT[]` (nullable, additive).
2. `/agents`: add a name-search input (client-side filter over already-loaded agents is fine given the small roster size — no new query needed unless you judge the roster will grow large enough to need server-side search, in which case say so and build it server-side instead) and filter controls for branch/district/estate-speciality/language, following `/listings`' established filter-chip/select patterns from P3 for visual and code consistency rather than inventing a new filter UI style. Restructure the flat 2-column grid into a grouped layout (by branch is the most natural grouping given the data model — your judgment on the exact grouping key).
3. Fix `agents_.$slug.tsx`'s "查看代理放盤" button: add an `agent` search param to `/listings`' Zod schema (threading it through to the existing, already-working `agentId` filter at the query layer — this is wiring a URL param to an ALREADY-FUNCTIONING backend filter, not building new filter logic), then point the button at `/listings?agent=<id>` instead of the current bare `/listings`.
4. Do not touch `src/config/site-team.ts` in this task unless you've actually traced its import graph and confirmed it's dead — if you find it's unused, note that clearly in your report as a finding for a separate cleanup, don't silently delete it as a drive-by.

### Tests

Cover: languages column threads through the type layer; search/filter UI produces the expected filtered subset for known fixture agents; the `/listings` `agent` param correctly narrows results (a contract test against the query layer, reusing patterns already established for `deal`/`district`/etc. params); the CTA button's `href`/`to`+`search` now includes the agent's id.

**Verify:** `npx tsc --noEmit`, `node --test src/lib/control-plane/migration-versions.test.mjs`, whichever test scripts you extended (likely covering `agents.tsx`, `agents_.$slug.tsx`, and `/listings`' contract tests).

Commit: `feat(agents): add languages, search/filters, and fix the unscoped "查看代理放盤" link`

---

## Task 4: Branches as a real entity

**Files:**
- Create: `neon/migrations/<timestamp>_branches_entity.sql`
- Modify: `src/config/site-branches.js` (only if genuinely needed — it should stay the seed source, not be replaced), relevant agent-display files (`agents.tsx`, `agents_.$slug.tsx`, `about.tsx`, `PropertyDecisionActions.tsx`)
- Test: extend `site-branches.test.mjs` and whatever covers the agent-display files

### What to build

1. Migration: `branches` table (`id`, `slug`, `name`, `address`, `phone`, `whatsapp`, `photo`, timestamps — mirror `site-branches.js`'s existing field shape so seeding is a direct mapping, not a reshaping), seeded from the 3 `SITE_BRANCHES` entries. `staff_users.branch_id UUID REFERENCES branches(id)` (nullable, additive — keep the existing free-text `branch` column, don't drop it, matching this repo's established "don't break what reads the old column" discipline).
2. Wire agent-display code to PREFER `branch_id`-resolved branch info when set, falling back to the existing free-text `branch` string when not — **do not reintroduce the exact bug this plan's own Ground-truth section documents** (a silent default to branch #1 when data is missing). A `NULL`/unresolved `branch_id` with a `NULL` free-text `branch` should render nothing/omit gracefully, exactly like today's already-fixed behavior, not fall back to a guessed branch.
3. `staff_users.branch_id` starts `NULL` for every existing row (no data migration/backfill guessing which real branch each agent belongs to — that's exactly the kind of unverified-fact problem this whole plan exists to avoid; if the CMS admin form already lets staff assign a branch via the free-text field, extend it to also offer a `branch_id` dropdown sourced from the new table, so this can be filled in by a human going forward rather than guessed now).

### Tests

Cover: the `branches` table seeds correctly from `SITE_BRANCHES` (a migration-content contract test, matching this repo's established pattern for asserting migration file contents); a `branch_id`-set agent resolves branch info from the new table; a `branch_id`-unset agent falls back to the free-text column; an agent with NEITHER renders nothing (not a guessed default) — this last case is the regression test that matters most, given the documented history of this exact bug class.

**Verify:** `npx tsc --noEmit`, `node --test src/config/site-branches.test.mjs src/lib/control-plane/migration-versions.test.mjs`, whichever test scripts cover the agent-display files.

Commit: `feat(branches): add branches table as a real entity, seeded from site-branches.js`

---

## Task 5: `/contact` rebuild

**Files:**
- Modify: `src/routes/contact.tsx`, `src/lib/neon/admin-data.ts` (Zod schema extension), `src/lib/neon/website-inquiry.js`/`.d.ts` (if the new fields need to persist — check whether `enquiryType`/`preferredContact` should be stored or are purely UI-routing hints; if they should persist, extend the schema/table following this repo's additive-column discipline)
- Test: extend whatever covers `contact.tsx`

### What to build

1. Add "enquiry type" (e.g. 買樓／租樓／放盤估價／一般查詢) and "preferred contact method" (WhatsApp／電話／Email) fields to the form and its Zod schema.
2. Add concise PICS (Personal Information Collection Statement) copy near the form, linking to `/privacy` (Task 9 will ensure that page exists with at least a structural skeleton — check the current state of `/privacy` before assuming).
3. Keep the direct-marketing consent checkbox separate from the operational-reply disclaimer — this structural separation already exists (confirmed in research); just make sure adding the new fields doesn't accidentally merge or muddy that distinction.
4. Add a duplicate-submit guard inside the handler itself (`if (submitting) return;` at the top, or equivalent), not just relying on the submit button's `disabled` prop (which doesn't stop a fast double-click/double-Enter from firing two handler invocations before the first `setSubmitting(true)` re-render commits).
5. Confirm/exercise all four states: success, validation error, network/server error, duplicate-submit-blocked — the first three already exist in some form per this plan's research, verify and touch up copy/behavior as needed rather than assuming they're already perfect.

### Tests

Cover: enquiry-type/preferred-contact fields are required and validated; PICS link renders and points to a real route; the marketing-consent checkbox is still unchecked by default and still structurally separate from the reply disclaimer; the duplicate-submit guard actually prevents a second in-flight submission (a behavioral test simulating two rapid calls, not just checking the guard code exists).

**Verify:** `npx tsc --noEmit`, whichever test script you extended.

Commit: `feat(contact): add enquiry type, preferred contact method, PICS, and a duplicate-submit guard`

---

## Task 6: Owner valuation — structured form + `valuation_leads`

**Files:**
- Create: `neon/migrations/<timestamp>_valuation_leads.sql`, `src/lib/neon/valuation-leads.js`+`.d.ts`
- Modify: `src/lib/neon/admin-data.ts` (or a new small dedicated file, matching Task 5's judgment call), `src/components/site/OwnerValuationPanel.tsx`
- Test: new test file mirroring `listing-alerts.test.mjs`'s structure

### What to build

Follow the `listing_alerts` pattern (Pattern B from this plan's "Ground truth") exactly: own table (`valuation_leads`: property address/estate reference, contact fields, `consent_text`/`consent_version`/`consented_at`, source/UTM, status, timestamps — mirror `listing_alerts`' column shape closely), own `.js`/`.d.ts` pure-logic pair, server-supplied consent constants (never client-trusted), `z.literal(true)` forcing real consent. Extend `OwnerValuationPanel` to offer a structured form (name, phone, property address/estate, rough size/condition notes — keep it lightweight, this isn't a full listing intake) ALONGSIDE the existing WhatsApp deep-link, not replacing it — this site's established pattern (P3's zero-results notify-me form did the same thing: offer a structured path without removing the existing WhatsApp-first option).

### Tests

Mirror `listing-alerts.test.mjs`'s coverage exactly: SQL parameterization (no string interpolation), consent fields required and server-supplied (test against hostile client input attempting to forge `consent_text`/`consentedAt`, matching how P3's `listing_alerts` review specifically verified this), rate-limiting wired, the form's consent checkbox starts unchecked.

**Verify:** `npx tsc --noEmit`, `node --test src/lib/control-plane/migration-versions.test.mjs` plus the new test file. No live-DB commands.

Commit: `feat(valuation): add structured owner-valuation form and valuation_leads table`

---

## Task 7: `MortgageCalculator.tsx` — full zh-HK translation + cash-required summary + collapsed amortisation

**Files:** `src/components/site/MortgageCalculator.tsx`, test file covering it (check `package.json`)

### What to build

1. Translate every English string this plan's research enumerated (labels, section headings, result rows, table headers, notes, error/placeholder text) into natural zh-HK, matching this repo's established mortgage/property terminology (cross-reference `src/lib/format.ts` and other already-zh-HK financial displays elsewhere in the app for consistent terminology — e.g. how "首期"/"印花稅"/"每月供款" are already phrased in `PropertyDecisionActions.tsx`'s existing mortgage teaser from P3, don't invent different terms for the same concepts).
2. Add a cash-required-at-closing line (deposit + stamp duty, reusing `result.deposit`/`result.stampDuty` — same pattern P3 Task 7 already established on the property-detail page's mortgage teaser; keep terminology consistent with that existing implementation).
3. Collapse the amortisation table behind a "顯示年度還款明細" (or similar) toggle, default collapsed — a simple `useState` disclosure, no new dependency needed.
4. Do NOT touch the actual stamp-duty bracket numbers in `src/lib/mortgage.ts` in this task — that's Task 8's job, and mixing a full-file translation with a financial-logic extraction in one commit makes both harder to review independently.

### Tests

Extend whatever test covers this component: a source-scan or rendered-output check confirming no English UI string remains (search for the specific strings enumerated in this plan's "Ground truth" section, confirm each is gone); the cash-required line renders the correct sum for a fixture price; the amortisation table starts collapsed and expands on toggle.

**Verify:** `npx tsc --noEmit`, whichever test script covers `MortgageCalculator.tsx`.

Commit: `fix(mortgage): translate MortgageCalculator to zh-HK, add cash-required summary and collapsed amortisation`

---

## Task 8: `policy-rates.ts` + scenario comparison

**Files:**
- Create: `src/content/policy-rates.ts`
- Modify: `src/lib/mortgage.ts`, `src/components/site/MortgageCalculator.tsx`
- Test: extend `src/lib/mortgage.test.ts` (or wherever `mortgage.ts` is already tested) and the component's test file

### What to build

1. `src/content/policy-rates.ts`: extract `calculateResidentialStampDuty`'s bracket table out of `mortgage.ts` into a typed, sourced content structure — follow `school-nets.ts`'s shape (`source`, `sourceUrl`, an effective-date field) rather than inventing a different pattern. The UI already asserts an effective date ("26 February 2026" per the current English text, being translated in Task 7) — carry that same effective date into this file's metadata rather than dropping it, but don't fabricate a `sourceUrl` if none is verifiably known; `null` is the honest choice there, matching this whole plan's established discipline.
2. `calculateResidentialStampDuty` reads its brackets from `policy-rates.ts` instead of embedding literals — same computed output, verified by running `mortgage.test.ts`'s existing assertions unchanged before/after (this is a refactor, not a behavior change, same discipline as P4 Task 1's registry consolidation).
3. Scenario comparison: let a user save up to 2-3 input snapshots (price/LTV/term/rate) and see their key results (monthly payment, cash required) side by side. Client-side only (no server persistence needed — this is a "compare while you're on the page" tool, not a saved-search-style feature) — a simple local array of scenarios in component state is sufficient, don't over-engineer with localStorage persistence unless you judge it clearly improves the feature at low cost.

### Tests

Cover: `calculateResidentialStampDuty`'s output is byte-identical before/after the extraction for a range of fixture prices (proving the refactor preserved behavior); `policy-rates.ts`'s exported data has no fabricated `sourceUrl`; the scenario comparison correctly computes and displays results for 2+ saved scenarios, and correctly handles removing one.

**Verify:** `npx tsc --noEmit`, `bun test src/lib/mortgage.test.ts` (or the real path — confirm it first), whichever test script covers the component.

Commit: `feat(mortgage): extract policy-rates.ts and add scenario comparison`

---

## Task 9: Legal pages — structure only (no real copy)

**Files:** whatever routes back `/privacy`, `/disclaimer`, `/terms` (locate them first — check `src/routes/` for the exact filenames, don't assume)

### What to build

**This task adds structure, not legal content.** For each of the three pages: add explicit "生效日期" (effective date) and "最後更新日期" (last-updated date) fields near the top (using placeholder/TODO values, not invented real dates), and wrap the actual body content in a clearly-marked `{/* TODO(client/legal): ... */}` comment block if the page doesn't already have one, per the master plan's explicit instruction to keep such markers until a licensed HK legal/privacy professional signs off. If a page already has reasonable placeholder copy, leave the copy itself untouched — this task is about the metadata/structure (dates, TODO markers), not rewriting or expanding the substance of what's already there. Do not draft new legal clauses, do not invent effective dates, do not remove any existing TODO marker.

### Tests

A lightweight source-scan test confirming each of the three pages has a `TODO(client/legal)` marker present and an effective-date/last-updated-date field in its markup — a regression guard against someone later removing the marker and treating placeholder copy as final without the required sign-off.

**Verify:** `npx tsc --noEmit`, whichever test script you add/extend.

Commit: `chore(legal): add effective/last-updated date structure and TODO(client/legal) markers`

---

## Final verification (after all nine tasks)

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run test:contact && npm run test:homepage
node --test src/lib/control-plane/migration-versions.test.mjs
```
(Plus every test script touched by individual tasks — run the full relevant scripts, not just the files each task's implementer directly edited, per this whole project's established "a phase's final task tends to surface a stale test elsewhere" lesson.)

Per the master plan's P5 acceptance criteria (the infrastructure subset in scope here):
- No public reference to 成交快訊 remains.
- No unverified transaction renders publicly (only `published=true AND verification_state='verified'` rows).
- Marketing consent is never preselected and never bundled with the operational reply, on both `/contact` and the new valuation form.
- No stamp-duty figure renders without an effective date and source (via `policy-rates.ts`).
- The `branch_id`/free-text-fallback logic never reintroduces the documented silent-default bug.
