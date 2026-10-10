# FX-16: Public accessibility, schema and content polish. Implementation plan

**Owner decisions (pending, fill in after review):**
- D7 / Task 6 [owner copy] items: approved as drafted / amended / declined, per item (F-10, F-18, F-19, F-25, F-26).
- F-18 opening hours per branch: supplied / not yet (default: leave as is).
- F-19 service-area scope: 小欖至三聖 in scope (default, per the 2026-09-07 client amendments) / narrowed.
- Open questions 1-8 below: defaults accepted / changed.

Fixed by the brief:
1. **Never lose an enquiry or lead.** The sticky WhatsApp bar, the property action bar and the 問樓助手 launcher are lead paths. F-07 only moves the launcher into the bar's own row; nothing is hidden, and every CTA stays at least 44×44 px and uncovered (Review Focus 1). No form, server function, `/api/*` or `/w/*` changes.
2. **No migration. No new env var. No `vercel.ts` edit.** No data is changed by code; the one data-touching item (F-15 stale videos) is an owner step with a read-only dry run first.
3. **Cut from `main` (1216ab8d). Never stack on #238 to #242.** Shared files are listed in fact 30; every hunk is placed away from those PRs' hunks.
4. **Copy.** zh-HK copy is unchanged except the items marked **[owner copy]**, which are all in Task 6 and gated on approval. No business fact is invented: opening hours, coordinates and reviews come only from the owner.
5. **UI refines the design system.** One existing token value changes (`--destructive`), one token pair is added (`--whatsapp`, replacing three hard-coded hex pairs), and four text chips switch to the existing shadcn `secondary` pair. `--primary` and the client-approved `#1F7A4D` do not change.
6. **Public URLs and slugs stay stable.** `/transactions` keeps resolving even when its links are hidden.

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax. Every behaviour change gets a failing test first.

**Goal.**
- On phones, the 問樓助手 launcher sits inside the bottom action bar as a 44 px icon instead of floating above it. The two layers that covered about 15 % of a 375×812 screen (fact 1) become one bar of about 7 %. The bar sits on the safe area, and the page reserves exactly its height. Desktop is unchanged (F-07).
- Every audited text pair meets WCAG AA 4.5:1, including the form error text the audit did not measure (F-08).
- Each navigation link says `aria-current="page"` only when it is the current page; sections say `"true"`. The blog filter stops using `aria-pressed` on links (F-09).
- JSON-LD stops multi-typing agents, states monthly rent, and puts the district, not the estate, in `addressLocality` (F-12).
- Sitemap `lastmod` comes from a real date or is omitted; the generation date is never used (F-13).
- `/videos` hides empty category chips, drops U+FFFC, and stops publishing YouTube boilerplate (with agent mobile numbers) in JSON-LD (F-15).
- Small fixes: `tel:+852…` everywhere (F-16), CJK headings and the home H1 (F-20), live mortgage results (F-21).
- A 27-page axe gate in `e2e/a11y.spec.ts` (fact 27).
- [owner copy], once approved: hide the 最新成交 links (F-10), branch hours (F-18), listing headline and placeholder clean-up (F-25), and a de-duplicated generated meta description (F-26).

Findings: F-07, F-08, F-09, F-10, F-12, F-13, F-15, F-16, F-18, F-19, F-20, F-21, F-25, F-26.

**Approach.**
- **Task 1 (F-07).** One `LiveAgentLauncher` instance stays at the root. A `docked` prop gives its trigger mobile classes that place a 44×44 icon button in a slot the bars reserve on their right. At `lg` and up it uses today's classes exactly. Both bars move from `bottom-16` to `bottom-0` with safe-area padding. A new owned browser scene in the existing live-agent fixture checks geometry and axe at 360, 375, 390, 430 and 1440 px.
- **Task 2 (F-08, F-09).** Token and class changes with a contrast test computed from `styles.css`. Router `activeOptions` for the blog filters; header section links say `"true"`.
- **Task 3 (F-12, F-13).** The property JSON-LD moves into tested builders in `src/lib/schema.ts`. A pure `sitemap-lastmod.js` decides each `lastmod`.
- **Task 4 (F-15).** Render-time text clean-up and empty-chip removal. No sync change; the owner reviews stale rows with a read-only query.
- **Task 5 (F-16, F-20, F-21).** Small, independent fixes.
- **Task 6 ([owner copy], gated).** Only after the owner approves the exact wording below.
- **Task 7 (gate).** `e2e/a11y.spec.ts` grows to 27 pages × 2 viewports, run against a preview or staging (fact 27 explains why not the owned fixture).

**Tech stack.** `node --test`, `bun test`, Playwright 1.62 with `@axe-core/playwright` 4.13 (already devDependencies). No new dependency. New tests join existing `test:*` scripts that are already in `ci.yml` (fact 29).

**Spec.**
- Audit `docs/audits/2026-10-final-audit.md`: F-07 to F-10 (`:292-295`), F-12, F-13, F-15, F-16 (`:297-301`), F-18 to F-21 (`:303-306`), F-25, F-26 (`:309-310`), axe summary (`:319`).
- Fix plan `docs/audits/2026-10-fix-plan.md`: FX-16 (`:667-690`), Global constraints (`:17-39`), D7 (`:75`), D6 (`:74`, FX-15) and D8 (`:76`, FX-19d), which D7's items touch, batch table (`:104`), FX-20 (`:772-773`).

## Verified current behaviour (main `1216ab8d`, 2026-10-09)

Live checks were read-only `GET`s to `https://www.earnestproperty.com` on 2026-10-09.

