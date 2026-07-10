# Task 4 Report: Property Decision Centre And CRM Assignment

## Status

Implemented Task 4 in the owned scope. Stable branch resolution, sale/rent decision behavior, property contact and mortgage actions, browser payload allow-listing, and server-side inquiry routing are covered by focused behavior tests.

## RED Evidence

Command:

```powershell
node --test src/config/site-branches.test.mjs src/components/property/property-decision.test.mjs src/lib/neon/website-inquiry.test.mjs
```

Result before production implementation: exit 1, 10 tests, 0 passed, 10 failed.

- Branch tests failed with `site branch resolver must exist`.
- Sale/rent and browser-payload tests failed with `property decision helper must exist`.
- Assignment behavior tests failed with `website inquiry routing helper must exist`.
- Inquiry SQL contract failed because the server had no active-property/active-staff lookup and still inserted an unassigned hard-coded `buyer` lead.

## GREEN Evidence

The same command passed after implementation: exit 0, 10 tests, 10 passed. The final focused run, after adding the preservation and overlap contract, passed with 11 tests, 11 passed.

Covered behavior:

- Estate mapping precedes district default; unknown locations return the general contact object.
- All approved estate and district mappings resolve to stable branch IDs.
- Sale exposes mortgage behavior and exact mobile commands `致電`, `WhatsApp`, `計月供`.
- Rent derives `renter`, uses the rental inquiry CTA, and exposes no mortgage command.
- Browser inquiry payloads allow-list fields and discard agent assignment keys.
- Active rental listings assign active staff; inactive/missing staff and unresolved listings remain unassigned.
- Property route keeps media, video, VR, floorplan, map, transactions, similar listings, inquiry, SEO, and JSON-LD contracts.
- Mobile sticky bar uses `bottom-16`; the live-agent launcher remains at `bottom-4`, preventing launcher overlap.

## Verification

- Focused Task 4 tests: 11/11 passed.
- `npm.cmd run test:contact`: 15/15 passed.
- `npm.cmd run test:neon-auth`: 3/3 passed.
- `npm.cmd run test:command-center`: 25/25 passed.
- Scoped ESLint on every owned file: passed with the repository's baseline CRLF-only Prettier rule disabled.
- Normal ESLint and Prettier check on every new file: passed.
- `git diff --check` on owned files: passed; only Windows CRLF conversion warnings were emitted.
- `npm.cmd run build`: passed; 4,839 client and 236 SSR modules transformed.
- Browser production preview shell loaded without an error overlay. A database-backed property page could not render because the configured database has not applied the approved agent-profile migration (`column s.show_on_website does not exist`).
- Repo-wide `npx.cmd tsc --noEmit` remains red on pre-existing issues in AI knowledge, Bun mortgage tests, admin server-function typing, MLS declarations, estate route typing, and existing property-row fields. No new Task 4 helper/component/server error was reported.

## Files

- `src/config/site.ts`
- `src/config/site.test.mjs`
- `src/config/site-branches.js`
- `src/config/site-branches.d.ts`
- `src/config/site-branches.test.mjs`
- `src/components/property/PropertyDecisionActions.tsx`
- `src/components/property/property-decision.js`
- `src/components/property/property-decision.d.ts`
- `src/components/property/property-decision.test.mjs`
- `src/routes/property.$listingNo.tsx`
- `src/lib/neon/admin-data.server.ts`
- `src/lib/neon/website-inquiry.js`
- `src/lib/neon/website-inquiry.d.ts`
- `src/lib/neon/website-inquiry.test.mjs`
- `.superpowers/sdd/task-4-report.md`

## Self-Review And Concerns

- Property title, price, core specs, and update date now precede media without deleting any existing discovery or structured-data section.
- Published assigned agents remain authoritative; when public agent data is absent, estate-first/district-second branch resolution supplies exact existing branch details, then general contact fallback.
- Inquiry assignment is derived only after a server-side active listing lookup and active staff check. The browser cannot provide an agent ID. There is no round robin and no automatic send.
- Sale mortgage preview calls the current pure calculator and deep-links with the listing price. Rental paths do not calculate or render mortgage content.
- Mobile action labels come directly from the tested pure decision model; bottom padding and vertical offset protect content and the live-agent launcher.
- Remaining concern: apply the already approved agent-profile migration to the verification database before final visual QA of real sale and rental property records.
- Concurrent agent-route, `routeTree.gen.ts`, plan, and lockfile changes were not edited or included in Task 4 staging.
