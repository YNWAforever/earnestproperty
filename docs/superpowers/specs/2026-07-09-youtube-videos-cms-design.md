# YouTube Videos CMS Design

## Goal

Put the Earnest Property YouTube channel at `https://earnestproperty.vercel.app/videos`, and let admin staff paste YouTube video links later without code changes.

Channel:

`https://www.youtube.com/@%E6%99%89%E8%AA%A0%E5%9C%B0%E7%94%A2-EarnestProperty`

## Scope

The videos page will use a hybrid source model:

- A fixed Earnest Property channel header with the channel link.
- CMS-managed YouTube video links for general channel videos.
- Existing listing-linked videos from `properties.video_url`.

This avoids relying on YouTube scraping or a YouTube API key. "All channel videos" means all videos entered into the CMS video list. Admin staff can add the current channel videos once, then paste future links as new videos are uploaded.

## User Experience

### Public `/videos`

The page starts with an Earnest Property YouTube channel section:

- Channel name: `晉誠地產 Earnest Property`
- Link to the provided YouTube channel.
- CTA to open the channel on YouTube.

Below the header, videos appear in a responsive grid:

- CMS channel videos appear first.
- Listing videos from `properties.video_url` appear after CMS videos.
- Each card shows an embedded YouTube player when the URL can be converted to an embed URL.
- Non-YouTube or unparseable URLs show a playable external-link card instead of breaking the page.

If there are no CMS or listing videos yet, the page shows a stable empty state with a channel link and WhatsApp CTA.

### Admin CMS

The CMS gets a `YouTube影片` tab.

Admin staff can:

- Add a video by pasting a YouTube URL.
- Set a title.
- Add a description field that can be left blank.
- Choose whether the video is published.
- Set sort order.

The listing form also gets a `YouTube影片連結` field so staff can attach a video to a specific property. This field saves to the existing `properties.video_url` column.

## Data Model

Use a new CMS table for general channel videos:

```sql
cms_videos (
  id uuid primary key,
  title text not null,
  video_url text not null,
  description text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

No change is needed for listing videos because `properties.video_url` already exists.

## Code Changes

### Config

Add channel metadata near site config:

- `SITE_YOUTUBE_CHANNEL.url`
- `SITE_YOUTUBE_CHANNEL.name`
- `SITE_YOUTUBE_CHANNEL.handleLabel`

### Public Data

Add read helpers:

- `fetchCmsVideos()` in the public Neon server/data layer.
- `fetchVideoListings()` continues to return listing rows with `video_url`.
- `/videos` loader combines `{ cmsVideos, listingVideos }`.

### Admin Data

Add admin helpers:

- `fetchAdminCmsVideos()`
- `saveAdminCmsVideo()`

Do not add a delete workflow in this pass. Admin staff hide a video by setting `published = false`.

Extend `AdminPropertyInput`, `saveAdminProperty`, and `PropertyForm` to read/write `video_url`.

### Route

Update `src/routes/videos.tsx`:

- Channel header.
- CMS video grid first.
- Listing video grid second.
- Shared URL-to-embed helper.
- Empty state when both lists are empty.

### Tests

Update source-level tests to assert:

- The channel URL is present.
- `/videos` uses CMS videos and listing videos.
- Admin property form includes `video_url`.
- Admin save path persists `video_url`.

## Error Handling

- Bad YouTube URLs do not crash rendering.
- Empty CMS rows are ignored unless published.
- Missing titles fall back to a readable YouTube/listing label.
- If the CMS video table is empty, `/videos` still shows listing videos and the channel link.

## Validation

Run:

- `npm run test:contact`
- Targeted ESLint on touched files
- `npm run build`

Known repo state before this work:

- Full `npm run lint` has existing unrelated CRLF Prettier failures.
- Build has existing Better Auth dependency resolution failures.
- `tsc --noEmit` has existing unrelated admin/Neon/property route errors.

Those pre-existing failures should be reported separately from this feature if they remain.