| # | Fact | Where |
|---|---|---|
| 1 | **F-07 stack.** The generic bar is `fixed inset-x-0 bottom-16 z-40` with `py-2`. Its link is `py-2.5 text-sm`, so **40 px tall, under 44** (`StickyWhatsAppBar.tsx:21,31`). The launcher is a separate `fixed bottom-4 right-4 z-50 h-11` pill (`LiveAgentLauncher.tsx:16`). After the first tap the lazy widget renders **its own** trigger with the same classes (`LiveAgentWidget.tsx:281-287`) and a panel `fixed bottom-3 right-3 z-50 h-[min(520px,100dvh-1.5rem)]` (`:291-292`). Bar 57 px + 64 px offset = 121 px of 812 (14.9 %). The root reserves `pb-32` (128 px) when the bar shows (`__root.tsx:154`). | as listed |
| 2 | **Property pages have their own bar.** `shouldShowStickyWhatsAppBar` returns false for `/property/*` (`__root.tsx:208-213`). `PropertyDecisionActions` renders `fixed bottom-16 z-40` with 3 buttons 致電 / WhatsApp / 計月供 in `grid-cols-3` (`PropertyDecisionActions.tsx:327-360`). Button `size="sm"` is already `h-11` (`button.tsx:23`). The route reserves `pb-32 lg:pb-8` (`property.$listingNo.tsx:510`). **At 320 px the WhatsApp button already overflows** (about 110 px of content in a 93 px column). | as listed |
| 3 | **The launcher shows on every public path, including `/dashboard`**, where there is no bar (`__root.tsx:144,198-202`). Desktop (`lg`, 1024 px+) shows no bar (`lg:hidden`), and the launcher is at `bottom-5 right-5` (`sm:` classes). | `__root.tsx` |
| 4 | **No safe-area handling.** The viewport meta is `width=device-width, initial-scale=1` with no `viewport-fit=cover` (`__root.tsx:85`), so `env(safe-area-inset-bottom)` is 0 today. Adding `viewport-fit=cover` would collide with #239's rewrite of that `meta` array (fact 30), so this plan only adds `env()` padding, which is a no-op until cover is set. | `__root.tsx:85` |
| 5 | **Tests pin the old geometry.** `site.test.mjs:184-213` asserts `bottom-16`, "sits above the 問樓助手 bubble" and `pb-32 lg:pb-0`. `property-decision.test.mjs:174-176` asserts `bottom-16`, **not** `bottom-0`, and `fixed bottom-4 right-4` on the launcher. | as listed |
| 6 | **F-08 measured ratios** (sRGB relative luminance from the oklch tokens; `bg-x/10` composited over white `card` and over `--surface` #F8FBF9). Fails in bold. | computed |

   | Pair | Ratio | Used at |
   |---|---|---|
   | white on `#25D366` (property bar WhatsApp) | **1.98** | `PropertyDecisionActions.tsx:341` |
   | white on `#1ebe57` (its hover) | **2.45** | same |
   | `#25D366` text on white (branch WhatsApp link) | **1.98** | `contact.tsx:130` (renders only once a branch `whatsapp` is set; all 3 are `null` today) |
   | white on `#128C4A` (**the audit's suggested fix**) | **4.31** | not used; it fails too |
   | white on `#08783f` (generic bar today) | 5.57 | `StickyWhatsAppBar.tsx:31` |
   | `text-primary` on `bg-primary/10` | **4.65 over card, 4.47 over surface** | text chips: `blog.tsx:184,226`, `blog_.$slug.tsx:306`, `FormStatus.tsx:31` (the success message of every public form) |
   | same pair, icons only (3:1 rule) | 4.47 to 4.65, passes | `MortgageCalculator.tsx:350`, `SearchFallbackCTA.tsx:18`, `castle-peak-road.$segment.tsx:131`, `index.tsx:825`, `videos.tsx:403,611`, `estate-reviews.tsx:231` |
   | `text-destructive` on white / surface | **4.40 / 4.22** | `MortgageCalculator.tsx:153` (12 px error text), shadcn `form.tsx` messages |
   | `text-destructive` on `bg-destructive/10` | **3.79 over card, 3.64 over surface** | `FormStatus.tsx:20`, **the error message of every public form** |
   | white on `bg-destructive` | **4.22** | `button.tsx` destructive variant |
   | `text-secondary-foreground` on `bg-secondary` | 6.99 | shadcn `Badge variant="secondary"` |
   | `text-primary` on white / surface | 5.33 / 5.11 | everywhere |
   | `text-muted-foreground` on white / surface / muted | 5.12 / 4.91 / 4.57 | everywhere |

| # | Fact | Where |
|---|---|---|
| 7 | **The primary token has a large blast radius.** `--brand-primary` feeds `--primary`, `--ring`, `--coral` and `--chart-1` (`styles.css:121,143,151,153`). 80 source files use those classes (261 `text-primary`, 43 `bg-primary`, 33 `text-coral`, 29 `border-primary` …). `SITE_THEME_COLOR` is the hex `#1F7A4D` (`content/seo.ts:34`), and the file header calls that hex client-approved (`styles.css:10,73`). Moving L from 0.515 to 0.500 would pass the chip pair (4.75) but changes the brand colour on 80 files to fix 4 chips. | `styles.css`; grep |
| 8 | **`--destructive` users.** 58 files: 22 public or shared (`ui/alert.tsx`, `ui/badge.tsx`, `ui/button.tsx`, `ui/form.tsx`, `FormStatus.tsx`, `MortgageCalculator.tsx`, `LiveAgentWidget.tsx`, `DefaultErrorComponent.tsx`, `use-unsaved-changes-guard.tsx`, `routes/agents.tsx`, `routes/property.$listingNo.tsx`, `components/dashboard/{ImageUploader,PropertyForm,TransactionForm}.tsx`) and 36 under `components/admin/**` and `routes/admin.*.tsx`. Class counts: 69 `text-destructive`, 14 `border-destructive/30`, 10 `bg-destructive/5`, 5 `bg-destructive/10`, 5 `border-destructive`, 3 `bg-destructive`, plus single uses of `/20`, `/40`, `/50`, `/80`, `/90`. The `.dark` value (`styles.css:182`) is not used on public pages (`<html class="light">`, `__root.tsx:130`). | grep |
| 9 | **F-09.** `blog.tsx:181` puts `aria-pressed` on a `<Link>` (8 links, live: `aria-pressed on <a>` = 8 on `/blog`). TanStack Router adds `aria-current="page"` to any active `<Link>` itself (`node_modules/@tanstack/react-router/dist/esm/link.js:236-240`). Its default match is fuzzy on path and **partial** on search (`link.js:34-41`), so the 「全部」 filter (`search={}`) is "active" on every `/blog?category=…` page. `blog.routes.test.mjs:178` pins `aria-pressed`. | as listed |
| 10 | **Header nav.** `HeaderNavLink` sets `aria-current="page"` whenever `itemMatchesLocation` matches, including by `ownsPrefixes` (`SiteHeader.tsx:211-217,243,259`). Live: on `/property/T027001` the header's `/listings?deal=all&page=1` link says `aria-current="page"`. The mega-menu trigger already uses `"true"` (`:433`). | `SiteHeader.tsx`; live HTML |
| 11 | **Pagination is already correct.** The active page `Link` gets `aria-current="page"` from the router (live: `/listings?deal=sale&page=2&sort=newest` marks exactly the page-2 link). Disabled prev/next render a `<span>` (`listings.tsx:1424-1478`). No change, one test (Task 7). | live HTML |
| 12 | **F-12 live JSON-LD.** Agent `/agents/tommy-yiu`: `"@type":["Person","RealEstateAgent"]`, `"telephone":"66442444"` (no +852), `"image":"/team/tommy-yiu.jpg"` (relative), no licence, although the page prints 牌照 when `licence_no` is set (`agents_.$slug.tsx:97-103,159`; `schema.ts:104-121`). Rent `/property/R076194`: the `Offer` has `price: 18000` and `LeaseOut` but no period. `Residence.address` is `{"addressLocality":"黃金海岸","addressRegion":"Hong Kong"}`: the estate name as locality (`property.$listingNo.tsx:409-470`). Branch nodes on `/contact` have no `addressLocality` (`schema.ts:140-164`). The organisation node has `areaServed`, `telephone "+852 2688 2988"`, `identifier C-018613`, no `openingHours`, no `geo` (`schema.ts:76-102`). No node anywhere has `aggregateRating` or `review` (grep). | live HTML; as listed |
| 13 | **Data available for F-12 without inventing.** The estate row has `lat`, `lng` and `district_slug` (`property.$listingNo.tsx:350-363,503`). `districtLabelForSlug` maps the six real district slugs (all in the New Territories) to 深井, 汀九, 青山公路 … and returns null otherwise (`listing-seo.ts:62-75,489-492`). The three branch addresses literally contain their locality: 深井麗都花園…, 深井海韻花園…, 青龍頭村11號地下 (`site-branches.js:5,25,41`). Branch `districtSlugs` are `["sham-tseng"]`, `[]`, `["ting-kau"]`. Staff `licence_no` exists (`public-data.types.ts:61`). Branch coordinates and opening hours do **not** exist (`site-branches.js:19-20,35-36,51-52` are TODOs). | as listed |
| 14 | **Google rich results relevant here** (Google Search Central, to re-check at implementation): `RealEstateAgent` is a `LocalBusiness` subtype (required `name`, `address`; recommended `geo`, `openingHoursSpecification`, `telephone`, `url`). There is **no** Google rich result for `RealEstateListing`, `Offer` on a residence, or `Person` outside a `ProfilePage`, so those are validated against schema.org only. `FAQPage` rich results are limited to government and health sites since 2023; the markup stays valid and harmless. | Google docs |
| 15 | **F-13.** `lastmod` falls back to `generatedAt = new Date()` for every path without a source (`sitemap[.]xml.ts:170-184`). Live sitemap: 466 URLs, **95 carry today's date**: 16 static pages and hubs, 54 `/blog/*` (all static articles from `blog-articles.ts`), 23 `/agents/*`, `/estate-reviews` and 3 `/property/*` whose `updated_at` is null. Static articles have an authored date, `articlePublishedAt(article)` (`blog-articles.ts:194-200`), that the sitemap ignores. The agent query has no `updated_at` column (`public-data.server.ts:38-60`), and adding one would edit a file #238 and #239 both change. | live `sitemap.xml`; as listed |
| 16 | **F-15: the sync never deletes.** A YouTube-managed row missing from a **full** snapshot gets `youtube_missing_full_runs + 1`, at most once per Hong Kong month (`last_full_period IS DISTINCT FROM`), and becomes `youtube_available = false` on the second miss (`youtube-repository.server.ts:110-130`). The public query hides `youtube_available = false` managed rows only (`public-data.server.ts:1358-1363`). So a removed managed video stays listed for one to two months, and a **manual** row (`youtube_managed = false`) with a dead video stays forever. Nothing is ever deleted. | as listed |
| 17 | **F-15 page defects.** Live `/videos`: 135 videos; the four category chips read 「樓盤實拍 0」「屋苑開箱 0」「市場評論 0」「社區生活 0」, because `cms_videos.category` is null on every row and the chips are always rendered (`videos.tsx:102-107,236-262`; `video-categories.ts:1-7`). U+FFFC appears 61 times in the HTML (titles such as 「…一梯兩伙！￼有匙即看！￼￼」). The card summary already strips boilerplate (`video-description.js:23-55`), but the `VideoObject` JSON-LD uses the raw description (`videos.tsx:483-515`): 7 of the 12 nodes carry 「樓盤編號 / 刊登日期」 boilerplate and 8-digit mobile-like numbers. `video-description.js` has no test file. | live HTML; as listed |
| 18 | **F-16.** Footer branch links are `tel:${branch.phone}` = `tel:26882988` (`SiteFooter.tsx:209`); so are `/contact`'s (`contact.tsx:113`). Live: every page carries `tel:26882988`, `tel:26886996`, `tel:26882883`; home, property and contact also carry `tel:+852…` forms. `toTelHref()` already returns `tel:+852…` (`contact-links.ts:42-45`) and keeps its signature under #238 (landlines `[2-9]xxxxxxx` stay valid in #238's `phone.js`). Display is already 「2688 2988」 (`SiteFooter.tsx:7-11`). | live HTML; as listed |
| 19 | **F-20.** `tracking-tight` (−0.025em) is on CJK headings in shared components `PageHero.tsx`, `SectionHeading.tsx`, `Prose.tsx`, and in `__root.tsx:48`, `blog.tsx:235`, `property.$listingNo.tsx`, `index.tsx`. The home H1 (`index.tsx:312-315`) relies on `text-balance`, which breaks inside 買樓租樓 at desktop widths. The HK system font fallback is **FX-15's** D6 change (`PingFang HK` first in `--font-sans`, #242), so it is not repeated here. | grep; FX-15 diff |
| 20 | **F-21.** `result` is `null` whenever any field is being edited (`MortgageCalculator.tsx:256-259`), so the whole results panel is replaced by 「編輯中，暫無法顯示結果」 while typing (`:501-512`). `aria-live="polite"` wraps the entire results block (`:501`): about ten rows would be announced on every update. Inputs commit only on blur or Enter (`:136-144`). | as listed |
| 21 | **F-26: already inside the budget.** `seo-budget.js` measures display width (CJK = 2 units): title ≤ 60 units (about 30 CJK), description ≤ 160 (about 80 CJK) (`seo-budget.js:93-98`), and `listingSeoDescription` uses it (`listing-seo.ts:344-477`). Live widths: home 49/129, property T027001 52/156, rent R076194 55/157, estate 42/153, listings 53/148; `seoCopyIssues` reports nothing on all 14 pages fetched. **The real defect is content:** T027001's description repeats its own facts as filler, 「…呎價 $14,073。碧堤半島，高層，實用面積。WhatsApp…」 (step 5, `listing-seo.ts:436-443`), and step 6 can claim 「一頁睇齊{屋苑}成交紀錄」 (`:445-456`) while estates show 「暫未有足夠近期成交資料」 (`EstateMarketSnapshot.tsx:142`). | live HTML; as listed |
| 22 | **F-10.** 「晉誠地產最新成交」 is linked from the header mega menu (`SiteHeader.tsx:169-173`), the footer (`SiteFooter.tsx:153-157`) and a home card (`index.tsx:584-590`). `/transactions` 307s to `?dealType=all&page=1` and shows no rows; it is already `noindex` and out of the sitemap while empty (`sitemap[.]xml.ts:92-131`). `site.test.mjs` requires the strings 「晉誠地產最新成交」 and `/transactions` in the home and nav files. | as listed |
| 23 | **F-18.** `/contact` already renders `branch.hours` with a clock icon when set (`contact.tsx:119-124`); the field is typed (`site-branches.d.ts:19-20`). No branch has it. | as listed |
| 24 | **F-19: the scope note is older than the client's last amendment.** `vercel.ts:65-69` ("client narrowed scope … 小欖/掃管笏/三聖 out of scope") is from 2026-08-03 (`4cf5ea3d`). The client's 2026-09-07 amendments (`33334184`, 2026-09-09) **added** the 「青山公路區小欖至三聖」 group, including 香港黃金海岸 by explicit allowance (`client-area-presentation.ts:113-140,222-235`). The home section 「青山公路屋苑／掃管笏、青山灣、小欖一帶屋苑，我哋同樣熟悉」 (`index.tsx:469`) dates from 2026-09-01. | `git log` |
| 25 | **F-25.** Listing headlines carry a source prefix, shown raw in the H1, cards, breadcrumb and JSON-LD `name`. On two live result pages: 「(晉誠地產租盤推介)」 52×, 「(晉誠地產全部真盤)」 30×, 「(晉誠地產 )」 16×, 「(晉誠地產放盤推介)」 8×, 「(晉誠地產VR實景)」 8×, 「(晉誠地產全部實盤)」 6×, 「(晉誠地產YouTube介紹)」 6×, 「(晉誠地產筍盤推介)」 6×. `normalizePublicListingTitle` already strips leading 「【筍盤】」-style tags and repeated 「!!」, but not the parenthesised 「(晉誠地產…)」 one (`property-public.ts:95-103`); `publicPropertyTitle` feeds the property H1 and JSON-LD (`property.$listingNo.tsx:310`), listing cards (`listings.tsx:1199`), corridor cards and agent pages. The `/listings` ItemList JSON-LD uses the raw `title_zh` (`listings.tsx:1044`, a file #239 and #242 edit). The placeholder 「此屋苑的交通資料仍待核對。請按實際出發地及時段查閱路線。」 is at `property.$listingNo.tsx:909`, inside the 「地區交通」 fallback card (`:899-918`) that also links 「查看地區指南 →」; it is pinned by `property.listing-detail.contract.test.mjs:473`. | live HTML; as listed |
| 26 | **Video admin can hide a row reversibly.** The CMS 「YouTube影片」 editor has a 已發布 switch (`admin.cms.tsx:1989`) that sets `published`. Hidden rows show 「已隱藏」. | `admin.cms.tsx` |
| 27 | **`test:a11y` = `playwright test`** (`package.json:61`): every spec under the default config, which starts `npm run dev` unless `PLAYWRIGHT_BASE_URL` is set (`playwright.config.ts:3-40`). It is **not** in the main CI matrix: `test-wiring.test.mjs:92-95` lists it as environment-dependent. It runs only in the `browser-staging` job, against `vars.STAGING_BASE_URL`, and only when that variable is set (`ci.yml:207-224`). `e2e/a11y.spec.ts` covers 6 pages and **skips** on a 5xx (`:16-22,27-36`). **A 27-page run on an owned fixture is not feasible:** public loaders query Neon through the `neon()` HTTP driver (`db.server.ts:12-16`), while owned Postgres (`withOwnedPostgres`) speaks the pg wire protocol only, and `acceptance:public:synthetic` needs a disposable **Neon** branch (`scripts/test-public-synthetic-browser.mjs:16-19`). The owned fixtures (`scripts/browser-fixtures/*`) bundle components, not routes. The live-agent fixture (`scripts/browser-fixtures/live-agent/main.tsx`) is in CI through `test:live-agent:ui` (`ci.yml:91`) and can host the F-07 and F-21 components. | as listed |
| 28 | **The audit's "27 pages" are not in the repo** (only "0 violations on 21 of 27", audit `:319`; evidence was in a session scratchpad, `:562`). Task 7 defines the 27. | audit |
| 29 | **Test wiring.** `test-wiring.test.mjs` requires every `src/**/*.test.*` to be in a `test:*` script and every deterministic script to be in `ci.yml`. Lines no open PR edits: `test:layout` (`ci.yml:59`), `test:styles` (`:61`), `test:videos` (`:69`), `test:live-agent:ui` (`:91`). Existing files that join suites with no `package.json` edit: `schema.test.ts` and `sitemap.contract.test.mjs` (`test:seo`), `listing-seo.test.ts`, `mortgage.test.ts`, `property-decision.test.mjs` (`test:property-experience`), `blog.routes.test.mjs` (`test:blog`), `SiteHeader.contract.test.mjs` (`test:homepage`), `site.test.mjs` (`test:contact`), `FormStatus.test.tsx`. | as listed |
| 30 | **Open PR overlap** (`git diff origin/main...origin/<branch>`; the two-dot form also shows `main`'s own newer commits as reversed hunks for #238 and #239, which are based on `bfbfd618`). **Shared with this batch:** `src/routes/__root.tsx` (#239: import `:35`, `head` `:80-113`; #242: `:17-30`); `src/styles.css` (#242: `:22-23` and an end-of-file `@utility`); `src/routes/property.$listingNo.tsx` (#239: `:76-80`, `:138-143`, `:356-366`, `:388`, `:475-495`, `:514-530`, `:858-883`; #242: one import near `:81`, one line above `:257`); `src/components/site/SiteFooter.tsx` (#242: `:1-27`, `:228-260`); `src/routes/index.tsx` (#242: `:81-110`, `:156-250`, `:758`); `src/lib/schema.ts` (#241: comment `:23-29`); `src/routes/videos.tsx` (#239: imports `:4-10`, `:51`); `src/routes/property.listing-detail.contract.test.mjs` (#239 and #242); `playwright.admin-owned.config.ts` (#238 inserts after `:11`); `package.json` (other lines, see fact 29). **Not touched by any open PR:** `StickyWhatsAppBar.tsx`, `LiveAgentLauncher.tsx`, `LiveAgentWidget.tsx`, `PropertyDecisionActions.tsx`, `SiteHeader.tsx`, `blog.tsx`, `blog_.$slug.tsx`, `FormStatus.tsx`, `contact.tsx`, `agents_.$slug.tsx`, `sitemap[.]xml.ts`, `MortgageCalculator.tsx`, `mortgage.ts`, `listing-seo.ts`, `property-public.ts`, `video-description.js`, `site-branches.js`, `e2e/a11y.spec.ts`, the live-agent fixture, `ci.yml` (no edit here). | git |

## Global Constraints

- **Never lose an enquiry or lead.** No change to a form, a server function, `/api/*`, `/w/*`, a WhatsApp href builder or the launcher's lazy-load and handoff. Every bar CTA stays ≥ 44×44 px and uncovered at 360 to 430 px, and the page reserves the bar's height so footer links and the owner valuation form scroll clear of it.
- **Copy.** zh-HK. Only Task 6 changes visible copy, and only as approved. No new visible strings anywhere else (the docked launcher keeps 「問樓助手」 as its accessible name; its visible text is hidden below `lg` only).
- **Facts.** No opening hours, coordinates, ratings, reviews, `priceRange` or licence numbers that are not in the data. A field without a source is omitted.
- **No migration, no env var, no `vercel.ts` or `ci.yml` edit.** `package.json` changes only the `test:layout`, `test:styles`, `test:videos` and `test:live-agent:ui` lines.
- **Keep hunks small in shared files** (fact 30): `__root.tsx` only inside `RootComponent` (`:142-189`); `styles.css` only `:146` (`--destructive`), a new block after `:158`, and the `@layer base` block (`:189-200`), never `:20-30` or the file end; `property.$listingNo.tsx` only `:409-470` (JSON-LD), `:510` and, in Task 6, `:908-910`; `SiteFooter.tsx` only `:153-157` (Task 6) and `:209`; `index.tsx` only `:312` and, in Task 6, `:576-591`; `schema.ts` from `:104` down; `videos.tsx` below `:100`.
- **Do not touch `bun.lockb`, `package-lock.json` or dependencies.** The worktree's `bun.lockb` shows a stray local modification; leave it unstaged.
- **Production is read-only.** `GET` only; no deploy, Neon, admin write or form submission by an agent.
- **Every PR passes** `npm run lint`, `npm run typecheck`, `npm run build`, `test:layout`, `test:styles`, `test:videos`, `test:live-agent:ui`, `test:seo`, `test:blog`, `test:homepage`, `test:contact`, `test:property-experience`, `test:control-plane` (`test-wiring`), and the admin browser suites in `playwright.admin-owned.config.ts`. UI tasks attach before and after screenshots at 375 and 1440 px.

## Review Focus

1. **The merged bar hides or blocks a lead CTA, or covers the form or footer.** *Tests (Task 1, `e2e/public-mobile-chrome.spec.ts`):* `at 360, 375, 390 and 430 px the WhatsApp link and the docked chat icon are each at least 44×44 and are the topmost element at their centre`; `property bar: 致電, WhatsApp and 計月供 keep their full label with no overflow at 360 to 430 px`; `the last footer link and the last owner-form field scroll fully above the bar`.
2. **The chat panel stops opening, or desktop changes.** *Tests (Task 1):* `the docked icon opens the chat panel and focus lands in the message box; closing it returns the icon to the bar`; `at 1440 px no bar renders and the launcher box equals main's (right 20, bottom 20, height 44, label visible)`.
3. **A token change shifts something unexpected.** *Tests (Task 2, `src/styles.contrast.test.mjs`):* `every audited text pair meets 4.5:1 and every UI pair 3:1`; `--brand-primary, --primary and SITE_THEME_COLOR are unchanged`; `no source file hard-codes #25D366, #1ebe57 or #08783f`.
4. **Structured data claims something untrue or loses a fact.** *Tests (Task 3, `src/lib/schema.test.ts`):* `agent node is a Person; hasCredential appears only with a licence number`; `no builder emits aggregateRating, review, openingHours, geo or priceRange without a source value`; `rent offer carries a monthly UnitPriceSpecification and a sale offer none`; `addressLocality is the district label, never the estate name`.
5. **The sitemap reports a date nobody authored.** *Tests (Task 3, `sitemap.contract.test.mjs`):* `static article lastmod = authored date`; `a page with no tracked date has no lastmod element`; `the route no longer reads the clock for lastmod`.

## Out of scope / follow-ups

| Follow-up | Owner | Note |
|---|---|---|
| `viewport-fit=cover` so the bar extends under the iPhone home indicator | after #239 merges | One `meta` line in `__root.tsx` `head`, which #239 rewrites. The `env()` padding from Task 1 then takes effect with no further change. |
| Property first screen: compact toolbar, gallery above the fold (F-25 layout part) | FX-20 | A layout change on a file #239 and #242 both edit; FX-20 owns spacing and layout polish. |
| 28Hse watermark on listing photos (F-25) | owner / FX-18 | Needs un-watermarked source photos; not a code change. |
| Price format `$12.68M` vs `$1,268萬` (F-25) | FX-19d (D8) | Already decided there. |
| Property bar overflow at 320 px (fact 2) | FX-20 | Exists on `main` today; this plan guarantees 360 px and up. |
| Strip U+FFFC from home video cards | after #242 merges | #242 rewrites the home video loader (`home-videos.js`); reuse `cleanVideoText` there. |
| Agent `lastmod` from `staff_users.updated_at` | after #238/#239 merge | Needs a column in `public-data.server.ts`, which both PRs edit (fact 15). |
| Category tagging of videos | owner content | Chips reappear by themselves once rows have a category. |
| `/listings` ItemList JSON-LD still uses the raw `title_zh` (fact 25) | after #239/#242 merge | Switch `listings.tsx:1044` to `publicPropertyTitle`; one line in a shared file. |

---

### Task 1: The chat launcher docks into the mobile action bar (F-07)

**Files:**
- **`src/components/live-agent/LiveAgentLauncher.tsx`:** add `docked?: boolean` and export the trigger classes so the loaded widget uses the same ones.
- **`src/components/live-agent/LiveAgentWidget.tsx:146,281-287`:** accept `triggerClassName?: string` (default: today's string) and pass it to the `DialogPrimitive.Trigger` button. Its visible text 「問樓助手」 goes in a `<span className={docked ? "sr-only lg:not-sr-only" : undefined}>`; the button gets `aria-label="問樓助手"` (same as the launcher today). The panel classes (`:292`) are unchanged.
- **`src/components/site/StickyWhatsAppBar.tsx`:** `bottom-16` → `bottom-0`; padding `px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pr-[3.75rem]` (the right slot is 44 px icon + 12 px edge + 4 px gap); the link gets `min-h-11`; colour classes move to the Task 2 token (`bg-whatsapp hover:bg-whatsapp-hover`). Update the doc comment.
- **`src/components/property/PropertyDecisionActions.tsx:327-360`:** the same bar position, padding and right slot; the three buttons get `px-2`; their leading icons get `hidden min-[420px]:inline` so 「WhatsApp」 fits a 89 px column at 360 px. Labels are unchanged.
- **`src/routes/__root.tsx:142-189`:**
  - `const dockLauncher = showStickyWhatsAppBar || location.pathname.startsWith("/property/");` and `<LiveAgentLauncher docked={dockLauncher} />`.
  - The reservation `pb-32 lg:pb-0` becomes `pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-0`; rewrite the comment above it.
- **`src/routes/property.$listingNo.tsx:510`:** `pb-32 lg:pb-8` → `pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-8`.
- **`src/styles.css`, inside `@layer base` (`:189-200`):**
  ```css
  /* FX-16 F-07: a focused field or an in-page anchor scrolls clear of the
     fixed mobile action bar instead of landing underneath it. */
  @media (width < 64rem) {
    html:has([data-sticky-whatsapp-bar], [data-property-mobile-actions]) {
      scroll-padding-bottom: calc(4.5rem + env(safe-area-inset-bottom));
    }
  }
  ```
- **Fixture:** `scripts/browser-fixtures/live-agent/main.tsx` renders a second scene when `location.search === "?scene=chrome"`: 60 paragraphs, a form whose last field is an `<input>` and submit button (stand-in for the owner valuation form), a footer list of 20 links, `<StickyWhatsAppBar />` and `<LiveAgentLauncher docked />`; `?scene=property` swaps in `PropertyDecisionActions` with fixed props (3 commands, `showMortgage: true`); `?scene=desktop` renders `<LiveAgentLauncher docked={false} />` only. The default scene is unchanged, so `live-agent-cards.spec.ts` is untouched.
- **New `e2e/public-mobile-chrome.spec.ts`**, appended to the end of `testMatch` in `playwright.admin-owned.config.ts` (after `live-agent-cards.spec.ts`, away from #238's insert) and to the `test:live-agent:ui` line.
- **Update** `src/config/site.test.mjs:184-213` and `src/components/property/property-decision.test.mjs:174-176` to the new contract (`bottom-0`, safe-area padding, the right slot, `docked`), keeping their reasons in the messages.

**Interfaces:**
```ts
// src/components/live-agent/LiveAgentLauncher.tsx
/** Mobile: a 44×44 icon in the bars' reserved right slot. lg+: today's floating pill, unchanged. */
export function liveAgentTriggerClass(docked: boolean): string;
// docked === false -> "fixed bottom-4 right-4 z-50 h-11 rounded-full px-4 shadow-lg sm:bottom-5 sm:right-5" (main, byte-identical)
// docked === true  -> "fixed bottom-[calc(0.5rem+env(safe-area-inset-bottom))] right-3 z-50 h-11 w-11 rounded-md p-0 shadow-none
//                      lg:bottom-5 lg:right-5 lg:w-auto lg:rounded-full lg:px-4 lg:shadow-lg"
export function LiveAgentLauncher(props: { docked?: boolean }): JSX.Element;
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `e2e/public-mobile-chrome.spec.ts`, per width in `[360, 375, 390, 430]` (height 740):
    - `the WhatsApp link and the docked chat icon are each at least 44×44 and are the topmost element at their centre` (`document.elementFromPoint` returns the element or a descendant);
    - `the bar touches the viewport bottom and covers at most 10 % of the viewport`;
    - `the last footer link and the last owner-form field scroll fully above the bar` (scroll to the end, and separately `focus()` the last input: its `getBoundingClientRect().bottom` ≤ the bar's `top`);
    - `the docked icon opens the chat panel and focus lands in the message box; closing it returns the icon to the bar` (the existing route stubs from `live-agent-cards.spec.ts` are reused);
    - `property bar: 致電, WhatsApp and 計月供 keep their full label with no overflow at 360 to 430 px` (`scrollWidth <= clientWidth` for each button);
    - `axe finds no violations in the chrome and property scenes` (`AxeBuilder.withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa","best-practice"])`).
  - The same spec at 1440×900: `at 1440 px no bar renders and the launcher box equals main's (right 20, bottom 20, height 44, label visible)`.
  - `site.test.mjs`: `the sticky bar sits at bottom-0 on the safe area and reserves the launcher slot`; `the root reserves the bar height and docks the launcher wherever a mobile bar exists`.
  - `property-decision.test.mjs`: `the property bar sits at bottom-0 with the same launcher slot`.
- [ ] **Step 2: red.** `npm run test:live-agent:ui`, `npm run test:contact`, `npm run test:property-experience`.
- [ ] **Step 3: implement.**
- [ ] **Step 4: green**, the same three scripts.
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview.** Screenshots at 375 and 1440 px of `/`, `/listings?deal=all&page=1` (empty search too), `/property/<active no.>` (gallery visible) and `/contact`, before and after. On a real iPhone (Safari), check the bar sits above the toolbar and the chat opens. Tap WhatsApp, then the chat icon, on each page.
- [ ] **Step 7: commit.**
  ```
  fix(public): dock the chat launcher into the mobile action bar

  F-07. The launcher floated over a bar that floated 64 px up, covering about
  15 % of a 375x812 screen and the hero, empty-search and gallery CTAs. Both
  bars now sit on the safe area at the bottom with a 44 px chat icon in their
  right slot; desktop keeps today's launcher exactly.
  ```

### Task 2: Contrast tokens and current-page semantics (F-08, F-09)

**Files:**
- **`src/styles.css:146`:** `--destructive: oklch(0.6 0.22 27);` → `oklch(0.53 0.21 27);` (`#E62C2C` → `#C90F1A`; update the comment). Ratios after: 5.89 on white, 5.64 on surface, 4.95 / 4.75 on `bg-destructive/10` over card / surface, 5.64 for white on `bg-destructive`. Every user is listed in fact 8; all of them get the same deeper red and none changes layout.
- **`src/styles.css`, new block directly after `:root` (`:158`):**
  ```css
  /* WhatsApp CTA green, darkened from the brand #25D366 (1.98:1 with white
     text) to 5.57:1. One token instead of three hard-coded hex pairs. */
  :root {
    --whatsapp: #08783f;
    --whatsapp-hover: #066333;
  }
  @theme inline {
    --color-whatsapp: var(--whatsapp);
    --color-whatsapp-hover: var(--whatsapp-hover);
  }
  ```
- **Use the token:** `PropertyDecisionActions.tsx:341` (`bg-[#25D366] … hover:bg-[#1ebe57]` → `bg-whatsapp text-white hover:bg-whatsapp-hover`), `StickyWhatsAppBar.tsx:31` (Task 1 already), `contact.tsx:130` (`text-[#25D366]` → `text-whatsapp`).
- **Text chips to the shadcn secondary pair** (`bg-primary/10 text-primary` → `bg-secondary text-secondary-foreground`): `blog.tsx:184` (keep `border-primary`), `blog.tsx:226`, `blog_.$slug.tsx:306`, `FormStatus.tsx:31`. Icon tiles keep `bg-primary/10 text-primary` (they pass 3:1, fact 6). Update `FormStatus.test.tsx:38`.
- **`src/routes/blog.tsx:175-189`:** remove `aria-pressed`; add `activeOptions={{ exact: true }}` so the router marks exactly the selected filter `aria-current="page"` (fact 9). The `role="group"` and its label stay.
- **`src/components/site/SiteHeader.tsx:243-260`:** `aria-current={active ? (hrefPathname(itemHref(item)) === hrefPathname(currentHref) ? "page" : "true") : undefined}`. Visual state is unchanged.
- **New `src/styles.contrast.test.mjs`**, added to `test:styles` (`"node --test src/styles.test.mjs src/styles.contrast.test.mjs"`). It parses the oklch and hex tokens from `styles.css`, converts them to sRGB, composites alpha over `--card` and `--surface`, and computes WCAG ratios. `styles.test.mjs` is not edited (#242 edits it).
- **Update** `blog.routes.test.mjs:178`, `SiteHeader.contract.test.mjs`.

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `styles.contrast.test.mjs`:
    - `every audited text pair meets 4.5:1 and every UI pair 3:1` (the fact 6 table as data: `destructive` on card, surface and `destructive/10` over both; white on `whatsapp` and `whatsapp-hover`; `secondary-foreground` on `secondary`; `primary` on card and surface; `muted-foreground` on card, surface and `muted`; `primary` on `primary/10` at 3:1 for icons);
    - `--brand-primary, --primary and SITE_THEME_COLOR are unchanged` (`oklch(0.515 0.11 156.8)`, `var(--brand-primary)`, `#1F7A4D`);
    - `no source file hard-codes #25D366, #1ebe57 or #08783f` (scan `src/**/*.tsx`).
  - `blog.routes.test.mjs`: `blog filters are links with exact matching and no aria-pressed`.
  - `SiteHeader.contract.test.mjs`: `a section match says aria-current="true"; only the same pathname says "page"`.
  - `FormStatus.test.tsx`: the success class is `bg-secondary`.
- [ ] **Step 2: red.** `npm run test:styles`, `npm run test:blog`, `npm run test:homepage`, `npm run test:contact`.
- [ ] **Step 3: implement.** **Step 4: green**, the same scripts.
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview.** axe at 375 px on `/property/<active no.>`, `/blog`, `/blog?category=樓市分析` and `/contact` (submit nothing; check the error style with the fixture from `public-form-feedback.spec.ts`). Screenshots of a form error, a form success, the blog chips and the property bar, before and after, for the owner.
- [ ] **Step 7: commit** (two commits).
  ```
  fix(a11y): meet 4.5:1 for WhatsApp buttons, form messages and chips

  F-08. The property WhatsApp button was 1.98:1 and every public form error
  3.6-3.8:1. --destructive deepens to #C90F1A, one --whatsapp token replaces
  three hex pairs, and four text chips use the secondary pair. --primary and
  the approved #1F7A4D are unchanged.
  ```
  ```
  fix(a11y): aria-current only on the current page

  F-09. Blog filters used aria-pressed on links (axe critical x8) and the
  「全部」 filter was always current. Header section matches now say "true".
  ```

### Task 3: Truthful JSON-LD and sitemap dates (F-12, F-13)

**Files:**
- **`src/lib/schema.ts` (from `:104` down):**
  - `agentPersonSchema`: `"@type": "Person"` only; `image` through `absoluteUrl`; `telephone` through `formatHkTelephone`; new optional `licenceNo` → `hasCredential` (below).
  - `branchLocalBusinessSchema`: new `addressLocality` and optional `areaServed` inputs; adds `addressCountry` already present.
  - New `listingOffersSchema(input)` and `residenceSchema(input)`, moved out of `property.$listingNo.tsx:409-470` with the changes below.
- **`src/routes/property.$listingNo.tsx:409-470`:** call the two builders. The `BreadcrumbList` (`:471-495`, #239's hunk) is not touched.
- **`src/routes/agents_.$slug.tsx:97-103`:** pass `licenceNo: profile.licence_no`.
- **`src/config/site-branches.js` + `.d.ts`:** add `addressLocality` per branch: 「深井」, 「深井」, 「青龍頭」 (fact 13, read from the addresses). `contact.tsx:16` passes it, and `areaServed` from `districtSlugs` through `districtLabelForSlug` (lido 深井, hong-kong-garden 汀九, rhine none).
- **New `src/lib/sitemap-lastmod.js` + `.d.ts`:** a pure `lastmodFor`.
- **`src/routes/sitemap[.]xml.ts:57-66,155-196`:** `urlXml(path, lastmod)` omits `<lastmod>` when `lastmod` is null; `generatedAt` is deleted; static articles pass `articlePublishedAt(article)`.
- **Tests:** `src/lib/schema.test.ts` and `src/lib/schema.test.mjs` (`test:seo`), `src/routes/sitemap.contract.test.mjs` (`test:seo`). No `package.json` edit (the `test:seo` line belongs to #239).

**Interfaces:**
```ts
// src/lib/schema.ts
export function agentPersonSchema(input: {
  name: string; jobTitle?: string | null; telephone?: string | null;
  image?: string | null; url: string; licenceNo?: string | null;
}): {
  "@type": "Person"; name: string; url: string; "@id": string; worksFor: ReturnType<typeof organizationRef>;
  jobTitle?: string; telephone?: string; image?: string;
  hasCredential?: {
    "@type": "EducationalOccupationalCredential"; credentialCategory: "license"; identifier: string;
    recognizedBy: { "@type": "GovernmentOrganization"; name: "地產代理監管局" };
  };
};

export function listingOffersSchema(input: {
  propertyUrl: string; residenceId: string;
  offerings: Array<{ deal_type: "sale" | "rent"; price: number | null; rent: number | null }>;
  fallback: { isRent: boolean; price: number | null; rent: number | null };
}): Array<Record<string, unknown>>;
// rent offers add:
//   priceSpecification: { "@type": "UnitPriceSpecification", price, priceCurrency: "HKD",
//                         unitCode: "MON", referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" } }
// sale offers: unchanged shape (no priceSpecification). The SoldOut fallback is kept.

export function residenceSchema(input: {
  residenceId: string; propertyUrl: string; name: string; images: string[];
  streetAddress: string | null; districtSlug: string | null;
  estate: { name_zh: string; lat: number | null; lng: number | null } | null;
  saleableArea: number | null; bedrooms: number | null; bathrooms: number | null;
}): Record<string, unknown>;
// address: { streetAddress?, addressLocality: districtLabelForSlug(districtSlug) (omitted when null),
//            addressRegion: "新界" (only when the locality resolved), addressCountry: "HK" }
// containedInPlace: { "@type": "ApartmentComplex", name: estate.name_zh,
//                     geo?: { "@type": "GeoCoordinates", latitude, longitude } }  (only with an estate; geo only with both numbers)
```
```js
// src/lib/sitemap-lastmod.js
/**
 * @param {string} path
 * @param {{ listings: Map<string, string|null>, estates: Record<string, string|null>,
 *           articles: Record<string, string|null>, staticArticles: Record<string, string> }} sources
 * @returns {string | null}  YYYY-MM-DD, or null to omit <lastmod>
 */
export function lastmodFor(path, sources);
```
The user brief said `unitText: "MON"`. `MON` is the UN/CEFACT code, so it goes in `unitCode`, which schema.org documents for that purpose; no `unitText` is emitted (it would be new visible-language copy in the data).

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `schema.test.ts`:
    - `agent node is a Person; hasCredential appears only with a licence number`;
    - `agent image is absolute and telephone is +852 formatted`;
    - `rent offer carries a monthly UnitPriceSpecification and a sale offer none` (R076194's shape: rent 18000);
    - `addressLocality is the district label, never the estate name` (estate 香港黃金海岸 in `castle-peak-road` → 青山公路; estate goes to `containedInPlace.name`);
    - `an unknown district slug omits addressLocality and addressRegion`;
    - `geo appears only when the estate has both lat and lng`;
    - `no builder emits aggregateRating, review, openingHours, geo or priceRange without a source value` (deep-scan every builder's output from a fixture with all optional inputs null);
    - `branch nodes carry addressLocality and areaServed from config`.
  - `schema.test.mjs`: `property route builds its offers and residence through schema.ts` (source scan: no inline `"@type": "Offer"` left in the route).
  - `sitemap.contract.test.mjs`:
    - `static article lastmod = authored date` (`/blog/sham-tseng-buying-guide-2026` → `2026-06-22`);
    - `a CMS row's updated_at wins over the authored date`;
    - `a page with no tracked date has no lastmod element` (`/`, `/about`, `/agents/x`, and a listing with `updated_at: null`);
    - `the route no longer reads the clock for lastmod` (source: no `generatedAt`, no `new Date()` in the route).
- [ ] **Step 2: red.** `npm run test:seo`.
- [ ] **Step 3: implement.** **Step 4: green.** `npm run test:seo && npm run test:property-experience && npm run test:contact`.
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: validate.** From the preview HTML of `/`, `/contact`, `/agents/<slug>`, a sale and a rent `/property/*`, copy each JSON-LD block into validator.schema.org and Google's Rich Results Test (code mode). Record in the PR: 0 errors on both; the warnings for `geo` and `openingHoursSpecification` on `RealEstateAgent` are expected until Owner action 2. `curl <preview>/sitemap.xml`: no URL carries the deploy date unless a source has it; `/blog/*` static articles show their authored dates.
- [ ] **Step 7: commit** (two commits).
  ```
  fix(seo): agents are Persons, rent is monthly, locality is the district

  F-12. Removes the Person+RealEstateAgent multi-type, makes agent images
  absolute and phones +852, adds a licence credential only when one exists,
  states rent per month, and moves the estate from addressLocality to
  containedInPlace. No rating, hours or coordinates are invented.
  ```
  ```
  fix(seo): sitemap lastmod is a real date or absent

  F-13. 95 of 466 URLs carried the generation date. Static articles now use
  their authored date; pages with no tracked date omit <lastmod>.
  ```

### Task 4: The videos page shows clean text and only real categories (F-15)

**Files:**
- **`src/lib/video-description.js` + `.d.ts`:** add `cleanVideoText(value)` (removes U+FFFC, collapses the doubled spaces it leaves, trims). `summarizeVideoDescription` calls it first.
- **`src/routes/videos.tsx`:**
  - `:102-107`: `categoryCounts` keeps only `count > 0`; `:233-264`: the 「分類」 group renders only when `categoryCounts.length > 0`. The 「屋苑」 group is unchanged.
  - Card titles and JSON-LD `name` go through `cleanVideoText`.
  - `:487`: JSON-LD `description: summarizeVideoDescription(video.description)` (falls back to the name inside `videoObjectSchema`), so no boilerplate or agent number reaches the structured data.
- **New `src/lib/video-description.test.mjs`**, added to the `test:videos` line. Extend `src/routes/videos.contract.test.mjs`.
- **No change** to `src/lib/youtube-sync/*` (fact 16): the sync already hides managed videos missing from two monthly full snapshots and never deletes. Stale rows are an owner review (Owner action 3).

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `video-description.test.mjs`: `cleanVideoText removes U+FFFC and the doubled spaces it leaves` (「一梯兩伙！￼有匙即看！￼￼」 → 「一梯兩伙！有匙即看！」); `summarizeVideoDescription cuts at 樓盤編號 and never returns an 8-digit number from the boilerplate`; `summarizeVideoDescription returns null for whitespace-only input` (existing behaviour, now tested).
  - `videos.contract.test.mjs`: `category chips render only for categories with videos`; `VideoObject description is summarised, not raw`; `titles pass through cleanVideoText`.
- [ ] **Step 2: red.** `npm run test:videos`. **Step 3: implement.** **Step 4: green.**
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview.** `/videos` at 375 and 1440: no 「… 0」 chip, no U+FFFC in the HTML (`curl | grep -c $'￼'` = 0), and the JSON-LD descriptions contain no 「樓盤編號」.
- [ ] **Step 7: commit.**
  ```
  fix(videos): hide empty categories, drop U+FFFC, keep boilerplate out of JSON-LD

  F-15. Every category chip read 0 because no row has a category yet; they
  now appear only when they have videos. VideoObject descriptions reused the
  raw YouTube text with listing ids and agent mobiles.
  ```

### Task 5: Phone links, CJK headings and live mortgage results (F-16, F-20, F-21)

**Files:**
- **F-16:** `SiteFooter.tsx:209` and `contact.tsx:113`: `href={toTelHref(branch.phone) ?? undefined}` (from `@/lib/contact-links`). Display text unchanged.
- **F-20 (defined precisely):**
  1. **No negative tracking on CJK headings:** remove `tracking-tight` from `PageHero.tsx`, `SectionHeading.tsx`, `Prose.tsx` heading classes, `__root.tsx:48`, `blog.tsx:235`, and the `index.tsx` and `property.$listingNo.tsx` headings that carry it. Nothing replaces it (letter-spacing returns to 0). This is a removal.
  2. **The home H1 breaks only at its spaces:** add `break-keep` (`word-break: keep-all`) to `index.tsx:312`. Its longest unbreakable run, 汀九買樓租樓, is 216 px at `text-4xl`, under the 343 px line at 375 px.
  3. **Running Chinese text is at least 14 px on phones:** a `p`, `li` or `dd` with 12 or more CJK characters renders at ≥ 14 px at 375 px. Labels, chips, badges, prices, timestamps and the legal footer line are exempt. Task 7 measures it on the 27 pages, and each offender found moves from `text-xs` to `text-sm` in this task's commit (expected: card descriptions in `MegaMenuLink` (`SiteHeader.tsx:288`), the agent `job_title` line (`index.tsx:550`) and estate card blurbs; the list is fixed by the measurement, not guessed).
  4. **Font fallback:** not repeated here; #242 (D6) puts PingFang HK first.
- **F-21:**
  - `src/lib/mortgage.ts`: new pure `liveMortgageInputs(inputs, key, draft)`.
  - `MortgageCalculator.tsx:256-259`: the result is computed from `liveMortgageInputs(...)` of a 300 ms debounced draft (a local `useDebouncedValue`, 8 lines, in the component file; no shared hook is added). The 「編輯中」 panel (`:502-512`, existing copy) shows only while the debounced draft is invalid or a required field is empty.
  - `:501`: move `aria-live="polite"` and `aria-atomic="true"` from the whole block to the 每月供款 `ResultRow` wrapper. The 「編輯中」 panel keeps `role="status"`.
- **Tests:** `src/lib/mortgage.test.ts` (`test:property-experience`); new `src/components/site/public-polish.test.tsx` added to the `test:layout` line (`"bun test src/components/layout/layout.test.tsx src/components/site/public-polish.test.tsx"`); the fixture scene `?scene=mortgage` (renders `<MortgageCalculator initialSearch={{}} />`) with cases in `e2e/public-mobile-chrome.spec.ts`.

**Interfaces:**
```ts
// src/lib/mortgage.ts
/** The inputs to preview while `key` is being typed: the draft applied when it parses and lies
 *  inside MORTGAGE_INPUT_LIMITS[key]; null when it is invalid, out of range or a required field is empty. */
export function liveMortgageInputs(
  inputs: MortgageInputs, key: keyof MortgageInputs, draft: string,
): MortgageInputs | null;
```

**TDD steps:**
- [ ] **Step 1: failing tests.**
  - `public-polish.test.tsx`:
    - `footer and contact phone links are tel:+852` (render `SiteFooter` in a memory router, the `layout.test.tsx` pattern; source-scan `contact.tsx`);
    - `CJK heading components carry no tracking-tight` (source scan of the files in item 1);
    - `the home H1 keeps words together` (`break-keep` on the H1 class).
  - `mortgage.test.ts`: `results update while typing` (`liveMortgageInputs(defaults, "price", "6500000")` gives price 6,500,000); `an invalid or out-of-range draft previews nothing`; `an empty optional income previews without income`.
  - `e2e/public-mobile-chrome.spec.ts` (`?scene=mortgage`): `typing a price updates 每月供款 without blur`; `only the 每月供款 row is a live region`; `an invalid draft shows the existing 編輯中 panel`; axe passes.
- [ ] **Step 2: red.** `npm run test:layout`, `npm run test:property-experience`, `npm run test:live-agent:ui`.
- [ ] **Step 3: implement.** **Step 4: green.**
- [ ] **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview.** Screenshots at 375 and 1440 of `/`, `/blog`, `/estate/bellagio`, `/about` (headings) and `/mortgage` while typing. VoiceOver or NVDA: typing a price announces only the new 每月供款 once.
- [ ] **Step 7: commit** (three commits: `fix(public): tel links use +852` (F-16); `fix(typography): no negative tracking on Chinese headings; keep the hero H1 words whole` (F-20); `fix(mortgage): results update while typing; announce only the monthly payment` (F-21)).

### Task 6: [owner copy] items, gated on approval (F-10, F-18, F-19, F-25, F-26)

**Do not start until the owner has approved each item's wording below** (verbatim, or amended). Items not approved are skipped; the rest still ship.

| Item | Where | Current (verbatim) | Proposed (verbatim) |
|---|---|---|---|
| **F-10a** header link | `SiteHeader.tsx:169-173` | 「晉誠地產最新成交」 with 「追蹤近期成交及區內價格走勢。」 in the 市場資訊 menu | *(removed; the menu keeps 「YouTube影片」, 「屋苑開箱」, 「市場分析」 and 「觀看最新影片」)* |
| **F-10b** footer link | `SiteFooter.tsx:153-157` | 「晉誠地產最新成交」 | *(removed)* |
| **F-10c** home card | `index.tsx:584-590` | 「晉誠地產最新成交」 / 「追蹤近期成交及區內價格走勢。」 | *(removed; the 「最新樓市動態」 grid keeps 「市場分析」 and 「屋苑開箱」, as `sm:grid-cols-2`)* |
| **F-18** branch hours | `site-branches.js` `hours` (shown at `contact.tsx:119-124`) | *(nothing shown)* | 「{星期X至星期X} {HH:MM}–{HH:MM}」 per branch, e.g. the shape 「星期一至星期六 10:00–19:00」, **filled only with hours the owner supplies**. Optional second line 「{星期X及公眾假期} 休息」 only if the owner says so. The same values become `openingHoursSpecification` on that branch's JSON-LD. |
| **F-19** service-area scope | `index.tsx:469`; footer and header 「青山公路區小欖至三聖」 group | 「青山公路屋苑」 / 「掃管笏、青山灣、小欖一帶屋苑，我哋同樣熟悉」 | **Default: unchanged** (fact 24: the client added this group on 2026-09-07). Only if the owner confirms a narrower scope: remove that home section and the 「青山公路區小欖至三聖」 nav and footer group. The home FAQ geography sentence (「青山公路由汀九、油柑頭一直伸延到深井、青龍頭，再去到掃管笏、青山灣、小欖同大欖；深井只係其中一段。」) stays either way: it describes the road, not the service. |
| **F-25a** listing headline prefix | one regex alternative in `normalizePublicListingTitle` (`property-public.ts:97`), which reaches the H1, cards, breadcrumb and property JSON-LD | 「(晉誠地產筍盤推介) 9座極高層樓皇橋海!附設靚裝修!有匙即看!」 | 「9座極高層樓皇橋海!附設靚裝修!有匙即看!」 (a leading 「(晉誠地產…)」 or 「（晉誠地產…）」 tag is removed; the rest stays byte-for-byte, including the 「!」) |
| **F-25b** transport placeholder | `property.$listingNo.tsx:908-910` | 「此屋苑的交通資料仍待核對。請按實際出發地及時段查閱路線。」 | *(the sentence is removed; the 「地區交通」 card keeps its 「查看地區指南 →」 link, so the card still leads somewhere)* |
| **F-26a** generated meta description (T027001 shown) | `listing-seo.ts:436-443` (step 5) | 「深井碧堤半島 高層 4 房單位。實用 901 呎，南，3 廁。售 $1,268萬，呎價 $14,073。碧堤半島，高層，實用面積。WhatsApp 即時預約睇樓或免費估價。晉誠地產 C-018613。」 | 「深井碧堤半島 高層 4 房單位。實用 901 呎，南，3 廁。售 $1,268萬，呎價 $14,073。WhatsApp 即時預約睇樓或免費估價。晉誠地產 C-018613。」 (130 units, about 65 CJK; step 5 adds only whole body clauses that state something new) |
| **F-26b** generated context sentence | `listing-seo.ts:445-456` (step 6) | 「一頁睇齊{屋苑}成交紀錄、同屋苑其他放盤同交通配套。」 | 「一頁睇齊{屋苑}同屋苑其他放盤同交通配套。」 (no transaction claim while the feed is empty, fact 22) |

**Files:** as listed in the table, plus `site.test.mjs` (drop 「晉誠地產最新成交」 and `/transactions` from the required strings, and add `the 最新成交 entry points are hidden while D7 holds`), `property.listing-detail.contract.test.mjs:473` (F-25b; one line, away from #239's `:253-271` and #242's end-of-file block), `listing-seo.test.ts`, `property-public.test.ts`, `schema.test.ts` (F-18 hours, if supplied).

**TDD steps:**
- [ ] **Step 1: failing tests** for each approved item: `the 最新成交 entry points are hidden while D7 holds` (header config, footer and home source); `a leading (晉誠地產…) tag is removed from the public title and nothing else changes` (all eight live variants of fact 25, full-width and half-width brackets, and a title with no tag stays identical); `the fallback transport card has no 仍待核對 sentence and keeps its 查看地區指南 link`; `T027001's description equals the approved text` and `body filler never restates a fact already in the description`; `the context sentence makes no 成交紀錄 claim`; F-18 only if supplied: `a branch with hours shows them on /contact and as openingHoursSpecification; a branch without hours shows neither`.
- [ ] **Step 2: red.** `npm run test:contact`, `npm run test:property-experience`, `npm run test:homepage`, `npm run test:seo`.
- [ ] **Step 3: implement.** **Step 4: green.** **Step 5: lint, typecheck, build.**
- [ ] **Step 6: preview** screenshots of each changed surface at 375 and 1440 for the owner. `/transactions` still returns 200.
- [ ] **Step 7: commit**, one per item: `content(public): hide 最新成交 links until the feed has data (D7, owner-approved <date>)`, and so on.

### Task 7: A 27-page axe gate (accessibility tests)

**Files:**
- **`e2e/a11y.spec.ts`:** rewrite `PAGES` to the 27 below; two viewports per page (375×812 with `isMobile`, and 1440×900); `AxeBuilder().withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa","best-practice"]).exclude("iframe")`. Keep the GET-only route guard (`:10-15`). **A 5xx now fails** when `PLAYWRIGHT_BASE_URL` is set (a remote target must have data), and still skips for a local `npm run dev` without a database. Add three page-level checks to every page:
  - `every aria-current="page" link points to the current pathname`;
  - on `/blog` and `/blog?category=樓市分析`: `exactly one blog filter is current`; on `/listings?deal=sale&page=2&sort=newest`: `the pagination nav has exactly one current link, and it reads 2`;
  - at 375 px: `no running Chinese text is under 14 px` (the F-20 rule).
- **No script or CI change.** `test:a11y` keeps running in the `browser-staging` job (fact 27).

**The 27 pages** (dynamic ones are discovered from the listing page, so the spec works on any data set):

| # | Path | # | Path |
|---|---|---|---|
| 1 | `/` | 15 | `/agents/<first agent link on /agents>` |
| 2 | `/listings?deal=all&page=1` | 16 | `/blog` |
| 3 | `/listings?deal=sale&page=2&sort=newest` | 17 | `/blog?category=樓市分析` |
| 4 | `/listings?deal=rent&page=1&sort=newest` | 18 | `/blog/sham-tseng-buying-guide-2026` |
| 5 | `/property/<first card on #2>` | 19 | `/blog/bellagio-estate-review` |
| 6 | `/property/<first card on #4>?deal=rent` | 20 | `/blog/editorial-standards` |
| 7 | `/estate/bellagio` | 21 | `/estate-reviews` |
| 8 | `/estate/hong-kong-garden` | 22 | `/videos` |
| 9 | `/castle-peak-road` | 23 | `/transactions` |
| 10 | `/castle-peak-road/sham-tseng` | 24 | `/mortgage` |
| 11 | `/castle-peak-road/ting-kau` | 25 | `/contact` |
| 12 | `/district/sham-tseng` | 26 | `/about` |
| 13 | `/privacy` (the legal template `/terms` and `/disclaimer` share) | 27 | `/zz-fx16-not-found` (the 404 page) |
| 14 | `/agents` | | |

(`/district/ting-kau` 308s to `/castle-peak-road/ting-kau`, so it is not listed twice.)

**TDD steps:**
- [ ] **Step 1: write the spec.** Run it against production read-only first, with `PLAYWRIGHT_BASE_URL=https://www.earnestproperty.com npx playwright test e2e/a11y.spec.ts`, to record the "before" list (expected failures: F-08 and F-09 pages). Paste the summary in the PR.
- [ ] **Step 2:** after Tasks 1 to 5, run it against the preview with the owner's share link (`PLAYWRIGHT_BASE_URL=<preview>`; the share cookie set in a `storageState`). **Target: 0 violations on 54 runs.**
- [ ] **Step 3: lint.**
- [ ] **Step 4: commit.**
  ```
  test(a11y): axe gate on 27 public pages at 375 and 1440 px

  Adds WCAG 2.2 AA tags, aria-current and pagination checks, and the 14 px
  Chinese body rule. Runs where data exists (preview or staging); the owned
  fixture covers the FX-16 components deterministically in CI.
  ```

### Verification (whole batch)

- [ ] `npm run lint && npm run typecheck && npm run build`.
- [ ] `npm run test:layout && npm run test:styles && npm run test:videos && npm run test:seo && npm run test:blog && npm run test:homepage && npm run test:contact && npm run test:property-experience && npm run test:control-plane` (`test:control-plane` runs `test-wiring`).
- [ ] `npm run test:live-agent:ui` and the admin browser suites: `npx playwright test --config playwright.admin-owned.config.ts`.
- [ ] Task 7 on the preview: 0 violations on 27 pages × 2 viewports.
- [ ] Screenshots at 375 and 1440 for every UI task, before and after, in the PR.
- [ ] **After production deploy:** rerun Task 7 against production, update the audit Status column for F-07 to F-10, F-12, F-13, F-15, F-16, F-18 to F-21, F-25, F-26, and add a `CHANGELOG.md` entry.

## Owner actions before production

**Order:** approve this plan and the Task 6 wording → (1) → CI green → preview checks (Tasks 1, 2, 3, 7) → merge → (3) when convenient → (4). There is **no migration** and no setting.

| # | Action | Steps | Needed before |
|---|---|---|---|
| 1 | **Preview access** | Give a Vercel preview share link (or set `STAGING_BASE_URL` for the `browser-staging` job), so Task 7 and the screenshots can run against data. Previews are behind Vercel Authentication. | Task 7 |
| 2 | **Facts for F-18 and F-12** (optional) | Send each branch's opening hours (days, open and close times, holidays), and, if you want map pins in search, each branch's latitude and longitude from Google Maps. If not, everything stays as it is. | Task 6 (F-18) |
| 3 | **Stale videos (F-15), dry run first** | (a) Read-only, in the Neon SQL editor on production: `SELECT id, title, youtube_video_id, youtube_managed, youtube_available, youtube_missing_full_runs, updated_at FROM cms_videos WHERE published = true AND (youtube_managed = false OR youtube_missing_full_runs > 0) ORDER BY youtube_managed, youtube_missing_full_runs DESC;` (b) Open each listed video's YouTube link; note the ones that say "Video unavailable". (c) For those only, in 後台 → 內容中心 → YouTube影片, edit the row and switch off 已發布. The row shows 「已隱藏」 and leaves `/videos` and its JSON-LD. **Undo:** switch it back on. Nothing is deleted. Managed rows the sync already counts as missing hide themselves after the second monthly full run. | any time |
| 4 | **Canary** | ecc:canary-watch on `/`, `/listings`, a property, `/contact`, `/mortgage` and `/videos` for 30 minutes: tap WhatsApp and the chat icon on a phone; WhatsApp CTA clicks in analytics (`whatsapp_cta_click`, `property_whatsapp_click`) stay at their usual daily rate over the next week. | after deploy |

**Rollback:** revert the PR. Each task is its own commit (Task 6 one per item), so any one can be reverted alone. Nothing needs restoring in data or settings.

## Open questions

Each has a recommended default. I will use the default unless the owner says otherwise.

1. **F-08: fix the chips without touching the brand green?** **Default: yes.** Four text chips move to the existing secondary pair, and `--primary` stays `#1F7A4D`. The alternative, darkening `--brand-primary` to `oklch(0.50 0.11 156.8)` (`#187549`, chips 4.75:1), changes the approved brand colour on 80 files and `SITE_THEME_COLOR` (fact 7).
2. **F-08: deepen `--destructive` to `#C90F1A`?** **Default: yes.** Every public form error is 3.6 to 3.8:1 today (fact 6). It also changes admin error text and buttons (fact 8), which only gain contrast.
3. **F-07 on property pages: hide the three bar icons below 420 px?** **Default: yes.** It is the only way all three labels and the chat icon fit at 360 px with no label change. The alternative is a separate floating chat circle above the property bar, which keeps the gallery overlap the audit reported.
4. **F-07: may the open chat panel cover the WhatsApp bar on phones?** **Default: yes, as today.** The visitor opened it, it closes with one tap, and it has its own WhatsApp handoff.
5. **F-10: hide the links by removing them, or with a data check?** **Default: remove** (Task 6). A data check needs a query on every page through the root route. To restore, revert that one commit once transactions are published; the sitemap and `noindex` already switch themselves (fact 22).
6. **F-15: shorten the two-month removal window in the sync?** **Default: no.** Two monthly misses protect against a partial YouTube response hiding live videos. Owner action 3 covers today's stale rows.
7. **F-12: individual agents as `Person` or `RealEstateAgent`?** **Default: `Person`** with `worksFor` the agency. `RealEstateAgent` is a `LocalBusiness` (a place with an address and hours), which an individual is not, and multi-typing both is what the audit flagged.
8. **Task 7 target: preview or staging?** **Default: the preview of this PR** with the owner's share link, plus `browser-staging` whenever `STAGING_BASE_URL` is set. The owned fixture covers the changed components in CI (Tasks 1 and 5).

## Findings that differ from the approved fix plan

1. **The audit's WhatsApp green fails too.** `#128C4A` gives 4.31:1 with white. This plan uses `#08783f` (5.57:1), which the generic bar already uses (fact 6).
2. **Public form errors fail contrast (3.6 to 3.8:1)**, which the audit did not list. `--destructive` changes; `--primary` does not, because a 0.15 shortfall on four chips does not justify changing the approved brand colour on 80 files (facts 6 to 8).
3. **F-19 may not be a defect.** The "client narrowed scope" note (2026-08-03) predates the client's 2026-09-07 amendments, which added the 小欖至三聖 group. The default is to leave it as is and ask (fact 24).
4. **F-26 is already within budget.** The width budget (60 / 160 units = about 30 / 80 CJK) exists and every fetched page passes. The real problem is a repeated-fact filler and a 成交紀錄 claim, which are [owner copy] (fact 21).
5. **F-15's sync does not need a "drop removed videos" change.** It never deletes, and already hides managed videos after two monthly misses. What was wrong is on the page: always-rendered zero chips, U+FFFC, and raw boilerplate with agent mobiles in JSON-LD. Stale rows are a reversible owner step (facts 16, 17).
6. **F-09 is wider than the blog.** The header marks section pages as `aria-current="page"` (on a property page, the listings link). The router already handles pagination correctly (facts 9 to 11).
7. **The 27-page axe run cannot use an owned fixture.** Public pages read Neon over HTTP, which owned Postgres cannot serve, and `test:a11y` is not in the main CI matrix (it runs in `browser-staging`). The gate runs on a preview; the changed components get deterministic axe and geometry checks in CI through the live-agent fixture (facts 27, 28).
8. **F-07 also needs the property bar**, which has its own `bottom-16` bar and launcher stack, and the generic bar's link was 40 px tall, under 44 (facts 1, 2).
9. **`unitText: "MON"` becomes `unitCode: "MON"`.** MON is a UN/CEFACT code, which belongs in `unitCode` (Task 3).
10. **F-20's font fallback is FX-15's** (D6, #242). This batch keeps to tracking, line breaks and the 14 px rule (fact 19).
11. **Sitemap `lastmod` is omitted rather than defaulted** for pages with no tracked date, which removes the clock read instead of adding a date source (fact 15).
