# Castle Peak Road Content Cluster Design

Date: 2026-06-22

## Status

Approved for design by the user. This document defines the Core Corridor Launch for the Castle Peak Road / 青山公路 SEO content cluster. It is a design spec only; implementation planning begins after user review.

## Background

Earnest Property already has a public site with Neon-backed listing data, legacy public-site content, and SEO metadata for several districts. The user provided an older content brief focused on 汀九 Ting Kau and broader Castle Peak Road coverage. The agreed direction is to expand beyond a single Ting Kau page into a reusable, SEO-friendly corridor content system that combines useful area guidance with live listing inventory.

The site should avoid thin, purely static SEO pages. Corridor pages should have real buyer value, current inventory signals from Neon, and clear internal links into district, estate, listing, contact, and valuation flows.

## Approved Direction

Use the Core Corridor Launch:

- Build `/castle-peak-road` as the main SEO guide and live inventory hub for the 青山公路 coastal corridor.
- Launch five strong child segment pages at the same time.
- Make `/castle-peak-road/ting-kau` the flagship deep page and redirect the old `/district/ting-kau` route there.
- Keep true district pages such as `/district/tsuen-wan` and `/district/sham-tseng` canonical, then cross-link them into the corridor cluster.
- Use the existing Neon listing layer for live counts and listing blocks.

## Goals

- Establish Castle Peak Road as a topical content cluster rather than a single isolated page.
- Improve local SEO coverage for 汀九, 深井, 青龍頭, 掃管笏, 黃金海岸, 油柑頭, and related estate searches.
- Make Ting Kau a rich, buyer-oriented page using the provided brief.
- Reuse one segment-page model so future estate and area pages can be added without redesigning the system.
- Show live listing counts and cards where Neon has matching inventory.
- Keep pages useful when listing coverage is sparse by rendering static guidance and inquiry CTAs.

## Non-Goals

- Do not rebuild the whole site navigation in this phase.
- Do not create every possible estate page under Castle Peak Road yet.
- Do not replace canonical district pages that already represent real districts, such as Tsuen Wan and Sham Tseng.
- Do not claim MLS coverage, prices, or listing counts that are not present in the live dataset.
- Do not add paid MLS vendor integrations in this design; this phase uses the current Neon-backed listing pipeline.

## Route Architecture

The first launch cluster contains six canonical routes:

| Route | Purpose |
| --- | --- |
| `/castle-peak-road` | Parent guide, corridor overview, comparison content, live inventory by segment |
| `/castle-peak-road/tsuen-wan-yau-kom-tau` | 荃灣西 / 油柑頭 / 荃灣段 segment |
| `/castle-peak-road/ting-kau` | Flagship 汀九 Ting Kau page |
| `/castle-peak-road/sham-tseng` | 深井 segment, connected to existing Sham Tseng authority |
| `/castle-peak-road/tsing-lung-tau` | 青龍頭 / 豪景 / 香港花園 segment |
| `/castle-peak-road/so-kwun-wat-gold-coast` | 掃管笏 / 黃金海岸 segment |

Redirect and canonical behavior:

- `/district/ting-kau` redirects permanently to `/castle-peak-road/ting-kau`.
- Future legacy Ting Kau aliases should also resolve to `/castle-peak-road/ting-kau`.
- `/district/tsuen-wan` remains canonical as a district page and links to the corridor hub and relevant segment.
- `/district/sham-tseng` remains canonical as a district page and links to the corridor hub and relevant segment.
- New internal links should prefer the `/castle-peak-road/*` URLs for corridor-segment intent.

## Content Model

Each corridor page follows the same reusable structure:

1. Hero with bilingual area name, buyer positioning, live sale and rent counts, and primary CTA.
2. Area guide covering transport, lifestyle, housing profile, sea-view or low-density positioning, and school net where relevant.
3. Featured estates and buildings with local Chinese and English names.
4. Live listing block with sale/rent tabs, price/rent/size filters, newest listing cards, empty state, and inquiry CTA.
5. Comparison and internal-link section connecting adjacent segments, district pages, estate pages, listing filters, contact, and valuation.
6. FAQ section in Traditional Chinese with relevant English place or estate names where search intent uses them.

The depth varies by segment. Ting Kau receives the richest content in phase one. Other segment pages use a consistent structure with enough local context to stand alone, but avoid overclaiming where the old content or live data is limited.

## Ting Kau Flagship Page

The Ting Kau page should use the brief as its primary source. Required themes:

- H1 meaning: `汀九 Ting Kau · 青山公路低密度海景住宅`.
- Meta title meaning: `汀九 Ting Kau 樓盤｜青山公路低密度海景別墅、洋房`.
- Meta description should mention 觀海別墅, 嘉御龍庭, 汀九別墅, location between 荃灣 and 深井, school net 62, true listings, and agency license `C-018613`.
- Positioning: low-density villas, houses, sea-view homes, privacy, space, and quieter waterfront lifestyle.
- Local context: between 荃灣油柑頭 and 深井, views toward Ting Kau Bridge and Tsing Ma Bridge, closer access to Tsuen Wan and airport routes.
- Featured estates: Vista Del Mar / 觀海別墅, Royal Dragon Villa / 嘉御龍庭, Ting Kau Villa / 汀九別墅.
- FAQs should cover available property types, school net, transport, and Ting Kau versus Sham Tseng.

## Segment Coverage

Phase-one segment content should include these examples and aliases where they match the site dataset:

| Segment | Examples |
| --- | --- |
| Tsuen Wan / Yau Kom Tau | 荃灣西, 油柑頭, 海雲軒, 縉皇居 |
| Ting Kau | 觀海別墅, 嘉御龍庭, 汀九別墅, 青山公路汀九段 |
| Sham Tseng | Bellagio, Sea Crest Villa, Lido Garden, Rhine Garden, Hong Kong Garden |
| Tsing Lung Tau | 青龍頭, 豪景花園, 香港花園, nearby low-density/coastal homes |
| So Kwun Wat / Gold Coast | Aegean Coast, Serenade Cove, Gold Coast, 帝濤灣, 漣山, 滿名山, 星堤, NAPA, OMA by the Sea, 瑜翠園 |

## Data Flow

Use the current server-side Neon data access layer. Each segment has:

- A canonical slug.
- A display name in Chinese and English.
- A set of listing aliases for district, area, building, and estate matching.
- Static SEO/content fields.
- FAQ entries.
- Internal-link definitions.

Listing counts and cards should come from Neon using the same normalized listing model used elsewhere on the site. If a query finds no matching listings, the segment still renders static content and a useful inquiry CTA. Empty states should say that current matching listings are limited and invite the visitor to contact Earnest Property for off-market or fresh options.

Live listing claims must be derived from the result set. Do not hard-code sale/rent counts into copy.

## SEO And Structured Data

Each new route needs unique metadata:

- Title.
- Description.
- Canonical path.
- H1.
- Open Graph title and description if the existing metadata system supports it.

Structured data requirements:

- BreadcrumbList for `/castle-peak-road` and child pages.
- FAQPage for visible FAQs.
- ItemList for visible live listing cards when listings exist.
- Existing RealEstateAgent or LocalBusiness identity should remain consistent with the rest of the site.

Sitemap generation should include the new canonical routes. Redirected routes should not appear as canonical sitemap entries.

## UX And Visual Direction

The visual treatment should match the corrected public-site direction after the dark-mode/color feedback:

- Bright, professional real-estate presentation.
- No accidental dark-mode page treatment.
- Practical, scan-friendly sections rather than marketing-only hero copy.
- Live inventory modules should feel like part of the content page, not a disconnected listing app.
- Desktop and mobile layouts must keep text readable and avoid overlap in cards, filters, FAQ blocks, and CTAs.

The `/castle-peak-road` hub should make the corridor map mentally clear through ordered segment cards or bands from east to west. A visual map is optional for phase one; the required outcome is understandable corridor navigation and strong internal links.

## Testing And Verification

Implementation should include or update checks for:

- Every new route has title, description, H1, canonical slug, FAQ entries, and internal links.
- `/district/ting-kau` redirects to `/castle-peak-road/ting-kau`.
- `/district/tsuen-wan` and `/district/sham-tseng` remain canonical.
- Segment listing queries return Neon results where matching data exists.
- Empty listing states render without errors.
- Existing SEO, MLS, cron, contact, migration, lint, and build checks remain passing.
- Desktop and mobile visual checks cover the hub and Ting Kau page.

After deployment, verify the production alias `https://earnestproperty.vercel.app` and confirm that live listing counts render from Neon.

## Acceptance Criteria

- `/castle-peak-road` is a canonical parent guide with live segment inventory.
- The five phase-one segment routes are canonical, indexable, internally linked, and included in the sitemap.
- Ting Kau content reflects the supplied brief and no longer relies on `/district/ting-kau` as the canonical page.
- Listing counts and listing cards use Neon-backed live data.
- Pages remain useful when a segment has few or no matching listings.
- Metadata and FAQ schema are unique per page.
- The design does not introduce a dark-mode visual regression.
