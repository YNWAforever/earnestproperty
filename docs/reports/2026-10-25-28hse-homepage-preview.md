# Saved 28hse homepage preview

Local preview only. No deployment, push, database connection, or ingestion.

## Run

```sh
npm ci --ignore-scripts
node scripts/parse-28hse-saved.mjs /workspace/28hse_capture
VITE_28HSE_PREVIEW=true npm run dev -- --host 0.0.0.0 --port 3000
```

The explicit flag replaces the homepage latest-listings area with static buy/rent cards and bypasses its database loader. Without the flag the existing homepage remains active. No credentials are needed. Cards link directly to the original 28hse listing, without enquiry tracking or agent contact data.

The existing `parse28HseDetail` requires a normalized `[data-listing-detail]` template absent from these raw captures. The small offline adapter therefore reuses the repository money/room normalizers and snake_case field convention while extracting actual saved card/table selectors. It makes no network requests. Raw HTML is kept outside Git.

The supplied `new_listings.json` is the only listing allowlist. Its six NEW source rows represent five flats: OMA OMA (4068170, duplicate 4067425 merged), OMA by the Sea (4063699), 黃金海灣 (4061626), 縉皇居 (4060450), 飛揚 (4060439). The comparison CSV contains 4 ALREADY_ON_SITE, 8 UNSURE, and 6 NEW source rows. Both existing and uncertain rows are excluded. No DB comparison is rerun and no DB is accessed.

Requested fields come from the supplied JSON; cover image URLs are matched by exact source ID against saved buy_p1.html. All requested fields are present for the five flats; rent is null because all five are for sale. There are no new rentals in the supplied allowlist, so the rent tab shows an explicit empty state. Duplicate source IDs remain recorded for provenance. The old 18-listing fixture is replaced entirely.

The fixture is a saved snapshot, not a claim of currently available inventory. Remote image URLs can expire or fail; cards use the existing image fallback.

Screenshot: `/workspace/28hse_capture/homepage_preview.png`.

## Validation of the five-flat update

- Full lint: exit 0 (9 existing warnings); changed parser/component lint: exit 0.
- Typecheck: exit 0 after using a price formatter that accepts nullable amounts.
- Parser/selection tests: 4 pass, including exclusion of existing/uncertain rows and explicit duplicate merging.
- Offline cross-check: all five fixture rows have NEW status in compare.csv and match requested fields in new_listings.json exactly.
- Chrome: exactly 5 sale cards, OMA OMA once, all 5 images loaded, zero rental cards with an explicit empty state, working keyboard tabs, and no page errors or mobile horizontal overflow.
- Full homepage screenshot refreshed at the requested path; additional listings, rental empty-state, and mobile screenshots remain beside it.
- Final `VITE_28HSE_PREVIEW=true npm run build`: exit 0 (existing dependency/chunk warnings).
