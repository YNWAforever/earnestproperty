# Independent review: Tasks 9 and 11, with Task 8 query follow-up

Reviewed 2026-09-06 in `audit-20260905`. Source review only; no provider, database, deployment or full-build action. Root separately reports real Chromium keyboard 2/2 and approved disposable migration/integration results; those were not independently rerun here.

## Findings

1. **P2 — GA4 readiness inventory disagrees with runtime gates.** `scripts/operations/release-readiness.mjs` accepts measurement IDs with 5–20 trailing characters and reports enabled based on that alone. Runtime accepts 10–16 and additionally requires `VITE_GA4_MANUAL_EVENTS_CONFIRMED=true`. An invalid ID or absent manual-events confirmation therefore produces an enabled inventory while tracking deliberately remains disabled. Align the validator and list/check the confirmation variable; cover absent/false flag and both invalid length boundaries. Sent to root for correction.

2. **P2 — Similar listings can repeat the current canonical offering.** `src/lib/neon/public-data.server.ts:739` removes only `p.id = excludeId` before canonical ranking. Given source rows A and B for the same canonical property and deal type, viewing A removes A then ranks B first, displaying the current offering as a similar listing. Exclude the current offering's full canonical identity, preserving the existing listing-number fallback for null/empty identifiers and deal-type distinction. Add a fixture with duplicate rows for the viewed offering plus a genuinely different offer; the existing real-DB pagination fixture does not exercise this query. Sent to root for correction.

## Release evidence gaps

The packet evaluator is a structural checklist, not provider verification or release authorization. It correctly requires matching 40-character commits, passed status and HTTPS evidence URLs without credentials/query/hash; missing evidence fails closed. Its result always retains `productionAuthorized:false`. Configuration outputs contain variable names, source labels and presence only; credential values do not appear. Freshness requires successful-run and content-observed timestamps independently, rather than listing dates.

At review time the packet has no explicit positive provider-verification or MLS/YouTube freshness gate: `providerFailures` covers a different acceptance concern and `summarizeFreshness` is standalone. The release runbook and final status must keep missing provider/freshness verification explicit; preferably require separate evidence fields before reporting review-ready. Inventory is expressly limited to current-process environment, so it does not establish deployed Preview/production configuration. The incoming runbook was not present during this pass.

## Task 9 findings and limits

No concrete blocker found in `LiveAgentWidget`, `LiveAgentLauncher`, `PrivateAuthProvider`, root lazy provider mounting or the document-isolation helper. The nonmodal Radix dialog focuses its input, uses a real title, retains the mounted trigger for Escape focus return, and preserves unsent state across close/reopen. Lazy-load failure offers retry. The two viewport keyboard regressions cover the reproduced interaction and overflow without real message submission.

Document isolation compares destination classification to the original document entry, not history's updated address. Crossing public/private boundaries requests a fresh document; preload is exempt. Private auth UI remains lazily wrapped on private routes. This source result and keyboard acceptance do not substitute for the plan's account/reset-link, back-navigation, listing/filter/gallery/saved-listing, form validation, authenticated editing and full accessibility journeys.

Task 8 optional similar/transaction/branch failures independently degrade after the primary property status/existence gate; primary database failure is not converted into a false successful property response. Search canonical deduplication precedes both counts and pagination, with stable ID tie-breaking and distinct sale/rent identities. Count and row reads explicitly use separate snapshots. Estate option invalidation prevents an older in-flight result from repopulating the new cache generation.

## Independent local verification

`node --test scripts/operations/release-readiness.test.mjs src/lib/route-isolation.test.mjs`: **5 passed, 0 failed, 0 skipped**. These are local pure tests, not live provider, deployment, browser or migration evidence.

## Task 8 finding correction

The similar-listing query now excludes the viewed offering's canonical identity and deal type inside the candidate filter, before ranking and LIMIT. Null/empty canonical values use the same namespaced listing-number fallback as canonical grouping. A physical-ID exclusion remains defensive. Viewing either source of a duplicated offering therefore cannot promote the other source into similar results; a different deal type remains a separate offering.

The new query regression failed on the old SQL and passed after this change. Focused listing-search and corridor tests: **43 passed, 0 failed, 0 skipped**. The real PostgreSQL fixture now checks both source IDs of the current offering, null/empty fallback duplicates, a distinct offering, and opposite-deal preservation. This agent did not execute that expanded database fixture; root must run it against the already approved disposable target. No new migration or provider action is needed.
