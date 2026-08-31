# P6c3 — Proper /admin/estates editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `/admin/estates` route (list + `$id` + `new`) editing the 10 estate columns that exist in the database but have no UI anywhere today (`aliases`, `address`, `blocks`, `school_net_code`, `transport_note`, `verified_at`, `district_id`, `avg_saleable_psf`, `lat`, `lng` — P4 built these columns "pending verified facts"; this is that pending mechanism), plus the 15 fields the CMS tab's existing estate dialog already edits, an estate-scoped FAQ section, and a lightweight pre-publish preview. Routed through the **same** revision engine P6b wired up (`saveAdminCmsDraft`/`publishAdminCmsRevision`/`restoreAdminCmsRevision`/`archiveAdminCmsResource`, `resourceType: "estate"`) — per the confirmed scope decision, this is not a second, direct-write path into `estates`.

**Base branch:** `feat/frontend-revamp-p6b-cms-revision-wiring` (not P6c1/c2 — this doesn't touch transactions at all).

---

## 0. A real correctness risk found while planning this, and how it's fixed

`admin-cms.server.ts`'s `projectorSql()` for `resourceType: "estate"` is a **hardcoded INSERT/UPDATE naming exactly the 15 CMS-known columns** — it does not reference any of the 10 new columns at all. Two consequences, both real:

1. **Publishing does nothing with the new fields today.** If this phase only added form fields and shipped drafts through the existing projector unchanged, `publishAdminCmsRevision` would silently drop `aliases`/`address`/etc. on the floor at the exact moment of publish — the draft's JSON payload would store them fine, but the live `estates` row would never see them. Task 1 extends the projector's `estate` INSERT/UPDATE to include all 10 columns.
2. **Once the projector writes those 10 columns, both editors share one payload space with different field sets.** The CMS tab's existing `EstateDialog` (P6b) only ever sends the 15 known fields in its draft payload — it doesn't know these new 10 exist. If its draft is *ever* published after this phase ships, the projector's `payload->>'aliases'` etc. would all be `NULL` (the key is simply absent from that payload), and the `ON CONFLICT DO UPDATE` would **overwrite whatever `/admin/estates` had just set with NULL** — a real, silent data-loss path. Task 2 fixes this at the source: `EstateDialog`'s draft-save now carries forward the last-known values of all 10 new fields (fetched via the same `fetchAdminCmsEditor` call it already makes for version history), even though it exposes no UI for them. Every draft, from either editor, always carries the full 25-field payload.

---

## Task 1: Extend the revision engine for the 10 new estate fields

**Files:**
- Modify: `src/lib/neon/admin-cms.server.ts`
- Modify: `src/lib/neon/admin-cms.types.ts`
- Modify: `src/lib/neon/admin-cms.server.contract.test.mjs`

- [ ] **Step 1: Expose the latest revision's payload from `fetchAdminCmsEditor`**

In `admin-cms.types.ts`, widen `CmsEditorResult`:

```typescript
export type CmsEditorResult = {
  row: CmsHubRow | null;
  revisions: CmsRevisionSummary[];
  payload: Record<string, unknown> | null;
};
```

In `admin-cms.server.ts`'s `fetchAdminCmsEditor`, return the latest row's payload alongside `row`/`revisions`:

```typescript
return {
  row,
  revisions: rows.map((revision) => ({ /* unchanged */ })),
  payload:
    latest && latest.payload && typeof latest.payload === "object"
      ? (latest.payload as Record<string, unknown>)
      : null,
};
```

- [ ] **Step 2: Extend the `estate` projector**

Replace the `estate` branch of `projectorSql()`:

```typescript
if (resourceType === "estate")
  return `${common}
  INSERT INTO estates (id, slug, name_zh, name_en, district_slug, developer, year_completed,
    phases, total_units, area_min, area_max, description, hero_image, facilities,
    seo_title, seo_description, aliases, address, blocks, school_net_code, transport_note,
    verified_at, district_id, avg_saleable_psf, lat, lng, published)
  SELECT resource_id, payload->>'slug', payload->>'name_zh', payload->>'name_en',
    payload->>'district_slug', payload->>'developer', (payload->>'year_completed')::int,
    (payload->>'phases')::int, (payload->>'total_units')::int, (payload->>'area_min')::int,
    (payload->>'area_max')::int, payload->>'description', payload->>'hero_image',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'facilities', '[]'::jsonb))),
    payload->>'seo_title', payload->>'seo_description',
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'aliases', '[]'::jsonb))),
    payload->>'address', (payload->>'blocks')::int, payload->>'school_net_code',
    payload->>'transport_note', NULLIF(payload->>'verified_at', '')::timestamptz,
    NULLIF(payload->>'district_id', '')::uuid, (payload->>'avg_saleable_psf')::numeric,
    (payload->>'lat')::numeric, (payload->>'lng')::numeric, true
  FROM eligible
  ON CONFLICT (id) DO UPDATE SET slug=EXCLUDED.slug, name_zh=EXCLUDED.name_zh,
    name_en=EXCLUDED.name_en, district_slug=EXCLUDED.district_slug, developer=EXCLUDED.developer,
    year_completed=EXCLUDED.year_completed, phases=EXCLUDED.phases, total_units=EXCLUDED.total_units,
    area_min=EXCLUDED.area_min, area_max=EXCLUDED.area_max, description=EXCLUDED.description,
    hero_image=EXCLUDED.hero_image, facilities=EXCLUDED.facilities, seo_title=EXCLUDED.seo_title,
    seo_description=EXCLUDED.seo_description, aliases=EXCLUDED.aliases, address=EXCLUDED.address,
    blocks=EXCLUDED.blocks, school_net_code=EXCLUDED.school_net_code,
    transport_note=EXCLUDED.transport_note, verified_at=EXCLUDED.verified_at,
    district_id=EXCLUDED.district_id, avg_saleable_psf=EXCLUDED.avg_saleable_psf,
    lat=EXCLUDED.lat, lng=EXCLUDED.lng, published=true, updated_at=now() RETURNING id`;
```

