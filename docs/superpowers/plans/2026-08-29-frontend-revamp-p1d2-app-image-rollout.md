# P1d2 — `AppImage` Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 24 raw `<img>` tags on public routes with `AppImage`, closing
P1's "zero raw `<img>` on public routes" acceptance criterion.

**Architecture:** Every site keeps its exact current `width`/`height`/`className`
sizing and its exact current `loading` value (explicit `eager`/`lazy` sites keep what
they had; the four sites with no `loading` attribute at all get `lazy`, since none of
them are above-the-fold). Two real simplifications happen along the way, both
grounded in `AppImage`'s actual behavior (built in P1d1), not invented:
1. Every `{src ? (<img .../>) : (<fallback/>)}` ternary collapses to an unconditional
   `<AppImage src={src} .../>` — `AppImage` already renders the fallback internally
   when `src` is falsy.
2. `index.tsx`'s `PropertyCard` drops its local `coverFailed` `useState` and `onError`
   handler entirely — that's exactly what `AppImage`'s internal failed-state handling
   now does, so keeping the local copy would just be dead weight duplicating it.

Three avatar sites (`agents.tsx`, `agents_.$slug.tsx`, `about.tsx`) already fall back to
a `<UserRound>` icon when `avatar_url` is missing — that fallback is preserved via
`AppImage`'s `fallback` prop, not replaced with the generic brand wordmark, since a
person icon is the more correct affordance for a missing person photo. The homepage's
team-grid avatar (`index.tsx:406`) currently falls back to rendering nothing at all —
this plan gives it the same `UserRound` fallback as the other three avatar sites, for
consistency, rather than either leaving a blank gap or showing the (semantically wrong
for a person) brand wordmark. Static, build-time-imported assets (`heroImage`,
`logoMark`) never have a realistic missing-`src` case, so their `AppImage` calls need
no `fallback` prop — the default is simply unreachable for them.

**Tech Stack:** Same as the rest of P1 — no new tooling.

**Prerequisite:** P1d1 (`docs/superpowers/plans/2026-08-29-frontend-revamp-p1d1-app-image.md`)
must be merged first — every task below imports `AppImage` from
`src/components/media/AppImage.tsx`.

---

## File Structure

No new files. Modifies: `src/routes/index.tsx`, `src/routes/property.$listingNo.tsx`,
`src/routes/agents.tsx`, `src/routes/agents_.$slug.tsx`, `src/routes/about.tsx`,
`src/routes/listings.tsx`, `src/routes/estate.$slug.tsx`,
`src/routes/estate-reviews.tsx`, `src/components/site/CorridorInventory.tsx`,
`src/routes/contact.tsx`, `src/routes/videos.tsx`, `src/components/site/SiteHeader.tsx`,
`src/components/site/SiteFooter.tsx`.

---

## Task 1: `index.tsx` (7 sites)

**Files:** Modify `src/routes/index.tsx`

- [ ] **Step 1: Add the import**

Add after the existing `toTelHref` import (already extended by P1b's Task 5 and
P1a's format import — if this plan lands independently of those, add it after whatever
`@/lib/*` import is currently last):

```ts
import { AppImage } from "@/components/media/AppImage";
```

- [ ] **Step 2: Hero image (line 201) — LCP candidate, stays eager**

Current:

```tsx
<img
  src={heroImage}
  alt="深井海岸線及屋苑景觀"
  className="h-full w-full object-cover"
  width={2048}
  height={1370}
/>
```

Replace with:

```tsx
<AppImage
  src={heroImage}
  alt="深井海岸線及屋苑景觀"
  className="h-full w-full object-cover"
  width={2048}
  height={1370}
  loading="eager"
/>
```

- [ ] **Step 3: Team-grid avatar (line 406) — gets the UserRound fallback**

Current:

```tsx
{agent.avatar_url ? (
  <img
    src={agent.avatar_url}
    alt={`${name} 個人相片`}
    loading="lazy"
    width={160}
    height={160}
    className="h-full w-full object-cover"
  />
) : null}
```

