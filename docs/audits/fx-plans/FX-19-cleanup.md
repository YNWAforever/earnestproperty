# FX-19: Cleanup, docs, CI wiring and WhatsApp env consolidation. Implementation plan (19a, 19b, 19c, 19d)

**Owner decisions (binding once filled in; until then the defaults in "Open questions" apply):**
1. **D8 (price format):** _pending_. Default **HK$1,268萬 everywhere** (fix plan D8). Only 19d-2 depends on it.
2. **19c env consolidation:** _pending_. Nothing in 19c changes production until the owner has answered the readback in Owner action O-3 and confirmed the two "same channel / same number" questions (19c table, rows 1 and 2).
3. **S7 (legacy MLS container):** _pending_. 19d-3 is not built until the owner confirms in Cloudflare that `earnest-mls-container` (and its scheduled sibling `earnest-mls-runner`) has no active deployment, schedule or binding.
4. **Archive location for S6:** _pending_. Default: a new **private** GitHub repository owned by the owner (Open question 4).
5. **No migration in any FX-19 PR.** No new env var. No `vercel.ts` edit. No product behaviour change in 19a, 19b or the code half of 19c.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Deletions are proved unused by a failing-then-passing guard test or by the full suite; behaviour changes get a failing test first.

**Goal.**
- Remove dead weight that a new team would otherwise have to read and maintain, without changing anything a visitor or staff member sees (19a).
- Make the docs tell the truth, run the database suites that guard leads, WhatsApp and listings on every PR without any external database, and stop shipping a third-party map key in a fixture (19b).
- Cut the WhatsApp settings from about 34 to about 20, **without changing who receives a WhatsApp message**, by first reading both old and new names, then letting the owner set the new values, then letting the owner delete the old ones (19c).
- One price format, HK dates, one role list, Zod on staff writes, server-only markers, no silent auth/DB errors, and retirement of the legacy MLS container once Cloudflare confirms it is gone (19d).

Findings: S3, S5 (= H-14, H-15, H-17), S6, S7 (= H-12), B-09, B-13, B-14, H-04, H-05, H-07, H-08, H-13, H-16, H-18, H-20, A-03 (= H-21, R-NEW-05). A-02 (source-text tests) stays with the batches that own those paths; see "Out of scope".