(`NULLIF(x, '')::timestamptz`/`::uuid` guard against an empty-string payload value, which `NULL::timestamptz`/`::uuid` would reject with a cast error — `payload->>'field'` on a JSON `null` already comes back as SQL `NULL`, but a form that sends `""` for an unset optional field needs this too.)

- [ ] **Step 3: Extend the source-shape contract test**

In `admin-cms.server.contract.test.mjs`, add assertions that the `estate` INSERT column list includes `aliases`, `district_id`, `avg_saleable_psf`, `lat`, `lng` (the four the master plan calls out explicitly, plus one more from the full set — enough to catch a regression without pinning the entire 27-column list verbatim).

- [ ] **Step 4: Typecheck and run the CMS suite**

Run: `npx tsc --noEmit && npm run test:cms`

- [ ] **Step 5: Commit**

```bash
git add src/lib/neon/admin-cms.server.ts src/lib/neon/admin-cms.types.ts src/lib/neon/admin-cms.server.contract.test.mjs
git commit -m "feat(admin): extend the estate revision-engine projector for P4's pending fields"
```

---

## Task 2: Fix the shared-projector data-loss risk in the existing CMS estate dialog

**Files:**
- Modify: `src/routes/admin.cms.tsx`

- [ ] **Step 1: Capture the latest payload alongside revisions**

`loadEstateRevisions` already calls `fetchAdminCmsEditor`. Add a new state var `estateLatestPayload: Record<string, unknown> | null` set from the same response's new `payload` field.

- [ ] **Step 2: Merge it into every draft save**

In `handleSaveEstateDraft`/`handlePublishEstate`, change the `payload` sent to `saveAdminCmsDraft` from `{ ...editingEstate }` to `{ ...estateLatestPayload, ...editingEstate }` — the last-known full payload first (carrying forward the 10 fields this dialog has no UI for), then the form's own 15 known fields on top (so this dialog's actual edits always win for the fields it controls).