Replace with (note `UserRound` needs adding to this file's `lucide-react` import list
if not already present — check the existing import line and add it):

```tsx
<AppImage
  src={agent.avatar_url}
  alt={`${name} 個人相片`}
  width={160}
  height={160}
  className="h-full w-full object-cover"
  fallback={
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <UserRound className="h-9 w-9" aria-hidden="true" />
    </div>
  }
/>
```

- [ ] **Step 4: Logo mark in the about-preview section (line 457)**

Current:

```tsx
<img
  src={logoMark}
  alt=""
  width={44}
  height={44}
  className="h-11 w-11 object-contain"
/>
```

Replace with:

```tsx
<AppImage src={logoMark} alt="" width={44} height={44} className="h-11 w-11 object-contain" />
```

(No `fallback` needed — `logoMark` is a build-time import, never missing.)

- [ ] **Step 5: Branch photo card (line 495)**

Current:

```tsx
{branch.photo ? (
  <img
    src={branch.photo}
    alt={`${branch.name}舖面`}
    loading="lazy"
    width={branch.photoWidth}
    height={branch.photoHeight}
    className="h-64 w-full object-cover sm:h-72"
  />
) : null}
```

Replace with:

```tsx
<AppImage
  src={branch.photo}
  alt={`${branch.name}舖面`}
  width={branch.photoWidth}
  height={branch.photoHeight}
  className="h-64 w-full object-cover sm:h-72"
/>
```

- [ ] **Step 6: Estate card photo (line 668) — preserves the first-4-eager pattern**

Current:

```tsx
{estate.photo ? (
  <img
    src={estate.photo}
    alt={`${estate.name} 深井 放盤`}
    width={1600}
    height={900}
    // The first row is above the fold on desktop; the rest are not.
    loading={index < 4 ? "eager" : "lazy"}
    className="h-full w-full object-cover"
  />
) : null}
```

Replace with:

```tsx
<AppImage
  src={estate.photo}
  alt={`${estate.name} 深井 放盤`}
  width={1600}
  height={900}
  // The first row is above the fold on desktop; the rest are not.
  loading={index < 4 ? "eager" : "lazy"}
  className="h-full w-full object-cover"
/>
```

- [ ] **Step 7: Video thumbnail (line 816)**

Current:

```tsx
{thumbnail ? (
  // Decorative: the card's own title/eyebrow/CTA text already labels the
  // link, so a repeated "<title> 影片預覽" alt would be announced twice.
  <img
    src={thumbnail}
    alt=""
    loading="lazy"
    width={480}
    height={360}
    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
  />
) : null}
```

Replace with:

```tsx
{/* Decorative: the card's own title/eyebrow/CTA text already labels the
    link, so a repeated "<title> 影片預覽" alt would be announced twice. */}
<AppImage
  src={thumbnail}
  alt=""
  width={480}
  height={360}
  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
/>
```

- [ ] **Step 8: Property card cover (lines 910-911, 930-940) — drops the now-redundant `coverFailed` state**

Current, lines 907-911:

```tsx
  // Falls back to the gradient/Building2 placeholder if the photo host 404s or
  // blocks hotlinking -- without this, `cover` stayed truthy forever and the
  // fallback below could never render.
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverFailed ? null : (property.images?.[0] ?? null);
```

Replace with:

```tsx
  // AppImage's own internal onError/fallback handling now covers what
  // coverFailed used to do locally -- see AppImage.tsx.
  const cover = property.images?.[0] ?? null;
```

Current, lines 930-940:

```tsx
        {cover ? (
          <img
            src={cover}
            alt={`${property.title_zh} 相片`}
            loading="lazy"
            width={640}
            height={480}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setCoverFailed(true)}
          />
        ) : null}
```

Replace with:

```tsx
        <AppImage
          src={cover}
          alt={`${property.title_zh} 相片`}
          width={640}
          height={480}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
```

Confirm `useState` is still used elsewhere in this file (it is — other components in
`index.tsx` use it) so the import doesn't become unused; if this were the only
`useState` call in the file, the import would need removing too.

- [ ] **Step 9: Run the tests**

