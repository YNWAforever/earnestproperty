# EPRC market registered transactions implementation plan

> Use superpowers:executing-plans to implement this bounded change inline, with a final branch review.

**Goal:** Implement issue #283: a separate public「市場註冊成交」section on the 22 estate pages.

**Spec:** https://github.com/YNWAforever/earnestproperty/issues/283 and the user's option 2 decision.

**Architecture:** Preserve the supplied CSV byte for byte as a versioned fixture. Parse it into typed market records and resolve EstateQuery using registry names/aliases. A Vite raw import supplies the static snapshot; an independent component receives market data only. Leave agency transaction queries, tables, admin and charts unchanged.

**Scope:** Read the issue and repo; change fixture, content, public component, route integration and tests; open a PR against main and observe CI/preview. No agency-data writes, production apply or merge.

## Constraints and review focus

- Exactly 107 records and 22 covered estates; the six named empty estates retain empty sections.
- Resolve registry aliases exactly (case/whitespace normalized); no fuzzy matching. Unknown names are excluded and listed by a test.
- Instrument dates parse as DD/MM/YYYY, not US dates; sorting is newest first. Preserve ASP and P-ASP rows independently.
- Missing `-` values become null; retain leading-zero floors/units. Never fabricate area, psf or price.
- Display at most eight rows, source EPRC 註冊成交, snapshot date and count; label price in $M and area/psf basis explicitly.
- Unknown/uncovered estates receive no market section. Agency queries remain unrelated to market content.

## Task 1: Typed static content and mapping

- [x] Commit the exact issue CSV under src/content/fixtures/eprc-transactions-22-estates-20261027.csv.
- [x] Add failing Node tests for 107 rows, all estate mappings, unmapped names, date ordering, missing values, preserved nature and the six empty estates.
- [x] Implement src/content/eprc-transactions.ts (pure parser/index) and src/content/eprc-transactions-snapshot.ts (raw fixture wiring).
- [x] Run the content tests; expect all pass.

## Task 2: Separate public UI and regression guards

- [x] Add failing rendered-component tests for source/fields, eight-row cap, null values, empty/unknown estates, and an agency-query isolation contract.
- [x] Implement EstateRegisteredTransactions and render immediately after EstateMarketSnapshot in estate.$slug.tsx, passing only the separate static market snapshot.
- [x] Wire tests into an existing CI test script. Keep fetchEstateTransactions(estate.id, 8) and EstateMarketSnapshot unchanged.
- [x] Run relevant content, component and agency contract suites, typecheck, lint and build; expect success.

## Task 3: Review and delivery

- [x] Review diff against #283, including fixture fidelity and agency isolation.
- [ ] Open PR targeting main with Closes #283 and validation evidence.
- [ ] Observe checks until terminal, fix relevant failures, and inspect populated and empty estate preview pages on desktop/mobile.
- [ ] Report PR, preview and verification results. Do not merge.

## Local validation

Estate conversion, agency transactions and test-wiring suites passed; typecheck, lint (zero errors; nine existing warnings) and production build passed. Independent read-only review found no concrete defects. Fixture SHA-256: `ecab14a11f2aefa3e541d922fde7c684575dd87dc8e089f0fa4536124827b6de`. PR/CI/preview acceptance remains to be recorded in the PR.
