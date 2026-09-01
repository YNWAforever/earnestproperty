# 17-Estate Expansion: Publish-Gate Follow-Up — Design

**Status:** Approved.

## Origin

Continues the 17-estate expansion after publishing (PR #103), the homepage
empty-state/footer fix (PR #104), and photo sourcing for 7 of the 17 (PR
#105, all merged and now applied to production). Those phases deliberately
shipped with known gaps: an externally-supplied `schoolNetCode` per estate
never independently verified, 4 documented cross-source fact conflicts left
`NULL`, and 10 of the 17 estates still without a photo. This phase closes
as much of that gap as the available research methods actually allow,
without fabricating anything the earlier phases were careful not to.

This is three independent research-and-patch workstreams, not one. Each
ships as its own PR — the established pattern from PR #105 — so a
workstream that yields little (fact conflicts, most likely) never blocks
one that yields a lot (school net, most likely).

## Workstream 1: School net confirmation

**What exists today:** `estate-expansion-17.data.json` assigned every one
of the 17 estates a `schoolNetCode` (`"62"` or `"71"`), applied to the
`estates` table by `20260901100000_estate_expansion_facts.sql`. This came
from the externally-supplied data pack, not independent verification —
distinct from the 4 fields the pack itself flagged as disputed (workstream
2 below), this one wasn't flagged, but was also never checked.

**Method:** for each of the 17 estates' addresses (already in the `estates`
table from the facts migration), look up the actual Primary One Admission
school net via EDB's official net-search tool or GeoInfo Map's school-net
layer — both real Hong Kong government lookup tools, navigated directly
(not a general web search, which is the method that failed to resolve
workstream 2's conflicts previously).

**Output:** a new migration, `UPDATE estates SET school_net_code = '<net>'
WHERE slug = '<slug>'`, but only for estates where the confirmed net
differs from what's already in the table. Where confirmed correct, no row
changes — that's a real, useful outcome (confidence gained), not a
no-op to hide.

## Workstream 2: Resolve documented fact conflicts

Exactly 4 conflicts exist, all in `20260901100000_estate_expansion_facts.sql`,
each already commented with the specific disputed values:

| Slug | Field | Disputed values |
|---|---|---|
| `lung-tang-kok` (龍騰閣) | `developer` | Unset entirely — publishBlockers note says pending estate-document confirmation |
| `sing-tai` (星堤) | `area_max` | 2,766 / 4,054 / 4,484 sq ft |
| `seong-yuen` (上源) | `blocks` | 5 buildings vs. 10 A/B sub-blocks (two counting conventions) |
| `tai-tou-waan` (帝濤灣) | `area_max` | 2,841 / 3,421 sq ft |

**Method:** query Hong Kong government portals directly for each —
差餉物業估價署 (Rating and Valuation Department) property information
online, and 屋宇署 (Buildings Department) building records search — rather
than a general web search engine, which already failed to surface these on
a prior pass this session. This is a genuine attempt at the authoritative
source, not a repeat of the same failed method.

**Output:** a new migration that sets only the fields an authoritative
source actually confirms. Realistic expectation, stated up front: some or
all 4 may still not resolve — a government portal not indexing a specific
small residential building, or requiring an in-person/paid search, is a
real possible outcome. Anything not resolved stays `NULL`, exactly as
today; this workstream does not pick a value to "unblock" the same way
PR #103 deliberately chose to publish without full data.

## Workstream 3: Photos for the remaining 10 estates

The 7 already sourced (PR #105): `hoi-wan-toi`, `chun-wong-kui`,
`mun-ming-shan`, `wong-gam-hoi-ngon`, `oi-kam-hoi-ngon`, `sing-tai`,
`tai-tou-waan`. The remaining 10: `hoi-wan-hin`, `tai-wah-hin`,
`lung-tang-kok`, `tai-yu`, `wong-gam-hoi-waan`, `seong-yuen`, `the-carmel`,
`oma-oma`, `lin-shan`, `long-tou-waan`.

**Method:** identical to PR #105 — search Wikimedia Commons per estate
(by both Chinese and confirmed English name), verify each candidate file's
license and author on its own file page (not the category page), visually
confirm the photo shows a real building exterior, and independently
cross-check the estate-name-to-building match against a second source
(a property portal listing) before treating it as a hit — the same
discipline that caught the 海韻臺 / "Rhine Terrace" vs. this repo's
existing, unrelated "Rhine Garden" naming collision risk last time.
Never a competitor real-estate portal photo, never without a verified
license, never a guess at which building matches the name.

**Realistic expectation, stated up front:** the initial scan behind PR
#105 found Commons coverage for only 7 of all 17 estates. The remaining 10
were the ones without a hit at that time — this workstream may mostly
confirm "still no license-clean photo" rather than find new ones. Any
found follow PR #105's exact pattern: resized to ~1200px, `photo` +
`photoCredit` set on the registry entry, credit line rendered on the
homepage card.

## Testing approach

- Workstream 1: a migration contract test (mirroring
  `estate-expansion-facts-migration.contract.test.mjs`) asserting only
  `school_net_code` changes, only for the specific slugs actually
  corrected, nothing else touched.
- Workstream 2: same contract-test pattern, asserting only the specific
  field(s) actually resolved for each slug change, everything else
  (including any conflict that stays unresolved) is unchanged.
- Workstream 3: reuse `core-estates.test.mjs`'s "every declared photo
  exists on disk" pattern, plus `estate-registry.test.mjs`'s photo/credit
  presence checks, extended to cover whichever of the 10 slugs get a photo.
- All three: `npx tsc --noEmit`, and the same `test:estate-conversion` /
  `test:homepage` scripts already used for PR #105.

## Explicitly out of scope

- Setting `verified_at` for any estate — that remains a genuine per-estate
  human sign-off against the full publish gate (identity, facts, school
  net, photo, SEO/copy, MLS aliases, route health, mobile/a11y, CMS draft),
  not something this research phase can complete on its own even once
  school net and some facts are confirmed.
- Forcing a resolution on any of the 4 fact conflicts or any missing photo
  by picking a value/source that isn't actually authoritative — a
  documented `NULL` stays `NULL` if no authoritative source is reachable.
- Applying any resulting migration to the live database — same constraint
  as every prior phase this session: this sandbox has no `DATABASE_URL`;
  migrations ship unapplied and need the same manual
  `npm run neon:migrate` step the user just ran for PR #103's migrations.
- Any estate outside the 17-estate expansion (the original 5 core estates
  are untouched by all three workstreams).