Run: `npm run test:homepage`
Expected: same result as the P0 baseline (6 pass, 0 fail).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 10: Commit**

```bash
git add src/routes/index.tsx
git commit -m "refactor(homepage): replace raw <img> with AppImage (7 sites)

PropertyCard's local coverFailed state/onError is removed -- AppImage's
own internal fallback handling now does the same job. Team-grid avatar
gets the same UserRound fallback the other three avatar sites already
use, instead of rendering nothing when avatar_url is missing."
```

---

## Task 2: `property.$listingNo.tsx` (4 sites)

**Files:** Modify `src/routes/property.$listingNo.tsx`

- [ ] **Step 1: Add the import**

Add alongside this file's other new-in-P1 import from P1b's Task 6 (or, if this plan
lands independently, after the `createWebsiteInquiry` import):

```ts
import { AppImage } from "@/components/media/AppImage";
```

- [ ] **Step 2: Main gallery photo (line 475) — stays eager**

Current:

```tsx
<img
  src={images[activeImg]}
  alt={property.title_zh}
  className="aspect-[4/3] w-full object-cover"
  loading="eager"
/>
```

Replace with (width/height added — this site had none before; the gallery's fixed
`aspect-[4/3]` container implies a 4:3 ratio, so use a representative 1200x900):

```tsx
<AppImage
  src={images[activeImg]}
  alt={property.title_zh}
  width={1200}
  height={900}
  className="aspect-[4/3] w-full object-cover"
  loading="eager"
/>
```

- [ ] **Step 3: Thumbnail strip (line 493)**

Current:

```tsx
<img
  src={src}
  alt={`${property.title_zh} ${i + 1}`}
  className="h-full w-full object-cover"
  loading="lazy"
/>
```

Replace with:

```tsx
<AppImage
  src={src}
  alt={`${property.title_zh} ${i + 1}`}
  width={200}
  height={150}
  className="h-full w-full object-cover"
/>
```

- [ ] **Step 4: Floorplan (line 537)**

Current:

```tsx
<img
  src={floorplanUrl}
  alt={`${property.title_zh} 平面圖`}
  className="w-full object-contain"
  loading="lazy"
/>
```

Replace with:

```tsx
<AppImage
  src={floorplanUrl}
  alt={`${property.title_zh} 平面圖`}
  width={1200}
  height={900}
  className="w-full object-contain"
/>
```

- [ ] **Step 5: Related/similar listing card (line 805)**

Current:

```tsx
<img
  src={img}
  alt={listing.title_zh}
  className="h-full w-full object-cover transition-transform group-hover:scale-105"
  loading="lazy"
/>
```

Replace with:

```tsx
<AppImage
  src={img}
  alt={listing.title_zh}
  width={400}
  height={300}
  className="h-full w-full object-cover transition-transform group-hover:scale-105"
/>
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:property-experience`
Expected: same as the P0 baseline (89 node pass / 2 known pre-existing fail + 105 bun
pass — unrelated to this task, see `docs/superpowers/reports/2026-08-28-revamp-baseline.md` §4.2).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/routes/property.$listingNo.tsx
git commit -m "refactor(property): replace raw <img> with AppImage (4 sites)

Main gallery photo and thumbnail strip previously had no width/height
at all -- now required by AppImage's types, closing that DR-7 gap."
```

---

## Task 3: Avatar sites — `agents.tsx`, `agents_.$slug.tsx`, `about.tsx` (3 sites)

**Files:** Modify `src/routes/agents.tsx`, `src/routes/agents_.$slug.tsx`,
`src/routes/about.tsx`

- [ ] **Step 1: Add the import to all three files**

```ts
import { AppImage } from "@/components/media/AppImage";
```

- [ ] **Step 2: `agents.tsx:97`**

Current, lines 96-108:

```tsx
{agent.avatar_url ? (
  <img
    src={agent.avatar_url}
    alt={`${name} 個人相片`}
    loading="lazy"
    width={104}
    height={104}
    className="h-full w-full object-cover"
  />
) : (
  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
    <UserRound className="h-9 w-9" aria-hidden="true" />
  </div>
)}
```

Replace with:

```tsx
<AppImage
  src={agent.avatar_url}
  alt={`${name} 個人相片`}
  width={104}
  height={104}
  className="h-full w-full object-cover"
  fallback={
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <UserRound className="h-9 w-9" aria-hidden="true" />
    </div>
  }
