# UI/UX refinement — menu, inner-page alignment, missing content (2026-09-03)

## Context

Three code audits (public shell + pages, staff admin, docs/content coverage) and a visual pass
of the live preview (earnestproperty.vercel.app) found that the site's problems are not
visual-design problems but consistency and wayfinding problems:

- **Menu.** Four mega-menu items are raw `<a>` full-page reloads inside the SPA
  (`/listings?deal=…`, `/castle-peak-road/ting-kau`, `/#owner-valuation`); the active state is an
  exact string compare on `location.href`, so nothing lights up on `/estate/*`, `/blog/*`,
  `/listings?deal=sale&page=2`, etc.; triggers lack `aria-haspopup`; the mobile sticky WhatsApp
  bar covers the last ~52px of every page because the root reserves only `pb-16`.
- **Inner-page alignment.** The layout primitives in `src/components/layout/*` are tested but
  unused; pages hand-roll five container widths (3xl/4xl/5xl/6xl/7xl), three padding
  conventions, and three hero styles. `/contact` and `/district/sham-tseng` have no hero band at
  all; `/mortgage` drops `lg:px-8`; the homepage's local `SectionHeader` defaults to
  `text-center` so headings zig-zag left/centre down the page; card titles are `<h2>` on three
  pages and `<h3>` everywhere else; `CardTitle` renders a `<div>` so 交通時間/校網/屋苑資料 are
  invisible to heading navigation; three pages emit `BreadcrumbList` JSON-LD with no visible trail.
- **Missing content.** `/contact` has no meta description; `/account/*` has no `head()`;
  `/blog/editorial-standards` is missing from the sitemap; `/estate-reviews` renders an empty grid
  with no message after a district filter; `/agents/$slug` prints raw estate slugs as link text;
  blog 延伸閱讀 passes `"/listings?deal=all&page=1"` to `<Link to>`; `/district/sham-tseng` has zero
  WhatsApp CTA and no valuation/trust panels; estate pages show `待查` placeholders; `/about`
  hardcodes agent/branch counts; the 404/error pages are English-only with `min-h-screen`.
- **Admin menu.** The sidebar is not role-gated (a `viewer` sees 12 entries and can open 1; an
  `agent` sees 12 and can open 5), Command Center has no entry, the sidebar still offsets itself
  for a public header that no longer renders on `/admin`, two icons are duplicated, and there is
  no link back to the public site.

Deliberately **out of scope** (documented decisions or client-blocked): legal `[待補]` dates
(test-pinned, awaiting HK legal review), `SITE_URL` still on the preview host, branch opening
hours / agent WhatsApp numbers (no data), `/district/tsuen-wan` IA decision, map mode, conditional
nav for empty collections (DR-9, needs a root-level fetch), the corridor hub's 「三個生活圈」 copy
(test-pinned as intentional), and the deep admin form backlog beyond the cheap fixes listed below.

## Design

### 1. Shared primitives (`src/components/site/`)

- **`SiteLink`** — one place that turns an internal href string into the correct typed
  TanStack `<Link>` (`/listings?deal=sale` → `to="/listings" search={{deal:"sale"}}`;
  `/estate/:slug`, `/castle-peak-road/:segment`, `/agents/:slug`, `/blog/:slug`,
  `/property/:no` → `params`; `/#owner-valuation` → `to="/" hash`), and a plain `<a>` for
  external/mailto/tel. Generalises `CorridorRelatedLink` (castle-peak-road.$segment.tsx) which is
  replaced by it. Used by the header, footer, breadcrumbs and blog 延伸閱讀.
- **`PageHero`** — the one hero band: `border-b bg-muted/30` + `Container` (`max-w-7xl px-4
  sm:px-6 lg:px-8`) + `py-14`; eyebrow (`text-sm font-semibold text-primary`) → `h1`
  (`text-3xl … sm:text-5xl`) → lead (`max-w-3xl leading-8 text-muted-foreground`) → actions.
  `tone="brand"` keeps the estate page's gradient identity with the same structure;
  `size="compact"` (`py-8`, `sm:text-4xl`) for tool pages (`/listings`).