- [ ] **Step 3: Reset `estateLatestPayload` to `null`** everywhere `estateRevisions` is reset to `null` (new-estate flow) — a brand new estate has no prior payload to carry forward.

- [ ] **Step 4: Run the CMS suite and typecheck**

Run: `npx tsc --noEmit && npm run test:cms`

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.cms.tsx
git commit -m "fix(admin): carry forward P6c3's estate fields when saving through the CMS tab's dialog"
```

---

## Task 3: Build the `/admin/estates` routes and comprehensive form

**Files:**
- Create: `src/components/admin/estates/AdminEstateEditorForm.tsx`
- Create: `src/components/admin/estates/EstatePreviewCard.tsx`
- Create: `src/routes/admin.estates.tsx`
- Create: `src/routes/admin.estates_.$id.tsx`
- Create: `src/routes/admin.estates_.new.tsx`
- Modify: `src/components/admin/AdminShell.tsx`

- [ ] **Step 1: Fetch districts for the picker**

Check whether a `fetchAdminDistrictOptions`-style function already exists (grep `districts` in `admin-data.ts`/`admin-data.server.ts` first). If not, add one following exactly the `listAdminEstateOptions` pattern (`SELECT id, slug, name_zh FROM districts ORDER BY name_zh ASC`), wrapped the same way.

- [ ] **Step 2: Build `AdminEstateEditorForm`**

All 25 fields, grouped into sections (基本資料 / 地理及交通 / 學校網 / SEO). Key UI decisions:
- `aliases`: a `Textarea`, one alias per line (matches `facilities`' existing `.join("\n")`/`splitList()` convention already used in `admin.cms.tsx` — reuse that exact helper, don't reinvent it).
- `district_id`: a `Select` populated from Step 1's fetch, alongside the existing legacy `district_slug` text field (both stay editable — P4's migration deliberately kept `district_slug` for backward compat; this phase doesn't remove it).
- `verified_at`: **not a raw date input.** A read-only display of the current value (or "尚未核實") plus a "標記為已核實" button that sets it to `new Date().toISOString()` in local form state. No manual backdating — matches this project's "don't fabricate dates" convention (see `policy-rates.ts`, the legal-pages tests).
- `avg_saleable_psf`/`lat`/`lng`: plain `NumberField`-equivalents (reuse shadcn `Input type="number"`, matching `AdminTransactionForm`'s pattern from P6c1 — same repo, same convention, even though P6c3 doesn't depend on that branch).
- Draft/publish/restore/archive footer: identical shape to P6b's `CmsPublishFooter`/`CmsRevisionHistory` (in `admin.cms.tsx`) — **do not duplicate that JSX**; either import them if `admin.cms.tsx` exports them, or (more likely, since they're currently module-private to that file) recreate the same two small components locally in this new file, since cross-file coupling to a route file's internals is worse than a small, deliberate duplication of ~40 lines. Use `saveAdminCmsDraft`/`publishAdminCmsRevision`/`restoreAdminCmsRevision`/`archiveAdminCmsResource` from `@/lib/neon/admin-cms` directly (already fixed with `unwrapServerFnResponse` since P6b).

- [ ] **Step 3: FAQ section**

Reuse `fetchAdminCms()`'s existing full FAQ list (already fetched for the CMS tab) — filter client-side to `scope === \`estate:${estate.slug}\`` (this exact scope-string convention is already established: `estate.$slug.tsx:52` calls `fetchFaqs(\`estate:${params.slug}\`)`). List existing scoped FAQs with 編輯/新增 actions calling the existing `saveAdminFaq`/`deleteAdminFaq` from `@/lib/neon/admin-data` — **no new FAQ storage or fetch path**, this section is a thin composition over what already exists. Flag clearly in a code comment: renaming an estate's slug after FAQs exist orphans them (the scope key is the slug, not a stable id) — this phase does not add slug-rename protection; that's a pre-existing property of the FAQ system, not something introduced here.