/>
```

- [ ] **Step 3: `agents_.$slug.tsx:79`**

Current, lines 78-91:

```tsx
{profile.avatar_url ? (
  <img
    src={profile.avatar_url}
    alt={`${name} 個人相片`}
    loading="lazy"
    width={128}
    height={128}
    className="h-full w-full object-cover"
  />
) : (
  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
    <UserRound className="h-10 w-10" aria-hidden="true" />
  </div>
)}
```

Replace with:

```tsx
<AppImage
  src={profile.avatar_url}
  alt={`${name} 個人相片`}
  width={128}
  height={128}
  className="h-full w-full object-cover"
  fallback={
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <UserRound className="h-10 w-10" aria-hidden="true" />
    </div>
  }
/>
```

Also replace this file's second image site, `agents_.$slug.tsx:213` (an agent's
listing card, no custom fallback needed):

Current:

```tsx
<img
  src={img}
  alt={listing.title_zh}
  loading="lazy"
  width={400}
  height={300}
  className="h-full w-full object-cover transition-transform group-hover:scale-105"
/>
```

Replace with:

```tsx
<AppImage
  src={img}
  alt={listing.title_zh}
  width={400}
  height={300}
  className="h-full w-full object-cover transition-transform group-hover:scale-105"
/>
```

- [ ] **Step 4: `about.tsx:129`**

Current, lines 128-141:

```tsx
{agent.avatar_url ? (
  <img
    src={agent.avatar_url}
    alt={`${name} 個人相片`}
    loading="lazy"
    width={200}
    height={200}
    className="h-full w-full object-cover"
  />
) : (
  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
    <UserRound className="h-8 w-8" aria-hidden="true" />
  </div>
)}
```

Replace with:

```tsx
<AppImage
  src={agent.avatar_url}
  alt={`${name} 個人相片`}
  width={200}
  height={200}
  className="h-full w-full object-cover"
  fallback={
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <UserRound className="h-8 w-8" aria-hidden="true" />
    </div>
  }
/>
```

Also replace this file's second image site, `about.tsx:176` (branch photo, no custom
fallback needed):

Current:

```tsx
<img
  src={branch.photo}
  alt={`${branch.name}舖面`}
  loading="lazy"
  width={branch.photoWidth}
  height={branch.photoHeight}
  className="h-40 w-full object-cover"
/>
```

Replace with:

```tsx
<AppImage
  src={branch.photo}
  alt={`${branch.name}舖面`}
  width={branch.photoWidth}
  height={branch.photoHeight}
  className="h-40 w-full object-cover"
/>
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:property-experience`
Expected: same as Task 2 Step 6 (this script covers `agents.contract.test.mjs`).

Confirm `src/routes/agents.contract.test.mjs:178`'s `<img` regex scan still passes —
`AppImage` renders a real `<img>` element, so the rendered markup is unchanged for
this test's purposes.

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/routes/agents.tsx src/routes/agents_.$slug.tsx src/routes/about.tsx
git commit -m "refactor(agents,about): replace raw <img> with AppImage (5 sites)

The three avatar sites' existing UserRound fallback is preserved via
AppImage's fallback prop rather than replaced by the generic default."
```

---

## Task 4: Listing/article card sites — `listings.tsx`, `estate.$slug.tsx`, `estate-reviews.tsx`, `CorridorInventory.tsx` (4 sites)

**Files:** Modify `src/routes/listings.tsx`, `src/routes/estate.$slug.tsx`,
`src/routes/estate-reviews.tsx`, `src/components/site/CorridorInventory.tsx`

- [ ] **Step 1: Add the import to all four files**

```ts
import { AppImage } from "@/components/media/AppImage";
```

