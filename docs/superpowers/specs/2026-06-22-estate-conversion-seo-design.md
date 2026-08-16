# Estate Conversion SEO and Trust Content Design

Date: 2026-06-22

## Status

Approved for design by the user. This document defines the next conversion SEO layer for Earnest Property estate pages, search fallback capture, owner valuation leads, and factual trust content. It is a design spec only; implementation planning begins after user review.

## Background

Earnest Property already has a public TanStack Start site with live listing routes, estate pages, district pages, corridor content, and a Neon-backed listing pipeline. The user now wants the homepage's core estates to become stronger independent SEO pages, and wants search and WhatsApp CTAs to capture high-intent users instead of ending in passive browsing.

The approved direction is:

- Use approach A, Conversion Layer On Existing Pages.
- Add a small structured estate content registry from approach C.
- Include useful factual content from the public 28Hse agent page at `https://www.28hse.com/agent/540`.
- Keep the launch scoped to public SEO/conversion pages and reusable content infrastructure.

The existing wording rule remains active: use `堅盤源` and avoid the older disallowed wording.

## Goals

- Turn core estate cards into genuinely useful independent SEO pages.
- Make each estate page answer buyer, renter, and owner questions before pushing to WhatsApp.
- Add intent-specific WhatsApp CTAs for buying, renting, and owner valuation.
- Add a search fallback CTA for users who cannot find a suitable listing.
- Add a clear `業主放盤 / 免費估價` entry point.
- Use factual trust assets from Earnest Property and 28Hse without inventing testimonials, reviews, or unverified claims.
- Keep the architecture reusable for additional estates and corridor/area pages.

## Non-Goals

- Do not create a full CRM, lead database, or form backend in this round.
- Do not scrape private, logged-in, or non-public listing data.
- Do not copy 28Hse listing descriptions or marketing copy into the site.
- Do not display Google review claims from share links unless the exact content is manually verified later.
- Do not replace the current Neon/live-listing pipeline.
- Do not create a large CMS migration before the first conversion layer ships.

## Source Inputs

### Existing Site Data

Use the current site data and modules:

- `src/content/seo.ts` for the existing estate SEO registry.
- `src/routes/estate.$slug.tsx` for the estate SEO page.
- `src/routes/listings.tsx` for public search.
- `src/routes/index.tsx` for the homepage search/CTA experience.
- `src/config/site.ts` for company identity, WhatsApp helpers, address, and licence.
- `src/lib/queries.ts` for estate listings and estate transaction helpers.

### 28Hse Public Agent Page

Useful facts observed from `https://www.28hse.com/agent/540`:

- Company name: `晉誠地產代理有限公司`.
- English company name: `Earnest Property Agency Ltd`.
- Company licence: `C-018613`.
- Company phone: `852-26882988`.
- Company address: `深井麗都花園地下5A舖`.
- Public branch/team roster includes agents such as Kelvin Lee, Tommy Yiu, Kenneth Chang, Mon Lau, Mike K.n.cheung, Mun Chu, Andy Hah, Winnie Cheung, and Terence Tang, with public licence numbers shown on the page.
- The page showed `共有 229 個放售樓盤` at access time.
- Public listing examples indicate coverage across 深井, 屯門青山公路, 碧堤半島, 琨崙, 海澄軒, and other Castle Peak Road/coastal estates.

These facts may be rewritten into the site as evidence of local presence and public listing footprint. The implementation should not quote listing titles, copy listing descriptions, or claim live 28Hse counts as current unless they are re-fetched and clearly timestamped.

## Content Architecture

Create or extend a small estate content registry. The registry should keep structured content out of route files and make future estate pages easy to add.

The first registry should cover the core homepage estates:

| Estate | Slug |
| --- | --- |
| 碧堤半島 / Bellagio | `bellagio` |
| 浪翠園 / Sea Crest Villa | `sea-crest-villa` |
| 豪景花園 / Hong Kong Garden | `hong-kong-garden` |
| 海韻花園 / Rhine Garden | `rhine-garden` |
| 麗都花園 / Lido Garden | `lido-garden` |

Each registry entry should support:

- Page title and meta description.
- Short hero positioning.
- Overview paragraphs.
- Buyer/renter fit notes.
- Pros.
- Watchouts.
- Transport and lifestyle notes.
- Market snapshot copy.
- Sale/rent CTA copy.
- Owner valuation CTA copy.
- FAQ items.
- Related estate or district links.
- Optional factual trust notes.

The content can live in the existing `src/content/seo.ts` if the change remains tidy. If the file becomes crowded, create a focused `src/content/estate-pages.ts` module and export helpers for the existing route.

## Route and Page UX

The existing `/estate/$slug` route remains canonical for estate SEO pages.

Each estate page should render this flow:

1. Hero with estate name, district, positioning, and three intent CTAs.
2. Market snapshot showing available listing counts, latest transaction rows if available, and an honest data note when data is thin.
3. Estate guide with introduction, transport/lifestyle context, and buyer/renter fit.
4. Pros and watchouts.
5. Latest sale/rent listing section using existing live listing queries.
6. Search fallback CTA when matching inventory is thin or missing.
7. Owner valuation panel for `深井業主估價報告` and `免費估價`.
8. Factual trust proof panel.
9. FAQ section and related internal links.

Estate pages should remain useful even if listings or transaction rows are missing. Empty states should push users toward a specific WhatsApp action rather than showing a dead end.

## Intent WhatsApp CTAs

Add reusable intent-specific WhatsApp messaging.

Required intents:

| Intent | Label | Message Goal |
| --- | --- | --- |
| Buy | `我要買樓` | Capture estate, budget, rooms, timing, and viewing needs |
| Rent | `我要租樓` | Capture estate, budget, move-in date, rooms, and pets/family needs where relevant |
| Valuation | `我要放盤估價` or `免費估價` | Capture estate/building, flat size, floor/view, sale or rent intent, and preferred contact time |

The implementation can extend `whatsappUrl(message)` with a typed helper such as `whatsappIntentUrl(intent, context)`. Routes and components should use the helper rather than hand-building query strings.

## Search Fallback Lead Capture

The `/listings` search experience should include a fallback CTA:

- Show strongly in zero-result states.
- Show as a lighter end-of-results CTA when results exist but the user may still need help.
- Include estate/district/search context in the WhatsApp message when available.
- Use the approved wording concept: `搵唔到心水盤？WhatsApp 講低預算，代理幫你配盤。`

The homepage search should navigate into `/listings` with useful query parameters where the existing search model supports them. If a typed free-text search cannot be fully supported yet, the CTA should still route to `/listings` and offer a WhatsApp fallback.

## Owner Valuation Entry

Add a visible owner-focused entry point:

- Header/nav label: `業主放盤 / 免費估價`.
- Homepage section or band with anchor target such as `/#owner-valuation`.
- Estate-page owner panel customized by estate name.
- WhatsApp-first lead magnet: `深井業主估價報告`.

This round should stay WhatsApp-first. Do not add a form database yet. The CTA should set clear expectations that Earnest can provide a local valuation view after the owner shares building, size, floor/view, and sale/rent intent.

## Trust Proof Content

Use verifiable, factual trust assets only:

- Company licence `C-018613`.
- Shop address at 深井麗都花園地下5A舖.
- Main phone `2688 2988`.
- Local branch/team presence.
- Public 28Hse agent profile link.
- Public agent roster as optional name/licence proof.
- Observed 28Hse public sale-listing footprint as a dated public signal, if displayed with care.
- Existing site promises such as licensed agency, local focus, and `堅盤源` process.

Do not invent:

- Google review counts.
- Customer testimonials.
- Transaction screenshots.
- Awards.
- Agent photos if image rights or source quality are not confirmed.

The supplied Google share links should remain internal candidate references until their target pages and review content are manually confirmed.

## Component Boundaries

Implementation should prefer small components with clear purposes:

- `IntentWhatsAppCTA`: renders intent-specific buttons and builds messages through the site helper.
- `EstateMarketSnapshot`: renders listing counts, transaction rows, and missing-data notes.
- `SearchFallbackCTA`: reusable zero-result/end-of-results lead capture block.
- `OwnerValuationPanel`: WhatsApp-first owner valuation panel.
- `TrustProofPanel`: company licence, address, phone, public profile, and factual local proof.
- Estate content helper: returns content by estate slug and keeps page rendering generic.

The route file should compose these components rather than holding large blocks of copy and CTA logic inline.

## Data Flow

Estate pages should combine:

1. Static content from the estate content registry.
2. Estate and listing data from existing server-side queries.
3. Transaction rows from `fetchEstateTransactions(estateId, limit)` where available.
4. Site identity and WhatsApp helpers from `src/config/site.ts`.

Live claims must come from the current data layer. Static copy can say Earnest specializes locally, but it should not hard-code live listing counts, transaction prices, or psf values unless sourced by a query or clearly labeled as illustrative.

## Error Handling and Empty States

- Unknown estate slugs keep existing 404 behavior.
- Missing estate content falls back to existing estate metadata where possible.
- Missing transactions show an honest note and valuation CTA.
- Missing listings show the search fallback CTA.
- Missing WhatsApp phone configuration should continue using the existing helper behavior, with no runtime crash.
- External public proof links should open in a new tab with safe attributes.

## SEO Requirements

- Each enriched estate page keeps unique title and meta description.
- FAQ schema should include only visible FAQs.
- Sitemap generation should continue to include every estate registry URL.
- Internal links should connect homepage cards, estate pages, district pages, corridor pages, listings, contact, and owner valuation.
- Copy must use `堅盤源` and avoid the older disallowed wording.
- The public site should remain bright and professional after the previous dark-mode color feedback.

## Testing and Verification

Implementation should include or update tests for:

- Estate registry entries have required fields for core estates.
- Estate pages render enriched sections without throwing when listings or transactions are empty.
- Search fallback CTA appears for zero-result states.
- WhatsApp intent helper generates encoded messages for buy, rent, and valuation.
- Header or homepage includes the owner valuation entry.
- Sitemap still includes estate pages.
- No source files contain the older disallowed wording.

Manual or browser verification should cover:

- Homepage.
- `/listings`.
- At least one estate page with listings, such as `/estate/bellagio`.
- One estate page with sparse or missing listings, if available.
- Mobile and desktop layouts for CTA wrapping and text overlap.

If this work is deployed, verify the Vercel production alias `https://earnestproperty.vercel.app` after deployment.

## Acceptance Criteria

- Core estates have richer independent SEO pages with guide content, pros/watchouts, FAQ, market snapshot, listings, owner CTA, and trust proof.
- Search no longer ends in a passive empty state; it captures high-intent users through WhatsApp.
- WhatsApp CTAs are segmented into buy, rent, and valuation intents with different prefilled messages.
- The site has a visible `業主放盤 / 免費估價` pathway.
- Public 28Hse facts are used only as factual trust signals and not copied as third-party marketing text.
- Google share links are not used for public claims until verified.
- The implementation keeps using live/Neon data for current listing and transaction claims.
- Tests and build pass before completion.
