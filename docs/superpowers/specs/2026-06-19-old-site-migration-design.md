# Old Site Migration Design

Date: 2026-06-19

## Context

The existing public site at `https://www.earnestproperty.com/` is a PHP/Apache website. Its public sitemaps expose three main URL families:

- General pages: 17 URLs, including home, profile, contact, property lists, list-your-property, news, school, mortgage, bank valuation, unlucky properties, and transaction trend pages.
- Property details: 2,350 URLs, including Traditional Chinese and English versions under `/property-detail/{id}.html` and `/eng/property-detail/{id}.html`.
- District/building listing pages: 253 sitemap entries, around 65 unique URLs after dedupe.

The new application is a TanStack Start app backed by Supabase, with existing routes for home, listings, property detail, estate pages, district pages, agents, blog, contact, and dashboard flows.

The migration will use the old public site only. There is no database/admin export available.

## Agreed Migration Strategy

Use a phased public-crawl migration.

Phase 1 launches the new Vercel/Supabase site with the listings currently browseable through these old public listing index families:

- `https://www.earnestproperty.com/property/`
- `https://www.earnestproperty.com/property/c1/`
- `https://www.earnestproperty.com/property/c2/`
- `https://www.earnestproperty.com/property/c5/`

The long tail of old detail URLs is preserved through redirects/fallbacks. English and Simplified Chinese legacy URLs redirect to the main Traditional Chinese new pages for Phase 1. Listing images are hotlinked at launch, then copied to owned storage in a later backfill.

## Architecture

Build a repeatable migration pipeline beside the app. The old public site is treated as a read-only source.

### 1. Discover

Crawl the selected old listing indexes:

- `/property/`
- `/property/c1/`
- `/property/c2/`
- `/property/c5/`

The crawler follows pagination and collects unique `/property-detail/{id}.html` URLs. It should also record the source index family where each listing was discovered so imported records can retain launch-set provenance.

### 2. Extract

Fetch each selected detail page and parse stable fields from the HTML and metadata:

- Legacy detail id
- Legacy detail URL
- Old property number
- Title/building name
- District
- Deal type
- Sale price
- Rent
- Saleable area
- Gross area
- Room/layout text
- Features
- Description or meta description
- Agent/contact/WhatsApp data where available
- Image URLs
- Original source language path

The extraction layer should be tolerant of missing optional fields and should report parse failures without stopping the crawl.

### 3. Normalize

Convert scraped fields into the current Supabase listing shape. Keep legacy identifiers as explicit fields or source metadata:

- `source_site`
- `legacy_detail_id`
- `legacy_property_no`
- `legacy_url`
- `legacy_source_indexes`
- `last_scraped_at`

Dedupe by `legacy_detail_id` first, then by `legacy_property_no`.

### 4. Import And Redirect

Upsert approved launch listings into Supabase.

Generate a redirect manifest from old URLs to new URLs:

- Imported old detail URLs redirect to matching new property pages.
- Non-imported old detail URLs redirect safely to `/listings`.
- Old English detail URLs redirect to the same Traditional Chinese target as the Chinese old detail URL.
- New imported property URLs use `/property/{listingNo}`, where `listingNo` is the normalized listing number. Prefer the old property number when it is available.

Images are stored as old public image URLs at launch. A later image backfill job copies those images into owned storage and updates listing records.

## URL And SEO Rules

The new sitemap should contain only canonical new URLs:

- `/`
- `/listings`
- Imported property detail pages
- Estate pages
- District pages
- `/about`
- `/contact`
- `/agents`
- `/blog`

Old URLs should not appear in the new sitemap.

### Legacy Redirects

