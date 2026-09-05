# Astra Tasks 7–11 development handoff

Date: 2026-09-06. Branch: `codex/astra-tasks-7-11`, based on merged PR #112 (`b1e9f9a`, identical tree to `6d5c016`). Source implementation and local/disposable verification are delivered. **Production release remains NO-GO.** The task plan's external acceptance gates are not marked complete.

| Task | Delivered | Remaining acceptance |
| --- | --- | --- |
| 7 | Authorized server filters, stable cursor pages capped at50, complete CMS tab retrieval, older/new message separation and bounded outbound status refresh; measured indexes | Authenticated staging endpoint p50/p95, query/response measurements |
| 8 | Responsive images, narrow card queries, canonical dedup before pagination, cached estate options with publication invalidation, isolated secondary queries, deferred auth/chat, local variable font | Same-host historical live baseline comparison and field vitals |
| 9 | Radix nonmodal chat focus/Escape/draft recovery; mobile navigation; forms, saved search, page2/Back and gallery tests; contrast/landmark/heading corrections | Approved staging staff account/site, authenticated CMS/CRM/inbox workflows and video fixtures |
| 10 | GA4 public-only gated adapter, strict PII validation, first-touch attribution, persisted inquiry conversion dedup, lifecycle Web Vitals and authorized operational dashboard | Stream ID/settings confirmation, controlled staging conversion and real payload inspection, GA reporting credentials/import, field monitoring |
| 11 | Configuration presence inventory, exact-commit evidence completeness checks, freshness classification, two-schema migration verification and release/rollback runbook | Provider positive evidence, MLS/YouTube live freshness, staff performance, backup/restore proof, recipients, monitoring owner and concrete production approval |

## Verification

- All33 deterministic `test:*` scripts passed. One media metadata test timed out at5seconds while running concurrently with the build; its unchanged isolated rerun passed12/12 in2.63seconds. The final results ledger preserves the initial timeout. This is a suite-by-suite result, not a claim of one uninterrupted green matrix.
- Typecheck and production build passed. Scoped ESLint passed for70 changed source files with only `endOfLine:auto` to handle the Windows checkout. The Linux repository-wide ratchet is a separate CI gate.
- Optimized production build:14/14 Chromium browser cases passed in one run. Chat390/1440, public/private document transition including Link preload and Back, six public route/viewport axe+overflow checks, mobile menu keyboard, contact/valuation invalid forms, saved search/filter/page2/Back and multi-image gallery. Requests that could write are aborted. Actual GA4 is disabled, so browser absence checks complement the fake-sink privacy tests; they do not prove configured-provider behavior.
- Approved Neon target only: project `dawn-meadow-79190048`, branch `br-quiet-hat-aoxbj2ue` (Preview, Singapore). All38 migrations applied to representative `neondb` and empty `astra_empty_20260905`; zero pending migrations and zero unvalidated public constraints. The empty database intentionally receives22 seeded estates. No production database mutation.
- Real disposable tests passed: bootstrap1, inquiry/CRM1, CMS16groups, outbound intent3, canonical paging/similar-query1 and the large admin paging fixture (10,000 contacts/leads,1,000 content records,100,000 messages). Isolated schemas cleaned. Empty migration database retained on the approved expiring Preview branch for review.
- Latest admin message index EXPLAIN24.89ms and20warm database-HTTP samples p95=144ms. These are database measurements, not the authenticated staging endpoint500ms budget.
- Operational report SQL executed read-only on Preview: complete five-day series with date/count-only columns and valid nonnegative counts.

## Transfer and visual evidence

Three fresh Chromium contexts per optimized build,390×844, no throttling, networkidle, sum resource.transferSize excluding the document and opaque cross-origin resources. Same Preview data, region and local serving method: baseline6,528,165bytes → final3,131,530bytes (**52.03% reduction**),107→78resources, no horizontal overflow. The mobile hero uses1440w after screenshot review caught an undersized cover candidate. Font appearance and hero layout were inspected at390px; the sticky CTA intentionally has darker accessible contrast.

The original live baseline was4,880,833bytes. The final local number is35.84% lower, but local hosting does not share that deployment's compression/cache/data conditions. **The original same-host live50% target remains unverified.** No field LCP/INP/CLS compliance is claimed. Narrow listing-card fixture serialization reduced3190→714bytes(77.62%). See `astra-task-8-transfer.json` and the task-specific reports.

## Release status

The configuration inventory describes local process presence, not deployed credentials or successful provider behavior. GA4 remains disabled without both its valid stream ID and manual-events confirmation. No real provider sends, publication, production migrations or production deployment were performed for Tasks7–11.

`astra-release-evidence.incomplete.json` deliberately fails readiness; `astra-task-11-runbook.md` lists the exact remaining evidence and staged release/rollback procedure. Earlier Tasks3B editorial lifecycle and Task6 sales/consent policy decisions remain outside these new changes. A prior merged PR or prior CI success is not evidence for this new release commit.

Automatic approval review rejected repository graph indexing because the private source destination was unverified. Local source inspection was used instead; this did not block implementation.
