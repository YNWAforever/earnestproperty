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

18 unique source listing IDs: 15 sale cards from buy_p1.html (3 enriched by saved detail pages), plus exactly 3 rent details. Distinct source listing IDs remain separate even when they appear to advertise the same unit. There is no rent-index coverage. Source filenames and URLs are preserved per record. Bedroom count for sale listing 4068791 is missing and remains null; inactive-deal price/rent fields are null by design. All other requested fields were parsed. Visible bedroom tables take precedence over inconsistent JSON-LD numberOfRooms values.

The fixture is a saved snapshot, not a claim of currently available inventory. Remote image URLs can expire or fail; cards use the existing image fallback.

Screenshot: `/workspace/28hse_capture/homepage_preview.png`.

## Validation

- `npm run lint`: exit 0 (9 existing warnings, no errors).
- `npm run typecheck`: exit 0.
- `VITE_28HSE_PREVIEW=true npm run build`: exit 0; existing dependency deprecation/chunk warnings.
- `npm run test:28hse-preview`: 3 tests pass; existing 28hse parser test file also passes.
- Chrome: 15 sale cards, 3 rent cards, HK$18,600 rent readback, keyboard tab switching, all 15 sale images loaded; no page errors. Mobile width 390px has no horizontal overflow.
- Additional screenshots: `homepage_preview_rent.png`, `homepage_preview_mobile.png`, and `homepage_preview_listings.png` alongside the requested full homepage capture.
