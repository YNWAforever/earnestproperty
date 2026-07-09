# Mega Menu Navigation Redesign

## Summary

Redesign the Earnest Property site header from a compact top nav plus `更多` dropdown into a clearer hybrid mega-menu navigation. The new menu should help users find property search, district pages, buying/renting services, market content, and contact paths without crowding the desktop header.

## Approved Direction

Use the **Full Mega Menu** approach with a mixed top bar:

- Keep `搜尋放盤` as a direct primary link.
- Keep `WhatsApp` as the strongest right-side CTA.
- Replace the current primary/secondary split and `更多` dropdown with three grouped mega-menu triggers:
  - `地區與屋苑`
  - `買租服務`
  - `市場資訊`

This balances high-intent direct actions with a scannable site directory.

## Desktop Navigation Structure

The desktop header should contain:

- Brand link to `/`.
- Direct link: `搜尋放盤` to `/listings`.
- Mega-menu trigger: `地區與屋苑`.
- Mega-menu trigger: `買租服務`.
- Mega-menu trigger: `市場資訊`.
- Right-side `WhatsApp` CTA using the existing `whatsappUrl` helper.

`聯絡` should be available inside service/contact menu content instead of taking top-bar space.

## Mega Menu Groups

### 地區與屋苑

Purpose: users who think by location or estate.

Featured links:

- `深井買樓租樓` to `/district/sham-tseng`.
- `汀九地區頁` to `/district/ting-kau`.

Supporting links:

- `青山公路` to `/castle-peak-road`.
- `屋苑入口` to `/estate/bellagio`.
- `屋苑開箱` to `/estate-reviews`.

Contextual CTA:

- `查看全部放盤` to `/listings`.

### 買租服務

Purpose: users who think by task or need agent help.

Featured links:

- `買樓` to `/listings?deal=sale`.
- `租樓` to `/listings?deal=rent`.

Supporting links:

- `業主放盤 / 免費估價` to `/#owner-valuation`.
- `代理團隊` to `/agents`.
- `聯絡門市` to `/contact`.

Contextual CTA:

- WhatsApp inquiry using the existing deep-link message for 深井 / 青山公路 / 汀九 property enquiries.

### 市場資訊

Purpose: users who want proof, media, or research before contacting.

Featured links:

- `YouTube影片` to `/videos`.
- `成交快訊` to `/transactions`.

Supporting links:

- `屋苑開箱` to `/estate-reviews`.
- `市場分析` to `/blog`.
- `關於晉誠` to `/about`.

Contextual CTA:

- `觀看最新影片` to `/videos`.

## Panel Layout

Each desktop mega menu should open a panel around `720-860px` wide, aligned under the navigation area rather than taking over the full screen.

Panel anatomy:

- Left column: one or two featured links with short descriptions.
- Right side: grouped text links arranged in one or two simple columns.
- Bottom strip: one contextual CTA.

The design should feel like a practical directory for a property agency. Avoid card-heavy marketing treatment, oversized decorative panels, or nested cards. Use restrained borders, existing site colors, and compact spacing. Icons from `lucide-react` may be used lightly, but Chinese labels remain text-first.

## Interaction Behavior

Desktop:

- Open mega panels on click.
- Clicking a different trigger switches to that panel.
- `Escape` closes an open panel.
- Clicking outside closes the panel.
- Selecting a menu link closes the panel.
- Active route styling should remain visible for direct links and relevant trigger states.
- Opening a panel must not cause layout shift; it floats below the sticky header.

Mobile:

- Do not use floating mega panels.
- The existing drawer becomes grouped sections using the same three labels:
  - `地區與屋苑`
  - `買租服務`
  - `市場資訊`
- Each section shows its links vertically with clear spacing.
- The drawer keeps the WhatsApp CTA at the bottom.

## Accessibility

- Mega-menu triggers use `aria-expanded` and `aria-controls`.
- Panels use stable ids tied to their trigger.
- Menu links are normal anchors/router links and keyboard reachable in reading order.
- `Escape` closes the active panel.
- Focus order should move naturally from trigger to panel links.
- Chinese menu labels should be large enough to scan quickly and must not wrap awkwardly inside buttons.

## Implementation Notes

- Keep the change focused in `src/components/site/SiteHeader.tsx` unless small shared helpers/types make the header easier to read.
- Prefer structured menu data arrays over repeating JSX.
- Preserve all current routes and user-supplied menu labels.
- Use normal anchor links for filtered listing URLs such as `/listings?deal=sale` and `/listings?deal=rent` if typed router search params would add unnecessary complexity.
- Do not remove the existing `whatsappUrl` behavior.
- The desktop breakpoint can remain `lg` unless the final layout is cramped; if changed, verify both tablet and desktop widths.

## Testing Plan

- Extend `npm run test:contact` source checks to include:
  - `地區與屋苑`
  - `買租服務`
  - `市場資訊`
  - representative routes from each group
- Run targeted ESLint on `src/components/site/SiteHeader.tsx` and any touched test/config files.
- Manually check desktop width:
  - top bar is not cramped
  - each trigger opens the correct panel
  - outside click, `Escape`, and link selection close panels
- Manually check mobile drawer:
  - grouped sections are visible
  - links fit without overflow
  - WhatsApp CTA remains easy to find

## Out Of Scope

- Creating new destination pages.
- Changing existing route behavior beyond navigation entry points.
- Applying the `cms_videos` database migration.
- Redesigning the footer.