| Old URL Pattern | Phase 1 Target |
| --- | --- |
| `/property-detail/{oldId}.html` | Matching new property page if imported, otherwise `/listings` |
| `/eng/property-detail/{oldId}.html` | Same Traditional Chinese target as `/property-detail/{oldId}.html` |
| `/?ln=sc` | `/` |
| `/?ln=tc` | `/` |
| `/eng/` | `/` |
| `/profile.php` | `/about` |
| `/contactus.php` | `/contact` |
| `/property/` | `/listings?deal=all&page=1` |
| `/property/c1/` | `/listings?deal=all&page=1` |
| `/property/c2/` | `/listings?deal=all&page=1` |
| `/property/c5/` | `/listings?deal=rent&page=1` |
| `/listprop.php` | `/contact` |
| `/companynews.php` | `/blog` |
| `/news_content.php?author=PHK_NEWSPROP` | `/blog` |
| `/mortgage.php` | `/contact` |
| `/mortgage_rate.php` | `/contact` |
| `/school.php` | `/blog` |
| `/bankval.php` | `/contact` |
| `/unlucky.php` | `/blog` |
| `/tran_trends.php` | `/blog` |

## Data Quality

Each crawl run should save auditable artifacts:

- Raw HTML snapshots or source hashes for fetched pages.
- Parsed JSON per listing.
- Crawl summary counts.
- Failed-parse report.
- Duplicate report.
- Redirect manifest.

The crawl summary should include:

- Index pages crawled.
- Detail URLs discovered.
- Unique detail URLs discovered.
- Detail pages fetched successfully.
- Listings imported.
- Listings skipped.
- Failed parses.
- Duplicate legacy ids.
- Records missing optional fields.

### Validation Rules

Required for import:

- Legacy detail id or legacy detail URL.
- Old property number when the old detail page exposes one.
- Title/building name.
- Deal type.
- At least one of sale price or rent.

Optional but flagged when missing:

- Saleable area.
- Gross area.
- District.
- Image URL.
- WhatsApp phone.
- Room/layout text.

Failed parses do not block the whole migration. They are written to a review file for manual follow-up.

## QA Plan

Before production cutover:

- Sample at least 20 imported listings against their old detail pages.
- Verify top old homepage listing URLs redirect to their new pages.
- Verify non-imported old detail URLs redirect safely to `/listings`.
- Verify `/`, `/contact`, `/listings`, and at least one imported property detail page return `200`.
- Verify `/eng/...` and `?ln=sc` legacy URLs redirect to Traditional Chinese targets.
- Verify the generated sitemap includes canonical new URLs only.
- Verify the preview contains real contact and WhatsApp values.
- Verify no demo/test listings remain visible unless explicitly approved.

## Launch Sequence

### 1. Preflight

Fix current launch blockers:

- Vercel build configuration.
- Real contact and WhatsApp values.
- Tracked `.env` hygiene.
- Lint/build issues that affect maintainability.

### 2. Crawl Dry Run

Run the crawler against the four selected old index families. Produce parsed JSON, failed-parse report, duplicate report, and proposed redirect manifest. Do not write to Supabase during this step.

### 3. Review Sample

Review summary counts and a sample of imported listings. Adjust parser mappings if old fields are missing or misread.

### 4. Import

Upsert approved launch listings into Supabase. Preserve legacy identifiers. Existing manually seeded listings should be deduped, replaced, or explicitly marked as demo/test records.

### 5. Preview Verification

Deploy to Vercel preview. Verify imported listing pages, listing filters, redirects, sitemap, and key static routes.

### 6. Production Cutover

Deploy or promote production after preview checks pass. Point `www.earnestproperty.com` to Vercel. Keep the old host available temporarily for rollback during DNS propagation.

### 7. Post-Launch

Monitor:

- 404s.
- Redirect misses.
- Import failures.
- Enquiry/contact behavior.
- Image hotlink failures.

Begin image backfill from old public image URLs to owned storage.

## Out Of Scope For Phase 1

- Proper bilingual content and routing.
- Full import of all 2,350 sitemap detail URLs.
- Rebuilding mortgage, school net, bank valuation, unlucky property, and transaction trend tools.
- Owned image storage backfill before launch.
- A replacement for every old PHP utility page.

## Open Implementation Notes

- The crawler should be idempotent and safe to rerun.
- Import should be an explicit command, separate from crawl/extract.
- Redirect generation should be deterministic from imported records plus legacy sitemap data.
- Public crawling should use conservative request pacing and clear error reporting.
