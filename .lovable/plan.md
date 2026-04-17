
# 晉誠地產 Earnest Property — Hyperlocal 地產網站

A bilingual (繁中/EN) hyperlocal real estate site focused on 深井 (Sham Tseng), with property listings, estate pages, agent backend, and WhatsApp CRM integration.

## Tech & Setup
- **Stack**: TanStack Start + React + TypeScript + Tailwind + shadcn/ui (project default)
- **Backend**: Lovable Cloud (Supabase) — auth, database, storage, RLS
- **Forms**: react-hook-form + zod
- **SEO**: TanStack Router `head()` per route + JSON-LD
- **Charts**: recharts
- **Note**: Will adapt React Router routes from PRD into TanStack file-based routes (e.g. `district.sham-tseng.tsx`, `estate.$slug.tsx`, `property.$id.tsx`)

## Brand System
- Colors: Deep Sea Blue `#0B3B5C`, Gold `#C9A96E`, Coral CTA `#E85D45`, Soft BG `#F7F7F5`
- Fonts: Noto Sans TC + Inter
- Tagline: 深井．青山公路．我哋比你更熟

## Phase 1 — Foundation (this build)
1. **Design system & layout**: brand tokens in styles.css, SiteHeader (logo, nav, 中/EN toggle, WhatsApp CTA), SiteFooter (licence C-018613, address, map, socials)
2. **Database schema** (Lovable Cloud) with RLS:
   - `profiles` (role: admin/manager/agent), `estates`, `properties`, `inquiries`, `articles`, `transactions`, `faqs`
   - User roles via separate `user_roles` table + `has_role()` security definer function
   - Storage bucket for property images
3. **Seed data**: 5 estates (碧堤半島, 浪翠園, 豪景花園, 海韻花園, 麗都花園), 3 demo agents, 15+ sample properties, 3 blog articles, FAQs
4. **Homepage** `/`: Hero with search, estate grid, featured listings, district stats, why-us, latest blog, FAQ, footer
5. **District page** `/district/sham-tseng`: intro, transit times, school net 62, estate list, 12-month price chart, lifestyle, listings, 10-Q FAQ + FAQPage JSON-LD
6. **Estate pages** `/estate/$slug`: hero, info table, avg PSF, sale/rent listings, recent transactions, FAQ, Residence/Place JSON-LD
7. **Property detail** `/property/$id`: gallery + lightbox, full specs, agent card with WhatsApp deep-link (`wa.me/852…?text=查詢樓盤[ID]`), related listings, RealEstateListing JSON-LD, OG image
8. **Agent pages** `/agents` + `/agents/$slug` with their listings
9. **Blog** `/blog` + `/blog/$slug` with Article JSON-LD
10. **About / Contact** with Google Map embed + inquiry form → writes to `inquiries`

## Phase 2 — Backend & CRM
11. **Auth** (`/auth/login`) — email/password for agents & admins
12. **Agent dashboard** `/dashboard`:
    - My listings (status: draft/active/sold/rented/offline)
    - PropertyForm (react-hook-form + zod): type, estate dropdown, price/area/rooms, features, multi-image upload, floorplan
    - My inquiries inbox
    - Profile edit
13. **Admin dashboard** `/dashboard/admin`: approve/edit/delete all listings, manage agents, all inquiries Kanban, CSV bulk import, homepage featured settings
14. **CRM inbox**: unified inquiries view, auto-assign by listing's agent, Kanban (new → contacted → viewing → negotiating → closed)
15. **WhatsApp webhook stub** at `/api/webhook/whatsapp` (server route) — ready for Meta Cloud API later

## Phase 3 — SEO/AEO Polish
- Per-route `head()` with title, description, canonical, OG, Twitter Card
- JSON-LD: Organization + RealEstateAgent + LocalBusiness (home), Place + Residence + FAQPage (estate), RealEstateListing + Product (property), Article + BreadcrumbList (blog)
- `sitemap.xml` server route auto-generated from DB
- `robots.txt`, hreflang zh-HK/en
- WebP images, lazy load, responsive srcset
- AEO: every estate/district page has 10 conversational FAQs with direct-answer first sentence

## Acceptance
- 5 estate pages complete with FAQ + ≥3 sample listings each
- Sham Tseng district page with chart, transit, school net
- Agents can login → add/edit listings; admin can approve & bulk import
- All WhatsApp CTAs carry listing param
- Inquiries from website forms appear in dashboard
- All pages have valid JSON-LD; mobile responsive (375/768/1280/1536)

## Open items I'll default unless you object
- WhatsApp number: placeholder `852XXXXXXXX` until you provide real number
- Logo: SVG placeholder at `/public/logo.svg` (wordmark + abstract coastline icon)
- Real photos: stock/AI-generated placeholders for hero & estates until you upload
- Default language: 繁中 first, EN toggle in header
