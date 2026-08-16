# SEO Full Content and MLS Integration Design

## Goal

Turn Earnest Property into a full-content, SEO-friendly public website that preserves the old site's live listing value, corrects local estate data, expands hyperlocal content, and keeps public listings fresh through a repeatable importer.

## Current Evidence

- The repo is a TanStack Start app deployed to Vercel, using Supabase client queries for public data and Neon Auth for auth UI.
- The public SEO brief lives at `/Users/willylai/Documents/Claude/Projects/Earnestproperty content/earnest-property-content-seo.md`.
- The old public MLS pages are reachable and indexable:
  - `https://www.earnestproperty.com/property/c1`
  - `https://www.earnestproperty.com/property/c2`
  - `https://www.earnestproperty.com/property/c5`
- The old MLS index pages advertise 1,013 listings, but `c1`, `c2`, and `c5` currently expose the same page shape and should be treated as seed URLs, not authoritative category definitions.
- Old detail pages such as `https://www.earnestproperty.com/property-detail/6709182.html` expose parseable public data: meta title, meta description, OG image, update date, property number, district, street, building names, sale price, rent, saleable area, gross area, psf, bedrooms/living rooms, orientation, contact branch, phone, license, and image gallery URLs.
- Current code already has public listing routes, property detail pages, estate pages, district pages, and a `properties` table with `legacy_detail_id` fields added by migration.

## Product Scope

This round includes both content SEO and the bigger MLS/live listing integration.

The website should become a useful public destination for:

- Buyers searching Sham Tseng, Ting Kau, Tsuen Wan, and Castle Peak Road properties.
- Sellers and landlords looking for a local agency.
- Search engines and AI answer engines looking for structured, local, citation-friendly property information.
- Internal staff who need the new website to show live public listings without manually copying every listing.

## Information Architecture

The site keeps the existing main routes:

- `/` homepage.
- `/listings` public search.
- `/property/$listingNo` detail pages.
- `/district/sham-tseng`.
- `/district/tsuen-wan`.
- `/estate/$slug`.
- `/blog`.
- `/about`.
- `/agents`.
- `/contact`.

This round adds:

- `/blog/$slug` for indexed article detail pages.
- `/district/ting-kau` for the Ting Kau / Yau Kom Tau low-density page from the SEO brief.
- `/api/mls-sync` server route for scheduled MLS refresh.

The URL strategy keeps old `property-detail/*.html` URLs redirected to new property detail URLs when a matching imported listing exists. If a specific mapping is unavailable, the old URL falls back to `/listings`.

## Estate Data Corrections

The public estate layer must use the corrected names from the SEO brief:

- `belvedere-garden` becomes `bellagio`.
- `sea-pearl-garden` becomes `rhine-garden`.
- Bellagio uses English name `Bellagio`, developer `會德豐 / 九龍倉`, years `2003-2006`, phases `3`, total units `3345`, and area range `515-1961`.
- Sea Crest Villa uses developer `新鴻基`, years `1992-1997`, phases `5`, total units `2389`.
- Hong Kong Garden uses developer `華懋集團`, years `1986-1991`, phases `3`, total units `2830`.
- Rhine Garden uses English name `Rhine Garden`, year `1992`, total units `1068`.
- Lido Garden uses English name `Lido Garden`, year `1988`, total units `1392`.

Old estate slugs get permanent redirects:

- `/estate/belvedere-garden` -> `/estate/bellagio`
- `/estate/sea-pearl-garden` -> `/estate/rhine-garden`

All header, footer, homepage, generated redirects, tests, and data mapping must use the corrected slugs.

## SEO Content Scope

The SEO brief content becomes production content, not a static attachment.

Required content additions:

- Root metadata uses first-party OG data and no `lovable.app` preview image.
- Homepage keeps its current visual design, but FAQ answers and LocalBusiness JSON-LD are cleaned up.
- Sham Tseng district page gets the long local introduction, refined metadata, clean FAQ, FAQ schema, and internal links to estates/blog.
- Tsuen Wan page changes from an empty placeholder to a real district page with metadata, intro copy, transport/comparison content, and links to Sham Tseng/Ting Kau.
- Ting Kau page is added with the low-density villa/house content, FAQ, metadata, and internal links.
- Estate pages show corrected overview copy, stat bars, buyer-fit notes, FAQ schema, breadcrumb schema, and live listing sections.
- About page is expanded into an E-E-A-T trust page.
- Blog list reads published articles.
- Two complete articles from the SEO brief are published:
  - `/blog/sham-tseng-buying-guide-2026`
  - `/blog/bellagio-vs-sea-crest-villa-vs-hong-kong-garden`

FAQ schema is only emitted for FAQs displayed on the same page.

## MLS Integration Architecture

Use a hybrid public crawler/importer.

Core modules:

- `scripts/old-site-migration/discover.mjs` continues to discover listing URLs from old public pages.
- `scripts/old-site-migration/parse.mjs` parses old MLS index and detail HTML into normalized intermediate records.
- `scripts/old-site-migration/normalize.mjs` maps parsed records into database-ready rows.
- `scripts/old-site-migration/import.mjs` imports the current crawl into Supabase/Neon-backed tables.
- `src/lib/mls/importer.ts` contains shared importer logic that can be called by both a CLI script and the Vercel server route.
- `src/routes/api/mls-sync.ts` verifies `CRON_SECRET` and runs the importer for production refreshes.

The old public site remains the source of truth for imported public listing fields in this round. The architecture should allow a future direct MLS/API feed to replace the fetch layer without changing public routes.

