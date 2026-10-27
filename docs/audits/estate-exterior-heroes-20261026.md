# Initial estate exterior hero audit

**Follow-up coverage:** this branch now has 25 of 61 corridor estates with source-verified exteriors; 36 still lack one. Four of the original 40 gaps were filled in the [second sourcing pass](estate-exterior-sourcing-round2-20261026.md). The tables below preserve the initial `2618c734` snapshot; use the follow-up audit for current gap status.

Base: `c61e6443b45df23d5323f43af29360489b5c7dcb` (#288). Production read at 2026-10-27T02:24:35.888Z. All 62 published estate URLs returned HTTP 200. The corridor set is the 61 approved presentation estates; published 龍騰閣 (`lung-tang-kok`) is outside that set and also loses its unverified DB hero. Registry publication is compared against accessible production HTML, not assumed to be live solely from a static flag.

## Result

| Published corridor estates | Before | After PR |
| --- | ---: | ---: |
| Verified curated / licensed exteriors | 15 | 21 |
| Registry unit/view listing heroes | 40 | 0 |
| DB hero_image listing fallback | 6 | 0 |
| Missing verified exterior (hero omitted) | 0 shown as missing | 40 |

Six estates gain licensed exterior photographs, including four of #288's 40 additions. The other 36 additions still lack a verified exterior. No image is newly claimed to show the whole estate: the deliberate wording is **屋苑外觀**, with capture year for the six new photos and **第三期** for the supplied Sea Crest Villa image. Existing unit photos remain in listing cards with their original provenance.

## Decision and data boundary

Use an explicit reviewed photo classification or a separately sourced exterior in the registry. Both visible hero and social metadata share the same resolver. A missing/unclassified photo omits the figure and uses the existing branded og-cover.jpg for sharing; the useful estate content and listings remain available. Do not fill an estate-wide visual slot with a unit, scenic listing view, unrelated neighbourhood image or construction photo. The new portrait exterior is contained within the hero rather than cropped into a misleading fragment.

**No Neon migration/data patch is included or applied.** No DB hero_image value, ownership fence, migration ledger or existing migration is changed. No neon:migrate command or dawn-meadow database client was run. The safe display policy needs only code. This PR is not merged and does not promote production.

## New licensed exteriors

| Estate | Slug | Source / honest subject |
| --- | --- | --- |
| 豪景花園 | `hong-kong-garden` | [Exploringlife / Wikimedia Commons, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Hong_Kong_Garden.jpg) — 屋苑外觀（2016年） |
| 浪濤灣 | `long-tou-waan` | [LN9267 / Wikimedia Commons, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Aqua_Blue_29-09-2026(1).jpg) — 屋苑外觀（2026年） |
| 飛揚 | `fei-yeung` | [建園春秋 / Wikimedia Commons, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:2024%E5%B9%B47%E6%9C%88-%E9%A3%9B%E6%8F%9A.jpg) — 屋苑外觀（2024年） |
| 海景花園 | `hoi-king-garden` | [姒姓賢寧 / Wikimedia Commons, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Seaview_Garden_%E6%B5%B7%E6%99%AF%E8%8A%B1%E5%9C%92_in_January_2023.jpg) — 屋苑外觀（2023年） |
| NAPA | `napa` | [LN9267 / Wikimedia Commons, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:NAPA_05-09-2022.jpg) — 屋苑外觀（2022年） |
| 逸璟．龍灣 | `l-aquatique` | [姒姓賢寧 / Wikimedia Commons, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:L'Aquatique_in_January_2023.jpg) — 屋苑外觀（2023年） |

These are author-published own-work Commons files under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), individually checked on their file pages for author, subject, date and license. The UI links the source and license beside each new image. Thumbnails are served by Wikimedia; no competitor photos are copied, no new Blob upload is performed, and no image binary is modified. The responsive thumbnail preserves the original aspect ratio. Remote thumbnails were opened through their Commons file-page links; the research service reported an image response. A native-browser screenshot and local binary download were unavailable, so no claim of browser-level visual verification is made. Original local assets were inspected in a contact sheet.

## Existing curated exteriors retained

| Estate | Slug | Already-on-site asset |
| --- | --- | --- |
| 碧堤半島 | `bellagio` | /estates/bellagio.jpg |
| 浪翠園 | `sea-crest-villa` | /estates/sea-crest-villa.jpg |
| 麗都花園 | `lido-garden` | /estates/lido-garden.jpg |
| 海韻花園 | `rhine-garden` | /estates/rhine-garden.jpg |
| 海雲軒 | `hoi-wan-hin` | /estates/hoi-wan-hin.jpg |
| 帝華軒 | `tai-wah-hin` | /estates/tai-wah-hin.jpg |
| 海韻臺 | `hoi-wan-toi` | /estates/hoi-wan-toi.jpg |
| 縉皇居 | `chun-wong-kui` | /estates/chun-wong-kui.jpg |
| 滿名山 | `mun-ming-shan` | /estates/mun-ming-shan.jpg |
| 香港黃金海岸 | `wong-gam-hoi-ngon` | /estates/wong-gam-hoi-ngon.jpg |
| 愛琴海岸 | `oi-kam-hoi-ngon` | /estates/oi-kam-hoi-ngon.jpg |
| 星堤 | `sing-tai` | /estates/sing-tai.jpg |
| 上源 | `seong-yuen` | /estates/seong-yuen.jpg |
| The Carmel | `the-carmel` | /estates/the-carmel.jpg |
| 帝濤灣 | `tai-tou-waan` | /estates/tai-tou-waan.jpg |

## Still missing a verified exterior

| Estate | Slug | Behavior after PR |
| --- | --- | --- |
| 帝御 | `tai-yu` | Hero omitted; branded social card |
| 黃金海灣 | `wong-gam-hoi-waan` | Hero omitted; branded social card |
| Oma Oma | `oma-oma` | Hero omitted; branded social card |
| 漣山 | `lin-shan` | Hero omitted; branded social card |
| 碧翠花園 | `bayview-terrace` | Hero omitted; branded social card |
| 青山別墅 | `castle-peak-villas` | Hero omitted; branded social card |
| 青麗灣別墅 | `ching-lai-waan-villas` | Hero omitted; branded social card |
| 青榕臺 | `ching-yung-toi` | Hero omitted; branded social card |
| 翠景花園 | `chui-king-garden` | Hero omitted; branded social card |
| 春和海景花園 | `chun-wo-sea-view-garden` | Hero omitted; branded social card |
| 棕月灣 | `chung-yuet-waan` | Hero omitted; branded social card |
| 海澄軒 | `hoi-ching-hin` | Hero omitted; branded social card |
| 海慧花園 | `hoi-wai-garden` | Hero omitted; branded social card |
| 海譽 | `hoi-yu` | Hero omitted; branded social card |
| 琨崙 | `kwan-lun` | Hero omitted; branded social card |
| 觀海別墅 | `kwun-hoi-villas` | Hero omitted; branded social card |
| 龍珠島花園 | `lung-chu-island-garden` | Hero omitted; branded social card |
| 蒙地卡羅別墅 | `monte-carlo-villas` | Hero omitted; branded social card |
| 南岸 | `nam-ngon` | Hero omitted; branded social card |
| 雅德苑 | `nga-tak-yuen` | Hero omitted; branded social card |
| 緹岸 | `ocean-camino` | Hero omitted; branded social card |
| 愛琴灣 | `oi-kam-waan` | Hero omitted; branded social card |
| OMA by the Sea | `oma-by-the-sea` | Hero omitted; branded social card |
| 翠濤居 | `palm-cove` | Hero omitted; branded social card |
| 蟠龍半島 | `pun-lung-bun-do` | Hero omitted; branded social card |
| 帝灣居 | `royal-cove-tower` | Hero omitted; branded social card |
| 嘉御龍庭 | `royal-dragon-villa` | Hero omitted; branded social card |
| 畔海 | `seaside-castle` | Hero omitted; branded social card |
| 瑜翠園 | `yu-chui-yuen` | Hero omitted; branded social card |
| 星岸 | `deauville` | Hero omitted; branded social card |
| 海濤花園 | `long-beach-gardens` | Hero omitted; branded social card |
| 麗海別墅 | `riviera` | Hero omitted; branded social card |
| 均富花園 | `both-wealth-garden` | Hero omitted; branded social card |
| 富安新邨 | `fiona-garden` | Hero omitted; branded social card |
| 容龍居 | `dragon-inn-court` | Hero omitted; branded social card |
| 屯門閣 | `tuen-mun-court` | Hero omitted; branded social card |
| 雅翠苑 | `elegant-villa` | Hero omitted; branded social card |
| 龍珠島平房 | `pearl-island-bungalow` | Hero omitted; branded social card |
| 龍珠花園 | `pearl-garden` | Hero omitted; branded social card |
| 珀居 | `peak-castle` | Hero omitted; branded social card |

Peak Castle remains in this missing list: its current MLS photo is not relabelled or promoted as a panorama. Supplying an agency-owned/licensed exterior can be a small registry follow-up. Commons categories were checked for likely matches; results limited to adverts, construction, ambiguous neighbourhood shots, and unverified candidates were excluded. In particular, Jade Grove reuse text mentions social-platform restrictions, so it was not selected for a hero/share image. South Crest and Dragon Inn Court file-page metadata was found but the image response could not be confirmed; they remain missing.

The connected Earnestproperty Drive folder was inspected for an existing exterior library. It exposes a legacy site ZIP, branding and shop photos, not a separate photo folder; the legacy ZIP exceeds the connector download limit (315,673,722 bytes versus 268,435,456). It was not downloaded or executed. No other private archive is copied into this PR.

## Evidence and validation

The adjacent JSON records each production hero URL, alt, caption, og:image, registry/DB selection and proposed result. No production DB values are inferred from these HTTP observations. The six DB-fallback slugs were hong-kong-garden, tai-yu, wong-gam-hoi-waan, oma-oma, lin-shan and long-tou-waan.

Regression coverage rejects listing/unclassified/blank/unknown hero sources; checks exterior versus panorama/phase wording and preserved attribution; and executes the route's social head function with a DB unit image to require a verified exterior or branded fallback. Existing listing-evidence fixtures and card behavior remain unchanged.
