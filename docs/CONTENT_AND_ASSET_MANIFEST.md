# Content & Asset Manifest

P8 handoff doc: which estates/photos/facts are verified and live vs. held
back pending real data, and why. Written against `main` at the point all of
P0–P7 had merged (2026-08-31). Consolidates `TODO-ASSETS.md` (still current
— spot-checked against today's code, not stale) with everything P4–P7 added
since it was last updated (2026-07-30).

## Estates

**5 estates have a full detail page** (`hasPage: true` in
`src/content/estate-registry.ts`, real `estate-pages.ts` content, real
photos in `public/estates/`): 碧堤半島 `bellagio`, 浪翠園 `sea-crest-villa`,
豪景花園 `hong-kong-garden`, 海韻花園 `rhine-garden`, 麗都花園 `lido-garden`.

**17 more estates exist as DB rows only** (`neon/migrations/*_estate_expansion.sql`,
P4 Task 2), every one `published = false`. No detail page, no URL, no
listings/search visibility. Per the master plan's own publish gate:
"verified facts + a real photo; no photo or no facts → stays unpublished."
Of these 17, **3 have an entirely unknown district** (帝華軒 `tai-wah-hin`,
海韻台 `hoi-wan-toi`, 龍騰閣 `lung-tang-kok` — `districtSlug: null` in the
registry, confirmed still true in current code) — no reference anywhere in
the codebase places them, and 海韻台 must NOT be assumed to sit near 海韻花園
just because the names share 海韻.

**Still needed from the client** (per `TODO-ASSETS.md`, verified current):
- 6 estate photos (豪景花園, 海雲軒, 帝華軒, 海韻台, 縉皇居, 龍騰閣) — cards
  without a photo fall back to a brand-green gradient, nothing is broken.
- A higher-resolution 浪翠園 photo — the supplied one is 600×357 and captioned
  三期 only (one phase, not the whole estate).
- Confirmed total-unit counts for the 5 estates that currently show "—" for
  every figure (海雲軒, 帝華軒, 海韻台, 縉皇居, 龍騰閣).
- Confirmation of whether each of the 17 should get its own detail page at
  all — the derived slugs above are React keys only today, not committed
  URLs; **once a slug becomes a URL it is permanent**, so this must be
  confirmed before any of the 17 gets a real page.

## Branch photos

3 of 3 branch shopfront photos exist (`public/branches/`:
`hong-kong-garden.jpg`, `lido.jpg`, `rhine.jpg`). **Still needed**: an
updated 麗都分行 shopfront photo (docx annotation 「麗都舖轉相」) — the
original still ships in the meantime, nothing is broken.

## Agents

All 23 staff/agent profiles render (name, title, branch, photo — all 23
headshots exist). **`whatsapp` and `licenceNo` are `null` for every single
one** (`src/config/site-team.ts`, re-verified today: 23/23 null on both
fields). This is a deliberate withhold, not an oversight —
`docs/client-feedback/Namecard/` likely has this data, but transcribing 23
people's personal contact details out of scanned images without explicit
client sign-off was judged the wrong call. Needs a spreadsheet/plain-text
list from the client, not an image-transcription pass.

Two open roster questions from `TODO-ASSETS.md`, still unresolved: **Kelvin
Wu** has a QR code but no namecard/headshot/roster entry (likely stale, needs
confirmation); **Andy Han** is spelled `Han` on the roster vs. `HAH` on his
namecard/QR/repo slug (`andy-hah`) — display name follows the roster, asset
filenames were left alone pending which spelling is correct.

## Legal pages

`/privacy`, `/disclaimer`, `/terms` all ship real, reasonable template copy
— not placeholder lorem ipsum — but every one carries an explicit
`TODO(client/legal)` marker in its source (enforced by a regression test,
`legal-pages.contract.test.mjs`, which fails if the marker is ever removed
without a real legal review having happened) flagging that a licensed Hong
Kong legal/PDPO-privacy professional has not reviewed the copy. None of the
three hardcodes a real-looking effective/last-updated date — also
test-enforced — so publishing today would not falsely claim a review date
that never happened.

## Blog / editorial content

4 articles in `src/content/blog-articles.ts` (the static registry-backed
set; the admin CMS can also publish DB-only articles with no registry entry
— see `blog_.$slug.tsx`'s dual-source loader). Every article carries a real
`sourcesNote` and `answerSummary`; `compareEstateSlugs` (where present) only
ever references estates that resolve in the registry.

## Video content

Synced live from the client's YouTube channel (`src/lib/youtube-sync/`), not
manually curated. `category` (`src/content/video-categories.ts`: 樓盤實拍,
屋苑開箱, 市場評論, 社區生活) is a real, nullable, admin-assigned DB column —
existing videos default to `null` (shown unfiltered) rather than a guessed
category, since there's no reliable text heuristic for it (unlike the
per-video estate tag, which IS parsed from a `＃屋苑名` title marker —
`src/lib/video-tags.js`).

## Resolved since the original `TODO-ASSETS.md` brief (2026-07-30)

Per that file's own "Resolved since the original brief" section: the 深井 /
青山公路 zone-summary copy (both paragraphs supplied 2026-07-29), Andy Han's
job title typo (confirmed 高級客戶經理), Michael Wong's roster removal
(confirmed by client), a rendering fault that showed 3 blank FAQ accordion
headings (now filtered), and all 23 agent headshots (all present).

## Trust/licence facts (verified, stable across the whole site)

Licence number `C-018613`, company name 晉誠地產代理有限公司 / Earnest
Property Agency Ltd, phone `2688 2988`, shopfront address 深井麗都花園地下
5A舖 — these appear consistently in `src/content/estate-pages.ts`'s
`earnestPublicTrust` object and are cross-checked by
`estate-conversion.test.mjs`'s "estate conversion registry includes factual
trust proof" test. No Google-review/testimonial claims anywhere (also
test-enforced) — this repo's content standard is licence/company-identity
trust proof only, never manufactured social proof.