(`listings.tsx` already gained a `@/lib/format` import in P1b's Task 4 — add this line
alongside it if both plans land together; otherwise add near the top of this file's
own import block.)

- [ ] **Step 2: `listings.tsx:407`**

Current:

```tsx
<img
  src={cover}
  alt={p.title_zh}
  loading="lazy"
  className="h-full w-full object-cover transition group-hover:scale-105"
/>
```

Replace with (this site had no `width`/`height` at all before):

```tsx
<AppImage
  src={cover}
  alt={p.title_zh}
  width={400}
  height={300}
  className="h-full w-full object-cover transition group-hover:scale-105"
/>
```

- [ ] **Step 3: `estate.$slug.tsx:345`**

Current:

```tsx
<img
  src={listing.images[0]}
  alt={listing.title_zh}
  className="h-full w-full object-cover"
/>
```

Replace with (this site had no `loading`/`width`/`height` at all before):

```tsx
<AppImage
  src={listing.images[0]}
  alt={listing.title_zh}
  width={400}
  height={300}
  className="h-full w-full object-cover"
/>
```

- [ ] **Step 4: `estate-reviews.tsx:125`**

Current:

```tsx
<img src={article.cover_image} alt="" className="h-full w-full object-cover" />
```

Replace with (this site had no `loading`/`width`/`height` at all before; it sits in an
`aspect-video` container per the surrounding markup, so use a 16:9 pair):

```tsx
<AppImage
  src={article.cover_image}
  alt=""
  width={640}
  height={360}
  className="h-full w-full object-cover"
/>
```

- [ ] **Step 5: `CorridorInventory.tsx:30`**

Current:

```tsx
<img
  src={cover}
  alt={listing.title_zh}
  loading="lazy"
  decoding="async"
  className="h-full w-full object-cover"
/>
```

Replace with (this site had `decoding="async"` explicitly, which `AppImage` already
sets by default — drop the now-redundant prop; still no `width`/`height` before this):

```tsx
<AppImage
  src={cover}
  alt={listing.title_zh}
  width={400}
  height={300}
  className="h-full w-full object-cover"
/>
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:listing-search && npm run test:estate-conversion && npm run test:corridor`
Expected: same results as the P0 baseline for each (16/0, 17/1 pre-existing, 18/0 —
see `docs/superpowers/reports/2026-08-28-revamp-baseline.md` §4).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/routes/listings.tsx src/routes/estate.$slug.tsx src/routes/estate-reviews.tsx src/components/site/CorridorInventory.tsx
git commit -m "refactor(listings,estate,corridor): replace raw <img> with AppImage (4 sites)

Three of these four sites had no width/height at all before -- closes
that DR-7 gap on every listing/article card grid."
```

---

## Task 5: Remaining sites — `contact.tsx`, `videos.tsx`, `SiteHeader.tsx`, `SiteFooter.tsx` (4 sites)

**Files:** Modify `src/routes/contact.tsx`, `src/routes/videos.tsx`,
`src/components/site/SiteHeader.tsx`, `src/components/site/SiteFooter.tsx`

- [ ] **Step 1: Add the import to all four files**

```ts
import { AppImage } from "@/components/media/AppImage";
```

- [ ] **Step 2: `contact.tsx:118`**

Current:

```tsx
<img
  src={branch.photo}
  alt={`${branch.name}舖面`}
  loading="lazy"
  width={branch.photoWidth}
  height={branch.photoHeight}
  className="h-64 w-full object-cover sm:h-72"
/>
```

Replace with:

```tsx
<AppImage
  src={branch.photo}
  alt={`${branch.name}舖面`}
  width={branch.photoWidth}
  height={branch.photoHeight}
  className="h-64 w-full object-cover sm:h-72"
/>
```

- [ ] **Step 3: `videos.tsx:495`**

Current:

```tsx
<img
  src={thumbnailUrl}
  alt=""
  loading="lazy"
  width={480}
  height={360}
  className="absolute inset-0 h-full w-full object-cover"
