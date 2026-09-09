# Client feedback 網頁07092026.docx — requirement-to-record ledger

Source: 網頁07092026.docx, pages 1–5 (2026-09-07 client feedback).
Implementation: `src/content/client-area-presentation.ts` holds the approved
groups, labels, orders and unresolved names. Canonical identity stays in
`src/content/estate-registry.ts`.

Legend for **DB**: `published` = a live `estates` row that passes the public
publication gate. `unpublished` = a row exists but has not cleared the gate.
`none` = no row and no registry entry.

## 深井 / 青龍頭 (docx p3)

| # | Client label | Canonical slug | Registry | DB district | Card | Issue |
|---|---|---|---|---|---|---|
| 01 | 逸璟瓏灣 | — | none | — | not rendered | **Unresolved.** No registry entry, alias or published row matches this name. Not guessed onto another estate. |
| 02 | 豪景花園 | `hong-kong-garden` | yes | `sham-tseng` | yes | Grouped under 青山公路 on its own card meta (pre-existing client exception). |
| 03 | 帝華軒 | `tai-wah-hin` | yes | `tsing-lung-tau` | yes | Was missing because `fetchEstates()` queried `sham-tseng` only. Fixed by querying approved membership; its real district is unchanged. |
| 04 | 浪翠園 | `sea-crest-villa` | yes | `sham-tseng` | yes | — |
| 05 | 海雲軒 | `hoi-wan-hin` | yes | `sham-tseng` | yes | — |
| 06 | 麗都花園 | `lido-garden` | yes | `sham-tseng` | yes | — |
| 07 | 碧堤半島 | `bellagio` | yes | `sham-tseng` | yes | — |
| 08 | 縉皇居 | `chun-wong-kui` | yes | `sham-tseng` | yes | — |
| 09 | 海韻花園 | `rhine-garden` | yes | `sham-tseng` | yes | — |
| 10 | 海韻台 | `hoi-wan-toi` | yes | `sham-tseng` | yes | Canonical display name is 海韻臺; 海韻台 is an existing alias and is used as the presentation label. One estate, one card. |

**龍騰閣 (`lung-tang-kok`)** is absent from the client's new order and so left
this curated sequence. Its registry entry, DB row, `/estate/lung-tang-kok` URL
and directory visibility are untouched.

## 青山公路區小欖至三聖 — primary (docx p2)

| # | Client label | Canonical slug | Registry | Card | Issue |
|---|---|---|---|---|---|
| 01 | 帝濤灣 | `tai-tou-waan` | yes | yes | — |
| 02 | 愛琴海岸 | `oi-kam-hoi-ngon` | yes | yes | — |
| 03 | 黃金海岸 | `wong-gam-hoi-ngon` | yes | yes | Canonical name 香港黃金海岸. Was invisible everywhere because its own name matches `outOfScopeTextAliases`' 黃金海岸. Fixed by an explicit per-estate allowance. Distinct from 黃金海灣. |
| 04 | 滿名山 | `mun-ming-shan` | yes | yes | — |
| 05 | 黃金海灣 | `wong-gam-hoi-waan` | yes | yes | Distinct estate from 黃金海岸. |
| 06 | 帝御系列 | `tai-yu` | yes | yes | 帝御系列 is a display label on the one 帝御 estate. Phase inventory is not duplicated. |
| 07 | 星堤 | `sing-tai` | yes | yes | — |
| 08 | NAPA | — | none | not rendered | **Unresolved.** |
| 09 | 上源 | `seong-yuen` | yes | yes | — |
| 10 | 凱和山 | — | none | not rendered | **Unresolved.** |
| 11 | 緹岸 | — | none | not rendered | **Unresolved.** |
| 12 | 飛揚 | — | none | not rendered | **Unresolved.** Appears on 28Hse as an estate under 屯門(青山公路); that is a third-party listing site's own taxonomy, not a verified identity in this repo. |
| 13 | 其他 | — | n/a | group control | Not an estate. No slug, row, figure or detail page. |

## 青山公路區小欖至三聖 — 其他 (docx p2)

| # | Client label | Canonical slug | Registry | Card | Issue |
|---|---|---|---|---|---|
| 01 | OMA OMA | `oma-oma` | yes | yes | Canonical display is `Oma Oma`; `OMA OMA` is an existing alias, so the client's spelling is searchable. |
| 02 | THE Carmel | `the-carmel` | yes | yes | One estate. The document's line break must not create a separate `THE` entry. |
| 03 | 漣山 | `lin-shan` | yes | yes | — |
| 04 | 浪濤灣 | `long-tou-waan` | yes | yes | — |
| 05 | 翠濤居 | — | none | not rendered | **Unresolved.** |
| 06 | 棕月灣 | — | none | not rendered | **Unresolved.** Deliberately not resolved to any similarly-named estate. |
| 07 | 愛琴灣 | — | none | not rendered | **Unresolved.** Not resolved to 愛琴海岸. |

## 油柑頭汀九 (docx p1, p4)

No registry entry carries `districtSlug` `ting-kau` or `yau-kom-tau`, so this
group has no canonical members and renders an honest empty state on the
overview. The segment's real 觀海別墅 / 嘉御龍庭 / 汀九別墅 names live in
`castle-peak-road.ts`'s `featuredEstates` as free text precisely because they
are not DB-backed estates; none was promoted to an estate card.

## Open questions for the client

1. **逸璟瓏灣, NAPA, 凱和山, 緹岸, 飛揚, 翠濤居, 棕月灣, 愛琴灣** — please confirm
   each estate's full name and, where possible, its English name or a listing
   URL, so a canonical record can be created rather than guessed. Until then
   these names are recorded here and are not rendered as cards.
2. **docx p5's 深井 annotation** — an arrow points from 深井 toward the
   青山公路走向示意 heading. It does not say whether the heading should become
   深井走向示意, whether only part of a label changes, or whether it marks a
   different target. The three-region sequence it also supplies is implemented;
   the heading, the 青山公路 hub H1, its canonical URL and its metadata are
   unchanged pending confirmation.