- [ ] **Step 4: `EstatePreviewCard`**

A lightweight summary card, **not** a full mirror of the public `estate.$slug.tsx` page (that page also pulls live listings/transactions/comparables a draft estate wouldn't have). Shows: name (zh/en), district, aliases, address, lat/lng (as a link to a maps URL, not an embedded map), transport note, school net code, avg PSF, verified badge (核實日期 or "尚未核實"), and the current publish state. Takes the draft form values directly as props (not a re-fetch) so it reflects unsaved edits live.

- [ ] **Step 5: Build the three routes**, following `admin.agents.tsx`/`admin.agents_.$id.tsx`/`admin.agents_.new.tsx`'s exact list/detail/new pattern (already used for P6c1's transactions routes too):
  - `admin.estates.tsx`: list (reuse `fetchAdminCms()`'s existing `estates` array — same data the CMS tab's table already shows — no new list-fetch needed), 編輯 link to `$id`, 新增屋苑 button to `new`.
  - `admin.estates_.$id.tsx`: fetches the estate via `fetchAdminCmsEditor({ resourceType: "estate", resourceId: id })` for the payload + revision history, falls back to the live `estates` row (via `fetchAdminCms()`, matching by id) if there's no revision history yet (a pre-existing estate that predates the 2026-07-11 backfill migration should never hit this branch, but handle it defensively rather than showing a blank editor).
  - `admin.estates_.new.tsx`: empty form, no revision history section (nothing to show yet).

- [ ] **Step 6: Nav entry**

Add to `AdminShell.tsx`'s `navGroups`, "Growth" group (alongside 內容中心, since this is the estate content the CMS tab's own SEO tab already partially covers): `{ to: "/admin/estates", label: "屋苑管理", icon: Building2, activeExact: false }` (icon already imported for 樓盤管理).

- [ ] **Step 7: Regenerate the route tree**

Run: `npm run build`

- [ ] **Step 8: Typecheck and run the full suites**

Run: `npx tsc --noEmit && npm run test:cms && npm run test:command-center`

- [ ] **Step 9: Commit**

```bash
git add src/components/admin/estates/ src/routes/admin.estates.tsx src/routes/admin.estates_.\$id.tsx src/routes/admin.estates_.new.tsx src/components/admin/AdminShell.tsx src/routeTree.gen.ts
git commit -m "feat(admin): add the proper /admin/estates editor (aliases, geo, PSF, transport, school net, FAQs, preview)"
```

---

## Task 4: Test coverage

**Files:**
- Create: `src/routes/admin.estates.routes.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write route-presence, nav-entry, and route-tree-registration tests**, following the exact style of `admin.transactions.routes.test.mjs` from P6c1.

- [ ] **Step 2: Register a `test:admin-estates` script** (not `test:estate-conversion`, which already exists for something unrelated — check `package.json` for name collisions before picking the script name, exactly as P6c1 had to rename around the pre-existing `test:transactions`).

- [ ] **Step 3: Run the new suite and the wiring guard**

Run: `npm run test:admin-estates && node --test src/test-wiring.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.estates.routes.test.mjs package.json
git commit -m "test(admin): cover the new /admin/estates editor"
```

---

## Final verification

Run: `npm run test:admin-estates && npm run test:cms && npm run test:command-center && npx tsc --noEmit && npm run lint`

## Acceptance

- A staff member can set aliases, address, blocks, school net code, transport note, district, avg PSF, and lat/lng for an estate, save as a draft, publish, and see all 10 fields actually land in the live `estates` row (not silently dropped by the projector).
- Saving through the **old** CMS tab's estate dialog after this phase never blanks out these 10 fields on an estate that already has them set.
- FAQs scoped to the estate are visible and editable from the new editor, using the existing FAQ machinery unchanged.
- The preview card reflects unsaved form edits live, with no fabricated verification date.
