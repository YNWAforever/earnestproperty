# P7d — Analytics (typed event taxonomy + wiring)

**Goal:** Build `src/lib/analytics/events.ts` from scratch per the master plan's P7 item 5
(18 named events, typed payloads, route/district/estate/listing-ref/agent/UTM context, no
PII, provider-agnostic no-op `track()`), then actually wire `track()` calls into the real
UI touchpoints those events name — not just ship an unused taxonomy.

**Base branch:** `main` (post-#90-#94; #95/P7c still open, not a dependency of this work).

## 0. Scope decisions

1. **The master plan names only the first and last event** (`listing_search` …
   `zero_results_notify`), not all 18. The other 16 are designed here from the site's real
   interaction points (confirmed by reading each component below), not invented generically.
2. **No shared UTM-capture utility.** `listings.tsx` and `OwnerValuationPanel.tsx` each
   already have an identical 5-line `collectUtmParams()`, and both carry a comment saying
   this was a *deliberate* choice ("no shared UTM utility... rather than introducing
   cross-feature coupling for five lines of logic"). Reversing that without a strong reason
   would violate the project's own documented precedent, so `events.ts` gets its own third
   copy, not a refactor of the other two.
3. **`track()` is a real no-op in production**, per the master plan ("no-ops until a
   provider is chosen", open input #11) — but logs to `console.debug` under
   `import.meta.env.DEV` so wiring can actually be verified locally before a provider
   exists. This is not scope creep: without it there is no way to confirm any call site
   fires correctly, in this session or later.
4. **View events use a shared `useTrackPageView` hook** (fires once per mount via a ref
   guard), not five copy-pasted `useEffect` blocks — this doesn't reverse any prior
   decision (no such hook exists yet) and avoids real duplication across 5 route files.
5. **Analytics context's `route` field is the router pathname** (`useRouterState` /
   `window.location.pathname`), not manually threaded through every call site.

## Event taxonomy (18)

| # | Event | Fires when | Payload |
|---|-------|-----------|---------|
| 1 | `listing_search` | `/listings` filters applied (`apply()`) | `{ dealType, districtSlug?, minPrice?, maxPrice?, resultCount }` |
| 2 | `listing_view` | `/property/$listingNo` mounts | `{ listingNo, dealType }` |
| 3 | `listing_share` | property detail share button (`handleShare`) | `{ listingNo }` |
| 4 | `listing_whatsapp_click` | WhatsApp link in `PropertyDecisionActions`/`PropertyMobileContactSummary` | `{ listingNo, dealType }` |
| 5 | `zero_results_notify` | `/listings` zero-results `ListingAlertForm` submit | `{ dealType, districtSlug?, source }` |
| 6 | `estate_view` | `/estate/$slug` mounts | `{ estateSlug, districtSlug? }` |
| 7 | `district_view` | a `/district/*` route mounts | `{ districtSlug }` |
| 8 | `transaction_share` | `/transactions` row share (`handleTransactionShare`) | `{ transactionId }` |
| 9 | `transaction_filter` | `/transactions` filters applied (`apply()`) | `{ dealType, districtSlug?, month?, resultCount }` |
| 10 | `agent_view` | `/agents/$slug` mounts | `{ agentSlug }` |
| 11 | `agent_whatsapp_click` | agent profile WhatsApp link | `{ agentSlug }` |
| 12 | `whatsapp_cta_click` | sitewide WhatsApp CTAs (`StickyWhatsAppBar`, `IntentWhatsAppCTA`) | `{ intent?: "buy"\|"rent"\|"valuation", source }` |
| 13 | `contact_form_submit` | `/contact` form submit | `{ hasPhone: boolean }` |
| 14 | `valuation_form_submit` | `OwnerValuationPanel` submit | `{ districtSlug?, estateSlug? }` |
| 15 | `mortgage_calculate` | `MortgageCalculator` produces a result | `{ hasIncome: boolean }` |
| 16 | `mortgage_scenario_save` | `MortgageCalculator`'s `handleSaveScenario` | `{ scenarioCount }` |
| 17 | `article_view` | `/blog/$slug` mounts | `{ articleSlug }` |
| 18 | `video_click` | a video card's play button (`VideoFrame`'s `onClick`) | `{ videoId, category? }` |

No PII anywhere: no names, phone numbers, emails, or free-text form values in any payload —
only slugs, ids, booleans, and enums.

## Task 1: `src/lib/analytics/events.ts` [x] done

- `AnalyticsContext`: `{ route: string; districtSlug?: string; estateSlug?: string;
  listingNo?: string; agentSlug?: string; utm?: Record<string,string> }`.
- A discriminated union `AnalyticsEvent` — one member per row of the table above, each
  `{ name: "<event>"; payload: <that row's payload type> }`.
- `collectUtmParams()` — the same SSR-guarded 5-line copy as the two existing ones.
- `buildContext(partial)` — merges `route` (from `window.location.pathname`, SSR-guarded)
  + `collectUtmParams()` + whatever slugs/ids the caller passes.
- `track(event: AnalyticsEvent, context: AnalyticsContext): void` — `if
  (import.meta.env.DEV) console.debug("[analytics]", event.name, { ...event.payload,
  ...context })`, otherwise a real no-op. One-line comment noting the provider is
  open input #11.
- `useTrackPageView(build: () => AnalyticsEvent | null, deps: unknown[])` — a small hook in
  the same file: `useEffect` with a `useRef` guard so it fires once per mount, not once per
  re-render; skips (no event) while `build()` returns null (e.g. before loader data resolves).
- Test: `src/lib/analytics/events.test.mjs` (`node --test`) — construct a few events of each
  shape, assert `track()` doesn't throw with `DEV` on and off, assert `collectUtmParams()`
  reads `utm_source`/`utm_medium`/etc. from a stubbed `window.location.search` and ignores
  unknown keys, assert every one of the 18 names in the table is a valid `AnalyticsEvent`
  discriminant (compile-time, but also asserted at runtime via a literal array match against
  the table above so the taxonomy can't silently drift from its own docs).

## Task 2: listings + property detail wiring [x] done

- `src/routes/listings.tsx`: `listing_search` inside `apply()` (uses the same filter values
  already being sent to `navigate()`, plus a `resultCount` read from the current loader
  data); `zero_results_notify` inside `ListingAlertForm`'s existing submit handler (reuses
  the `source: "listings-zero-results"` value already there).
- `src/routes/property.$listingNo.tsx`: `listing_view` via `useTrackPageView` once
  `property` resolves.
- `src/components/property/PropertyDecisionActions.tsx`: `listing_share` on `handleShare`
  (this file, not the route, owns the share button); `listing_whatsapp_click` added to each
  WhatsApp `<a>`'s `onClick` in both `PropertyMobileContactSummary` and
  `PropertyDecisionActions` (both already receive `listingNo`/`dealType` as props — no new
  prop plumbing needed).

## Task 3: transactions + estate/district/agent/article views [x] done

- `src/routes/transactions.tsx`: `transaction_filter` in `apply()` (same pattern as
  listings); `transaction_share` in `handleTransactionShare`.
- `src/routes/estate.$slug.tsx`, `src/routes/district.sham-tseng.tsx`,
  `src/routes/district.tsuen-wan.tsx`, `src/routes/castle-peak-road.index.tsx`,
  `src/routes/castle-peak-road.$segment.tsx`: `estate_view`/`district_view` via
  `useTrackPageView`.
- `src/routes/agents_.$slug.tsx`: `agent_view` via `useTrackPageView`;
  `agent_whatsapp_click` on the existing WhatsApp `<a>`'s `onClick`.
- `src/routes/blog_.$slug.tsx`: `article_view` via `useTrackPageView`.

## Task 4: WhatsApp CTAs, forms, mortgage, video [x] done

- `src/components/site/StickyWhatsAppBar.tsx`, `src/components/site/IntentWhatsAppCTA.tsx`:
  `whatsapp_cta_click` on their anchors' `onClick` (`source` = a short literal identifying
  which component fired it: `"sticky-bar"` / `"intent-cta"`; `intent` only present on
  `IntentWhatsAppCTA`, taken from the `item.intent` already in scope).
- `src/routes/contact.tsx`: `contact_form_submit` inside `handleSubmit`, `hasPhone` derived
  from whether the phone field is non-empty (never the value itself).
- `src/components/site/OwnerValuationPanel.tsx`: `valuation_form_submit` inside
  `handleSubmit`.
- `src/components/site/MortgageCalculator.tsx`: `mortgage_calculate` where `calculateMortgage`
  already runs for the live (non-editing) result; `mortgage_scenario_save` inside
  `handleSaveScenario`.
- `src/routes/videos.tsx`: `video_click` inside `VideoFrame`'s existing
  `onClick={() => setIsPlaying(true)}`; `CmsVideoCard`/`ListingVideoCard` pass `videoId`
  (`video.id`/`listing.id`) and `category` (`video.category`, undefined for listing videos)
  down as new `VideoFrame` props.

## Final verification

`npx tsc --noEmit && node --test src/lib/analytics/events.test.mjs && npm run
test:homepage && npm run test:property-experience && npm run test:transactions && npm run
test:woztell && npm run lint && npm run build`

(`test:woztell` covers `contact.tsx`; run whichever `test:*` scripts actually cover each
touched route — check `package.json` per file before assuming a name.)