## Data Model

Use the existing `properties` table where possible.

Fields from old detail pages map as follows:

- Old detail URL ID, for example `6709182`, maps to `legacy_detail_id`.
- Old property number, for example `B054805`, maps to `legacy_property_no`.
- `title_zh` is built from Chinese building name and old property number.
- `deal_type` is `sale` when sale price exists and rent is absent, `rent` when rent exists and sale price is absent. When both exist, create or update two rows differentiated by the existing `(legacy_detail_id, deal_type)` unique constraint.
- `district_slug` is inferred from address/building mapping. Sham Tseng core estates map to `sham-tseng`; Ting Kau low-density listings map to `ting-kau`; Tsuen Wan broader listings map to `tsuen-wan`; unknown Castle Peak Road west listings map to `castle-peak-road` for now.
- `estate_id` is resolved by normalized building names and corrected estate aliases.
- `price`, `rent`, `gross_area`, `saleable_area`, `bedrooms`, `bathrooms`, `floor`, `orientation`, `address`, `description`, `images`, `source_site`, `source_url`, `last_seen_at`, and `status` are filled from parsed HTML.

Imported listings are public `active` by default. A listing not seen in the latest successful import becomes `inactive` only after the import completes and the listing has been absent from every seed source in that run.

Images remain external `imgs.property.hk` URLs in this round. The app must render them with useful alt text and avoid proxying or storing them.

## Server and Scheduling

Vercel Cron calls `GET /api/mls-sync` once daily in production.

The route must:

- Require `Authorization: Bearer ${CRON_SECRET}`.
- Return `401` for missing or wrong auth.
- Use the shared importer with a conservative max page/detail limit so production refreshes finish within Vercel function limits.
- Return JSON with counts for discovered, parsed, upserted, skipped, deactivated, and errors.

The CLI importer remains available for full local/manual imports:

- `npm run mls:discover`
- `npm run mls:import`
- `npm run mls:sync`

## Public Listing UX

The listing experience must support imported live inventory:

- `/listings` shows imported listings alongside manually-created listings.
- Filters support deal type, price/rent range, bedrooms, estate, and district.
- Listing cards show listing number, estate/building, sale/rent price, saleable area, bedrooms, and image.
- Empty states encourage WhatsApp contact without pretending inventory exists.
- Estate pages show a "latest listings" section for that estate with sale/rent counts.
- Property detail pages preserve current rich media layout and include `RealEstateListing`, `Residence`, `Offer`, and breadcrumb JSON-LD where data is available.

## SEO Requirements

Every public content route must define:

- Unique title.
- Unique meta description.
- Canonical URL.
- OG title and description.
- OG image using first-party site/hero imagery or listing imagery.

Structured data:

- Homepage: `RealEstateAgent`.
- District/estate/blog pages: `BreadcrumbList`.
- Pages with displayed FAQs: `FAQPage`.
- Property details: `RealEstateListing` and `Offer`.
- Blog detail pages: `Article`.

The root `<html>` language should be `zh-HK`.

## Redirects

Add permanent redirects for old SEO-critical URLs:

- `/estate/belvedere-garden` -> `/estate/bellagio`
- `/estate/sea-pearl-garden` -> `/estate/rhine-garden`
- Existing `/property-detail/:oldId.html` should resolve to an imported new property detail route when possible. If no mapping exists, redirect to `/listings`.
- Existing `c1`, `c2`, and `c5` redirects should keep users landing on `/listings`, but the new importer should no longer rely on those redirects for data.

## Testing

The implementation must use TDD for production code changes.

Required automated coverage:

- Parser fixture tests for old MLS index pages and detail pages.
- Normalization tests for price/rent/area/bedroom parsing, estate alias mapping, and sale/rent dual rows.
- Importer tests with a fake Supabase adapter or dry-run mode.
- Route/source tests that verify corrected estate slugs are used and old wrong slugs are not present in public navigation.
- Metadata tests for page-specific titles/descriptions and no `lovable.app` OG image.
- Cron auth tests for `/api/mls-sync` handler logic.
- Blog/content tests for article slugs and required internal links.

Required manual or browser verification:

- Build succeeds.
- Public homepage renders in light theme.
- `/listings` returns live imported listings after a local or staging import.
- `/estate/bellagio` and `/estate/rhine-garden` work.
- Old estate slug redirects work.
- Production Vercel deployment is ready.

## Deployment

Use the existing Vercel project.

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- Existing public Supabase/Neon variables already used by the app.

The daily cron should only be enabled after the importer passes local fixture tests and one manual import run.

## Out of Scope

This round does not require:

- Downloading and rehosting old listing images.
- Rebuilding old mortgage/school/unlucky tools as full applications.
- Adding a direct private MLS/API feed if credentials or documentation are not available.
- Adding English-language duplicated pages with `hreflang`.
- Building a staff approval workflow before imported listings go public.

These are excluded from this round and can be added in a separate project without reworking the crawler/importer boundary.

## Success Criteria

The round is successful when:

- The site has full public content for homepage, Sham Tseng, Tsuen Wan, Ting Kau, core estates, About, Blog list, two blog posts, listings, and listing details.
- Corrected estate names/slugs are used everywhere public.
- Old public MLS listings can be discovered, parsed, normalized, and imported into the new database.
- Imported listings appear on `/listings`, estate pages, and property detail pages with SEO metadata/schema.
- A protected Vercel cron endpoint can run the refresh.
- The build, focused tests, and production deployment pass.
