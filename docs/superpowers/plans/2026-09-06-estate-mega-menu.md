# Estate mega menu implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A complete searchable, grouped published-estate navigation with deduplicated sale/rent counts.
**Architecture:** One public aggregate query and server function feed an isolated EstateDirectory component. SiteHeader retains disclosure/focus and mobile Sheet ownership.
**Tech Stack:** TanStack Start, React, PostgreSQL, Node tests, Playwright.

## Global constraints

Published estates only; no guessed counts; one property counted once in total and once per offered deal. Do not load photos/full listings. Search names and registry aliases locally. No schema or customer-data writes. Preserve unrelated local changes.

### Task 1: Directory data and search model
- [ ] Add an aggregate read using latest per public identity/deal before status filtering to public-data.server.ts and public-data.ts.
- [ ] Add estate-directory.ts with normalized search, registry order and grouping; pure tests cover aliases, Chinese/English, empty matches and hrefs.
- [ ] Extend real read-model DB fixture: published estate counts, dual offerings, withdrawn latest records and zero inventory.
- [ ] Run focused tests and TypeScript.

### Task 2: Desktop and mobile directory
- [ ] Add EstateDirectory.tsx, client cache for 60 seconds, loading/error/retry, labelled search, group sections and independent sale/rent links.
- [ ] Desktop: viewport-centered maximum 1120px panel with bounded internal scroll; retain district shortcuts and footer links.
- [ ] Mobile: searchable expandable groups within existing Sheet; 44px controls. Close on navigation; preserve Escape/focus behavior.
- [ ] Run navigation, lint and build checks. Test desktop/mobile search, routes, counts, no-result, overflow and focus via Playwright.

### Task 3: Release
- [ ] Review diff against spec and run required checks.
- [ ] Push approved repository, create PR, resolve CI failures and merge after passing.
- [ ] Confirm production deployment and browser behavior; record evidence.
