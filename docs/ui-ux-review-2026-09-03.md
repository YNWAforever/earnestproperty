# UI/UX review — every public page + admin shell (2026-09-03)

Method: three static audits (public shell + 24 routes, admin shell + 13 pages, docs/content
coverage) cross-checked against a visual pass of the live preview
(https://earnestproperty.vercel.app). Design/decisions:
`docs/superpowers/specs/2026-09-03-ui-ux-refinement-design.md`.

## What was wrong

### Menu / navigation
- 4 mega-menu items were raw `<a>` full-page reloads inside the SPA (`/listings?deal=sale`,
  `/listings?deal=rent`, `/castle-peak-road/ting-kau`, `/#owner-valuation`).
- Active state was `itemHref === location.href`: nothing lit on `/estate/*`, `/blog/*`,
  `/agents/*`, or `/listings?deal=sale&page=2`.
- Mega-menu triggers had no `aria-haspopup`; 屋苑入口 (a generic label) opened one specific
  estate with no hint which.
- Mobile sticky WhatsApp bar (fixed, bottom-16, ~52px tall) covered the last ~52px of every
  page because the root reserved only `pb-16`.
- 404 and runtime-error pages were English-only with `min-h-screen`.
- `/district/tsuen-wan` is orphaned (noindex, no inbound link) — IA decision still open.
- Nav items for empty collections (/transactions, /estate-reviews) render unconditionally —
  DR-9 "conditional nav" remains deferred (needs a root-level fetch).

### Inner-page alignment
- The tested layout primitives (`Container`, `Section`, `SectionHeading`, `Prose`, `Stat`)
  had zero production usage; pages hand-rolled 5 container widths, 3 gutter conventions and
  3 hero styles. `/contact` and `/district/sham-tseng` had no hero band; `/mortgage` dropped
  `lg:px-8`; `/property/$listingNo` used a fixed `px-6`.
- Homepage section headings alternated centre/left (local `SectionHeader` defaulted to
  `text-center`).
- Card titles were `<h2>` on /agents, the corridor hub and /about but `<h3>` everywhere else;
  `CardTitle` rendered a `<div>` so 交通時間 / 校網 / 屋苑資料 / 附近交通 were invisible to
  heading navigation.
- `/estate/$slug`, `/castle-peak-road`, `/blog/$slug` emitted `BreadcrumbList` JSON-LD with no
  visible trail; breadcrumb `<nav>`s had no accessible name; back-links were ad hoc.
- FAQ blocks used four different widths; `/blog/editorial-standards` nested a second `<main>`.

### Missing content
- `/contact`: no meta description (inherited the homepage og tags). `/account/*`: no `head()`.
- `/blog/editorial-standards` absent from the sitemap.
- `/estate-reviews`: empty grid with no message after a district filter.
- `/agents/$slug`: raw estate slugs (`bellagio`) as link text.
- Blog 延伸閱讀 passed `"/listings?deal=all&page=1"` to `<Link to>`.
- `/district/sham-tseng`: zero WhatsApp CTA, no valuation/trust panels, bare-text empty states.
- Estate pages showed `待查` / `單位數待查` placeholders; `/about` hardcoded "23 位持牌代理、3 間分店".
- Homepage 「所有放盤 →」 went to the district page; agent portraits were not links.

### Admin shell
- Sidebar not role-gated: a `viewer` saw 12 entries and could open 1; an `agent` saw 12 and
  could open 5. Command Center had no entry. The sidebar still offset itself (`lg:top-20`)
  for a public header that no longer renders on `/admin`. Two duplicated icons, no link back
  to the public site. 6 of 12 page `<h1>`s did not match their sidebar label.
- `/admin/estates` showed ≤40 rows silently with no search; the estate editor (~40 fields)
  had no unsaved-changes guard and fired 發布 / 還原 / FAQ 刪除 on one click.
- `/admin/segments` still had English field labels, a dead-end empty state, no preview
  loading state, and the admin's last `window.confirm`. `/admin/blasts` painted its empty
  state under the loading skeleton and had unassociated dialog labels. Command Center printed
  raw enums (`buyer`, `high`, `30_days`); operations showed a raw ISO timestamp and two
  English strings.

## Fixed in this branch
See the commit list on `claude/ui-ux-review-refinement-701658`. Summary: `SiteLink` /
`PageHero` / `Breadcrumbs` primitives; header rewritten on them with pathname-based active
state; every public page on the same hero band + `Container`; visible breadcrumbs on deep
pages; heading-level fixes; zh-HK 404/error pages; `pb-32` reservation; all the missing-content
items above except the client-blocked ones; the admin shell and page fixes listed above.

## Still open (needs a decision or data, not code)
| Item | Blocker |
|---|---|
| Legal pages `生效日期：[待補]` | Awaiting HK legal/PDPO review (test-pinned on purpose) |
| `SITE_URL` = preview host in canonicals/OG/sitemap | Client domain decision |
| Branch opening hours, agent WhatsApp/licence numbers | Client data (`site-branches.js`, `site-team.ts` TODOs) |
| `/district/tsuen-wan` reinstate or retire | IA decision (SEO_REDIRECT_PLAN.md) |
| Conditional nav for empty /transactions and /estate-reviews | DR-9 deferred; needs a root loader + cache |
| /transactions and /estate-reviews are empty in production | Content: verified transactions and 屋苑開箱 articles must be published from the admin |
| 7 estates without photos; 17 expansion estates thin (2 FAQs, no facts) | Content |
| Corridor hub intro says 「三個生活圈」 with two segment pages | Test-pinned as intentional; confirm with client |
| Admin backlog beyond this pass (PropertyForm English labels, listings 200-row hard stop, ops filters not in URL, detail routes reporting failures as "not found") | `docs/admin-ux-review-2026-08-05.md` |
