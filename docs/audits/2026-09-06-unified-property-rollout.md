# Unified property rollout — 2026-09-06

The approved behavior is one verified physical property, one public card and one stable detail URL. Sale and rental offerings retain their original IDs, prices, status and inquiry targets. Original property rows remain as source history.

## Data audit

The read-only audit covered all 1,067 production property rows (431 marked active). See `2026-09-06-property-data-audit.md` for field quality, stale-source flags and the five active canonical groups with conflicting physical facts. These facts have not been corrected by guessing.

The two reported examples are different properties with internal aliases: B054645 has twelve active sale/rent rows; B075535 has three active rental rows. Before this change their source-specific URLs returned 200, while `/property/B054645` and `/property/B075535` returned 404.

## Implemented behavior

- Persistent public groups preserve original property records and inquiry foreign keys. Physical conflicts are isolated for review.
- Public reads choose the latest offering by source chronology before active-status and user filters. Mixed lists count/page one unit; sale/rental categories retain their own eligible units.
- Cards show both active prices. Old source URLs redirect to the stable property URL and retain sale/rental intent.
- Detail selection is URL-backed; inquiry, WhatsApp context and mortgage behavior use the selected real offering.
- Verified historic aliases migrate existing favourites to the stable public identity. Unfavouriting removes the consolidated saved item.

## Verification so far

- UI TypeScript check and focused ESLint passed.
- Property experience: 140 Node tests passed, plus its Bun tests.
- SEO: 33 Node tests passed, plus its Bun tests.
- Homepage: 16 tests passed. Videos: 27 tests passed.
- Dedicated property presentation: 5 tests passed. Saved listing tests: 12 passed.
- Local browser against the approved disposable branch passed dual prices, sale/rental URL selection, verified alias favourites, a single B054645 rental card, rental entry intent, mobile overflow and B075535 rendering. No inquiry or customer message was submitted.

- MLS suite: 603 tests passed. Listing-search suite passed including 12 saved-listing tests.
- Real PostgreSQL read-model fixture passed: pagination/counts, independent corridor deals, newer withdrawal over older featured rows, latest price before filters, legacy withdrawal, sold/rented details, detail-only description transport, and known physical-fact fallback.
- Local production build passed. Final independent review found no remaining P1/P2 issues; its minor rented-label finding was fixed and tested.
- Full local listing pagination: 21 pages, 245 unique public cards, matching the displayed total exactly. Original rows remain 1,067; all 1,067 have membership mappings.

## Release status

Disposable database migration and final review are complete. Source commits are local through `5a2225b`. The user explicitly approved public publication and production deployment. PR #117 is open; its preview build passed. The first CI run found an outdated source-shape assertion for the corridor title sanitizer; the assertion was updated to retain the sanitization requirement after public title normalization. Production rollout is pending CI success.
