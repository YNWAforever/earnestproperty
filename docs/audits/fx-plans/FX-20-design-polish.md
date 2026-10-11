# FX-20: Design-system polish (tokens, type, interaction states). Implementation plan (20a, 20b, 20c)

**Owner decisions (binding once filled in; until then the defaults in "Open questions" apply):**
1. **Every visible change in "Changes for approval" (C1 to C13):** _pending_. Each item is approved or declined on its own; a declined item is removed from its PR, nothing else changes.
2. **C5, darker form-field borders:** _pending_. Default **yes, `oklch(0.64 0.017 157)`** (Open question 1). This is the most visible change in the batch.
3. **C13, property action bar at 320 px:** _pending_. Default **yes** (Open question 4). It is the only FX-20 change on a lead CTA, so it ships alone in 20c.
4. **Property first screen (gallery above the fold, handed over by FX-16):** _pending_. Default **not in FX-20** (Open question 5).
5. **No copy change, no migration, no env var, no `vercel.ts`/`workers/**` edit, no dependency change in any FX-20 PR.** The one wording question (C14, the English "Close" screen-reader label) is asked, not assumed.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every visible change gets a failing check first (a source assertion in `src/styles.design-system.test.mjs` or a computed-style assertion in the new `e2e/design-states.spec.ts`), then the change, then before/after screenshots at 375 and 1440 px.

**Goal.**
- Make keyboard focus visible and consistent on every control, including the green and WhatsApp buttons and the dark footer, where it is weak or invisible today (C2).
- Give buttons a pressed state, keep a busy button's label readable, and stop non-interactive badges reacting to hover (C3, C4, C11).
- Make form fields identifiable (3:1 border, WCAG 1.4.11), finish FX-16's "no negative tracking on Chinese headings", and lift the last sub-12 px labels (C1, C5, C6, C7).
- Tidy the token layer: one neutral family in the admin, named status colours instead of raw amber/emerald, no `transition-all`, no dead chart tokens (C8, C9, C10, C12).
- All of it inside `src/styles.css`, `src/components/ui/*` and a short list of call sites. **No restyle, no new colour or brand change, no layout rewrite, no new primitive.** `--primary` stays the client-approved `#1F7A4D`.

Findings: F-20 (remainder), FX-16 hand-overs (property bar at 320 px; property first screen), FX-19 hand-over (unused `--chart-*` tokens; the `--sidebar-*` tokens are already gone), FX-15 hand-over (inline SVG sprite, see Out of scope), plus the audit below (no G-/F- item was open against design tokens; G-04/G-15 mobile inbox layout belong to 17c).

**Approach.** Three slices, each one PR from `main`:

| Slice | Branch (suggested) | Content | Can start |
|---|---|---|---|
| **20a** | `fix/fx-20a-tokens-states` | `styles.css` tokens and base rules, `src/components/ui/*` states, a design-states browser fixture and its tests (C1-C5, C7, C10-C12) | **Now** |
| **20b** | `fix/fx-20b-app-consistency` | Call sites: sub-12 px labels, admin slate/amber/emerald → tokens, optional native-select class (C6, C8, C9) | After 20a; admin files that 17b/17c rebuild wait for them (Global Constraints) |
| **20c** | `fix/fx-20c-property-bar-320` | The property action bar fits at 320 px (C13) | After 20a, and only with owner decision 3 |

**Tech stack.** Tailwind v4 (`@theme inline`, oklch tokens), shadcn new-york primitives, `node --test` source checks, Playwright owned fixtures (`playwright.admin-owned.config.ts`, loopback only, no real auth, DB or provider).

**Spec.**
- Fix plan `docs/audits/2026-10-fix-plan.md`: batch row `:108`, FX-20 `:772-773`, Global constraints `:17-39`.
- Audit `docs/audits/2026-10-final-audit.md`: F-20 `:305`, F-25 `:309`, Lane G `:327-354`.
- Hand-overs: FX-16 Out of scope `docs/audits/fx-plans/FX-16-public-polish.md:122-134` (F-20 Task 5 `:384-385`); FX-19 `FX-19-cleanup.md:111`; FX-15 `FX-15-public-speed.md:96`.
- Format: `FX-18a-data-hygiene.md`, `FX-19-cleanup.md`. Skills used for the audit: `taste-skill:redesign-skill` (audit method only), `ecc:make-interfaces-feel-better`, `design:accessibility-review` (WCAG 2.1 AA, 1.4.3 / 1.4.11 / 2.4.7).

## Before screenshots (taken 2026-10-11, main `c2324336`)

58 PNGs, not committed, in the session scratchpad `fx20/before/` (`<page>-<width>.png`, 375 and 1440 px, full page):
- **Admin, from owned fixtures only** (`scripts/browser-fixtures/*`, built locally, served on `127.0.0.1`, every non-loopback request aborted): `admin-dashboard`, `admin-leads` (daily-work), `admin-whatsapp-inbox` (no-link), `admin-blasts` (campaign-review), `admin-analytics` (performance-readback), `admin-listings`, `admin-listing-new`, `admin-operations`, `admin-whatsapp-settings` (property-maintenance), `admin-cms`, `admin-transaction-new` (leave-guards), `admin-whatsapp-links` (link-bulk-owned), `admin-property-sync` (property-sync).
- **Public forms, from the owned fixture:** `public-forms-valuation-contact` (contact, property enquiry, owner valuation and listing-alert forms, `scripts/browser-fixtures/public-forms`).
- **Public pages, read-only GETs of the live site** (no fixture renders full public pages: `acceptance:public:synthetic` needs a disposable Neon database): `public-home`, `public-listings`, `public-listing-detail` (`/property/R076041?deal=rent`), `public-estate` (`/estate/bellagio`), `public-district` (`/district/sham-tseng`), `public-blog`, `public-article` (`/blog/sham-tseng-buying-guide-2026`), `public-videos`, `public-contact`, `public-mortgage`, `public-transactions`, `public-agents`, `public-legal-privacy`, `public-404`. Analytics and every third-party script were aborted; no click, no form input.
- **Not covered by any owned fixture** (and the live admin is never used): command center, team, agents, estates, segments, transactions list. They are built from the same primitives and `AdminShell`; 20a's design-states fixture covers the primitives, and the owner checks these six on the PR preview (Open question 6).