/>
```

Replace with:

```tsx
<AppImage
  src={thumbnailUrl}
  alt=""
  width={480}
  height={360}
  className="absolute inset-0 h-full w-full object-cover"
/>
```

- [ ] **Step 4: `SiteHeader.tsx:339` — the one site that stays eager with `fetchPriority`**

Current:

```tsx
<img
  src={logoMark}
  alt=""
  width={60}
  height={60}
  fetchPriority="high"
  className="h-14 w-14 object-contain sm:h-[60px] sm:w-[60px]"
/>
```

Replace with:

```tsx
<AppImage
  src={logoMark}
  alt=""
  width={60}
  height={60}
  loading="eager"
  fetchPriority="high"
  className="h-14 w-14 object-contain sm:h-[60px] sm:w-[60px]"
/>
```

(`fetchPriority="high"` on a `loading="lazy"` image is a contradictory signal to the
browser; this header logo renders on every route and is above-the-fold, so making the
existing high-priority intent explicit with `loading="eager"` is correct here, not a
change of intent — see this plan's header for the LCP-candidate reasoning. No
`fallback` needed — `logoMark` is a build-time import, never missing.)

- [ ] **Step 5: `SiteFooter.tsx:13`**

Current:

```tsx
<img
  src={logoMark}
  alt=""
  width={48}
  height={48}
  className="h-12 w-12 object-contain"
/>
```

Replace with:

```tsx
<AppImage src={logoMark} alt="" width={48} height={48} className="h-12 w-12 object-contain" />
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:contact && npm run test:videos && npm run test:homepage`
Expected: same results as the P0 baseline for each (`test:contact` has 2 known
pre-existing failures unrelated to this task — see
`docs/superpowers/reports/2026-08-28-revamp-baseline.md` §4.2 — `test:videos` and
`test:homepage` are both fully green at baseline).

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/routes/contact.tsx src/routes/videos.tsx src/components/site/SiteHeader.tsx src/components/site/SiteFooter.tsx
git commit -m "refactor(contact,videos,site): replace raw <img> with AppImage (4 sites)

SiteHeader's logo now makes its existing fetchPriority=high intent
explicit with loading=eager (both signals were already pointed the
same direction; the loading attribute was just previously implicit)."
```

---

## Verification (end to end)

1. `grep -rn "<img" src/routes/ src/components/site/ --include="*.tsx"` (excluding
   `src/components/ui/`, `src/routes/admin.*`, `src/components/admin/`) returns **zero**
   matches — confirms every raw `<img>` catalogued in this plan's audit is gone. (This
   grep intentionally does not need to exclude `AppImage.tsx` itself, since that file
   lives in `src/components/media/`, outside the paths scanned.)
2. `npm run test:homepage && npm run test:property-experience && npm run test:listing-search && npm run test:estate-conversion && npm run test:corridor && npm run test:contact && npm run test:videos`
   — every script matches its P0-baseline result exactly (no new failures beyond the
   already-documented pre-existing ones).
3. `npx tsc --noEmit` — still 0 errors.
4. `npx eslint .` — problem count still at or below the P0 baseline's 6,185.
5. `npm run build` — still passes.
6. Manually load `/`, `/listings`, `/property/<a-real-listing-no>`, `/agents`,
   `/agents/<a-real-slug>`, `/about`, `/contact`, `/estate/<a-real-slug>`,
   `/estate-reviews`, `/videos`, and a corridor page in a dev server. Confirm: every
   image renders identically to before (same photos, same sizing, same crop
   behavior); an agent with no `avatar_url` shows the person-icon fallback instead of
   a blank gap (this is the one intentional visible change in this plan, on the
   homepage team grid — confirm it looks right); temporarily break one image URL (edit
   a DB row or use browser devtools request-blocking) and confirm the "晉誠地產"
   fallback renders instead of a broken-image icon.
7. `git diff --stat` against the branch this was built on shows exactly the thirteen
   files listed in "File Structure" above.

This closes out P1 entirely — every sub-plan (a, b, c, d1, d2, e) is now either merged
or ready to merge, and P2 (data trust: DR-1 through DR-6, DR-8) can start.
