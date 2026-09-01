# 17-Estate Expansion — Design

**Status:** Approved (design supplied externally by the user as a complete master
spec + data pack; this document adapts it to this repo's own spec/plan convention
and records the corrections found while verifying it against current `main`).

## Origin

This continues the home page brainstorming earlier in this session: that
brainstorm converged on the "17-estate expansion" (P4's Task 2
placeholders — 5 深井/汀九 estates already anticipated by `core-estates.ts`, plus 12
青山公路 estates deliberately kept off the corridor/home page per master-plan
decision D2) as the real next phase, and had settled three decisions before this
spec arrived:

1. The client's scope has changed — a 青山公路 home page section is now wanted
   (D2's homepage restriction is overridden).
2. The override is scoped narrowly to the home page only — `corridorRegionScope`,
   the retired `so-kwun-wat-gold-coast` segment, and its 301 redirect are untouched.
3. No real content existed yet, so the plan was "build plumbing, content later."

Decision 3 is now superseded: the user supplied a complete data pack with real,
sourced facts, full page copy, and SEO records for all 17 estates, prepared
2026-09-01. That pack — `estate-expansion-17.data.json`, committed alongside this
spec at `docs/superpowers/specs/assets/estate-expansion-17.data.json` — plus the
accompanying master spec and Claude Code prompt (also user-supplied) are the design
this document formalizes. Decisions 1 and 2 stand — this phase is about publishing
individual estate detail pages, not touching corridor listing-search scope.

## What this phase does NOT do

Per both the original master-plan D2 decision and the user's own master spec:

- **No home page cards go live from this phase alone.** Every one of the 17 stays
  `published = false`, `verified_at = NULL`. A homepage/corridor card only appears
  once a specific estate individually clears the publish gate (below) — this phase
  ships the plumbing (registry, pages, SEO, tests) for all 17 at once, but publish
  state stays per-estate and manual.
- **No deploy.** Confirmed explicitly by the user's own prompt: "Do not deploy and
  do not publish."
- **No change to corridor listing-search scope.** `corridorRegionScope`, the
  `so-kwun-wat-gold-coast` retirement, and its 301 redirect in `vercel.ts` are
  untouched — matches this session's own earlier scoping decision, and the master
  spec's "Preserve … current public behavior" rule.
- **No fabricated facts.** Every number in the data pack traces to a cited source
  (中原地產/28Hse/House730/美聯物業/利嘉閣/永泰地產); every field with a genuine
  cross-source conflict stays `NULL` in the DB and is listed as a named
  `publishBlockers` entry, not silently resolved by guessing.

## Source-of-truth files

- `docs/superpowers/specs/assets/estate-expansion-17.data.json` — canonical
  identity, facts, sourced content (overview/buyerFit/pros/watchouts/FAQs/related
  links/CTAs), SEO records, and per-estate `publishBlockers` for all 17 estates,
  plus the `schoolNets` (62/71) and MLS `normalizationPrecedence` rules.
- `docs/superpowers/specs/assets/EarnestProperty_17_Estate_Claude_Master_Spec.md`
  and `EarnestProperty_17_Estate_Claude_Prompt.txt` — the user's own narrative
  spec and execution prompt; copied here for the same durability reason as the
  data pack (Downloads is not part of the repo and won't survive to a subagent's
  fresh context).

**Two files the master spec's own §12 lists as attachments do not actually
exist**: `estate-expansion-17.patch.ts` and
`20260901090000_estate_page_content_17.sql`. Only the three files above were
supplied. This is not a blocker — the master spec's own file-level instructions
(§5) are written in terms of *what changes to make*, not *apply this literal
diff*, and `estate-expansion-17.data.json` carries every fact and content field
needed to construct the real edits directly against current `main` (which is
mandatory anyway, since — see below — a few of the spec's stated "current repo
state" assumptions are already stale).

## Verified corrections vs. the master spec's "現況" assumptions

Checked directly against `src/content/estate-registry.ts` on current `main`
(commit `da7a9f4`) before planning:

| Slug | Spec's target `districtSlug` | Actual current value | Correction needed? |
|---|---|---|---|
| `hoi-wan-hin` | `sham-tseng` | `ting-kau` | **Yes** — not called out in the spec's own per-estate blockers, found independently |
| `tai-wah-hin` | `tsing-lung-tau` | `null` | Yes (spec doesn't flag this either, but the field is genuinely unset today) |
| `hoi-wan-toi` | `sham-tseng` | `null` | Yes |
| `chun-wong-kui` | `sham-tseng` | `ting-kau` | Yes — this one the spec's own blocker list *does* call out |
| `lung-tang-kok` | `tsing-lung-tau` | `null` | Yes |
| All 12 青山公路 estates | `castle-peak-road` | `castle-peak-road` | No change — already correct |

The 12 青山公路 estates' `districtSlug` was already right. All 5 深井/汀九 estates
need a `districtSlug` correction, not just the one (縉皇居) the spec's blocker
table names — the other four were silently correct-by-omission in the spec but
wrong in the actual registry.

Also confirmed: `EstateRegistryEntry` (the registry's own type,
`estate-registry.ts:48`) has **no `parentEstateSlug` field today** — the spec's
requirement to add `parentEstateSlug: "sea-crest-villa"` to 帝華軒 needs a type
addition, not just a value fill-in. `school-nets.ts` currently exports a single
`shamTsengSchoolNet` constant, not a `schoolNets` map — the spec's requested
`schoolNets` map + `getSchoolNet(code)` refactor is a genuine restructure, not
additive. `estateSeo` (`seo.ts`) covers only the 5 original core estates today,
and its `estateSeoIdentity()` helper already throws if `nameEn` is missing — the
data pack supplies a real `nameEn` for all 17 (including "The Carmel" and
"OMA OMA" using their own name per the spec's own naming rule), so this isn't a
blocker. `normalize-old-site.mjs` has zero references to any of the 17 slugs
today, confirmed by grep. The referenced migration
`neon/migrations/20260830130000_estate_expansion.sql` (note: **130000**, not the
prompt's stray `20260901090000_estate_page_content_17.sql` filename, which
doesn't exist) is real and already seeds all 17 rows unpublished with no facts —
the new work is an `UPDATE`, not another `INSERT`.

## Scope of work

Six areas, matching the master spec's §5 file-level breakdown, each grounded
against real current file content (not assumed):

1. **`estate-registry.ts`** — add `parentEstateSlug?: string | null` to the type;
   update all 17 entries' `nameEn`, `aliases`, `districtSlug` (5 corrections
   above), `corridorSegment` (stays `null` for all 17 — unaffected by this
   phase's scope decision, see "What this phase does NOT do"), `hasPage: true`
   (content/route now exist — this is independent of DB `published`, per the
   master spec's own distinction), `homepageDistrict` per `areaMeta`, and
   `parentEstateSlug` for 帝華軒 only.
2. **`estate-pages.ts`** — merge each of the 17 estates' `content` block
   (overview/buyerFit/pros/watchouts/transport/marketNote/CTAs/FAQs/relatedLinks)
   from the data pack into `estatePageContent`, keyed by slug, matching the
   existing 5-estate entries' shape exactly.
3. **`seo.ts`** — add 17 `estateSeo` records via `estateSeoIdentity()`, each
   carrying `robotsUntilPublished: "noindex,follow"` until publish, canonical
   `/estate/{slug}` only once published. Sitemap generation already reads
   `estateSeo` and must keep excluding anything not `published` in the DB
   (existing behavior — verify, don't change).
4. **`school-nets.ts`** — restructure to a `schoolNets` map (`62`/`71`) +
   `getSchoolNet(code)` lookup, both nets' `primarySchools` staying `[]` (no EDB
   register supplied, matching the existing 62-net's own documented discipline).
5. **`estate.$slug.tsx`** — remove the hardcoded 深井/62-net assumptions (hero
   eyebrow, CTA district name, breadcrumb, school net, transport fallback,
   completion label, structured-data area/name/URL); derive all of these from
   the registry entry + `areaMeta`/`schoolNets` lookups instead. Must not gate
   school-net display on `district_slug === "sham-tseng"` — resolve via the
   corridor segment lookup already in the route, falling back to
   `transportLifestyle` when no segment claims the estate (mirrors existing
   `findCastlePeakRoadSegmentByDistrictSlug` null-handling convention).
   `EstateMarketSnapshot`'s existing null-semantics (no `$0`/`0 伙`/`NaN`) must
   not regress.
6. **`normalize-old-site.mjs`** — add all 17 estates' aliases plus the 5
   precedence/`mustPrecede` rules from `normalizationPrecedence` in the data
   pack (tai-wah-hin before sea-crest-villa, hoi-wan-toi before rhine-garden,
   wong-gam-hoi-waan before wong-gam-hoi-ngon, tai-yu's 3-phase aliases, tai-tou-waan's
   2-phase aliases). Also fix `inferDistrictSlug` so 海雲軒/縉皇居 no longer
   fall through to `tsuen-wan` under the old rule (a known pre-existing bug the
   master spec calls out explicitly).
7. **Neon migration** — new migration (additive, does not touch
   `20260830130000_estate_expansion.sql`) that `UPDATE`s the 17 existing rows
   with the facts fields from the data pack (address, developer, year, phases,
   blocks, building composition, area min/max, school net code). Per the
   spec's non-negotiable rules: never seeds `avg_saleable_psf`, price, count, or
   transaction data; every row stays `published = false` and `verified_at = NULL`.
   Drift-check before applying.

## Publish gate (unchanged from the master spec, reproduced for this repo's own record)

Per estate, in order: identity/alias/address/district verified → developer/year/
phase/unit/area conflicts resolved → school net confirmed against EDB/GeoInfo →
licensed hero image in place → SEO/copy/CTA/FAQ/related-links approved → MLS
alias-collision tests pass → route returns 200 with no `0`/`NaN`/empty structured
data → mobile/keyboard/contrast/accordion/WhatsApp CTA pass → CMS revision has a
draft → approved/published record → `verified_at` written → **only then** flip
that single row's `published = true` → sitemap picks up the URL only after that.
This phase does not clear any estate through this gate — it builds everything
that gate needs to be checkable against, per estate, later.

## Testing approach

New contract tests before touching production code (matching this session's
established TDD-first pattern), covering at minimum: identity parity between
registry/SEO/content for all 17 slugs; slug uniqueness; MLS alias-collision cases
from `normalizationPrecedence` (the 8 cases listed in the master spec's §5,
e.g. `浪翠園5期 帝華軒` → `tai-wah-hin` but `浪翠園 第3期` → `sea-crest-villa`);
62/71 school-net resolution; dynamic breadcrumb/CTA/eyebrow per district;
unpublished-estate isolation from sitemap/homepage/public search (all 17 must
stay invisible everywhere public until each is individually published); `NULL`
market-metric rendering (no `$0`/`0 伙`/`NaN`); FAQ JSON-LD presence. Run
`test:seo`, `test:corridor`, `test:listing-search`, plus whichever existing
script the estate contract tests live under (likely extending
`test:content-copilot` or a dedicated new script — confirmed during planning),
`npx tsc --noEmit`, and `npm run build`. `test:a11y` only if a live-DB-adjacent
Playwright pass is feasible in this sandbox — same constraint this session hit
building it in P7b.

## Explicitly out of scope

- Corridor listing-search scope changes (see "What this phase does NOT do").
- Actually publishing any estate — that's a manual, per-estate, human-gated
  action after this phase ships.
- Sourcing/licensing real photos — every `photo` stays `null`; `proposedPhotoPath`
  in the data pack is a placeholder for when a licensed image exists.
- The home page 青山公路 section component itself (the UI work discussed earlier
  this session) — that's a separate, smaller phase gated on at least one estate
  in that group actually being publishable; this phase is the estate-page/data
  foundation that phase depends on, not the home page section itself.
