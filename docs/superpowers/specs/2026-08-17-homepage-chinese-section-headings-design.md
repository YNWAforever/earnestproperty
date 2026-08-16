# Homepage Chinese section headings

## Goal

Make the homepage’s four customer-facing section labels Chinese-first and remove the duplicated English heading copy. The requested labels are `精選筍盤`, `精選樓盤影片`, `深井核心屋苑`, and `為何選晉誠`. Keep these as the prominent large headings so the hierarchy remains clear on desktop and mobile.

## Scope

- Update the homepage section-header API so a section can render a large title without a redundant eyebrow label.
- Replace the English titles for featured listings, core estates, and why-us with the requested Chinese titles, and add the requested featured-property-video section using the existing public listing-video query.
- Preserve existing descriptions, links, data loading, SEO metadata, and card behavior.
- Do not add the 青山公路／汀九屋苑 block yet; that content will be supplied later.

## Implementation shape

`src/routes/index.tsx` remains the only product source change. `SectionHeader` will accept an optional eyebrow and render it only when supplied. The four requested sections will pass their Chinese copy through `title` and omit the eyebrow, so the existing responsive `text-3xl sm:text-4xl` heading sizing remains the source of truth. The new video section will read up to three existing YouTube listing videos, show an empty state when none are available, and link each populated card to its property detail without inventing CMS content.

## Validation

Add a focused source contract test for the four Chinese headings, absence of the four English heading strings, and the optional-eyebrow rendering contract. Run that test, targeted lint, and a diff check; report any unrelated baseline failures separately.
