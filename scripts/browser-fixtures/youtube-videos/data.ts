import type { CmsVideo, VideoListing } from "@/lib/queries";

export type VideosFixtureData = { cmsVideos: CmsVideo[]; listingVideos: VideoListing[] };

// Deliberately shuffled input and inverted import/upload chronology. Row 16 is
// a synthetic Short after ingestion has normalized its URL to canonical watch.
export function cmsFixture(): CmsVideo[] {
  return [4, 1, 9, 16, 2, 12, 7, 15, 3, 10, 6, 14, 5, 13, 8, 11].map((index) => {
    const number = String(index).padStart(2, "0");
    return {
      id: `synthetic-cms-${number}`,
      title:
        index === 16
          ? "SYNTHETIC 16 newest Short"
          : index === 1
            ? "SYNTHETIC 01 manual fallback"
            : `SYNTHETIC ${number} upload`,
      video_url: `https://www.youtube.com/watch?v=Fixture00${number}`,
      description: `Synthetic CMS row ${number}; no real channel, API or database.`,
      sort_order: index === 4 ? 0 : index + 1,
      created_at:
        index === 1
          ? "2026-10-01T01:00:00Z"
          : index === 16
            ? "2026-09-01T01:00:00Z"
            : `2026-10-16T${String(17 - index).padStart(2, "0")}:00:00Z`,
      youtube_published_at: index === 1 ? null : `2026-10-${number}T01:00:00Z`,
      category: index % 2 ? "樓盤實拍" : "屋苑開箱",
    };
  });
}

export function nextCmsFixture(): CmsVideo[] {
  return [
    ...cmsFixture(),
    {
      id: "synthetic-cms-17",
      title: "SYNTHETIC 17 next sync",
      video_url: "https://www.youtube.com/watch?v=Fixture0017",
      description: "Synthetic next loader response, never a real sync.",
      sort_order: 20,
      created_at: "2026-09-02T01:00:00Z",
      youtube_published_at: "2026-10-17T01:00:00Z",
      category: null,
    },
  ];
}