- **`Breadcrumbs`** — `<nav aria-label="頁面路徑">` + `<ol>`, last item `aria-current="page"`;
  every deep page (3+ levels) shows 首頁 › section › page, matching the JSON-LD it already emits.
- `layout/Container` and `layout/EmptyState` are adopted instead of hand-rolled copies.

### 2. Header / menu

- Nav data keeps its `href` strings (contract-tested) but renders through `SiteLink`, so every
  item is an SPA navigation.
- Active state: compare **pathnames** (query/hash stripped); each mega-menu group also owns a
  prefix list (`districts`: `/estate/`, `/district/`, `/castle-peak-road`; `services`:
  `/agents`, `/mortgage`, `/contact`; `market`: `/videos`, `/transactions`, `/blog`,
  `/estate-reviews`) so child routes light their parent. 搜尋放盤 owns `/listings` and `/property/`.
- Triggers get `aria-haspopup="true"`. 屋苑入口's description names the estate it opens.
- Root bottom reservation becomes `pb-32 lg:pb-0` (bar sits at 64px + ~52px tall); the contract
  test is updated with the reason. 404 and error pages become zh-HK and lose `min-h-screen`.

### 3. Inner-page alignment

Every public page = `PageHero` + body sections in `Container` (`py-12`). Reading pages (blog
article, legal, editorial standards) keep a `max-w-3xl` **text column inside** the 7xl container
so their left edge lines up with every other page. FAQ accordions sit in a `max-w-3xl` column.
Specific fixes: homepage `SectionHeader` defaults to left-aligned (the two-column headers already
are); 「所有放盤 →」 goes to `/listings`; homepage agent cards link to the profile; card titles
inside grids are `<h3>`; `CardTitle as="h3"` for 交通時間 / 校網 / 屋苑資料 / 附近交通; nested
`<main>` removed from editorial-standards; breadcrumb navs get labels; `/mortgage` header adopts
the hero band; `/property/$listingNo` gets responsive padding.

### 4. Missing content

`/contact` description + og meta and a hero; `/account/$pathname` `head()` (title + noindex);
`/blog/editorial-standards` in the sitemap; `/estate-reviews` filtered-empty `EmptyState`;
`/agents/$slug` estate names from the registry; blog 延伸閱讀 via `SiteLink`;
`/district/sham-tseng` gains `IntentWhatsAppCTA`, `OwnerValuationPanel`, `TrustProofPanel`,
`EmptyState` for chart/FAQ; estate `待查` → omitted fact / `—`; `/about` counts derived from data.

### 5. Admin (bounded)

- `AdminShell`: role-gate `navGroups` (items render disabled with the required role named,
  the pattern `/admin/operations` already uses); add 客戶查詢 › Command Center; drop the stale
  `lg:top-20`/`h-[calc(100vh-6rem)]`; unique icons; a 「查看網站」 link to `/`.
- Cheap page fixes: estate editor leave guard + confirm on FAQ 刪除 / 還原 / 發布;
  `/admin/estates` search + row-cap notice + empty-state action; blasts skeleton-vs-empty and
  `Field` label association; segments zh-HK copy, preview loading state, empty-state actions,
  selected indicator; command-center intent/urgency/timeline labels; operations timestamp + two
  English strings; page `<h1>`s aligned to their sidebar labels.

## Verification

- `npx tsc --noEmit`, `npm run lint`.
- Contract suites: `test:homepage`, `test:contact`, `test:legal`, `test:property-experience`,
  `test:blog`, `test:videos`, `test:estate-reviews`, `test:district`, `test:transactions`,
  `test:listing-search`, `test:seo`, `test:layout`, `test:corridor`, `test:command-center`,
  `test:operations`, `test:admin-estates`, `test:cms`, `test:team`.
- Local `npm run dev` (no DB locally, so DB-backed sections show their empty/error states):
  screenshot the header/mega menu, mobile sheet, and the pages that changed structure.
