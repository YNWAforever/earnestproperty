# Full saved 28hse homepage preview

Local preview only on `feat/28hse-homepage-preview` (existing PR #276). No push, merge, deployment, database connection, or ingestion.

## Run

```sh
npm ci --ignore-scripts
node scripts/parse-28hse-saved.mjs /workspace/28hse_capture
npm run test:28hse-preview
VITE_28HSE_PREVIEW=true npm run dev -- --host 0.0.0.0 --port 3000
```

Local URL: `http://localhost:3000/`. The explicit flag replaces the homepage latest-listings area and bypasses its database loader and enquiry resolver. Without the flag, the existing homepage remains active. No credentials are needed. Cards link to their original 28hse URLs without enquiry tracking or agent contact data.

## Full input and exclusions

The sole inventory input is `/workspace/28hse_capture/full_new_listings.json`, containing 56 canonical NEW flats: **38 sale + 18 rent**. Supplied reposts are already merged; duplicate IDs are retained only as provenance, never expanded into extra cards. This fixture replaces the earlier five-flat preview.

`full_compare.csv` has 56 NEW, 78 ALREADY_ON_SITE, 13 ON_SITE_PRICE_CHANGED, and 26 UNSURE canonical rows. The generated fixture has exactly the CSV's NEW ID set and no IDs from the other three statuses. The generator accepts only NEW entries without a site match, validates deal/source URL/unique canonical ID, and keeps all supplied requested fields and image URLs. The comparison is not rerun against the production database. Input JSON/CSV and raw HTML stay outside Git.

The earlier saved HTML helpers remain for parser regression coverage; fixture generation now reads the full supplied JSON directly. No network requests or additional HTML discovery are performed by the generator.

## Homepage and complete catalog

Each buy/rent tab shows up to **9 cards**. The visible tab counts show all 38 sale and 18 rent flats. `查看全部新盤` opens the `#all-new-listings` preview section on the same homepage, containing all **56** cards grouped into sale and rent; it does not navigate to the live DB listings page. The full section is collapsed until opened and can also be opened with its native keyboard-accessible summary.

Ordering uses the supplied relative posting times where available, newest first. The 52 entries without a posting time use descending 28hse ID as a deterministic fallback, not an inferred date. The homepage states this limitation. Missing fields are displayed as unavailable, without guessing studio status or area.

## Missing fields

- Bedrooms are null for 4030683, 4035765, 4035759, 4033510, 4028435, 4065990, and 4042934.
- Saleable area is null for 4040071.
- Posting time is null for 52 flats; inactive-deal price/rent is null by design.
- All titles, estate/district, active-deal prices, main image URLs, and source URLs are present. Remote images may expire; the existing image fallback remains available.

## Validation

- Six parser/selection/catalog tests pass. Updated selection tests first failed against the five-flat implementation, then passed after the full-input adapter was implemented.
- Tests cover all three excluded statuses, rows with existing site matches, unique canonical IDs, duplicate provenance, invalid source URLs, exact 56/38/18 counts, nullable fields, nine-card limits, full catalog counts, ordering, and no input mutation.
- Offline JSON/CSV cross-check confirms exact allowlist equality and equality of every supplied requested field, image URL, and posting value.
- Full lint: exit 0 (9 existing warnings, no errors). Typecheck: exit 0.
- Chrome: both tabs have exactly 9 expected cards and 9 loaded images; keyboard switching works. The all-listings link opens 56 unique source links (38 sale + 18 rent), including listings beyond both homepage slices. Mobile at 390px has no horizontal overflow. No page errors.
- Screenshot visually inspected: `/workspace/28hse_capture/homepage_preview.png`. Additional captures: `homepage_preview_listings.png`, `homepage_preview_rent.png`, `homepage_preview_mobile.png`, `homepage_preview_all.png` in the same directory.
- Final `VITE_28HSE_PREVIEW=true npm run build`: exit 0 (existing dependency deprecation and chunk warnings).
