# /videos filtering and sorting — Phase 1 design

**Date:** 2026-08-20
**Status:** Approved, ready for implementation planning
**Builds on:** PR #66 (facade embeds, paging, search, description summaries)

## Problem

The YouTube channel sync imported the full back catalogue, taking `/videos` from
1 video to 96. PR #66 made that volume performant — facades instead of live
embeds, 12 cards per page, a title search box — but it did not make it
*navigable*. A visitor looking for one estate has no way to narrow 96 videos
except typing a guess into the search box.

## Scope

This spec covers **Phase 1 only**: filtering and sorting using data that already
exists in `cms_videos`. It requires no migration and no change to the sync.

**Phase 2 (separate spec, not covered here):** view counts, duration, and
YouTube's own tags. None of these exist today — the sync calls
`/channels?part=contentDetails` and `/playlistItems?part=snippet,contentDetails`,
and every one of those fields lives on the `/videos` endpoint, which is never
called. Adding them means new columns, a migration, and extending the sync.
Quota is not the obstacle: `/videos` accepts 50 ids per call at 1 unit each, so
96 videos costs 2 units against a 10,000/day budget.

The phasing is deliberate. Filtering by estate is the larger usability win — "show
me 黃金海灣" is a more common need than "show me the most-watched" — and keeping
the migration in its own PR means it gets reviewed on its own rather than buried
inside a UI change.

## Evidence

Measured against all 97 titles on production (read from the JSON-LD block, which
emits every video regardless of paging):

| Signal | Coverage |
|---|---|
| Title matches a `CoreEstate` name | 39 / 97 (40%) |
| Title contains a `＃` / `#` marker | 94 / 97 (97%) |

The channel follows a consistent naming convention —
`💚＃黃金海灣.珀岸💚 《417呎 580萬》2房高層遊艇會海+沙灘海景！優質單位！` — with the
estate name immediately after the `＃`.

Two findings shaped the design:

1. **`CoreEstate` covers a minority of the catalogue.** 黃金海灣, 漣山, 上源,
   愛琴海岸, 星堤, 帝濤灣, NAPA and 滿名山 all appear in videos and are absent from
   `src/content/core-estates.ts`. Matching only against that list leaves 60% of
   videos unfilterable.
2. **The raw `＃` token is noisy.** `浪翠園一期` and `浪翠園三期` split one estate
   into two filters, and `晉誠地產` (the agency's own market-commentary videos) is
   not a place at all.

Hence: derive from the marker, then normalize.

## Design

### 1. Tag derivation

New module `src/lib/video-tags.js` with a `.d.ts` sibling, matching the
`website-inquiry.js` / `site-branches.js` convention so the `node --test` suite
imports it with no build step.

```
deriveEstateTag(title) → { tag: string, district: string | null } | null
```

- Extracts the token following `＃` or `#`.
- Applies a normalization map: phases fold into their parent
  (`浪翠園一期`, `浪翠園三期` → `浪翠園`); non-estate tokens (`晉誠地產`) are dropped,
  returning `null`.
- `district` is resolved by looking the normalized tag up in `CoreEstate`, and is
  `null` when unknown. It is never guessed — `core-estates.ts` already refuses to
  invent a district rather than put a false location on a real estate, and this
  follows that precedent.
- An unrecognised token still becomes a tag. This is the intended degradation
  path: a newly marketed estate appears as its own chip the day it is uploaded,
  rather than silently disappearing from the filter set.

The map lives in code, so **staff cannot override a tag for an individual video
from the CMS.** Accepted for Phase 1; revisit if editors ask for it.

### 2. Chip row and sort control (layout option A)

Tag counts are computed once in the route loader and passed to the component.

- Chips: `全部 96`, then the **top 8 estates by count**, then `更多 N ▾` which
  expands the full list in place. Ties break alphabetically by tag, so the chip
  order is stable between renders rather than dependent on row order.
- Videos whose token normalizes to `null` (the `晉誠地產` commentary set) and the
  three carrying no `＃` at all are **untagged**: they appear under `全部` and
  under no estate chip. `全部` counts the entire section, tagged or not, so its
  number always matches what an unfiltered visitor sees.
- **Single-select** — one estate at a time. Multi-select would require the
  sidebar layout and roughly doubles the state handling for a need this audience
  has not demonstrated.
- Sort is a `select`: `最新` (default — `youtube_published_at`, falling back to
  `created_at`), `最舊`, `精選` (the existing `sort_order` column).
- The search box from PR #66 stays and **composes** with the chips: filter to
  豪景花園, then search within that subset.

Chips were chosen over dropdowns because they advertise that filtering exists
without requiring a tap. Nobody arriving on this page knows the videos are
organised by estate, and a collapsed `select` does not tell them.

### 3. URL state

Filter state lives in TanStack Router search params, validated with Zod:

```
/videos?estate=豪景花園&sort=newest&q=海景
```

Parameter vocabulary, fixed so links stay valid as UI copy changes:

| Param | Values | Default |
|---|---|---|
| `estate` | any normalized tag, URL-encoded | absent = 全部 |
| `sort` | `newest` \| `oldest` \| `featured` | `newest` |
| `q` | free text | absent |

The `sort` values are deliberately English and decoupled from the Chinese labels
(最新 / 最舊 / 精選), so rewording a label never invalidates a shared link.

Filtered views become shareable and linkable — usable as WhatsApp or ad targets —
and the browser back button behaves. Invalid or unknown params **fall back to
defaults rather than erroring**: a stale link should render the unfiltered page,
never a crash.

### 4. Interaction with existing behaviour

- Changing filter, sort, or search **resets paging to the first 12**.
- Facade embeds are untouched.
- `AllVideoSchemas` continues to emit schema for **all** videos regardless of the
  active filter. Crawlers must see the whole catalogue; `schema.test.mjs` already
  asserts the schema block receives the unfiltered lists.
- Filtering applies to the **官方頻道影片** section only. **樓盤影片 is excluded** —
  it holds a single listing video whose estate already comes from a database
  relation rather than a parsed title.

### 5. Testing

- Unit tests for `deriveEstateTag` against a corpus of **real production titles**,
  including the awkward cases: `黃金海灣.珀岸` (estate plus phase joined by a dot),
  `浪翠園三期` (phase folding), the `晉誠地產` commentary videos (dropped), and the
  three titles carrying no `＃` at all (return `null`).
- A contract test asserting invalid search params degrade to defaults.
- Wire the new test file into a named `test:*` script — the `test-wiring` guard
  fails any test file no script runs.

## Decisions taken without a separate question

Flagged here so a reviewer can challenge them:

- **Single-select chips**, not multi-select.
- **樓盤影片 excluded** from filtering.
- **URL state included** by default.

## Out of scope

- View count, like count, duration, YouTube tags (Phase 2 — needs a migration).
- Editor-controlled tag overrides in the CMS.
- Multi-select filtering and the sidebar layout.
- Any change to the sync or to `cms_videos`.
