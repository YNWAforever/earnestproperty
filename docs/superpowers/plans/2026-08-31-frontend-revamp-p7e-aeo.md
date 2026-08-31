# P7e — AEO/GEO (answer summaries, sourced claims, entity links)

**Goal:** Close the master plan's P7 AEO/GEO item: `DataNote` on `mortgage.tsx`, an "as of"
field on `EstateComparisonTable`, estate-page entity links to agent/video/article, and an
explicit answer-summary callout (mirroring P5e1's blog `answerSummary` pattern) on estate
and district/corridor pages that answers 適合邊類家庭／交通取捨／同價有咩選擇／睇樓前要留意甚麼.

**Base branch:** `main` (post-#94; #95/#96/#97 still open, not a dependency of this work).

## 0. Scope decisions

1. **Stamp duty gets a real `DataNote`; the interest-rate/LTV/stress-rate defaults get an
   honest caveat, not a fabricated citation.** `RESIDENTIAL_STAMP_DUTY_SCHEDULE` in
   `policy-rates.ts` already carries `source`/`sourceUrl`/`effectiveDate` — that's a direct
   swap. The 3.25%/70%/2% mortgage defaults have no real source anywhere in the repo; a
   `DataNote` for those says they're illustrative defaults the user can adjust, not "our
   rate," rather than inventing a bank/source name.
2. **`EstateComparisonTable`'s `asOf` reuses `estate.verified_at`**, which is null for every
   estate today (confirmed in P4's audit). The field is still worth adding now — it's real
   plumbing that self-heals the moment verification data lands, matching this repo's
   established "wire the honest path now, even if it renders the caveat today" pattern
   (same shape as `district.sham-tseng.tsx`'s existing transit `DataNote`).
3. **No new DB queries for estate-page entity links.** Per the research pass: agent linking
   reuses `listPublicAgentProfiles()` + `served_estate_slugs` (in-memory filter); video
   linking reuses `fetchCmsVideos()` + `deriveEstateTag()` + the registry's `nameZh` (also
   in-memory); article linking reuses the static `blogArticles` array's
   `compareEstateSlugs`. All three are loader-level filtering of data the app already
   fetches elsewhere, not new SQL.
4. **The answer-summary callout is DATA-GROUNDED, not freehand copy, everywhere it can be.**
   - Estate pages (17, of which ~14 have `estate-pages.ts` content): 適合邊類家庭 and
     睇樓前要留意甚麼 are the estate's own existing `buyerFit`/`watchouts` arrays, joined
     into prose — reused verbatim, not rewritten. 交通取捨 reuses `transportLifestyle` where
     an estate has one; omitted (not fabricated) where it doesn't. 同價有咩選擇 is
     **computed**, not written: the 2 nearest-PSF comparable estates from the same
     `findComparableEstates()` data already powering `EstateComparisonTable`, named by
     real avgPsf proximity. Estates with no `estate-pages.ts` entry get no callout at all
     (matches the existing hide-don't-fabricate convention for unpublished/uncurated
     estates).
   - District/corridor pages (`district.sham-tseng.tsx`, `district.tsuen-wan.tsx`,
     `castle-peak-road.index.tsx`, `castle-peak-road.$segment.tsx`): a short hand-written
     paragraph per page, but each one is a *synthesis* of facts already stated elsewhere
     on that same page (transit table, buyerFit, watchouts, FAQ) — no new claims, no new
     numbers, nothing that isn't already sourced on the page it summarizes.
5. **Same visual component as the blog's callout** (`重點摘要`, primary-tinted box) —
   extracted into a small shared component (`AnswerSummaryCallout`) rather than copy-pasted
   4+ times, since this is now used in 3+ distinct route files, past the point where
   duplication is cheaper than a shared component.

## Task 1: mortgage.tsx DataNote + EstateComparisonTable asOf [x] done

- `MortgageCalculator.tsx`: replace the "重要事項" section's inline stamp-duty citation
  paragraph with a real `<DataNote source={RESIDENTIAL_STAMP_DUTY_SCHEDULE.source}
  sourceUrl={...} asOf={RESIDENTIAL_STAMP_DUTY_SCHEDULE.effectiveDate}>`; add a second,
  caveat-only note (no `source`/`sourceUrl` — see §0.1) for the interest-rate/LTV/stress
  defaults.
- `src/components/site/estate-comparison.ts`: add `asOf?: string | null` to
  `EstateComparisonRow`.
- `EstateComparisonTable.tsx` / `BlogEstateComparisonTable.tsx`: render a `DataNote`-style
  caveat line using the row set's most-recent non-null `asOf` (or the existing static
  caption, unchanged, when every row's `asOf` is null).
- `estate.$slug.tsx`, `blog_.$slug.tsx`: pass `asOf: estate.verified_at` (or the DB record's
  equivalent) when building each `EstateComparisonRow`.

## Task 2: estate-page entity links (agent/video/article) [x] done

- `estate.$slug.tsx` loader: alongside the existing `Promise.all(...)`, add
  `listPublicAgentProfiles()` (filter client-side for `served_estate_slugs.includes(slug)`),
  `fetchCmsVideos()` (filter for `deriveEstateTag(video.title)?.tag === estate.name_zh`),
  and a pure in-memory filter of `blogArticles` for `compareEstateSlugs?.includes(slug)`.
- Render a new "相關資源" section: agent cards linking to `/agents/$slug`, video cards
  linking to `/videos` (or embedding via the existing `VideoFrame`-adjacent pattern),
  article links to `/blog/$slug`. Each sub-list renders nothing (not a placeholder) when
  empty.

## Task 3: shared AnswerSummaryCallout + estate-page wiring [x] done

- New `src/components/site/AnswerSummaryCallout.tsx`: extracted from
  `blog_.$slug.tsx`'s existing inline `重點摘要` block (same classes), taking a single
  `summary: string` prop.
- `blog_.$slug.tsx`: switch its existing inline block to use the new shared component
  (no visual change).
- New `buildEstateAnswerSummary(estate, content, comparableEstates)` in `estate-pages.ts`:
  composes the 4-question paragraph from `buyerFit`/`transportLifestyle`/`watchouts` plus
  a computed same-price-alternatives sentence from the nearest 2 comparable estates by
  `avgPsf`. Returns `null` when `content` doesn't exist for that estate (no callout render).
- `estate.$slug.tsx`: render `<AnswerSummaryCallout summary={...} />` when non-null.

## Task 4: district/corridor answer-summary wiring [x] done

- `district.sham-tseng.tsx`, `district.tsuen-wan.tsx`: one new hand-written paragraph each,
  synthesizing only facts already stated elsewhere on that same page (transit table,
  buyerFit-equivalent prose, watchouts).
- `castle-peak-road.ts`: add an `answerSummary` field per segment (ting-kau, sham-tseng
  corridor entries), synthesized from that segment's own existing `buyerFit`/intro copy.
- `castle-peak-road.index.tsx`, `castle-peak-road.$segment.tsx`: render the callout.

## Final verification

`npx tsc --noEmit && npm run test:seo && npm run test:corridor && npm run test:district &&
npm run test:blog && npm run test:property-experience && npm run test:estate-conversion &&
npm run lint && npm run build`
