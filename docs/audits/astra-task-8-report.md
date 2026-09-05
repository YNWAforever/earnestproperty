# Task 8: public page transfer and query work

Date: 2026-09-05. Checkout: `audit-20260905`, branch `codex/audit-20260905`; starting baseline `6d5c016`. Source implementation is ready for integrated verification. The whole-page transfer acceptance budget is **not yet verified**.

## Implemented

- Added a reproducible Sharp pipeline over 19 existing authorized hero, estate and branch originals. It emits 71 content-addressed WebP variants with width descriptors, without upscaling, and handles EXIF rotation before computing dimensions. Originals remain available as fallbacks.
- `AppImage` supplies responsive candidates only for known local media and preserves explicit overrides, alt text, dimensions and remote behavior. Homepage hero remains eager/high priority. Below-fold estate and branch cards are lazy, with layout-specific sizes on homepage and contact.
- Listing queries use a separate card projection: one image, no long description, floorplan or full agent biography. Detail retains its full projection and published-agent safeguards. Existing result types remain compatible, with detail-only card fields null.
- Canonical deduplication happens in SQL before counts and pagination for listing search, corridor, featured and similar queries. Identity includes deal type; null/empty canonical identifiers fall back to listing number. Freshness ties end with stable property ID ordering. Estate counts use the same canonical identity.
- Independent search count and row reads execute concurrently using the same filtered canonical query definition. These are separate reads: a concurrent import can briefly change their snapshots; the implementation does not claim snapshot isolation.
- Estate filter options use a 60-second process-local cache with in-flight deduplication, error retry and generation-based invalidation. CMS estate publish/archive now calls synchronous `invalidatePublicEstateOptions` after successful mutation (Task7 integration). Other process instances expire within the TTL.
- Similar-listing and transaction failures degrade independently to empty sections; primary property data and its existing contact/status behavior survive.
- Added a manifest-based local bundle profiler before recommending auth/chat import changes to root. Root owns the resulting route/provider and chat integration.

## Measurements

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Authorized image inventory, one 960px candidate per source | 6,811,023 bytes | 2,651,334 bytes | 61.07% |
| Same synthetic record, detail versus card serialized result | 3,190 bytes | 714 bytes | 77.62% |

Image inventory is a size proxy, not a browser request measurement. All variant widths together occupy 7,768,738 bytes; browsers select candidates. The recorded homepage baseline is 4,880,833 bytes, but the >=50% whole-page reduction and no-visual-regression acceptance still need the same viewport, data and request method. Initial shared local page attempts returned 500 while other files were being edited; no passing browser comparison is asserted.

The existing last-built public entry was 1,504,587 raw / 445,796 gzip bytes (`index-CItuLjgA.js`). Source inspection found auth UI and chat mounted from the shared root; root received a recommendation to isolate avoidable imports while preserving account functionality and keyboard behavior. This profile predates the final integrated build and establishes no final bundle savings. Machine-readable evidence: `astra-task-8-image-metrics.json` and `astra-task-8-bundle-profile.json`.

## Verification

Test-first failures reproduced card overfetch, missing canonical-before-pagination handling and missing cache implementation (39 tests: 36 passed, 3 failed). Optional-section failure was separately reproduced (18 tests: 17 passed, 1 failed). Image metadata tests caught and drove the EXIF orientation correction.

Fresh final focused commands:

```text
node --test src/lib/neon/listing-search.contract.test.mjs src/lib/neon/public-estate-options-cache.test.mjs src/lib/neon/corridor-scope.contract.test.mjs src/lib/neon/agent-profiles.contract.test.mjs src/routes/property.listing-detail.contract.test.mjs src/routes/homepage-copy.contract.test.mjs
87 passed, 0 failed, 0 skipped

bun test src/components/media/AppImage.test.tsx
12 passed, 0 failed, 243 expectations (local Bun 1.3.14)
```

Focused ESLint previously passed for owned production TS/TSX and media scripts. The last shared typecheck encountered concurrent `admin.leads.tsx` JSX syntax errors outside Task8; final integrated typecheck/build belongs to root. No concurrent full build was run by this agent.

