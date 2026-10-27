# Estate exterior sourcing — third pass

**Outcome: zero additional qualifying exterior sources.** The original 36 gaps remain unresolved; overall corridor coverage stays **25/61**. This is a new discovery/evidence pass on the existing [PR #289](https://github.com/YNWAforever/earnestproperty/pull/289), not a photo-selection change. Baseline tip: `5d11e33f98c446c73d5c97e9558c0d578a4a9f9c`.

## Counts

| Scope                                         | Before | After this pass |
| --------------------------------------------- | -----: | --------------: |
| Source-verified exteriors among these 36 gaps |      0 |               0 |
| Missing exteriors among these 36              |     36 |              36 |
| Exteriors across all 61 corridor estates      |     25 |              25 |
| Listing-unit hero / DB listing fallbacks      |      0 |               0 |

**New estates added: none. New licenses selected: none.** Registry photo metadata, captions/alt, source/license links, hero omission and social fallback behavior remain unchanged. The 10 licensed sources from the first two passes are retained.

## New routes used

The [round-2 audit](estate-exterior-sourcing-round2-20261026.md) was used as an exclusion ledger. Known platform-exclusion, construction/ad, tiny-neighbourhood, door-number and unresolved-identity candidates were not re-proposed as heroes.

- **Commons live API:** 85 file-namespace search requests and 12 current categorymember reads, covering all 36 unresolved names and aliases. This found one previously missed estate-related aerial still. Prior indexed-page searches had not surfaced it.
- **Openverse and Flickr:** a separate pass for 10 focus estates used 29 Openverse API URLs and 23 primary Flickr license-filtered search pages. Fifteen API responses explicitly returned zero results; **14 timed out**. Twenty Flickr pages explicitly reported no matches; three exposed no photo records. Timeouts and unreadable pages are **not** treated as zero results or evidence that no photograph exists.
- **New Mapillary-import discovery:** bounded Commons searches by relevant estate/street names returned no new matches. No protected street-view screenshots were captured.
- **Primary grant/archival checks:** the new YouTube-derived aerial was checked against the original watch page, embed, oEmbed and archived watch-page captures. These surfaces did not expose the original reuse grant.

The adjacent [structured evidence](estate-exterior-sourcing-round3-20261026.json) retains query URLs, returned titles, source records, failures and the exact 36-estate set. This is a bounded search, not proof that no qualifying source exists anywhere.

## Newly discovered leads that do not qualify

### 帝御: Seacoast Royale aerial still

[Commons file: Seacoast Royale Aerial view 202201.png](https://commons.wikimedia.org/wiki/File:Seacoast_Royale_Aerial_view_202201.png) identifies 帝御金灣, dates the source to 22 January 2022 and credits **Brian 帶你飛**. It claims CC BY 3.0, but is a third-party YouTube still and explicitly carries **License review needed**. The uploader is not claiming their own work.

The [original video](https://www.youtube.com/watch?v=282uy6t__9M) confirms the title/channel, but the accessible responses expose no license grant. A Wayback index found 2022/2023/2026 captures; the retrieved historical pages exposed only title/author, and the raw replay could not be read. Neither an archive timestamp nor a thumbnail is license verification. The original grant, photograph composition and completed-building state remain unresolved, so **the still is not selected**.

### 蟠龍半島: Flickr tag-level lead

A Beaulieu tag page exposed the title `hong_kong_airport_20240420173738` by `inunami`. No primary photo record, reusable license, trustworthy capture date, direct image URL or substantial exact-estate subject evidence was obtained. A tag/title is insufficient; **no image is selected**.

Newly surfaced construction filenames and a logo/vector were excluded as non-candidates. None of the previously rejected Peak Castle/Jade Grove/Crown By The Sea platform-exclusion images is proposed again.

## Access and verification limits

- The available Firecrawl connections were checked and all had zero credits, so no further scrape/browser request was made through that service.
- The available web/image tools did not provide image pixels or a native browser session. The conditional Bayview Terrace/Aquamarine candidates therefore did not gain the missing composition evidence.
- Only existing, allowed read interfaces were used. Network policy was not changed or bypassed. No competitor photograph was fetched or copied, and no new Blob or other media upload occurred.
- An approved agency-owned/licensed exterior-photo folder or independently confirmed primary photo grant would provide a useful new source. The previously inspected legacy Drive ZIP exceeds the connector download limit. No user-supplied folder was available when this report was prepared.

## The 36 gaps remain unchanged

| Estate         | Slug                      | Result                                          |
| -------------- | ------------------------- | ----------------------------------------------- |
| 帝御           | `tai-yu`                  | No new qualifying source; hero remains omitted. |
| 黃金海灣       | `wong-gam-hoi-waan`       | No new qualifying source; hero remains omitted. |
| Oma Oma        | `oma-oma`                 | No new qualifying source; hero remains omitted. |
| 漣山           | `lin-shan`                | No new qualifying source; hero remains omitted. |
| 碧翠花園       | `bayview-terrace`         | No new qualifying source; hero remains omitted. |
| 青山別墅       | `castle-peak-villas`      | No new qualifying source; hero remains omitted. |
| 青麗灣別墅     | `ching-lai-waan-villas`   | No new qualifying source; hero remains omitted. |
| 青榕臺         | `ching-yung-toi`          | No new qualifying source; hero remains omitted. |
| 翠景花園       | `chui-king-garden`        | No new qualifying source; hero remains omitted. |
| 春和海景花園   | `chun-wo-sea-view-garden` | No new qualifying source; hero remains omitted. |
| 棕月灣         | `chung-yuet-waan`         | No new qualifying source; hero remains omitted. |
| 海澄軒         | `hoi-ching-hin`           | No new qualifying source; hero remains omitted. |
| 海慧花園       | `hoi-wai-garden`          | No new qualifying source; hero remains omitted. |
| 海譽           | `hoi-yu`                  | No new qualifying source; hero remains omitted. |
| 琨崙           | `kwan-lun`                | No new qualifying source; hero remains omitted. |
| 觀海別墅       | `kwun-hoi-villas`         | No new qualifying source; hero remains omitted. |
| 蒙地卡羅別墅   | `monte-carlo-villas`      | No new qualifying source; hero remains omitted. |
| 雅德苑         | `nga-tak-yuen`            | No new qualifying source; hero remains omitted. |
| 愛琴灣         | `oi-kam-waan`             | No new qualifying source; hero remains omitted. |
| OMA by the Sea | `oma-by-the-sea`          | No new qualifying source; hero remains omitted. |
| 蟠龍半島       | `pun-lung-bun-do`         | No new qualifying source; hero remains omitted. |
| 帝灣居         | `royal-cove-tower`        | No new qualifying source; hero remains omitted. |
| 嘉御龍庭       | `royal-dragon-villa`      | No new qualifying source; hero remains omitted. |
| 畔海           | `seaside-castle`          | No new qualifying source; hero remains omitted. |
| 瑜翠園         | `yu-chui-yuen`            | No new qualifying source; hero remains omitted. |
| 星岸           | `deauville`               | No new qualifying source; hero remains omitted. |
| 海濤花園       | `long-beach-gardens`      | No new qualifying source; hero remains omitted. |
| 麗海別墅       | `riviera`                 | No new qualifying source; hero remains omitted. |
| 均富花園       | `both-wealth-garden`      | No new qualifying source; hero remains omitted. |
| 富安新邨       | `fiona-garden`            | No new qualifying source; hero remains omitted. |
| 容龍居         | `dragon-inn-court`        | No new qualifying source; hero remains omitted. |
| 屯門閣         | `tuen-mun-court`          | No new qualifying source; hero remains omitted. |
| 雅翠苑         | `elegant-villa`           | No new qualifying source; hero remains omitted. |
| 龍珠島平房     | `pearl-island-bungalow`   | No new qualifying source; hero remains omitted. |
| 龍珠花園       | `pearl-garden`            | No new qualifying source; hero remains omitted. |
| 珀居           | `peak-castle`             | No new qualifying source; hero remains omitted. |

## Scope and validation

**Documentation/evidence only. No registry, route or test implementation changes. No Neon access, migration/data patch, merge or production promotion.** PR #289 remains open and held for Willy.

The evidence set is checked against the round-2 36 unresolved identities; accepted sources must be empty, and before/after counts must remain 0/36 within this set and 25/61 overall. Existing hero omission and the prior four additions are unchanged. CI status for the documentation tip is recorded in the PR body.
