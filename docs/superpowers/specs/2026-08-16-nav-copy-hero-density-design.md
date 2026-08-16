# Navigation copy and hero density

## Scope

- Remove the three Mega Menu group-purpose sentences from `SiteHeader`:
  - `按深井、青山公路、汀九或屋苑入口瀏覽。`
  - `由買樓、租樓、放盤估價到聯絡門市。`
  - `影片、成交、屋苑開箱與市場分析集中入口。`
- Keep every individual menu link, its description, route, CTA, and behavior unchanged.
- Reduce the homepage Hero's vertical padding by approximately 20% at each existing responsive breakpoint.

## Design

The Mega Menu keeps its labels and link descriptions so users retain navigation context without the repeated group-level copy. The Hero keeps its image crop, typography, controls, and content order; only the responsive vertical padding is reduced from `py-20`, `sm:py-28`, and `lg:py-36` to the nearest spacing tokens representing roughly 20% less height.

## Verification

- A focused source test asserts the three purpose strings are absent while menu labels remain.
- Existing frontend tests and a production build must pass.
- A responsive browser check confirms the navigation remains usable and the Hero is visibly shorter without clipping content.