`public-performance.db.test.mjs` is ready for root's approved disposable branch. It requires `TEST_DATABASE_URL` and `PUBLIC_TEST_DATABASE_CONFIRMED=true`, has no application URL fallback, creates a uniquely named isolated schema, exercises real exported query code, and drops only that schema. Its fixture covers duplicates across page boundaries, 33 unique offerings over 12/12/9 rows, same-canonical sale/rent, null/empty canonical identifiers and repeated page stability. This agent has not run that database test or accessed credentials; database results must be recorded separately by its runner.

Remaining integrated gates: isolated database fixture execution, final typecheck/build, same-method mobile transfer comparison, responsive visual spotchecks, and root auth/chat/account/browser acceptance. No production database, provider, migration, push or deployment action was performed by this agent.

## Approved disposable database verification

After the report above, root explicitly authorized this agent to execute the fixture against Preview branch `br-quiet-hat-aoxbj2ue` in project `dawn-meadow-79190048`. The runner loaded the ignored disposable environment, asserted that exact branch ID, and assigned only its explicit test URL to the fixture. No connection value was printed and no application environment fallback was used.

Result: `node --test src/lib/neon/public-performance.db.test.mjs` **1 passed, 0 failed, 0 skipped**. PostgreSQL verified canonical totals, three pages of 12/12/9 unique offerings, sale/rent and null identities, and stable repeated pagination. The isolated schema was cleaned up by the fixture. This supersedes the earlier pending database gate; whole-page/browser and final integrated build gates remain.

## Independent Task9 source review

Reviewed root's `__root.tsx`, `PrivateAuthProvider`, `LiveAgentLauncher`, `LiveAgentWidget`, document-isolation helper and keyboard regression. No concrete blocking defect found in this scoped source review. Auth UI consumers remain under admin/auth/account routes; provider retains the absolute reset-link base URL. Public/private transitions compare against the document entry path and request document reload. The document-boundary regression passed 1/1.

The launcher imports chat internals on first activation; the mounted widget owns draft state across close/reopen. Radix is explicitly nonmodal, focuses the message input on open, and retains a mounted trigger for focus return. Existing send/session/handoff code remains intact. Source review does not replace browser keyboard, account/reset-link, back-navigation or chunk-load-failure verification. Root owns those checks. No Task9 source edits were made by this reviewer.

## Variable CJK font follow-up (2026-09-06)

Root's matched production-browser comparison measured6,528,165→3,955,552 bytes (39.4% reduction), below the50% whole-page target. Its request profile identified about2MB of Noto Sans TC slices across400/500/700/900. Those are root-provided matched measurements, superseding inventory-only assumptions.

Replaced the four static Noto CSS imports with local `@fontsource-variable/noto-sans-tc/wght.css`, pinned exactly5.3.0 in npm package/lock. Updated both CSS family stacks to the package's `Noto Sans TC Variable`; all existing font-weight declarations, Inter imports and local Inter preload remain. Removed the unused static Noto dependency. No bun command was executed and the dirty bun.lockb was preserved.

Official Fontsource documentation confirms this equivalent variable family supports weights100–900: https://fontsource.org/fonts/noto-sans-tc/install and https://fontsource.org/docs/getting-started/variable. Installed metadata identifies Google Fonts source versionv39, OFL-1.1, weight axis100–900. Every CSS face uses that range, swap display, a Unicode subset and relative local WOFF2 URL. No runtime CDN font request is introduced.

Expected reason for savings: a Unicode-range variable slice is shared across weights instead of fetching distinct400/500/700/900 slices for the same characters. Variable slices may be individually larger, so this is not a claimed transfer percentage; root must rebuild and rerun the matched browser comparison. The font family/design and weight range are preserved; visual line-wrap/weight acceptance remains browser evidence.

Style contract first reproduced missing integration (4passed/1failed), then passed after replacement. Final `node --test src/styles.test.mjs`:6passed/0failed, including every installed font-face range/family/local-source checks. Focused root ESLint passed. No full build or browser transfer run was performed by this agent.

Final root integration verification: matched optimized builds measured6,528,165→3,131,530bytes(52.03% reduction), three fresh390×844 contexts each. Final mobile hero candidate1440w preserves the cover crop detail. Original live4,880,833baseline comparison remains unverified under identical hosting; see astra-task-8-transfer.json and astra-tasks-7-11-handoff.md.