**Approach.** Every item is classified against every open branch (#238 to #243, the local `fix/fx-17a-admin-safer-actions`, the local `fix/fx-18a-data-hygiene` plan, and the 17a-2/17b/17c/18b-d outlines). FX-19 is cut into **slices**, each one PR from `main`, so that nothing clashes with work in flight:

| Slice | Branch (suggested) | Content | Can start |
|---|---|---|---|
| **19a-1** | `fix/fx-19a1-dead-weight` | Unused UI primitives (no dependency change), B-09 wrappers, the unreviewed staff-channel wrapper, `.superpowers` untrack, `.lovable/`, one duplicate orphan test, B-13 fixture redaction; `bun.lockb` behind a one-line owner readback | **Now** |
| **19b-1** | `fix/fx-19b1-db-suites-ci` | Port `test:crm:db`, `test:woztell:db`, `test:property-sync:db` to owned Docker Postgres and add them to CI | **Now** (independent of 19a-1) |
| **19a-2** | `fix/fx-19a2-deps-exports` | Dependency removal + lockfile, `chart.tsx`, remaining dead exports, orphan tests, `estatePhotos` | After #239, #240, #242, 17a-1, 18a-1 |
| **19b-2** | `fix/fx-19b2-docs` | CLAUDE.md, README, `.env.example` rewrite; S6 archive; `test:whatsapp-enquiries:db`, `test:staff-notifications:db`, `test:cms:db` | After #238, #239, #240, #241, #242, 17a-1 |
| **19c-1** | `fix/fx-19c1-wa-env-dual-read` | Code reads new **and** old names; no production change | After #238, 17a-1, and owner readback O-3 |
| **19c-2** | `fix/fx-19c2-wa-env-old-names` | Remove the old names from code, after the owner has set the new values and production has run clean for 7 days | After 19c-1 + O-4 |
| **19d-1** | `fix/fx-19d1-consistency` | Server-only markers, single `ROLES`, H-20 auth/DB errors, Zod on staff writes | After #238, #240, #241, 17a-1, 18a-1 |
| **19d-2** | `fix/fx-19d2-price-dates` | D8 price format, HK dates | After #238, #242, #243, 17a-1 (and D8) |
| **19d-3** | `fix/fx-19d3-retire-mls-container` | S7 | After the owner's Cloudflare confirmation (O-6) and #241 |

**Tech stack.** `node --test`, `bun test` (Bun 1.3.12, as CI), owned Postgres through `scripts/acceptance/owned-postgres-test.mjs` (`withOwnedPostgres`, `mockOwnedServerDb`), Playwright admin-owned config. No production, Neon, WozTell, Vercel or Cloudflare call from any task.

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: A-03 `:127`, B-09 `:171`, B-13 `:175`, B-14 `:176`, H-04/H-05/H-07/H-08 `:370-373`, H-12 to H-18 `:377-383`, H-20 `:384`, S3/S5/S6/S7 `:423-427`, environment note `:559`.
- Fix plan `docs/audits/2026-10-fix-plan.md`: Global constraints `:17-39`, D8 `:76`, batch row `:107`, FX-19 `:744-770`.
- Format: `docs/audits/fx-plans/FX-11a-ai-staff-guardrails.md`.
- Open-branch plans read: FX-17a (`fix/fx-17a-admin-safer-actions`, `docs/audits/fx-plans/FX-17a-admin-safer-actions.md`, incl. 17b/17c outlines), FX-18a (`fix/fx-18a-data-hygiene`, `docs/audits/fx-plans/FX-18a-data-hygiene.md`, incl. 18b-d outlines).

## Verified current behaviour (main `1216ab8d`, 2026-10-10)

| # | Fact | Where |
|---|---|---|
| 1 | **`bun.lockb` is stale but not "modified".** Last changed 2026-04-18 (`e01fff54`). The working-tree "M" seen in every worktree is a Git-for-Windows stat quirk: `git hash-object bun.lockb` = HEAD blob `ae670d20` (also noted in the audit `:559`). CI installs with `npm ci` in every job (`ci.yml:33,151,187,202,219`; `migration-drift.yml:30`; `property-sync-*.yml`). `vercel.ts` sets `buildCommand: "npm run build"` (`:46`) but **no `installCommand`**, so Vercel picks the installer from the lockfiles it finds; which one it picks today is **not visible from the repo**. `package.json` has no `packageManager` and no `engines`. | `package.json:1-12`; `vercel.ts:46` |
| 2 | **20 UI primitives plus one hook are imported by nothing** in `src`, `scripts`, `e2e` or `workers`, on main or on any open branch: `aspect-ratio`, `breadcrumb`, `calendar`, `carousel`, `command`, `context-menu`, `drawer`, `dropdown-menu`, `form`, `hover-card`, `input-otp`, `menubar`, `navigation-menu`, `pagination`, `progress`, `resizable`, `separator` (only `sidebar` imports it), `sidebar`, `toggle` (only `toggle-group`), `toggle-group`, and `src/hooks/use-mobile.tsx` (only `sidebar`). The 21st, **`chart.tsx`, is also unused but #242 edits it** (`:225`, `toLocaleString("zh-HK")`). `sonner.tsx` is used (`__root.tsx`). | import walk over `src/components/ui/*` |
| 3 | **19 dependencies are used only by those files (or by nothing):** `@hookform/resolvers`, `date-fns` (no import at all), `@radix-ui/react-aspect-ratio`, `-context-menu`, `-dropdown-menu`, `-hover-card`, `-menubar`, `-navigation-menu`, `-progress`, `-separator`, `-toggle`, `-toggle-group`, `cmdk`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-hook-form`, `react-resizable-panels`, `vaul`. `recharts` stays (`EstateMarketSnapshot.tsx`, `district.sham-tseng.tsx`). `@radix-ui/react-slot`, `-label`, `-dialog` stay. **#239 is the only open branch that changes dependencies** (adds `path-to-regexp` to `package.json` and `package-lock.json`). | `package.json` dependencies |
| 4 | **B-09 confirmed, narrower.** `admin-data.ts:240-304` holds three browser-callable server functions (`fetchStaffAccessSummary`, `updateStaffRoles`, `setStaffActive`) that no UI calls; Team uses `admin-team.ts:264-266`. The **server** implementations in `admin-data.server.ts:228,340,508` are live: `staff-lifecycle.server.ts:1003-1005` calls them. `admin.routes.test.mjs:892-905` pins the three wrappers as admin-only. `unwrapStaffAccessResponse` (`:224`) is exported only for those wrappers and its own test `admin-data.staff-access-response.test.ts`, which sits in `test:property-experience` (`package.json:46`), **a line #239 edits**. | as listed |
| 5 | **A dead, browser-callable legacy write path for staff WhatsApp routing.** `saveWhatsappStaffChannel` (`whatsapp-assignment.ts:60-80`) calls `saveStaffChannel` (`assignment.server.ts:152`), "the legacy manual-review path" (`:158`) that writes `review_basis='legacy_manual'`. No UI calls it (the UI uses `saveReviewedWhatsappStaffChannel`, `:91-112`); only `staff-server-fn.modules.test.ts:122` lists it. The server function stays (`assignment.test.mjs:83`, `mapping-review.db.test.mjs:73`). | as listed |
| 6 | **H-16 dead exports, re-located** (line numbers moved since the audit): `getWhatsappTrackingLinks` (`whatsapp-enquiries.ts:29`), `provisionWhatsappLinks` (`:48`), `getWhatsappEnquiries` (`:60`, **17a-1 already deletes it**), `reorderAdminFaqs` wrapper (`admin-data.ts:1090-1100`), `estatePhotos`/`getEstatePhoto` (`estate-pages.ts:924-949`; the live photo map is `estate-registry.ts`). `staff-server-fn.contract.test.mjs:170-173` lists the whatsapp-enquiries names; 17a-1 edits that list. #239 edits `estate-pages.ts:919`. FX-11a's plan hands `generateAiText` (export) to FX-19a; 17a's plan hands "make server `queueAdminCampaign` module-private" to FX-19a. | as listed |
| 7 | **`.superpowers/` is gitignored (`.gitignore`, "Brainstorm session artifacts") but two files are tracked:** `.superpowers/sdd/progress.md`, `.superpowers/sdd/task-4-report.md`. `.lovable/plan.md` is tracked and unreferenced. `.audit-20260905/wp3-report.md` and `docs/codex/…` are audit records (S6 set). | `git ls-files` |
| 8 | **`ops/systemd/` is not free-standing dead weight.** `src/lib/mls/ops-contract.test.mjs:6-30` reads both unit files plus `docs/mls-production-activation.md` and both `workers/mls-container/wrangler*.jsonc`, and it runs in CI through `test:mls`. It goes with S7, not 19a. | as listed |
| 9 | **The "unused" `lido.jpg` is live through the database.** `public/branches/lido.jpg` (+7 responsive variants and its `responsive-images.generated.json` entry) is the seeded `branches.photo` value (`20260830160000_branches_entity.sql:45`), and `/about` renders `branch.photo` from `fetchNeonBranches()` (`about.tsx:53,234`). Only the code-side config moved to `lido-2026-09.jpeg` (`site-branches.js:13`). Deleting it would break the 麗都分行 photo on `/about` unless production's row was changed. | as listed |
| 10 | **Orphan tests (A-03) re-checked.** Still unwired: `scripts/jev/*.test.mjs` ×4 (the whole `scripts/jev/` has no `package.json` script; a pilot lives on branch `codex/jev-copilot-pilot`), `scripts/mls/verify-shadow*.test.mjs` ×2 (S7), `scripts/staff-handoff-fixture.test.mjs` (deterministic; validates the fixture used by `test:staff-notifications:e2e`), `scripts/acceptance/admin-no-link-journey.test.mjs` (its whole body is `import "../no-link-local-postgres.test.mjs"`, which CI already runs). `scripts/old-site-migration/__tests__/*` are **not** orphans (`test:migration` globs them). | `package.json`; file heads |
| 11 | **20 DB scripts are exempt from CI** by the list in `src/test-wiring.test.mjs:92-113`. The four the fix plan names, and the reason they are not in CI today: `test:crm:db` (2 files), `test:woztell:db` (1), `test:whatsapp-enquiries:db` (5), `test:property-sync:db` (8). **All use the Neon HTTP driver directly** (`neon(url)`), most behind `assertDisposableNeonTestTarget`, which requires a `*.neon.tech` host and an `earnest_audit_acceptance_YYYYMMDD` database (`disposable-test-target.mjs:9-40`). They build their own synthetic schema; they do not need production data. **Without `TEST_DATABASE_URL` they `skip`**, so adding them to CI unchanged would be a silent green. `test:property-sync:db` runs only by manual dispatch behind `vars.PROPERTY_SYNC_DB_ACCEPTANCE_ENABLED` (`property-sync-acceptance.yml:12`). The owned harness already offers a pg pool with `query`/`transaction` (`owned-postgres-test.mjs:44-144`) and `ownedMlsPorts` (`:169-191`). Parts are already covered: `staff-notifications.db.test.mjs` runs in `test:lead-alert:owned:db`; `historical-withdrawal.db.test.mjs` in `test:property-withdrawal:owned:db`. | as listed |
| 12 | **New FX DB suites are already self-wiring.** `test-wiring.test.mjs:89-118` fails any non-exempt `test:*` script missing from `ci.yml`, so #238 adds `test:contact-identity:db` (`ci.yml:164`), 18a plans `test:data-hygiene:db`. 19b only has to deal with the exempt Neon-only suites. | as listed |
| 13 | **B-13: the key is a Google Maps Embed API key** (`AIza…`, a browser key) inside an `<iframe src="https://www.google.com/maps/embed/v1/place?key=…">` scraped from the **old website**, in `scripts/old-site-migration/__fixtures__/property-detail-6709182.html:209` (committed 2026-06-22, `6bb31dec`). It is the only `AIza` string in the tree. The fixture is read by `src/lib/mls/mls-fixtures.test.mjs:38,104,206,251,285` and `source-adapters.test.mjs:103,137,197` (CI `test:mls`); none of them reads the key. Infra IDs: a real-looking Neon endpoint and branch ID in `src/lib/neon/disposable-test-target.test.mjs:5-9`, and in `docs/reports/2026-09-27-staging-acceptance-evidence.md:5,33` (S6 set). The key stays in Git history whatever the PR does. | as listed |
| 14 | **B-14 / H-13 confirmed.** CLAUDE.md says auth is a "Neon Auth JWT"; the server looks the bearer up as an opaque session token in `neon_auth.session` (`auth.server.ts:96-130`). CLAUDE.md names 5 server-function files; **29** non-test files call `createServerFn`. It says "17 scripts"; there are **105** `test:*` scripts. **CHANGELOG.md was already restarted** ("## 2026-10 — Pre-handover fixes", FX-01 onward), so that part of H-13 is done. #241 edits CLAUDE.md `:53`. `.env.example` is edited by #239 (`:37-41`, `:178`), #240 (`:135-147`) and #242 (`:101-107`). | as listed |
| 15 | **S6 set = 314 files:** `docs/reports` 182 (99 md, 64 json, 17 csv, 2 png), `docs/superpowers` 103, `docs/audits/astra-*` 29. **73 of the reports are readbacks, production/migration results or evidence** (e.g. `2026-09-07-daily-production-migration-result.md`, `2026-10-03-admin-remediation/*-readback.md`). Code that reads or writes inside the set: `scripts/acceptance/final-remediation.mjs` writes `docs/reports/final-remediation-results.json`; `scripts/media/generate-responsive.mjs:65` writes `docs/audits/astra-task-8-image-metrics.json`; `profile-public-bundle.mjs` writes `astra-task-8-bundle-profile.json`. Code comments cite `docs/superpowers/plans/*` in 8 files. #239 edits `docs/reports/2026-09-11-homepage-asset-redirect.md`. Tests that read docs outside the set: `client-area-presentation.test.mjs:18` (`docs/client-feedback-20260907-ledger.md`), `ops-contract.test.mjs:14` and `verify-shadow.test.mjs` (`docs/mls-production-activation.md`). | `git ls-files docs` |
| 16 | **About 34 WhatsApp variables exist** (the 19c table). Production values last recorded (2026-09-12, `docs/implementation/whatsapp-enquiries/staff-handoff/SETTINGS_REPAIR_20260912.md:149`; audit `:142`): `EP_WA_ENQUIRY_MODE=active`, `EP_WA_ROUTING_ENABLED=true`, `EP_WA_STAFF_NOTIFICATIONS_ENABLED=true`, `EP_WA_ACTIVATION_ID` set, tracked links live, **`EP_WA_SERVICE_AUTOMATION_ENABLED=false`** (customer survey/service messages off), direct staff WhatsApp alerts and ack escalation off. These are a month old and must be re-read (O-3). | as listed |
| 17 | **Phone fallback order is already "company, then public".** `companyFallbackLocation` tries `EP_WA_COMPANY_PHONE`, then `VITE_CONTACT_WHATSAPP_PHONE`, then `/contact` (`whatsapp-enquiries.server.ts:61-80`); `resolveTrackingLinks` the same (`:285`); but the tracked redirect itself requires `EP_WA_COMPANY_PHONE` only (`:477`, `:500`). The public CTAs read `VITE_CONTACT_WHATSAPP_PHONE` at **build time** (`site.ts:3`); `check-required-env.mjs:35,96` fails a Vercel build without it, and `:132-134` checks `EP_WA_COMPANY_PHONE` when tracked links are on. | as listed |
| 18 | **Two channel settings are compared, not merged.** `WOZTELL_CHANNEL_ID` is the bot send/history channel (`woztell.server.ts:390`, `history-import.server.ts:5,60`) and is stamped on CRM analysis rows (`crm-analysis-runs.server.ts:24-70`, `crm-enrichment.server.ts:253-372`). `EP_WA_COMPANY_CHANNEL_ID` scopes enquiry capture, assignment, inbox, service and no-link gates (11 readers). Staff sends already require them to be equal: `staff-whatsapp-transport.server.ts:23`, `lead-alert.server.ts:156`, `whatsapp-readiness.server.ts:47` (FX-05b fact "Sends go only when `EP_WA_COMPANY_CHANNEL_ID === WOZTELL_CHANNEL_ID`"). Event rows store the channel from the signed webhook, so a wrong merge would silently stop capture rather than misroute. | as listed |
| 19 | **The `*_VERIFICATION_REF` strings are gates, not labels.** `inboxConfig()` returns `null` unless `EP_WA_INBOX_VERIFICATION_REF` and eight other values are present (`inbox-api.server.ts:20-45`); `createStaffWhatsAppTransport` throws unless `EP_WA_STAFF_WHATSAPP_VERIFICATION_REF`, `_CORRELATION_VERIFICATION_REF`, `_ASSOCIATION_REVIEW_REF` and `EP_WA_STAFF_REPLY_CONTEXT_PATH` are all set (`staff-whatsapp-transport.server.ts:9-16`); the transport's ref value is copied into service actions (`service-workflow.server.ts:272`). **Deleting a ref that is unset in production would switch a staff-WhatsApp capability on.** | as listed |
| 20 | **No-link canary values must equal other values** (`docs/runbooks/whatsapp-no-link-rollout.md:15-16`): `EP_WA_NO_LINK_CANARY_CHANNEL_ID` = `EP_WA_COMPANY_CHANNEL_ID`, `EP_WA_NO_LINK_CANARY_ACTIVATION_ID` = `EP_WA_ACTIVATION_ID`. The rollout is "VERIFICATION_BLOCKED" (`:3`), so production most likely has `EP_WA_NO_LINK_EFFECTS_ENABLED` unset (to confirm in O-3). | `no-link-rollout.server.ts:30-55,110-120` |
| 21 | **Redirect caps** are env-overridable with defaults 5000/600 (`redirect-capacity.ts:12-18`); `.env.example:193-194` sets the defaults. | as listed |
| 22 | **H-04/H-05.** Three price formats remain: `formatSaleDisplay` → `$12.68M` (`format.ts:25-28`), 萬 (`formatManDisplay`), raw digits (`site.ts:124-131`, `admin.leads.tsx`). Browser-locale dates remain at `AdminOperationsJobs.tsx:64`, `AdminOperationsAudit.tsx:38` (others moved with #238/#240/17a edits). Files shared with open branches: `format.ts` (#242 +15), `transactions.tsx` (#239, #242), `property.$listingNo.tsx` (#239, #242, #243), `admin.leads.tsx` (#238, #241, 17a), `admin.whatsapp.tsx` (#238, 17a), `admin.cms.tsx` (#240, 17a), `admin.blasts.tsx` (17a), `AdminOperationsJobs.tsx` (17a). | as listed |
| 23 | **H-07/H-18/H-20/H-08.** `StaffRole` is declared in `auth.server.ts:12` (`admin|manager|agent|viewer`) and again in 17a's new `role-permissions.ts:4`; the literal `"admin" \| "manager" \| "agent"` appears in 5 more non-test files. 11 `.server.ts` files lack the server-only marker: `ai/config`, `control-plane/{audit,health,job-handlers,jobs,migration-registry,migrations}`, `media/media-upload-repository`, `neon/admin-pagination`, `woztell/{history-import,outbound-intent}`; none of the open branches edits their first 3 lines. H-20's example is `findNeonAuthSession(...).catch(() => [])` (`auth.server.ts:114`), which turns a DB outage into "not signed in"; #241 rewrites 47 lines of `auth.server.ts`. 33 `.catch(() => null/undefined)` / empty catches remain in non-test `src`. H-08 targets `admin-data.ts`/`admin-cms.ts` validators, edited by #241, 17a-1 and 18a-1. | as listed |
| 24 | **S7 is not one directory.** `workers/mls-container/` (Worker `earnest-mls-container`, scheduled config naming `earnest-mls-runner`), `scripts/old-site-migration/` (import/crawl/discover), `scripts/mls/verify-shadow*`, `ops/systemd/`, `test:mls:cloudflare`, `check:mls:cloudflare`, the `mls:*`/`migration:*` scripts, `@cloudflare/containers`, `@aws-sdk/client-s3` (R2 evidence). **Live pieces inside those paths:** `scripts/old-site-migration/redirects.mjs` generates `src/generated/old-site-redirects.json`, which `vercel.ts:1` imports (and #239 edits `__tests__/vercel.test.mjs`); `src/lib/mls/*` is shared with the live GitHub Actions sync (`property-sync-daily.yml` runs `scripts/mls/{verify-daily-target,read-sync-authority,publish-daily-listings,verify-sync-publication,record-sync-execution}.mjs`); `/api/mls-sync` (#241 edits it) reads sync status. | as listed |

## Global Constraints

- **Owner safety rules (binding).** No production, Neon, WozTell, Vercel, GitHub-settings or Cloudflare action from a task. Owned-DB tests use only the loopback container from `withOwnedPostgres`; synthetic ids start `79190000-0000-4000-8000-`. WozTell is mocked at `src/lib/woztell/provider-fetch.ts`.
- **Behaviour that must not change** (19a, 19b, 19c-1):
  - Every public form still creates its lead; every `/w/` link still opens the **company** chat; every staff alert still goes only where it goes today.
  - The admin and public bundles render the same screens (19a deletions only remove unreachable files).
  - `vercel.ts`, `workers/cron/**`, `neon/migrations/**` untouched.
- **Migrations.** None. FX-11a's "drop `ai_knowledge_chunks.embedding`" follow-up is **not** done here (it needs a migration; the column receives NULL and costs nothing).
- **Configuration.** 19a-19b add or remove no env var. 19c removes names only through the three-step rollout below; the code half never requires a new value to be set.
- **Dependencies and lockfile.** Only 19a-2 touches `package.json` dependencies or `package-lock.json`, and only after #239 has merged; it regenerates the lockfile with `npm install` (Node 24, the npm that ships with it) from a clean `main`, never by hand-merging.
- **Avoid conflicts with open work.**

  | Work | Shared files | Rule |
  |---|---|---|
  | #238 FX-12 | `ci.yml` (`:89,:109,:164`), `workflow.db.test.mjs:97`, `service-workflow.db.test.mjs:171`, `staff-notifications.db.test.mjs:77`, `service-workflow.server.ts`, `workflow.server.ts:55`, `outbound-intent.server.ts`, `admin.leads.tsx`, `admin.whatsapp.tsx` | 19a-1/19b-1 touch none of these hunks; append CI lines only at the end of the `no-link-local-postgres` job. Everything else waits. |
  | #239 FX-13 | `package.json` deps + `:25,:32,:37,:46`, `package-lock.json`, `.env.example:37-41,:178`, `estate-pages.ts:94-919`, `docs/reports/2026-09-11-homepage-asset-redirect.md`, `scripts/old-site-migration/__tests__/vercel.test.mjs`, `vercel.ts` | No dependency, `:46` script line, `.env.example` or `estate-pages.ts` change before it merges. |
  | #240 FX-11a | `.env.example:135-147`, `health.server.ts`, `release-readiness.mjs`, `config.server.ts:5-17`, `provider.server.ts` | 19c and `generateAiText` wait. |
  | #241 FX-14 | `CLAUDE.md:53`, `auth.server.ts`, `admin-data.ts:17,749-974`, `lead-alert.server.ts`, `api.mls-sync.ts`, `vercel.ts` | B-09 edits `admin-data.ts:168-305` only. H-20 and docs wait. |
  | #242 FX-15 | `chart.tsx:225`, `format.ts`, `.env.example:101-107`, `styles.css` | `chart.tsx` waits; do not touch `styles.css` (the unused `--sidebar-*`/`--chart-*` tokens stay for FX-20). |
  | #243 FX-16 | `badge.tsx`, `styles.css`, many public routes | 19a-1 deletes no file #243 touches. |
  | 17a-1 (local) | `admin-data.ts:1888-1900`, `whatsapp-enquiries.ts:57-67`, `staff-server-fn.contract.test.mjs:173`, `admin.routes.test.mjs:498,1186`, `admin-data.contract.test.mjs:37,429+`, `assignment.db.test.mjs:120-123`, `assignment.server.ts`, `whatsapp-enquiries.server.ts:335-376`, `ci.yml:88`, `package.json:39,41,55,98,124-126` | B-09's test edit is at `admin.routes.test.mjs:889-905` (more than 300 lines away). H-16 whatsapp-enquiries names wait for 17a-1. |
  | 18a-1 plan | `admin-data.ts:515-528,1000-1046`, `admin.routes.test.mjs:230-260`, `ci.yml` after `test:lead-integrity:db`, `package.json` after `test:lead-integrity:db` | B-09 is >200 lines from both `admin-data.ts` hunks. `reorderAdminFaqs` waits. |
  | 17b/17c/18b-d outlines | `admin.leads.tsx`, `admin.whatsapp.tsx`, `admin.blasts.tsx`, assignment and campaign server files | 19d-2 dates/prices in those screens go in whichever lands later; 19c-1 rebases on them. |
- **Committing.** `git add <paths>` only; never `bun.lockb` except the one deletion commit in 19a-1. Conventional commits with a scope, ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Every PR passes** `npm run lint`, `npm run typecheck`, `npm run build`, every CI `test:*` suite, and every `playwright.admin-owned.config.ts` suite. 19a and 19b must leave the test count unchanged except for the tests they delete or add, which the PR description lists.

## Review Focus

1. **A deleted file was reachable after all** (a dynamic import, a CSS `@import`, a fixture build, or an open branch that starts using it). *Test (19a-1 Task 1):* `no deleted UI primitive is imported anywhere` (a source scan over `src`, `scripts`, `e2e`, `workers`), plus `npm run build` and the browser-fixture builds; re-run the scan on each open branch before merge.
2. **CI turns green because the new DB suites skipped.** *Test (19b-1 Task 1):* `owned DB suites refuse to skip in CI` (with `CI=true` and no database the suite fails, not skips).
3. **The env consolidation sends a WhatsApp to a different number or channel, or switches on a gated capability.** *Tests (19c-1):* `company phone resolves identically under old-only, new-only and both-names environments`; `a staff transport is still refused when any old ref was unset`; `service automation stays off when EP_WA_ENQUIRY_MODE=active and the service switch is unset`.
4. **Deleting `bun.lockb` changes how Vercel installs production.** *Gate (19a-1 Task 6):* the owner reads the "Running install command" line of the last production build before the commit is kept.
5. **The archive loses the only copy of a production readback.** *Gate (19b-2 Task 3):* every moved file's SHA-256 is listed in `docs/ARCHIVE.md` and verified present in the archive before `git rm`.

## Out of scope / follow-ups

| Follow-up | Owner | Why |
|---|---|---|
| A-02 source-text tests on WozTell identity / live agent / AI contract | the batches that own those paths (FX-12 already replaces the identity one) | Behaviour tests need the domain context of each batch. |
| Drop `ai_knowledge_chunks.embedding` | later, only with another migration | FX-19 has no migration. |
| Remove the unused `--sidebar-*` / `--chart-*` CSS tokens | FX-20 | `styles.css` is edited by #242 and #243. |
| `@cloudflare/vite-plugin`, `@tanstack/router-plugin`, `vite-tsconfig-paths`, `wrangler` have no direct import | none (keep) | Peers of `@lovable.dev/vite-tanstack-config` / CLI tools; `wrangler` deploys `workers/cron`. |
| `/w/` global 429 policy (FX-10a follow-up) | FX-13 or later | A throttling decision, not configuration. |
| Rewrite git history to drop the Maps key and infra IDs | owner, only if the repo is shared with third parties | History rewrite breaks every open branch; restricting the key is the real fix. |

---

# 19a: Delete dead weight

## PR 19a-1 (build now): unused files, dead wrappers, stray tracked files, B-13 redaction

### Task 1: Remove the 20 unused UI primitives and `use-mobile` (H-15, files only)

**Files:**
- **Delete** `src/components/ui/{aspect-ratio,breadcrumb,calendar,carousel,command,context-menu,drawer,dropdown-menu,form,hover-card,input-otp,menubar,navigation-menu,pagination,progress,resizable,separator,sidebar,toggle,toggle-group}.tsx` and `src/hooks/use-mobile.tsx`.
- **Keep** `chart.tsx` (#242) and `sonner.tsx`. **Do not** touch `package.json`, `package-lock.json`, `components.json` or `styles.css`.
- **Create** `src/components/ui/ui-inventory.test.mjs` and a new script `"test:ui-inventory": "node --test src/components/ui/ui-inventory.test.mjs"` placed directly after `"test:district"` (`package.json:23`; lines 22-24 are untouched by every open branch, while `:17`, `:19`, `:20` are edited by #242/#243), plus `- run: npm run test:ui-inventory` after `- run: npm run test:district` in `ci.yml` (no open branch edits that region).

- [ ] **Step 1: failing test** (`ui-inventory.test.mjs`): `no deleted UI primitive exists or is imported` — for each of the 21 names, assert the file is absent and that no file under `src`, `scripts`, `e2e`, `workers` contains `components/ui/<name>"` or `hooks/use-mobile`. Run: fails (files exist).
- [ ] **Step 2:** delete the files. Run the test: passes.
- [ ] **Step 3:** before committing, re-run the import scan against every open branch: `for b in <branches>; do git diff origin/main...$b | grep -E '^\+.*components/ui/(aspect-ratio|…|toggle-group)\b|hooks/use-mobile'; done` → empty.
- [ ] **Step 4:** `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:ui-inventory`, `npm run test:layout`, and every `*:ui` browser suite (they build fixtures with Vite).
- [ ] **Step 5: commit.** `chore(ui): delete 20 unused shadcn primitives and the sidebar-only use-mobile hook`

### Task 2: Remove the three unused staff-access wrappers (B-09)

**Files:**
- **Modify `src/lib/neon/admin-data.ts`:** delete `fetchStaffAccessSummaryServer` … `setStaffActive` (`:240-304`). Keep `STAFF_ACCESS_ERROR_MESSAGES`, `translateStaffAccessMessage` and `unwrapStaffAccessResponse` (`:168-238`) until 19a-2, because their test sits on `package.json:46`, which #239 edits; reword the doc comment (`:200-216`) to say the helper is kept for its unit test and goes in 19a-2.
- **Modify `src/routes/admin.routes.test.mjs:889-905`:** replace `staff access management server functions are admin-only` with `staff roles and deactivation have no browser-callable path outside admin-team` — `admin-data.ts` contains none of `fetchStaffAccessSummaryServer`, `updateStaffRolesServer`, `setStaffActiveServer`; `admin-team.ts` still exports `changeStaffRoles` and `changeStaffActive`, and its boundary still requires admin (reuse the existing admin-team contract assertion). Keep `deactivation reassigns and flips active in one transaction` (`:907+`) unchanged; the server function is live.

- [ ] **Step 1:** write the new test; it fails (wrappers exist).
- [ ] **Step 2:** delete the wrappers; it passes.
- [ ] **Step 3:** `npm run test:command-center` (runs `admin.routes.test.mjs`), `npm run test:team`, `npm run test:property-experience`, `bun test src/components/admin/AgentProfileForm.test.tsx`, lint, typecheck.
- [ ] **Step 4: commit.** `chore(admin): remove the unused browser-callable staff role and deactivation wrappers`

### Task 3: Remove the unreviewed staff-channel save wrapper (safety, H-16)

**Files:** `src/lib/neon/whatsapp-assignment.ts:60-80` (delete `saveServer` and `saveWhatsappStaffChannel`); `src/lib/neon/staff-server-fn.modules.test.ts:122` (delete the row); append to `src/lib/neon/staff-server-fn.contract.test.mjs` **at the end of the file** (17a-1 edits `:170-173`): `no browser-callable legacy staff channel save remains`.

- [ ] **Step 1:** failing test: `whatsapp-assignment.ts` does not export `saveWhatsappStaffChannel`; the only browser-callable channel save is `saveReviewedWhatsappStaffChannel`.
- [ ] **Step 2:** delete. **Step 3:** `npm run test:staff-server-fn`, `npm run test:whatsapp-enquiries`, `npm run test:staff-notifications`, lint, typecheck.
- [ ] **Step 4: commit.** `fix(whatsapp): remove the unused legacy staff-channel save that skipped provider review`

### Task 4: Stray tracked files and a duplicate orphan test (H-17, A-03)

- `git rm --cached .superpowers/sdd/progress.md .superpowers/sdd/task-4-report.md`. **The local `.superpowers/` folder and its ignore rule stay**: the current workflow writes there. The fix plan's "delete `.superpowers/`" means only "stop tracking it".
- `git rm .lovable/plan.md` (no reference in code, CI or docs other than the audit).
- `git rm scripts/acceptance/admin-no-link-journey.test.mjs` (it only re-imports a suite CI already runs).
- [ ] Verify: `git ls-files .superpowers .lovable` is empty; `ls .superpowers` still lists local files; `npm run test:no-link:local-postgres` unchanged.
- [ ] **Commit.** `chore(repo): stop tracking .superpowers and .lovable, drop a duplicate acceptance entry point`

### Task 5: Redact the scraped Maps key and the real-looking Neon IDs (B-13, code half)

**Files:** `scripts/old-site-migration/__fixtures__/property-detail-6709182.html:209` (replace the key value with `FIXTURE_REDACTED_KEY`, nothing else on the line); `src/lib/neon/disposable-test-target.test.mjs:5-9` (replace the endpoint and branch ids with synthetic `ep-fixture-0000` / `br-fixture-0000` and keep every assertion's shape).

- [ ] **Step 1:** add `no Google API key in the tree` to `src/lib/mls/mls-fixtures.test.mjs` (end of file): no file under `scripts`, `src`, `e2e`, `docs` (except `docs/reports`, handled by S6) matches `/AIza[0-9A-Za-z_-]{35}/`. It fails.
- [ ] **Step 2:** redact. It passes. `npm run test:mls`, `npm run test:migration`, the script that lists `disposable-test-target.test.mjs` (`grep -n disposable-test-target package.json`) stay green.
- [ ] **Step 3: commit.** `chore(security): redact a third-party Maps key and real Neon ids from test fixtures`

The key itself is the owner's action (O-2).

### Task 6 (gated): Delete `bun.lockb` (H-14)

**Gate:** owner action O-1 has reported which install command the last production build ran.
- If the log says `npm install`/`npm ci`: `git rm bun.lockb` and add to `.gitignore` a commented `bun.lockb` / `bun.lock` line, so a local `bun install` cannot re-add one. No `packageManager` or `engines` (Open question 2).
- If the log says `bun install`: **stop.** Production is installing from a lockfile last updated in April. Move this task to its own PR, `fix(build): install with npm on Vercel`, whose preview build must show `npm` in the log and pass the canary check before merge.
- [ ] Verify: `npm ci && npm run build` on a clean checkout; a Vercel **preview** of the PR shows the expected install line.
- [ ] **Commit.** `chore(build): delete the stale bun.lockb; npm and package-lock.json are the only installer`

**19a-1 PR checks:** lint, typecheck, build, the full CI matrix, every `playwright.admin-owned.config.ts` suite. No screenshots needed (no rendered change); state that in the PR.

## PR 19a-2 (after #239, #240, #242, 17a-1 and 18a-1 merge)

- [ ] **Dependencies.** Remove the 19 packages in fact 3 (`recharts` stays) and `chart.tsx` (fact 2) in one commit; run `npm install` on a fresh `main` checkout to regenerate `package-lock.json`; `npm ci && npm run build`; check the client bundle size in the build output is not larger. Extend `ui-inventory.test.mjs`: `package.json` lists none of the removed packages.
- [ ] **`unwrapStaffAccessResponse`**, its helpers and `admin-data.staff-access-response.test.ts` (remove the path from `test:property-experience`).
- [ ] **H-16 rest:** `getWhatsappTrackingLinks`, `provisionWhatsappLinks` (and their rows in `staff-server-fn.contract.test.mjs`), the `reorderAdminFaqs` wrapper (only if 18a has not given it a caller), `estatePhotos`/`getEstatePhoto`, `generateAiText` as an export (FX-11a follow-up), server `queueAdminCampaign` made module-private (17a follow-up; the owned campaign tests import through a test-only re-export or move to `sendAdminCampaignQueue`).
- [ ] **Orphans:** wire `scripts/staff-handoff-fixture.test.mjs` into `test:staff-notifications` (17a edits that line, so after 17a-1). `scripts/jev/`: per Open question 5 (default: delete the whole folder).
- [ ] **Not deleted:** `public/branches/lido.jpg` and its variants (fact 9) unless O-5 shows no row uses it.
- **Commit messages:** `chore(deps): remove 19 packages used only by deleted UI primitives`; `chore(admin): remove remaining dead server-function exports`.

---

# 19b: Docs and CI

## PR 19b-1 (build now, independent of 19a-1): run the Neon-only DB suites on owned Postgres

### Task 1: An owned Neon-shaped client, and no silent skips

**Files:**
- **Modify `scripts/acceptance/owned-postgres-test.mjs`:** add `export function ownedNeonSql(pool)` returning `{ query(text, params), transaction(build, options) }` with the Neon HTTP driver's shapes (`transaction` accepts a callback that receives `t.query` and returns an array of queries, or an array). Add `export async function dbTargetOrOwned(run)`: when `TEST_DATABASE_URL` is set, keep today's path (Neon + the disposable guard); otherwise `withOwnedPostgres` and `ownedNeonSql`. When `process.env.CI === "true"` and neither path is available (no Docker), throw `OWNED_DB_REQUIRED_NO_SKIPPED_PASS`.
- **Create `scripts/acceptance/owned-neon-sql.test.mjs`** (unit, no container): the adapter maps `query`, both `transaction` forms, and isolation level; wire it into a new script `test:owned-harness` placed after `test:no-link:local-postgres` and in `ci.yml` (deterministic job).

- [ ] **Step 1:** failing tests: `adapter runs a callback transaction in one BEGIN/COMMIT`; `adapter rolls back on error`; `CI without a database fails instead of skipping`.
- [ ] **Step 2:** implement. **Step 3:** run them.
- [ ] **Commit.** `test(db): an owned Postgres client with the Neon driver's shape, and no silent skips in CI`

### Task 2: Port `test:crm:db`, `test:woztell:db` and `test:property-sync:db`

**Files:** `src/lib/neon/website-inquiry.db.test.mjs`, `whatsapp-leads.db.test.mjs`, `src/lib/woztell/outbound-intent.db.test.mjs`, the 8 files of `test:property-sync:db` (no open branch touches any of them). Replace the top-level `const url = …; neon(url)` and `{ skip: !url }` with `dbTargetOrOwned(async ({ query, transaction }) => …)`. Their synthetic schemas are created inside the test, so the empty owned database is enough; where a file already uses `ownedMlsPorts`-style client ports, pass the owned ports.
- **Scripts:** add `--experimental-test-module-mocks --test-concurrency=1` where a file needs `mockOwnedServerDb`.
- **CI:** append `- run: npm run test:crm:db`, `test:woztell:db`, `test:property-sync:db` at the **end** of the `no-link-local-postgres` job (after `test:lead-alert:owned:db`), and raise its `timeout-minutes` from 10 to 20 (one container per file, about 25 s each).
- **`src/test-wiring.test.mjs:92-113`:** remove the three names from `environmentDependent`.
- **`property-sync-acceptance.yml`:** unchanged (it still offers a real-Neon run on demand).

- [ ] **Step 1:** run each suite once on owned Postgres **before** changing assertions. Any failure is a real finding: a suite nobody has run may be red because the product changed. Record each as (a) test stale → fix the test, with the reason in the commit, or (b) product bug → stop and report; it becomes its own fix, not part of 19b.
- [ ] **Step 2:** port; all green locally with Docker; `CI=true` without Docker fails (Review focus 2).
- [ ] **Step 3:** `node --test src/test-wiring.test.mjs`, lint, typecheck.
- [ ] **Commit.** `ci(db): run the CRM, outbound-intent and property-sync database suites on owned Postgres in every PR`

## PR 19b-2 (after #238, #239, #240, #241, #242, 17a-1)

### Task 1: Port `test:whatsapp-enquiries:db`, `test:staff-notifications:db`, `test:cms:db` the same way

After #238 (edits `workflow.db`, `service-workflow.db`, `staff-notifications.db`) and 17a-1 (edits `assignment.db`). `staff-notifications.db.test.mjs` already runs on owned Postgres inside `test:lead-alert:owned:db`; remove `test:staff-notifications:db` instead of porting it (one fewer script) if its file list is a subset. Leave exempt, with a one-line reason each in `test-wiring.test.mjs`: `test:control-plane:db`, `test:mls:db` (S7), `test:property-sync:private-replay:db` (private fixtures), `test:staff-notifications:e2e` (browser + DB), `test:a11y` (browser server), `test:youtube-sync:db`, `test:staff-bootstrap:db`, `test:admin-properties:db`, `test:admin:paging:db`, `test:public-performance:db`, `test:live-agent:local-db`, `test:property-sync:{publication,admin,withdrawal}:db` (a later 19b-3 can port them with the same helper).

### Task 2: Rewrite `CLAUDE.md`, `README.md`, `.env.example` (B-14, H-13)

- **CLAUDE.md:** auth = opaque Neon Auth session token looked up per request (`auth.server.ts`); "server functions are defined in 29 files; the `x.ts` / `x.server.ts` split is the rule"; tests = "105 `test:*` scripts; CI runs every one except those listed in `src/test-wiring.test.mjs`"; security headers line from #241; cron line as today; drop "17 scripts".
- **README.md:** link CLAUDE.md for conventions; one paragraph on owned-Postgres DB tests (Docker required); link the one current status page.
- **`.env.example`:** keep every variable the code reads; group by "required in production", "WhatsApp" (as left by 19c-1, both names documented until 19c-2), "operator-only"; remove names nothing reads. Add a test to `scripts/check-required-env.test.mjs`: `every non-VITE env var read in src/ or scripts/ is documented in .env.example, and every documented name is read somewhere` (with an allowlist for Vercel-provided names).
- **CHANGELOG.md:** already restarted (fact 14); add the FX-19 entries only.

### Task 3: Archive the 314 doc and evidence files (S6)

1. **Owner chooses the destination** (Open question 4). Default: a new private GitHub repository `earnestproperty-records` created by the owner.
2. **Keep in this repo:** `docs/runbooks/`, `docs/deployment/`, `docs/audits/2026-10-*.md`, `docs/audits/fx-plans/`, `docs/mls-production-activation.md` (until S7), `docs/client-feedback-20260907-ledger.md` (read by a test), `docs/woztell-activation.md`, `docs/production-activation-status.md` (rewritten as the one current status page), `docs/reference/`.
3. **Move:** `docs/reports/**` (182), `docs/superpowers/**` (103), `docs/audits/astra-*` (29), `.audit-20260905/`, `docs/codex/`. Before `git rm`, write `docs/ARCHIVE.md` listing every path, its SHA-256 and the commit it was archived from; the owner confirms the archive holds every hash (Review focus 5). The 73 readback/production/evidence files are copied first and checked by hash individually.
4. **Redirect writers:** `final-remediation.mjs` and the two `scripts/media/*` writers write to `artifacts/` (gitignored) instead of `docs/`.
5. **Comments** that cite `docs/superpowers/plans/*` (8 files) are changed to "archived: see docs/ARCHIVE.md".
6. Nothing is lost: every file also stays in this repo's Git history.

### Task 4: B-13 owner half is listed in O-2; the docs half is covered by the archive (fact 13).

**Commits:** `docs: rewrite CLAUDE.md, README and .env.example to match the code`; `docs: archive 314 evidence and planning files to the owner's private record store`; `ci(db): run the WhatsApp enquiry and CMS database suites on owned Postgres`.

---

# 19c: WhatsApp env consolidation (S3)

**Rule (owner priority 2).** Each merge below is behaviour-preserving **only if** the owner's readback (O-3) shows the stated precondition. If a precondition fails, that row is **dropped**, not adapted. Order for every row:
1. **19c-1 (code):** read the new name, fall back to the old name; log once per cold start `[wa-config] legacy_name_in_use` with the **name only**. Health shows 「舊設定名稱仍在使用」 for admins.
2. **Owner:** sets the new value in Vercel (Production and Preview), redeploys, checks health.
3. **Owner, ≥ 7 days later with no `legacy_name_in_use` log:** deletes the old names in Vercel.
4. **19c-2 (code):** stops reading the old names; `.env.example` and the tests lose them.

## The before/after table

Readers are non-test code on main `1216ab8d`. "Keep" means unchanged.

| # | Variable today | Readers (file:line) | After | Precondition the owner must confirm (O-3) |
|---|---|---|---|---|
| 1 | `EP_WA_COMPANY_PHONE` | `whatsapp-enquiries.server.ts:72,285,477,500`; `check-required-env.mjs:132-134` | **Merged into `VITE_CONTACT_WHATSAPP_PHONE`** | **Owner confirms the two values are the same WhatsApp number, and that it is the number of the WozTell company channel.** If they differ, the row is dropped: the public CTAs (build-time) and the tracked `/w/` links (runtime) must then stay separate, because merging would send public visitors into the WozTell inbox or send `/w/` customers to a phone WozTell does not see. |
| 2 | `EP_WA_COMPANY_CHANNEL_ID` | `inbox-directory.server.ts:49`; `staff-mapping-review.server.ts:36`; `whatsapp-enquiries.server.ts:36`; `assignment.server.ts:156,225`; `no-link-rollout.server.ts:41,118`; `service-workflow.server.ts:25`; `staff-notifications.server.ts:31`; `workflow.server.ts:110`; `inbox-api.server.ts:27`; `check-required-env.mjs:126-129` | **Merged into `WOZTELL_CHANNEL_ID`** | **Owner confirms in WozTell that both are the same channel** (Channels → Channel Info), and a read-only query shows every recent `whatsapp_enquiry_events.channel_id` and active `whatsapp_staff_channels.channel_id` equals that value. If not, dropped: staff sends already refuse when they differ (fact 18), and merging would change which channel enquiries are captured from. |
| 3 | `EP_WA_ROUTING_ENABLED` | `assignment.server.ts:297,326`; `workflow.server.ts:78` | **Removed:** routing is on exactly when `EP_WA_ENQUIRY_MODE=active` | Production has `EP_WA_ENQUIRY_MODE=active` **and** `EP_WA_ROUTING_ENABLED=true` (recorded 2026-09-12). |
| 4 | `EP_WA_TRACKED_LINKS_ENABLED` | `whatsapp-enquiries.server.ts:41`; `check-required-env.mjs:122` | **Removed:** links are on when mode is `observe` or `active` | Production has it `true` with mode `active`. If any environment needs links **off** while capture is on, dropped. |
| 5 | `EP_WA_SERVICE_AUTOMATION_ENABLED` | `service-health.server.ts:35`; `service-workflow.server.ts:23`; `workflow.server.ts:111` | **Keep** (not collapsed) | Production has it `false`. Collapsing into `active` would **start sending automated service/survey messages to customers**. Open question 7 offers removing the feature instead. |
| 6 | `EP_WA_REDIRECT_GLOBAL_SHARD_PER_MIN` | `redirect-capacity.ts:15` | **Removed:** hard-coded 5000 | Unset in production, or set to 5000. |
| 7 | `EP_WA_REDIRECT_LINK_PER_MIN` | `redirect-capacity.ts:16` | **Removed:** hard-coded 600 | Unset, or 600. |
| 8 | `EP_WA_INBOX_VERIFICATION_REF` | `inbox-api.server.ts:23` | **Removed** (presence check dropped) | Set in production today (pilot recorded 2026-09-12). If unset, dropped: removing it would switch the Inbox API on. |
| 9 | `EP_WA_STAFF_WHATSAPP_VERIFICATION_REF` | `staff-whatsapp-transport.server.ts:9` | **Removed**; the transport's `verificationRef` becomes the constant `"env-config"` (still copied by `service-workflow.server.ts:272`) | Set in production. If unset, dropped: removing it would enable direct staff WhatsApp sends. |
| 10 | `EP_WA_STAFF_CORRELATION_VERIFICATION_REF` | `staff-event-isolation.server.ts:28`; `staff-whatsapp-transport.server.ts:12` | **Removed** | Set in production; same reason. |
| 11 | `EP_WA_STAFF_ASSOCIATION_REVIEW_REF` | `staff-whatsapp-transport.server.ts:13` | **Removed** | Set in production; same reason. |
| 12 | `EP_WA_NO_LINK_CANARY_CHANNEL_ID` | `no-link-rollout.server.ts:42` | **Removed:** reads `EP_WA_COMPANY_CHANNEL_ID` (row 2 → `WOZTELL_CHANNEL_ID`) | Unset in production, or equal to the company channel (runbook `:15` requires equality). |
| 13 | `EP_WA_NO_LINK_CANARY_ACTIVATION_ID` | `no-link-rollout.server.ts:43` | **Removed:** reads `EP_WA_ACTIVATION_ID` | Unset, or equal to `EP_WA_ACTIVATION_ID` (runbook `:16`). |
| 14 | `VITE_CONTACT_WHATSAPP_PHONE` | `site.ts:3`; `whatsapp-enquiries.server.ts:72,285`; `check-required-env.mjs:35,96` | **Keep** (absorbs row 1) | — |
| 15 | `WOZTELL_CHANNEL_ID` | `woztell.server.ts:390`; `history-import.server.ts:5,60`; `staff-whatsapp-transport.server.ts:23`; `lead-alert.server.ts:156`; `whatsapp-readiness.server.ts:47`; `health.server.ts:88`; `crm-analysis-runs.server.ts:24-70`; `crm-enrichment.server.ts:253-372`; `api.admin.woztell.backfill.ts:10`; `check-required-env.mjs:39`; `release-readiness.mjs:17,23` | **Keep** (absorbs rows 2, 12) | — |
| 16-34 | **Keep:** `WOZTELL_ENABLED`, `WOZTELL_CHANNEL_SECRET`, `WOZTELL_BOT_ACCESS_TOKEN`, `WOZTELL_OPEN_API_TOKEN`, `WOZTELL_APP_ID`, `EP_WA_ENQUIRY_MODE`, `EP_WA_ACTIVATION_ID`, `EP_WA_STAFF_NOTIFICATIONS_ENABLED`, `EP_WA_STAFF_ALERT_TEMPLATE`, `EP_WA_INBOX_INTEGRATION_ID`, `EP_WA_INBOX_SIGNATURE`, `EP_WA_INBOX_{LIST_THREADS,LIST_USERS,ASSIGN,INTERNAL_MESSAGE}_URL`, `EP_WA_STAFF_REPLY_CONTEXT_PATH`, `EP_WA_NO_LINK_EFFECTS_ENABLED`, `EP_WA_NO_LINK_CANARY_STAFF_IDS`, `EP_WA_TEST_INBOX_MEMBER_ID` | as in facts 16-21 | Keep | Secrets, real switches, or values with no other source. `EP_WA_SERVICE_AUTOMATION_ENABLED` is row 5. |

**Net:** 34 → 21 if every precondition holds (−13: rows 1-4 and 6-13). The fix plan's "about 35 → about 12" is not reachable without removing the Inbox, no-link and service-automation features themselves (Open questions 6 and 7).

## PR 19c-1: read both names (after #238 and 17a-1 merge, and after O-3)

**Files:** a new `src/lib/whatsapp-enquiries/wa-config.server.ts` with one function per merged value (`companyPhone()`, `companyChannelId()`, `trackedLinksEnabled()`, `routingEnabled()`, `noLinkCanaryChannelId()`, `noLinkCanaryActivationId()`, `staffTransportVerified()`, `inboxVerified()`), each returning the new source when set, else the old name, else today's default, and logging `legacy_name_in_use` once. Every reader in the table calls these instead of `process.env`. Rows whose precondition failed are left out of the PR. `check-required-env.mjs` accepts either name. `.env.example` documents the new name and marks the old one "deprecated, still read until 19c-2".

- [ ] **Step 1: failing tests** (`src/lib/whatsapp-enquiries/wa-config.test.mjs`, env restored key by key):
  - `company phone resolves identically under old-only, new-only and both-names environments` (both names set with **different** values → the old name wins in 19c-1, so nothing changes until the owner deletes it).
  - `companyFallbackLocation and resolveTrackingLinks never return a number that is not one of the two env values` (FX-10a's rule kept).
  - `routing is on only when mode=active, and EP_WA_ROUTING_ENABLED=false still turns it off in 19c-1`.
  - `service automation stays off when mode=active and the service switch is unset`.
  - `a staff transport is still refused when any old ref was unset` (19c-1 does not drop the presence checks; 19c-2 does, only for rows the owner confirmed).
  - `the legacy-name log carries the variable name only, never a value`.
  - Run `npm run test:whatsapp-enquiries`, `npm run test:staff-notifications`, `npm run test:woztell`. They fail.
- [ ] **Step 2:** implement. **Step 3:** those suites plus `test:no-link`, `test:lead-alert:owned:db`, `test:woztell:owned:db`, `test:whatsapp-safety:ui`, `test:contact`, lint, typecheck, build.
- [ ] **Commit.** `refactor(whatsapp): read consolidated WhatsApp settings with a fallback to the old names`

## PR 19c-2: drop the old names (after O-4)

Delete the fallbacks and the presence checks for confirmed rows; update `.env.example`, `check-required-env.mjs`, `release-readiness.mjs`, the readiness/health copy and the tests. **Commit.** `refactor(whatsapp): stop reading the retired WhatsApp setting names`

---

# 19d: Code consistency

## PR 19d-1 (after #238, #240, #241, 17a-1, 18a-1)

- [ ] **H-18:** add `import "@tanstack/react-start/server-only";` as line 1 of the 11 files (fact 23). Test: extend `staff-server-fn.contract.test.mjs` (end of file) `every *.server.ts starts with the server-only marker`. `npm run build` proves no client imports them.
- [ ] **H-07:** one `export const STAFF_ROLES = ["admin","manager","agent","viewer"] as const` in `role-permissions.ts` (17a's pure module); `StaffRole` derived from it in `auth.server.ts`; replace the 5 duplicate literal unions. Inline `roles.includes("admin")` checks stay (234; changing them is churn, not safety).
- [ ] **H-20:** `findNeonAuthSession` and the other auth/DB `.catch(() => null/[])` log `[auth] session_lookup_failed` with the error class only and rethrow as a 503, so a DB outage shows 「系統暫時無法連線」 and not the sign-in page. Test (`auth.server.test.mjs`, created by #241): `a database error during session lookup is a 503, not 401`. Leave catches that are a deliberate fallback (documented in a comment) alone; list each kept one in the PR.
- [ ] **H-08:** Zod for staff **mutations** in `admin-data.ts`/`admin-cms.ts` still using `(data: T) => data`, in the order: leads, transactions, CMS, campaigns (17b owns the campaign save validator; skip it if 17b has it). Each gets a `rejects an unknown key` contract test.

## PR 19d-2 (after #238, #242, #243, 17a-1; needs D8)

- [ ] **H-04 (D8):** one `formatPrice(price, { dealType })` in `format.ts` → `HK$1,268萬` for sale, `HK$38,000／月` for rent; `formatSaleDisplay` becomes an alias, then is removed. Replace the three formats (fact 22) and the WhatsApp prefill (`site.ts:124-131`). Screenshots at 375 and 1440 of a listing card, a listing page, `/transactions` and the admin lead row. **[owner copy]**: visible format change.
- [ ] **H-05:** `formatHkDateTime` in `AdminOperationsJobs.tsx:64`, `AdminOperationsAudit.tsx:38` and any remaining `toLocaleString()` on a date in admin code. Test: `operations dates render in Asia/Hong_Kong under an en-US locale`.

## PR 19d-3 (S7, after O-6 and #241)

- [ ] **Step 0 (gate):** the owner's written Cloudflare confirmation is in the PR description: no deployment, cron trigger, workflow or Durable Object for `earnest-mls-container` / `earnest-mls-runner`, and no R2 bucket the team still needs (or the owner keeps the bucket and says so). **No file is deleted before this.**
- [ ] **Step 1: inventory by import graph**, starting from the live entry points: `vercel.ts`, every `src/routes/*`, `workers/cron/src/index.ts`, every `scripts/*` invoked by `.github/workflows/*.yml`, and every `package.json` script kept. Anything not reachable and inside `workers/mls-container/`, `scripts/old-site-migration/` (except `redirects.mjs`, its test, `__tests__/vercel.test.mjs` and the fixtures still read by `src/lib/mls/*.test.mjs`), `scripts/mls/verify-shadow*`, `ops/systemd/`, `src/lib/mls/r2-reporting.mjs` is deleted. Expected about 19k lines incl. tests (audit H-12).
- [ ] **Step 2:** remove `test:mls:cloudflare`, `check:mls:cloudflare`, `mls:shadow`, `mls:legacy-sync`, `mls:dry-run`, `mls:import`, `migration:{discover,crawl,import}` and their `ci.yml` lines; drop `ops-contract.test.mjs` assertions about the container and systemd but keep its `workers/cron` assertions; remove `@cloudflare/containers` and `@aws-sdk/client-s3` if unreferenced; remove the `MLS_*`, `CLOUDFLARE_*`, `DATABASE_URL_UNPOOLED` entries from `.env.example` that only the container read; archive `docs/mls-production-activation.md`.
- [ ] **Step 3:** full CI, `test:property-sync*`, `test:migration`, `npm run build` (the redirects JSON still imported by `vercel.ts`), and a dry run of the daily sync workflow's Node scripts with `--help`.
- **Commit.** `chore(mls): retire the legacy Cloudflare MLS container and old-site import path`

---

## Owner actions

**Order:** 19a-1 and 19b-1 can merge as soon as CI is green (O-1 gates only Task 6). Then, as the open PRs merge: 19a-2, 19b-2, 19d-1, 19d-2. 19c and 19d-3 wait for the owner steps below.

- **O-1 (before 19a-1 Task 6, 2 minutes, read-only).** Vercel → project → Deployments → the latest Production deployment → Build Logs: copy the line that starts `Running "install" command` (or "Detected … lockfile"), and the Node.js version shown in Project Settings → General. No change.
- **O-2 (B-13).** In Google Cloud Console, check whether the Maps Embed key from the old website belongs to an Earnest project. If it does: restrict it to HTTP referrers of the old domain and to the Maps Embed API only, or rotate it if the old site is gone. If it belongs to the old-site vendor, tell them it is in a repository. Do not paste the key anywhere.
- **O-3 (before 19c-1, read-only).** For Production and Preview in Vercel, report for each variable in the 19c table: set or unset, and for non-secret values (the booleans, mode, caps, the two phone numbers, the two channel IDs) whether they are **equal** to each other. Confirm in WozTell → Channels → Channel Info that the company channel and the bot channel are the same channel. I prepare one read-only SQL for the Neon console: distinct `channel_id` in `whatsapp_enquiry_events` and `whatsapp_inbound_receipts` for the last 30 days and in active `whatsapp_staff_channels`. Nothing is changed.
- **O-4 (after 19c-1 deploys).** Set each new value (only for confirmed rows), redeploy, check 系統健康 and that one tracked `/w/` link on a test listing opens the company chat on your own phone. After 7 days without `legacy_name_in_use` in the Vercel logs, delete the old names; then 19c-2 merges.
- **O-5 (optional, read-only).** `SELECT slug, photo FROM branches;` If no row uses `/branches/lido.jpg`, 19a-2 may delete it and its variants; otherwise it stays.
- **O-6 (before 19d-3, read-only).** In Cloudflare → Workers & Pages and → Containers/Workflows: confirm `earnest-mls-container` and `earnest-mls-runner` have no active deployment, cron trigger or binding, and say whether its R2 evidence bucket is still wanted.
- **O-7 (19b-2).** Create the private archive repository (or name the other location) and give the team write access.

**After each deploy:** canary of public pages and read-only admin views; update the audit Status column and `CHANGELOG.md`.

**Rollback:** revert the PR. 19a/19b/19d revert cleanly (no data, no settings). For 19c, the old names keep working until 19c-2, so rollback before then is just "revert 19c-1"; after 19c-2, restore the old names in Vercel **and** revert both PRs.

## Open questions

Each has a default; I use it unless the owner says otherwise.

1. **Who reads the Vercel build log (O-1)?** Default: the owner, before 19a-1 Task 6; without it, Task 6 moves to 19a-2.
2. **Add `packageManager` and `engines`?** Default: **neither.** `engines.node` overrides the Node version Vercel runs production on, so it is not "no runtime change"; add it only to match the version O-1 reports, in its own commit.
3. **Port the remaining exempt DB suites (19b-3)?** Default: yes, after 19b-2, with the same helper; `test:control-plane:db`, `test:mls:db` and the private replay stay exempt.
4. **Where does the S6 archive go?** Default: a new private GitHub repository owned by the owner (history, search, access control). Alternatives: the owner's Google Drive as a zip plus `docs/ARCHIVE.md`; or `docs/archive/` in this repo (no exposure gain).
5. **`scripts/jev/` (JEV copilot pilot, unwired).** Default: delete the folder in 19a-2; the pilot lives on branch `codex/jev-copilot-pilot`.
6. **Hard-code the four WozTell Inbox URLs from the integration id?** Default: **no**, keep them; they are tenant-pinned and verified per URL.
7. **Service automation (customer surveys) is off in production.** Default: keep the switch. Alternative (fewer settings): delete the feature and the switch in a later PR.
8. **If row 1 or row 2 fails its precondition**, default: drop that row and document in `.env.example` why the two settings differ.
9. **`lido.jpg`.** Default: keep unless O-5 shows it unused.

## Findings that differ from the approved fix plan

1. **The env consolidation cannot fold every boolean into `EP_WA_ENQUIRY_MODE`.** Production runs `active` with service automation **off**; folding that switch would start automated customer messages. The `*_VERIFICATION_REF` strings are capability gates, not labels: deleting one that is unset would switch staff WhatsApp sends or the Inbox API on. 19c therefore merges only rows whose production value already matches, after an owner readback, and lands at about 21 variables, not 12.
2. **"Delete `bun.lockb`, add `packageManager` and `engines`" is not runtime-neutral.** Vercel has no `installCommand`, so which installer production uses depends on the lockfiles; `engines.node` would override the production Node version. The "modified `bun.lockb`" in every worktree is a Windows stat quirk (same blob as HEAD), not evidence. 19a-1 deletes the file only after one owner readback and adds neither field by default.
3. **The four named DB suites cannot simply be "added to the docker job":** they talk to Neon over HTTP, require a `*.neon.tech` disposable database, and **skip** without one, so CI would pass vacuously. 19b ports them to owned Postgres with a Neon-shaped adapter and makes a skip in CI a failure.
4. **Some "dead" items are live:** `lido.jpg` is the seeded `branches.photo` that `/about` renders; `ops/systemd` is read by a CI test (it moves to S7); `scripts/old-site-migration/redirects.mjs` feeds `vercel.ts`; B-09's server functions are used by the staff-lifecycle path (only the three browser wrappers are dead); `chart.tsx` is edited by #242.
5. **One "dead export" is a safety issue:** `saveWhatsappStaffChannel` is a browser-callable legacy staff-routing write that skips provider review. It is removed in the build-now slice, not left for later.
6. **`.superpowers/` is not deleted;** only its two tracked files are untracked. **CHANGELOG** has already been restarted. **B-13's key** is an old-site Google Maps Embed browser key; redaction in HEAD is done here, but restriction or rotation is the owner's, and it stays in Git history.
7. **FX-19 is nine slices, not four PRs,** because 19a's deletions, 19b's docs and 19c's readers overlap with #238 to #243, 17a-1 and 18a-1. Only 19a-1 and 19b-1 are clash-free today.
8. **19 dependencies, not about 15,** are removable; they wait for #239, the only open branch that changes `package.json` dependencies and `package-lock.json`.
