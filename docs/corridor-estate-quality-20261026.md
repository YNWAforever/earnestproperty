# Corridor estate editorial quality audit — 2026-10-26

Base: `79024081206320bcc8fb1e6ede9b4c458be56fdd` (current main, includes #287). Audited exactly the 40 estates in `20261026170000_listing_estate_content.sql`, using singular `/estate/<slug>` production URLs. Bellagio and Lido Garden are the established reference pages.

## Findings

- All 40 production rows are published and have nonblank description, hero_image, seo_title and seo_description. Read-only production ledger confirms the original migration was applied at 2026-10-26T20:38:12.783Z.
- Fresh HTTP retrievals returned 200 with an estate hero element on all 40 pages. No empty or 404 estate page was found.
- All 40 had the same editorial weakness: the opening paragraph doubled as the hero and sole benefit; each had one generic buyer profile and an address/repeated-introduction FAQ. SEO met width budgets but emphasized location/cautions rather than the estate proposition.
- Thirteen introductions were especially short (81–105 non-whitespace characters): 蒙地卡羅別墅、逸璟．龍灣、星岸、海濤花園、麗海別墅、均富花園、富安新邨、容龍居、屯門閣、雅翠苑、龍珠島平房、龍珠花園、珀居.

## Content and photographs

Each estate now has two substantive overview paragraphs, a distinct short hero, three buyer profiles, three benefits, three viewing considerations, two useful FAQs, practical transport notes, estate-specific market comparison guidance, and distinct rent/sale SEO with Chinese/English identity and the agency licence. Existing identity, aliases, address authority, school-net policy and original listing evidence are retained.

Every estate has at least one freshly retrieved external reference recorded in the audit fixture. Source disagreements (including selected building counts, occupation dates, management names and area bounds) are documented rather than silently resolved. Numerical claims are only used where explicitly supported; current prices, yields, travel times and service frequencies are not inferred.

The live HTML scrape recorded **40 hero references and 102 listing-photo references**. All 40 heroes already match the production hero_image and the agency listing provenance from the prior expansion, so these photographs are retained. They remain captioned individual-unit/view reference photos, not estate exterior photographs. There is no photos column or new gallery schema. No competitor photographs were copied and no new image assets were uploaded. Binary image availability and visual quality were not verified: the evidence establishes live markup presence and provenance only.

## Estate coverage

Introduction counts exclude whitespace. Every row receives the editorial and SEO refresh; all existing photos are retained.

| Estate         | Slug                      | Introduction characters before → after | Finding                                          | Live result        |
| -------------- | ------------------------- | -------------------------------------: | ------------------------------------------------ | ------------------ |
| 碧翠花園       | `bayview-terrace`         |                              162 → 212 | Repeated editorial sections                      | 200 / hero present |
| 青山別墅       | `castle-peak-villas`      |                              160 → 219 | Repeated editorial sections                      | 200 / hero present |
| 青麗灣別墅     | `ching-lai-waan-villas`   |                              154 → 209 | Repeated editorial sections                      | 200 / hero present |
| 青榕臺         | `ching-yung-toi`          |                              144 → 212 | Repeated editorial sections                      | 200 / hero present |
| 翠景花園       | `chui-king-garden`        |                              148 → 220 | Repeated editorial sections                      | 200 / hero present |
| 春和海景花園   | `chun-wo-sea-view-garden` |                              145 → 225 | Repeated editorial sections                      | 200 / hero present |
| 棕月灣         | `chung-yuet-waan`         |                              142 → 218 | Repeated editorial sections                      | 200 / hero present |
| 飛揚           | `fei-yeung`               |                              147 → 215 | Repeated editorial sections                      | 200 / hero present |
| 海澄軒         | `hoi-ching-hin`           |                              142 → 214 | Repeated editorial sections                      | 200 / hero present |
| 海景花園       | `hoi-king-garden`         |                              149 → 216 | Repeated editorial sections                      | 200 / hero present |
| 海慧花園       | `hoi-wai-garden`          |                              141 → 217 | Repeated editorial sections                      | 200 / hero present |
| 海譽           | `hoi-yu`                  |                              145 → 215 | Repeated editorial sections                      | 200 / hero present |
| 琨崙           | `kwan-lun`                |                              143 → 218 | Repeated editorial sections                      | 200 / hero present |
| 觀海別墅       | `kwun-hoi-villas`         |                              140 → 225 | Repeated editorial sections                      | 200 / hero present |
| 龍珠島花園     | `lung-chu-island-garden`  |                              144 → 189 | Repeated editorial sections                      | 200 / hero present |
| 南岸           | `nam-ngon`                |                              149 → 190 | Repeated editorial sections                      | 200 / hero present |
| NAPA           | `napa`                    |                              143 → 198 | Repeated editorial sections                      | 200 / hero present |
| 雅德苑         | `nga-tak-yuen`            |                              141 → 203 | Repeated editorial sections                      | 200 / hero present |
| 緹岸           | `ocean-camino`            |                              142 → 197 | Repeated editorial sections                      | 200 / hero present |
| 愛琴灣         | `oi-kam-waan`             |                              142 → 198 | Repeated editorial sections                      | 200 / hero present |
| OMA by the Sea | `oma-by-the-sea`          |                              150 → 209 | Repeated editorial sections                      | 200 / hero present |
| 翠濤居         | `palm-cove`               |                              145 → 200 | Repeated editorial sections                      | 200 / hero present |
| 蟠龍半島       | `pun-lung-bun-do`         |                              144 → 194 | Repeated editorial sections                      | 200 / hero present |
| 帝灣居         | `royal-cove-tower`        |                              147 → 198 | Repeated editorial sections                      | 200 / hero present |
| 嘉御龍庭       | `royal-dragon-villa`      |                              145 → 194 | Repeated editorial sections                      | 200 / hero present |
| 畔海           | `seaside-castle`          |                              142 → 193 | Repeated editorial sections                      | 200 / hero present |
| 瑜翠園         | `yu-chui-yuen`            |                              147 → 198 | Repeated editorial sections                      | 200 / hero present |
| 蒙地卡羅別墅   | `monte-carlo-villas`      |                               95 → 243 | Short introduction + repeated editorial sections | 200 / hero present |
| 逸璟．龍灣     | `l-aquatique`             |                               90 → 247 | Short introduction + repeated editorial sections | 200 / hero present |
| 星岸           | `deauville`               |                               89 → 253 | Short introduction + repeated editorial sections | 200 / hero present |
| 海濤花園       | `long-beach-gardens`      |                              100 → 260 | Short introduction + repeated editorial sections | 200 / hero present |
| 麗海別墅       | `riviera`                 |                               93 → 259 | Short introduction + repeated editorial sections | 200 / hero present |
| 均富花園       | `both-wealth-garden`      |                               88 → 265 | Short introduction + repeated editorial sections | 200 / hero present |
| 富安新邨       | `fiona-garden`            |                               85 → 265 | Short introduction + repeated editorial sections | 200 / hero present |
| 容龍居         | `dragon-inn-court`        |                               90 → 274 | Short introduction + repeated editorial sections | 200 / hero present |
| 屯門閣         | `tuen-mun-court`          |                               87 → 262 | Short introduction + repeated editorial sections | 200 / hero present |
| 雅翠苑         | `elegant-villa`           |                               80 → 267 | Short introduction + repeated editorial sections | 200 / hero present |
| 龍珠島平房     | `pearl-island-bungalow`   |                              102 → 274 | Short introduction + repeated editorial sections | 200 / hero present |
| 龍珠花園       | `pearl-garden`            |                              100 → 265 | Short introduction + repeated editorial sections | 200 / hero present |
| 珀居           | `peak-castle`             |                              104 → 260 | Short introduction + repeated editorial sections | 200 / hero present |

## Prepared SQL; production unchanged

The already-applied `20261026170000_listing_estate_content.sql` is unchanged. A new estate-only content patch, `20261026210000_corridor_estate_editorial_quality.sql`, is prepared and registered but **has not been applied**. It touches no properties or ingestion settings. It updates only the 40 matching, still-published identities; replaces each description/SEO field only when blank or equal to the audited baseline; fills blank heroes from reviewed agency provenance; and preserves later authored changes. Repeat execution does not churn timestamps. An estate unpublished or renamed/moved since the audit is skipped.

The static editorial sections become available after an approved merge and deployment. Database-authored SEO still takes precedence on the route, so the prepared data patch is also needed for the audited DB SEO/description fields to change. Its execution requires a later authorized operation; this task does not run it.

## Validation

- PGlite verifies all reviewed updates, blank-field repair, whole-row and single-field authored-edit preservation, unrelated rows, identity/district drift, later unpublication and repeat-run equality. Disabling the UPDATE was verified to make the regression fail; restoring it passes. The original ownership-fence regression remains passing.
- All 14 Node estate-conversion test files pass. SEO content tests pass for width, uniqueness, licence and source contracts. Blog, corridor and migration registry checks pass (7 Node test files).
- ESLint: zero errors, nine existing warnings in unrelated files. Typecheck passes.
- The local SEO sweep has 19 subprocess checks blocked by sandbox `spawnSync node EPERM` in `scripts/site-origin.test.mjs` and `scripts/vercel-config.test.mjs`. These are left to full GitHub CI; no redirect/configuration code changed. Bun is unavailable locally.
- Independent review found no blockers and checked all 40 SQL payloads against authored content and audited baselines.

Detailed evidence: [audit fixture](../src/content/fixtures/corridor-estate-quality-20261026.json). Original photo/listing provenance: [prior expansion fixture](../src/content/fixtures/listing-estate-expansion-20261026.json).

This PR is for review only. Do not merge or run neon:migrate as part of this task.