## Verified current behaviour (main `c2324336`, 2026-10-11)

| # | Fact | Where |
|---|---|---|
| 1 | **Tokens.** One radius (`--radius: 0.5rem`, scale `sm` 4 px to `4xl` 24 px), two custom shadows (`--shadow-elegant`, `--shadow-card`), brand greens in oklch with hex notes, `--whatsapp` pair (FX-16), `--destructive` `#C90F1A` (FX-16). `--input` equals `--border` (`oklch(0.912 0.017 157)`). | `styles.css:21-67,69-160,164-171` |
| 2 | **Base headings carry negative tracking.** `h1…h6 { letter-spacing: -0.02em }` still applies to every heading, public and admin. FX-16 Task 5 removed `tracking-tight` from CJK heading components so that "letter-spacing returns to 0" (`FX-16-public-polish.md:385`), but this base rule keeps it at −0.02em. `card.tsx:36`, `dialog.tsx:75`, `alert.tsx:34` add `tracking-tight` plus `leading-none` to titles. | `styles.css:222-230`; as listed |
| 3 | **Dead tokens.** `--chart-1…5` (+ `@theme` mappings) are used by nothing (the two recharts charts use `var(--primary)`, `var(--border)`, `var(--muted-foreground)`: `EstateMarketSnapshot.tsx:105-133`, `district.sham-tseng.tsx:248-270`; `chart.tsx` was deleted in 19a-2). The `.dark` block is never applied (no code sets a `dark` class). `--surface-warm`, `--ink-charcoal`, `--brand-accent-bronze` are used by nothing but are pinned by `styles.test.mjs:9-21` as "DRAFT, pending client sign-off". `--coral` is a live alias (42 lines, 15 files). | `styles.css:59-63,155-159,173-200,95-110` |
| 4 | **Focus ring is inconsistent and sometimes invisible.** Button: `focus-visible:ring-2 ring-ring` **with no offset** (`button.tsx:8`), so on `brand` (`bg-primary`) the green ring sits on a green button: **1.00:1** against the button, and on the WhatsApp button about 1.1:1; the only cue is the button growing 2 px. Textarea, checkbox, radio, slider use `ring-1` (`textarea.tsx:10`, `checkbox.tsx:14`, `radio-group.tsx:23`, `slider.tsx:39`); input, select, switch, tabs use `ring-2` (switch and tabs with offset, input and select without). Badge, dialog close and sheet close use `focus:` not `focus-visible:` (`badge.tsx:7`, `dialog.tsx:47`, `sheet.tsx:64`). | as listed |
| 5 | **Custom links have no focus style at all** and fall back to the browser outline: the header nav (`SiteHeader.tsx:239-243`), footer links (`SiteFooter.tsx:70,102,113,145,163`), and 0 `focus-visible` in 38 public files with links (e.g. `listings.tsx` 21 links, `SiteLink.tsx`, `videos.tsx`, `estate.$slug.tsx`). There is no global `:focus-visible` rule in `styles.css`. | grep |
| 6 | **Dark footer.** `SiteFooter.tsx:41` is `bg-foreground text-background`. The brand ring on it measures **2.83:1** (fails 1.4.11's 3:1); `--brand-bright` measures **10.06:1**. Footer text at `opacity-60`/`-80` is 6.15 / 9.74:1 (passes). | computed (sRGB from the oklch tokens) |
| 7 | **No pressed state anywhere.** 0 `active:` classes in `src`. Button transitions only colours (`transition-colors`). | grep; `button.tsx:8` |
| 8 | **A busy button is unreadable.** 37 files disable a button while saving (186 `disabled={…pending|saving|…}`) and swap the label to 「儲存中…」, 「提交中…」 etc.; `disabled:opacity-50` turns a `brand` button's label into **2.07:1**. Only `AdminConfirmDialog.tsx:96`, `AdminContentCopilot.tsx:771` and 4 non-button containers set `aria-busy`. Spinners are `Loader2`/`LoaderCircle` (the same lucide glyph) and `RefreshCw` for refresh; the global reduced-motion rule (`styles.css:238-247`) already stops them. | grep |
| 9 | **Non-interactive badges react to hover.** `Badge` is a `<div>` with `hover:bg-primary-hover`, `hover:bg-secondary/80`, `hover:bg-destructive/90` (`badge.tsx:12-16`); 27 files use it, none with `onClick`. The inbox has to cancel it with `hover:bg-amber-500` (`admin.whatsapp.tsx:1592`). `styles.contrast.test.mjs:128` pins the destructive class string including its hover. | as listed |
| 10 | **Field borders do not identify fields.** `--input` on white card is **1.29:1** (1.4.11 asks 3:1 when the border is the field's only boundary; fields are `bg-transparent` on cards). `border-input` is also used by the `outline` button (`button.tsx:16`, 264 uses) and by public filter chips (`blog.tsx:185`, `estate-reviews.tsx:185`, `listings.tsx:628,1496,1508`, `transactions.tsx:278,589-590,607-608`, `videos.tsx:248,262,282,296,306`, `DefaultErrorComponent.tsx:60`). Candidates: `oklch(0.66 …)` 3.09:1 on card / 2.96 on surface; **`oklch(0.64 0.017 157)` (#848F88) 3.34 / 3.20**. | computed; grep |
| 11 | **Sub-12 px text.** `text-[11px]` ×11, `text-[10px]` ×2, `text-[9px]` ×1: `index.tsx:979,985,1000,1009,1020` (home listing chips), `listings.tsx:773,940,1267,1385` (filter count, card chips), `EstateGroupGrid.tsx:78` (9 px photo credit at `/60` over a photo), `:85,:93` (labels), `ImageUploader.tsx:225`, `AdminOperationsMigrations.tsx:287`. The type scale is otherwise the Tailwind scale (`text-sm` 756, `text-xs` 297, `text-base` 62, `text-xl` 59, `text-2xl` 58 …); weights 400/500/600/700. | grep |
| 12 | **Two neutral families in the admin.** Tokens are green-tinted neutrals (hue 157); the admin also uses Tailwind `slate-*` (cool blue-grey): `AdminShell.tsx:527` page background `bg-slate-50/70`, `admin.index.tsx:158,293,319,353,421` `text-slate-950/900`, `:349` `bg-slate-50 hover:bg-slate-100`, `:414,:457` `border-slate-200`, `AdminTeamStatusBadge.tsx:16,24` `slate-500/10 / slate-700`. | grep |
| 13 | **Status colours are raw palette classes.** There is no warning/success token; amber and emerald are spelled out ≈45 times in 16 files, the most in `AdminTeamStatusBadge.tsx` (21), `admin.whatsapp.tsx` (12), `admin.index.tsx` (10), `AdminShell.tsx` (7: nav count badge `:199` `bg-amber-500 text-amber-950` 6.97:1; checklist `:298-306`), `AdminOperationsJobs.tsx:95,457`. All measured pairs pass AA (amber-900 on amber-50 8.75:1). | grep; computed |
| 14 | **`transition-all`** in `tabs.tsx:30`, `accordion.tsx:25`, `EstateGroupGrid.tsx:116,235`, `index.tsx:860,949`. Elsewhere `transition` / `transition-colors` (fine). | grep |
| 15 | **Radii and shadows are used consistently enough.** `rounded-md` 184, `rounded-lg` 141, `rounded` 86, `rounded-full` 46, `rounded-xl` 25; `shadow-card` 21, `shadow-sm` 17. The `Card` primitive is `rounded-xl` while hand-built panels are `rounded-lg`; nested surfaces are not concentric everywhere, but no screen looks broken. No hex colour remains in any `.tsx` (FX-16). Arbitrary values are layout widths/grids, not ad-hoc colours or spacing. | grep; screenshots |
| 16 | **Native selects in the admin are hand-styled six ways:** `h-10 … rounded-md border`, `rounded border p-2`, `h-9 rounded`, `min-h-11 rounded` (≈52 `<select>` in 21 files, most in `admin.listings.tsx` 8, `WhatsappLinkWizard.tsx` 6, `PerformanceDashboard.tsx` 5, `WhatsappLinksTable.tsx` 5, `WhatsappServicePolicyEditor.tsx` 5). Their border is `--border` (1.29:1) and heights differ from the 44 px `Input`/`Select` (visible on the inbox filter row, `admin-whatsapp-inbox-1440.png`). | grep; screenshot |
| 17 | **Primary action colour is split.** `Button`'s default variant is near-black `bg-foreground` (`button.tsx:12`; 77 `<Button>` without a variant, e.g. the home hero 搜尋 and the admin 前往跟進工作台), while `variant="brand"` is green (9 uses, e.g. the header WhatsApp). Changing the default would recolour ~77 buttons; this plan does **not** change it (Open question 3). | grep; screenshots |
| 18 | **Property action bar at 320 px** (FX-16 hand-over). The bar is `px-3 pr-[3.75rem]` with `grid-cols-3 gap-2` (`PropertyDecisionActions.tsx:333-338`), so each column is ≈77 px at 320; 「WhatsApp」 at `text-sm` + `px-2` needs ≈86 px. Icons are already hidden below 420 px (`:342,353,360`). FX-16 guarantees 360 px and up (`e2e/public-mobile-chrome.spec.ts`). | as listed |
| 19 | **Property first screen** (FX-16 hand-over, F-25 layout part): at 375 px the gallery starts at about y = 720, under the action bar (`public-listing-detail-375.png`). | screenshot |
| 20 | **Screen-reader label in English.** `dialog.tsx:49` `<span className="sr-only">Close</span>`; `sheet.tsx:66` already says 「關閉」. | as listed |
| 21 | **Open work.** No open FX branch on origin besides merged ones; 17b (fewer screens, G-12/G-13 nav, blasts, property-sync) and 17c (mobile inbox, G-04/G-15) are planned (`FX-17a-admin-safer-actions.md:139-149`) and will rebuild `admin.whatsapp.tsx`, `admin.blasts.tsx`, `admin.segments.tsx`, `admin.property-sync.tsx`, `admin.leads.tsx` and the `AdminShell.tsx` nav array (`:50-180`). | `git branch -r`; FX-17a plan |
| 22 | **Test wiring.** `test:styles` = `styles.test.mjs` + `styles.contrast.test.mjs` (`package.json:20`, `ci.yml:61`); `test:layout` (`package.json:17`); owned browser suites are listed in `playwright.admin-owned.config.ts:4-23`; `src/test-wiring.test.mjs` fails any non-exempt `test:*` script missing from `ci.yml`. | as listed |

## Global Constraints

- **Owner priorities (binding).** UI polish is last: nothing in FX-20 may risk leads, WhatsApp, access or data.
  - No change to a form's fields, submit logic, server function, `/api/*`, `/w/*`, a WhatsApp href builder, the launcher's lazy-load or handoff. Only class strings and CSS change; 20c changes classes on the property bar and nothing else.
  - Every bar CTA stays ≥ 44×44 px and uncovered at 360-430 px (FX-16 tests stay green); 20c extends that to 320 px.
- **Copy.** zh-HK unchanged. No visible string changes. C14 (sr-only "Close") is asked, not assumed. No brand copy proposals.
- **URLs and slugs** unchanged. No route file is added or renamed.
- **Design scope.** No new colour: C9 names colours already in use with their current values; C5 darkens an existing token within its hue. `--brand-primary`, `--primary`, `SITE_THEME_COLOR` unchanged (`styles.contrast.test.mjs:137` stays green). No layout rewrite, no new primitive, no new dependency. `src/components/ui/*` stay shadcn-shaped (class strings only; no new props).
- **No migration, no env var, no `vercel.ts`, `ci.yml` only for the one new owned browser script, no `package-lock.json`/`bun.lockb`.**
- **Avoid conflicts with planned work (fact 21).** 20b does not touch `admin.whatsapp.tsx`, `admin.blasts.tsx`, `admin.segments.tsx`, `admin.property-sync.tsx`, `admin.leads.tsx`, or `AdminShell.tsx:50-180`; their amber/slate classes move in 17b/17c or in a follow-up after them. `AdminShell.tsx` is edited only at `:199`, `:298-306`, `:527`.
- **Screens.** Before/after at 375 and 1440 px for every page type listed above, with the same scripts (owned fixtures for admin and forms; the PR's Vercel preview, public pages only, read-only, for public). Never the live admin.
- **Committing.** `git add <paths>` only. Conventional commits with a scope, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every PR passes** `npm run lint`, `npx tsc --noEmit`, `npm run build`, every CI `test:*` script, and every suite in `playwright.admin-owned.config.ts` (incl. `test:live-agent:ui`, `test:public-forms:ui`, which hold FX-16's bar geometry and FX-01's form feedback).

## Review Focus

1. **A token change shifts something unexpected.** *Test (20a Task 1, `src/styles.design-system.test.mjs`):* `--input meets 3:1 on card and surface, and only form fields use border-input` (asserts the `outline` button and the listed chips use `border-border`); `--primary, --border and SITE_THEME_COLOR are unchanged`.
2. **Focus disappears somewhere it used to show.** *Tests (20a Task 3, `e2e/design-states.spec.ts`):* `every control shows a focus indicator after Tab, at least 2 px and 3:1 against the colour beside it` (Button × 7 variants, Input, Textarea, Select, Checkbox, Radio, Switch, Slider, Tab, Accordion trigger, Dialog close, a `SiteLink` on the page surface and one on the footer surface); `mouse click does not show the ring on buttons` (focus-visible only).
3. **A busy or disabled control changes meaning.** *Tests (20a Task 3):* `a disabled button is 50% opacity and not clickable`; `a busy button (disabled + aria-busy) keeps full opacity and a progress cursor`; `pressing a button scales it, and a disabled button does not move`.
4. **The property bar loses a CTA or overflows.** *Test (20c, `e2e/public-mobile-chrome.spec.ts`):* `at 320, 360, 375, 390 and 430 px 致電, WhatsApp and 計月供 keep their full label with no overflow and each is ≥ 44 px tall`.
5. **20b repaints an admin status.** *Test (20b Task 2):* the warning/success token values equal the replaced Tailwind values (amber-50/-300/-500/-700/-900/-950, emerald-700/-800), so the screenshots differ only where C8 changes a neutral.

## Out of scope / follow-ups

| Follow-up | Owner | Why |
|---|---|---|
| Property first screen: compact toolbar, gallery above the fold (F-25 layout part, FX-16 hand-over) | owner decision (Open question 5) | A layout change on the main lead page; the brief excludes layout rewrites. If approved, its own PR with its own screenshots. |
| Sprite or dedupe the 134 inline SVGs (FX-15 hand-over) | a performance batch, if lab numbers still justify it | Bundle size, not design; no visible change to approve. |
| Default `Button` variant black vs brand green (fact 17) | owner (Open question 3) | Recolours ~77 buttons; a brand decision, not polish. |
| Remove the `.dark` block and the DRAFT warm tokens | owner (Open question 7) | Unused, but documented as pending sign-off and pinned by tests; costs nothing. |
| Status colours and native selects in `admin.whatsapp.tsx`, `admin.blasts.tsx`, `admin.segments.tsx`, `admin.property-sync.tsx`, `admin.leads.tsx` | 17b/17c, or a 20b follow-up after they merge | Those screens are being rebuilt (fact 21). |
| `aria-busy` on public form submit buttons | later, with FX-01's owner | Touches lead forms; the primitive style from 20a applies automatically once the attribute is set. |
| Concentric radii between `Card` (`rounded-xl`) and hand-built panels (`rounded-lg`) | none | Many files, little visible gain (fact 15). |
| Admin nav sprawl, mobile inbox layout (G-13, G-04, G-15) | 17b / 17c | Not design-system work. |

---

# 20a: Tokens, base rules and primitive states

**Files:**
- Modify `src/styles.css` (C1, C2 base rule, C5, C12).
- Modify `src/components/ui/{button,badge,input,textarea,select,checkbox,radio-group,slider,switch,tabs,accordion,card,dialog,sheet,alert}.tsx` (class strings only).
- Modify `src/components/site/SiteFooter.tsx:41` (one class: the footer's ring colour).
- Modify the non-field `border-input` users (fact 10) to `border-border` (no visible change; needed so C5 darkens fields only).
- Modify `src/routes/index.tsx:860,949`, `src/components/site/EstateGroupGrid.tsx:116,235` (`transition-all` → explicit).
- Modify `src/styles.contrast.test.mjs:128` (badge string without `hover:`).
- Create `src/styles.design-system.test.mjs`; add it to `test:styles` (`package.json:20`: `node --test src/styles.test.mjs src/styles.contrast.test.mjs src/styles.design-system.test.mjs`).
- Create `scripts/browser-fixtures/design-states/{index.html,design-states.tsx}`, `scripts/browser-fixtures/build-design-states.mjs` (copy of `build-public-forms.mjs` with its own output `.audit/design-states-browser`), `e2e/design-states.spec.ts`; add the spec to `playwright.admin-owned.config.ts:4-23`, a script `"test:design-states:ui": "playwright test --config playwright.admin-owned.config.ts e2e/design-states.spec.ts"` after `test:live-agent:ui`, and `- run: npm run test:design-states:ui` in the CI job that runs the other owned browser suites.

### Task 0: A design-states fixture (no product change)

`design-states.tsx` renders, with the real `@/styles.css`: every `Button` variant × size, each in rest / disabled / busy (`disabled aria-busy="true"` with the 「儲存中…」 label as it appears in the app); `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `Tabs`, `Accordion`, `Badge` × 4, `Card` with title, a `Dialog` trigger, a `SiteLink` row, and the same row inside a `bg-foreground text-background` block marked `data-surface="dark"` (the footer pattern). No network, no auth.

- [ ] **Step 1:** build the fixture; `e2e/design-states.spec.ts` first test only screenshots it at 375 and 1440 into `.audit/design-states-playwright/` (the "before" states sheet). Run it on `main`'s primitives. Commit: `test(ui): an owned design-states fixture for every primitive state`.

### Task 1: Tokens and base rules (C1, C2 base, C5, C12)

- [ ] **Step 1: failing tests** in `src/styles.design-system.test.mjs` (reuse the oklch → sRGB helpers by importing them from `styles.contrast.test.mjs` if exported, else copy the 20 lines):
  - `headings have no negative letter-spacing` — the `h1…h6` base rule has `letter-spacing: normal` (or none), no `-0.0` value.
  - `--input meets 3:1 on card and on surface`.
  - `only form fields use border-input` — `border-input` appears only in `input.tsx`, `textarea.tsx`, `select.tsx`; `button.tsx` outline variant uses `border-border`.
  - `a global focus-visible fallback exists and uses --ring with a 2 px outline and 2 px offset`, and `the footer sets its ring to --brand-bright` (`SiteFooter.tsx` contains `[--ring:var(--brand-bright)]`); the bright ring on `--foreground` is ≥ 3:1.
  - `no --chart- token remains`.
  - `--primary, --brand-primary, --border, --destructive and SITE_THEME_COLOR are unchanged` (values pinned).
  Run `npm run test:styles`: fails.
- [ ] **Step 2: implement** in `styles.css`:
  - `:222-230`: `letter-spacing: -0.02em` → delete the declaration (headings inherit `normal`).
  - `:152`: `--input: oklch(0.912 0.017 157)` → `--input: oklch(0.64 0.017 157)` with the comment `/* #848F88: 3.34:1 on card, 3.20:1 on surface (WCAG 1.4.11 field boundary). Fields only; buttons and chips use --border. */`. `.dark` `--input` unchanged.
  - New rule in `@layer base` after `:230`:
    ```css
    /* FX-20 C2: one focus indicator for links and custom controls that set none.
       Primitives draw their own ring and set outline:none, which wins (utilities layer). */
    :where(a, button, summary, [role="button"], [tabindex]:not([tabindex="-1"])):focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }
    ```
  - `SiteFooter.tsx:41`: add `[--ring:var(--brand-bright)]` to the footer's class list (10.06:1 on the footer).
  - Delete `--color-chart-1…5` (`:59-63`) and `--chart-1…5` (`:155-159`).
  - The non-field `border-input` users (fact 10) → `border-border` (same value today, so no visible change for them).
- [ ] **Step 3:** `npm run test:styles` green; `npm run build`; grep `chart-` in `src` is empty.
- [ ] **Step 4: commits.** `fix(typography): headings use normal letter-spacing (completes F-20)`; `fix(a11y): form fields get a 3:1 border; buttons and chips keep the light border`; `fix(a11y): one visible focus outline for links and custom controls, bright on the footer`; `chore(styles): remove the unused chart tokens`.

### Task 2: Primitive states (C2, C3, C4, C7, C10, C11)

- [ ] **Step 1: failing tests** in `src/styles.design-system.test.mjs` (source level):
  - `every primitive focus style is focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background` (button, input, textarea, select trigger, checkbox, radio item, slider thumb, switch, tabs trigger; badge, dialog close and sheet close use `focus-visible:` not `focus:`).
  - `Button has a pressed state and keeps busy buttons readable` — the base string contains `motion-safe:active:scale-98`, `aria-busy:cursor-progress`, `aria-busy:disabled:opacity-100`, and an explicit `transition-[color,background-color,border-color,box-shadow,transform]`.
  - `Badge has no hover style` (no `hover:` in `badge.tsx`).
  - `titles have no tracking-tight or leading-none` (`card.tsx`, `dialog.tsx`, `alert.tsx`).
  - `no transition-all in src` (any `.tsx`).
  Run: fails.
- [ ] **Step 2: implement** (exact strings in "Changes for approval"):
  - `button.tsx:8`: `transition-colors` → `transition-[color,background-color,border-color,box-shadow,transform] duration-150`; add `focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:active:scale-98 aria-busy:cursor-progress aria-busy:disabled:opacity-100`; `:16` outline `border-input` → `border-border` (Task 1).
  - `textarea.tsx:10`, `checkbox.tsx:14`, `radio-group.tsx:23`, `slider.tsx:39`: `focus-visible:ring-1` → `focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background`; `radio-group.tsx:23` drop `focus:outline-none` duplicate; `textarea.tsx:10` add `transition-colors`.
  - `input.tsx:11`, `select.tsx:22`: add `ring-offset-2 ring-offset-background` to the existing ring (select keeps `focus:` because Radix opens it on pointer and the ring marks the open trigger; this is shadcn's choice).
  - `badge.tsx:7-16`: `focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2` → `focus-visible:` equivalents; delete the three `hover:` classes. `styles.contrast.test.mjs:128` expects `bg-destructive text-destructive-foreground shadow` (the pair it measures is unchanged).
  - `dialog.tsx:47`, `sheet.tsx:64`: `focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2` → `focus-visible:`.
  - `card.tsx:36`, `dialog.tsx:75`, `alert.tsx:34`: drop `tracking-tight`; `leading-none` → `leading-snug`.
  - `tabs.tsx:30`, `accordion.tsx:25`, `EstateGroupGrid.tsx:116,235`, `index.tsx:860,949`: `transition-all` → `transition-[color,background-color,box-shadow,transform]` (tabs, cards) or `transition-colors` (accordion trigger; its chevron keeps `transition-transform`).
- [ ] **Step 3:** source tests green.

### Task 3: Browser assertions on the design-states fixture

- [ ] **Step 1: failing tests** in `e2e/design-states.spec.ts` (written against Task 0's fixture, run before Task 2 lands to see them fail):
  - `every control shows a focus indicator after Tab` — for each control: press Tab until it is focused; read `getComputedStyle` `outline-*` and `box-shadow`; assert an indicator ≥ 2 px exists and that its colour has ≥ 3:1 against the computed background just outside it (page surface, or the dark block for the footer row).
  - `a mouse click does not show the ring on a button` (`:focus-visible` false after `click`).
  - `disabled button: opacity 0.5, pointer-events none`; `busy button: opacity 1, cursor progress`.
  - `pressed button scales to 0.98 under mousedown; with prefers-reduced-motion it does not` (`page.emulateMedia({ reducedMotion: "reduce" })`).
  - `badges do not change background on hover`.
  - `inputs, textarea and select trigger border is ≥ 3:1 against the card`.
- [ ] **Step 2:** with Tasks 1-2 in place, all pass; take the "after" states sheet at 375 and 1440.
- [ ] **Step 3: commit.** `fix(ui): consistent focus-visible rings with offset, a pressed state, readable busy buttons, quiet badges`.

### 20a verification

- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run test:styles`, `npm run test:layout`, `node --test src/test-wiring.test.mjs`, every CI `test:*`.
- [ ] Every `playwright.admin-owned.config.ts` suite (these click by role and text, so a ring or scale change must not break them; any failure is investigated, not re-recorded).
- [ ] Before/after screenshots: rebuild every fixture listed under "Before screenshots" on the PR branch and re-run the same scripts (same names, `fx20/after/`); public pages against the PR's Vercel preview (read-only). Attach pairs per page type to the PR, plus the states sheets, plus a keyboard-focus pair (Tab to the first CTA) for home, property, contact and the admin dashboard.
- [ ] Manual: VoiceOver/NVDA is not needed (no semantics change); a 200 % zoom check on home and the admin dashboard (no new overflow).

---

# 20b: App-level consistency (after 20a)

### Task 1: No text under 12 px (C6)

**Files:** `index.tsx:979,985,1000,1009,1020`; `listings.tsx:773,940,1267,1385`; `EstateGroupGrid.tsx:78,85,93`; `ImageUploader.tsx:225`; `AdminOperationsMigrations.tsx:287`.
- [ ] **Step 1:** failing test in `styles.design-system.test.mjs`: `no text-[9px], text-[10px] or text-[11px] in src`.
- [ ] **Step 2:** each → `text-xs` (12 px). `EstateGroupGrid.tsx:78` (9 px photo credit at `/60` over a photo): `text-xs text-primary-foreground` on a `rounded bg-foreground/50 px-1` backing, the same pattern as the listing card chips (`listings.tsx:1267`). Chip containers keep their padding; check the home card chips still fit on one line at 375 px.
- [ ] **Commit.** `fix(typography): no label under 12 px`.

### Task 2: One neutral family and named status colours in the admin (C8, C9)

**Files (outside 17b/17c scope only):** `AdminShell.tsx:199,298-306,527`; `admin.index.tsx:158,290-353,414,421,457`; `AdminTeamStatusBadge.tsx`; `AdminOperationsJobs.tsx:95,457`; `AdminNoPermission.tsx`; `AdminPropertyWorkspace.tsx`, `AdminPropertyTable.tsx`, `AdminContentCopilot.tsx`, `PerformanceDashboard.tsx`, `WhatsappLinkWizard.tsx`, `WhatsappBatchResult.tsx`, `TransactionAttributionEditor.tsx`, `AdminPropertyBulkActions.tsx` (each 1-5 classes); `styles.css` (new tokens).
- [ ] **Step 1: failing tests** (`styles.design-system.test.mjs`): `the listed admin files use no slate-, amber- or emerald- class`; `the warning and success tokens equal the Tailwind values they replace` (hex pinned: amber-50 `#fffbeb`, amber-300 `#fcd34d`, amber-500 `#f59e0b`, amber-700 `#b45309`, amber-900 `#78350f`, amber-950 `#451a03`, emerald-700 `#047857`, emerald-800 `#065f46`); `warning-foreground on warning ≥ 4.5:1` and `on warning-strong ≥ 4.5:1`.
- [ ] **Step 2:** add after the `--whatsapp` block:
  ```css
  /* FX-20 C9: named status colours, same values the admin already used. */
  :root {
    --warning: #fffbeb;            /* amber-50: notice background */
    --warning-strong: #f59e0b;     /* amber-500: count badge, unread dot */
    --warning-border: #fcd34d;     /* amber-300 */
    --warning-foreground: #451a03; /* amber-950: 8.75:1+ on --warning, 6.97:1 on --warning-strong */
    --success: #047857;            /* emerald-700 (tints via /10, /20) */
    --success-foreground: #065f46; /* emerald-800 */
  }
  @theme inline { --color-warning: var(--warning); … }
  ```
  Replace `amber-*`/`emerald-*` with `warning*`/`success*` utilities (opacity modifiers kept, e.g. `bg-success/10`). `amber-900` / `amber-800` text become `text-warning-foreground` (darker, still the same hue; listed in C9).
- [ ] **Step 3:** `slate-*` → tokens: `text-slate-950`/`-900` → `text-foreground`; `text-slate-700` → `text-foreground/80` (≥ 4.5:1 on `bg-muted`, asserted); `bg-slate-50` → `bg-muted`, `hover:bg-slate-100` → `hover:bg-accent`; `border-slate-200` → `border-border`; `slate-500/10`, `/20` → `muted-foreground/10`, `/20`; `AdminShell.tsx:527` `bg-slate-50/70` → `bg-background`.
- [ ] **Step 4:** `npm run test:styles`, `test:team`, `test:command-center`, `test:operations`, all owned admin suites; admin after-screenshots.
- [ ] **Commit.** `refactor(admin): status colours and neutrals come from tokens`.

### Task 3 (optional, owner Open question 2): one class for native selects

- **Create** `src/components/ui/native-field.ts` exporting `nativeFieldClassName = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"` (a string, not a component).
- Apply to the native `<select>`s in files outside 17b/17c scope (fact 16 list minus `admin.whatsapp*`, `admin.blasts`, `admin.segments`, property-sync). Keep any width (`w-auto`, `ml-2`) the call site had.
- Test: `native selects outside the 17b/17c screens use nativeFieldClassName`. Commit: `fix(admin): native selects match the 44 px field style`.

---

# 20c: Property action bar at 320 px (C13, gated)

**Files:** `src/components/property/PropertyDecisionActions.tsx:340,346,358` (classes only); `e2e/public-mobile-chrome.spec.ts` (add 320 to the width list of the existing `property bar` test).
- [ ] **Step 1:** failing test: at 320 px each of 致電 / WhatsApp / 計月供 has `scrollWidth ≤ clientWidth`, height ≥ 44, and is the topmost element at its centre. Today it fails at 320 (fact 18).
- [ ] **Step 2:** on the three bar buttons add `max-[359px]:px-1 max-[359px]:text-xs`. Nothing changes at 360 px and up (asserted by the existing 360-430 runs). Labels, hrefs, analytics events and the `bg-whatsapp` colour are unchanged.
- [ ] **Step 3:** `npm run test:live-agent:ui`, `npm run test:property-experience`; screenshots at 320, 375, 1440 of a property page on the preview.
- [ ] **Commit.** `fix(property): the action bar keeps full labels at 320 px`.
- **Canary:** `property_whatsapp_click` daily rate unchanged over the following week (as FX-16).

**Rollback (all slices):** revert the PR; each change is its own commit, so one item can be reverted alone. Nothing to restore in data or settings.

---

## Changes for approval

Each row is one visible change. Approve or decline per row. "Where it shows" is per page type from the before screenshots.

| # | Change | Old → new | Where it shows | Slice |
|---|---|---|---|---|
| **C1** | Heading letter-spacing | `h1…h6 { letter-spacing: -0.02em }` → `normal` (0) | Every heading, public and admin. Chinese headings sit about 0.5 px per character wider at `text-2xl` (24 px); most visible on the home hero H1, page heroes, property title, admin page titles. Completes FX-16 F-20. | 20a |
| **C2** | Focus indicator | Buttons: 2 px ring **touching** the button → 2 px ring **with a 2 px gap** in the page colour. Textarea, checkbox, radio, slider: 1 px → 2 px ring + gap. Badges, dialog/sheet close: ring only for keyboard (was also on click). Links and custom controls (header nav, footer, cards, chips, pagination): browser default outline → 2 px brand-green outline, 2 px offset; on the dark footer, light green (`--brand-bright`, 10.06:1 instead of 2.83:1). | Only when using the keyboard (Tab). All page types. Mouse users see no change. | 20a |
| **C3** | Pressed state | none → button shrinks to 98 % while pressed (150 ms), not for users who ask for reduced motion, never on a disabled button | Every `Button`, public and admin (header WhatsApp, hero 搜尋, property bar, admin actions). | 20a |
| **C4** | Badges stop reacting to hover | `Badge` default/secondary/destructive darken on hover → no hover change | Status chips everywhere (租盤/售盤, 待回覆, 開啟, team status). Badges are not clickable, so nothing is lost. | 20a |
| **C5** | Form-field border | `--input` `#D9E6DD` (1.29:1) → `#848F88` `oklch(0.64 0.017 157)` (3.34:1 on white, 3.20:1 on page) | Every `Input`, `Textarea`, `Select` trigger: public contact, valuation, property enquiry, listing alert, listings filters, mortgage calculator; admin forms (listing/transaction/CMS editors, search boxes). Outline buttons and filter chips keep today's light border. | 20a |
| **C6** | Smallest text | 9, 10 and 11 px → 12 px (`text-xs`); the 9 px photo credit also gets full-opacity text on a dark 50 % backing | Home listing-card chips and badges; listings filter count and card chips; estate group grid labels (平均放盤實呎, 最新放盤) and photo credits; admin image-upload "cover" tag; migration detail list. | 20b |
| **C7** | Card, dialog and alert titles | `tracking-tight leading-none` → normal tracking, `leading-snug` | Admin card titles and dialog titles (confirmations); public cards using `CardTitle`. Two-line Chinese titles no longer touch. | 20a |
| **C8** | Admin neutrals | Tailwind slate (cool blue-grey) → the site's green-tinted neutrals: page background `slate-50/70` → `--background` `#F8FBF9`; dashboard text `slate-950/900` → `--foreground` (`oklch(0.27 0 0)`, #262626); task rows `slate-50` → `--muted`; card borders `slate-200` → `--border` | Admin dashboard (總覽), admin shell background on every admin page, team status badges (停用 / 未啟用). Hue shift only; contrast equal or higher. | 20b |
| **C9** | Admin status colours named | Raw amber/emerald → `--warning*` / `--success*` with the **same values**; the one difference: amber-800/-900 notice text → amber-950 (`--warning-foreground`, slightly darker) | Admin dashboard 需要跟進 row, first-login checklist, nav count badge, team badges, jobs notices. | 20b |
| **C10** | Transitions | `transition-all` → only the properties that change | Tabs, accordion, home video/estate cards, estate group cards. No visible difference except no stray animation of layout properties. | 20a |
| **C11** | Busy buttons | a disabled button that is saving (`aria-busy`) shows its 「儲存中…」 label at 50 % (2.07:1 on green) → full opacity (5.11:1) with a progress cursor | Admin confirmation dialogs and the content copilot today (they already set `aria-busy`); any button that adds `aria-busy` later. Plain disabled buttons stay at 50 %. | 20a |
| **C12** | Unused chart tokens removed | `--chart-1…5` deleted | Nothing visible. | 20a |
| **C13** | Property action bar below 360 px | at 320 px 「WhatsApp」 overflows its column → under 360 px the three buttons use 12 px text and 4 px side padding | Property pages on 320-359 px phones only. 360 px and up unchanged. | 20c |
| **C14** | (wording, ask) dialog close label for screen readers | `Close` → 「關閉」 (as the sheet already says) | Not visible; read aloud by screen readers on every dialog. | 20a, only if approved |
| **Native selects** | (optional, Open question 2) | six hand-made styles, 36-44 px, light border → one 44 px style with the C5 border and the C2 ring | Admin listings filters, performance dashboard, WhatsApp link wizard/table, service policy editor, staff editors. | 20b Task 3 |

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **C5 field border: `oklch(0.64 …)` (#848F88, 3.34:1) or a lighter `oklch(0.66 …)` (#8A958E, 3.09:1 on white but 2.96:1 on the page background)?** **Default: 0.64**, the lightest value that passes 3:1 on both surfaces. Declining C5 leaves fields at 1.29:1 (a WCAG 1.4.11 failure wherever the border is the only cue).
2. **Native admin selects (20b Task 3)?** **Default: yes, outside the 17b/17c screens.** It adds one class constant, not a component. Decline to keep 20b to C6, C8, C9.
3. **Default `Button` colour: keep near-black, or make green the default?** **Default: keep** (fact 17). Changing it recolours ~77 buttons (hero 搜尋, admin primary actions) and is a brand decision, not polish.
4. **C13 property bar at 320 px?** **Default: yes, in its own PR (20c)**, because it touches the main lead CTA; only classes change and only below 360 px.
5. **Property first screen (gallery above the fold, compact toolbar)?** **Default: not in FX-20.** It is a layout change on the main lead page and needs its own before/after approval; I can plan it as a separate item if you want it.
6. **Admin page types with no owned fixture (command center, team, agents, estates, segments, transactions list):** **Default: you check them on the 20a/20b preview yourself**; they use the same primitives the states sheet proves. The alternative is extending the fixtures for each (about a day of work, no product value).
7. **Unused `.dark` block and the DRAFT warm tokens (`--surface-warm`, `--ink-charcoal`, `--brand-accent-bronze`):** **Default: keep** (no cost, documented as pending your sign-off). Say "remove" and they go in 20a with their `styles.test.mjs` pins.
8. **C14 「關閉」 for the dialog close label?** **Default: yes** (matches the sheet; not visible). It is wording, so it waits for your yes.

## Findings that differ from the brief

1. **FX-16's "no negative tracking on Chinese headings" was not fully achieved:** the base `h1…h6` rule still applies −0.02em (fact 2). C1 finishes it.
2. **The worst focus problem is on the most important buttons:** the green and WhatsApp CTAs get a ring of their own colour with no gap (fact 4), and the footer ring fails 3:1 (fact 6). The axe gate in FX-16 cannot catch this (it does not test focus appearance).
3. **Form fields fail WCAG 1.4.11 (1.29:1)**, inherited from shadcn's default where `--input` equals `--border` (fact 10). Not listed in the audit.
4. **The `--sidebar-*` tokens FX-19 handed over are already gone;** only `--chart-*` remain (fact 3).
5. **No owned fixture renders public pages**, so public "before" shots are read-only captures of the live site, and "after" shots come from the PR preview (same as FX-16 Task 7).
