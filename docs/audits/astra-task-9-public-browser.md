# Task 9 — public browser acceptance supplement

Executed Chromium Playwright against local Vite8080 backed by the explicitly approved disposable Preview branch. Provider/publishing/GA flags were disabled by the parent. Every browser test also aborts every non-GET/HEAD/OPTIONS request, so no real form submission or provider write can occur.

Added `e2e/public-acceptance.spec.ts` (11 cases). Final evidence is split across two runs: the nine accessibility/navigation/form cases passed in the full rerun, then both corrected listing/gallery cases passed in a targeted rerun. **All 11 current cases have passing browser evidence; no remaining fixture skips.** This is not a claim that the final file was run as one combined eleven-case batch.

Covered:
- Mortgage, contact and listings at390px/1440px: HTTP200, no horizontal overflow, zero axe violations in app-owned markup (third-party iframes excluded).
- Mobile menu opens by Enter, retains keyboard focus inside, closes on Escape and restores its trigger.
- Empty contact form focuses required name and makes no application POST.
- Valuation submit remains disabled without consent; after consent an empty form focuses the required name and makes no application POST.
- Sale listing minimum-price filter applies, search saves locally, saved-search popover opens, second result page opens and browser Back restores the filtered URL/input.
- Gallery discovers up to eight actual property links to find multiple images. Enter advances the labelled photo state; ArrowLeft restores it. No overflow.

Reproduced and fixed real accessibility findings: mobile StickyWhatsAppBar white text on green#25D366 measured1.98:1 contrast; changed to dark green#08783f with darker hover, and made the bar a labelled aside landmark. Listing card h3 skipped a heading level on mobile; changed both display variants to h2 without changing visual styles. The six page/viewport axe scans passed after these changes. Focused ESLint passed for the test and affected components.

Initial run was5passed/6failed. Three failures were the above real mobile axe defects; the other interaction cases needed hydration readiness, and the saved-search locator had to include its newly rendered count ('已儲存搜尋 1'). Those test corrections preserve behavioral assertions. The second full run was9passed/1locatorfailure/1fixture skip; the final targeted run was2passed with a discovered multi-image fixture.

Limits: Chromium only, local development serving and a single disposable dataset; not staging latency/load evidence. Valid-success form submissions, authentication, outbound delivery and production data were deliberately not exercised. The fixture-dependent tests explicitly skip with a reason if future runs lack enough listings or multi-image properties; they did not skip in the final targeted run.

Final root integration: all11public cases plus2chat and1private-document-boundary case passed together(14/14) on the optimized production build. The subsequent sole visual change corrects homepage hero sizes; that homepage was measured separately.
