import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, MessageCircle, PlayCircle, Search, Video } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE_YOUTUBE_CHANNEL, whatsappUrl } from "@/config/site";
import { canonicalLink } from "@/content/seo";
import { fetchVideosPageData, type CmsVideo, type VideoListing } from "@/lib/queries";
import { jsonLdScript, videoObjectSchema } from "@/lib/schema";
import { summarizeVideoDescription } from "@/lib/video-description.js";
import { getYouTubeEmbedUrl, getYouTubeThumbnailUrl } from "@/lib/youtube-video-url.js";

// The channel sync imports the full back catalogue, so this page went from 1
// video to 96 in a single run. Rendering every card at once produced a 60,710px
// page whose load event fired at 20.3s. Cards are paged in batches; the
// VideoObject schema below is still emitted for all of them, so paging affects
// what a human scrolls through, not what a crawler indexes.
const VIDEOS_PER_PAGE = 12;

export const Route = createFileRoute("/videos")({
  loader: async () => fetchVideosPageData(),
  head: () => ({
    meta: [
      { title: "YouTube影片｜晉誠地產 深井 青山公路 汀九樓盤" },
      {
        name: "description",
        content: "晉誠地產 YouTube影片入口，集中官方頻道影片及附影片的深井、青山公路、汀九樓盤。",
      },
    ],
    links: [canonicalLink("/videos")],
  }),
  component: VideosPage,
});

function VideosPage() {
  const { cmsVideos, listingVideos } = Route.useLoaderData();
  const inquiryUrl = whatsappUrl("你好，我想睇深井／青山公路／汀九樓盤影片");
  const hasVideos = cmsVideos.length > 0 || listingVideos.length > 0;

  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(VIDEOS_PER_PAGE);
  const trimmedQuery = query.trim().toLowerCase();

  const matchingCmsVideos = useMemo(() => {
    if (!trimmedQuery) return cmsVideos;
    return cmsVideos.filter((video) => video.title?.toLowerCase().includes(trimmedQuery));
  }, [cmsVideos, trimmedQuery]);

  const matchingListingVideos = useMemo(() => {
    if (!trimmedQuery) return listingVideos;
    return listingVideos.filter((listing) =>
      `${listing.title_zh} ${listing.estates?.name_zh ?? ""}`.toLowerCase().includes(trimmedQuery),
    );
  }, [listingVideos, trimmedQuery]);

  const visibleCmsVideos = matchingCmsVideos.slice(0, visibleCount);
  const remainingCount = matchingCmsVideos.length - visibleCmsVideos.length;
  const hasMatches = matchingCmsVideos.length > 0 || matchingListingVideos.length > 0;

  return (
    <div className="bg-background">
      {/* Emitted for every video regardless of paging or the active filter: this
          is what video rich results read, and it must not shrink to whatever the
          visitor happens to have scrolled to. */}
      <AllVideoSchemas cmsVideos={cmsVideos} listingVideos={listingVideos} />

      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">YouTube影片</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            晉誠地產 YouTube影片
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            官方頻道影片、屋苑開箱及附影片樓盤集中一頁，睇樓前先了解景觀、間隔和屋苑環境。
          </p>
          <Button asChild className="mt-6 bg-coral text-coral-foreground hover:bg-primary-hover">
            <a href={SITE_YOUTUBE_CHANNEL.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              開啟 {SITE_YOUTUBE_CHANNEL.handleLabel}
            </a>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {hasVideos ? (
          <div className="space-y-12">
            <div>
              <label htmlFor="video-search" className="text-sm font-semibold text-primary">
                搜尋影片
              </label>
              <div className="relative mt-2 max-w-md">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="video-search"
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisibleCount(VIDEOS_PER_PAGE);
                  }}
                  placeholder="輸入屋苑或影片名稱"
                  className="pl-9"
                />
              </div>
              <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                {trimmedQuery
                  ? `搵到 ${matchingCmsVideos.length + matchingListingVideos.length} 條影片`
                  : `共 ${cmsVideos.length + listingVideos.length} 條影片`}
              </p>
            </div>

            {!hasMatches && (
              <div className="rounded-lg border bg-card p-8 text-center shadow-card">
                <h2 className="text-lg font-semibold text-primary">搵唔到相關影片</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
                  試下其他關鍵字，或者 WhatsApp 我哋直接索取影片。
                </p>
                <Button variant="outline" className="mt-4" onClick={() => setQuery("")}>
                  清除搜尋
                </Button>
              </div>
            )}

            {matchingCmsVideos.length > 0 && (
              <VideoSection title="官方頻道影片">
                {visibleCmsVideos.map((video) => (
                  <CmsVideoCard key={video.id} video={video} />
                ))}
              </VideoSection>
            )}
            {remainingCount > 0 && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setVisibleCount((count) => count + VIDEOS_PER_PAGE)}
                >
                  載入更多影片（尚餘 {remainingCount} 條）
                </Button>
              </div>
            )}
            {matchingListingVideos.length > 0 && (
              <VideoSection title="樓盤影片">
                {matchingListingVideos.map((listing) => (
                  <ListingVideoCard key={listing.id} listing={listing} />
                ))}
              </VideoSection>
            )}
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-8 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Video className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-primary">暫未有影片</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
              影片未加入網站前，可以先到官方 YouTube 頻道，或 WhatsApp 我哋索取最新影片、VR
              或睇樓安排。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button asChild variant="outline">
                <a href={SITE_YOUTUBE_CHANNEL.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  開啟 YouTube 頻道
                </a>
              </Button>
              <Button asChild className="bg-coral text-coral-foreground hover:bg-primary-hover">
                <a href={inquiryUrl} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp 索取影片
                </a>
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function VideoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-primary">{title}</h2>
      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function CmsVideoCard({ video }: { video: CmsVideo }) {
  return (
    <VideoFrame
      title={video.title || "晉誠地產 YouTube影片"}
      url={video.video_url}
      eyebrow="官方頻道"
      description={video.description}
    />
  );
}

function ListingVideoCard({ listing }: { listing: VideoListing }) {
  return (
    <VideoFrame
      title={listing.title_zh}
      url={listing.video_url}
      eyebrow={`${listing.estates?.name_zh ?? "深井 / 青山公路"} · ${
        listing.deal_type === "rent" ? "租" : "售"
      }`}
      description={formatListingPrice(listing)}
      footer={
        <Link
          to="/property/$listingNo"
          params={{ listingNo: listing.listing_no }}
          className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
        >
          查看樓盤詳情
        </Link>
      }
    />
  );
}

function AllVideoSchemas({
  cmsVideos,
  listingVideos,
}: {
  cmsVideos: CmsVideo[];
  listingVideos: VideoListing[];
}) {
  const schemas = [
    ...cmsVideos.map((video) => ({
      key: `cms-${video.id}`,
      name: video.title || "晉誠地產 YouTube影片",
      description: video.description,
      url: video.video_url,
      uploadDate: video.created_at,
    })),
    ...listingVideos.map((listing) => ({
      key: `listing-${listing.id}`,
      name: listing.title_zh,
      description: null,
      url: listing.video_url,
      uploadDate: null,
    })),
  ];

  return (
    <>
      {schemas.map((entry) => {
        const embedUrl = getYouTubeEmbedUrl(entry.url);
        if (!embedUrl) return null;
        const schema = videoObjectSchema({
          name: entry.name,
          description: entry.description,
          embedUrl,
          uploadDate: entry.uploadDate,
        });
        return (
          <script
            key={entry.key}
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: jsonLdScript({ "@context": "https://schema.org", ...schema }),
            }}
          />
        );
      })}
    </>
  );
}

function VideoFrame({
  title,
  url,
  eyebrow,
  description,
  footer,
}: {
  title: string;
  url: string;
  eyebrow: string;
  description?: string | null;
  footer?: ReactNode;
}) {
  const embedUrl = getYouTubeEmbedUrl(url);
  const thumbnailUrl = getYouTubeThumbnailUrl(url);
  const summary = summarizeVideoDescription(description);

  // A facade, not a live embed. Every card used to mount its own YouTube iframe
  // on first paint -- each one pulling the full player runtime -- so 96 cards
  // meant 98 requests to youtube.com and a load event at 20.3s. A poster frame
  // is ~15KB against roughly 1MB for an embed, and the player is now created
  // only for the video someone actually chooses to watch.
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <article className="overflow-hidden rounded-lg border bg-card shadow-card">
      {embedUrl ? (
        isPlaying ? (
          <iframe
            src={`${embedUrl}?autoplay=1`}
            title={title}
            className="aspect-video w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            aria-label={`播放影片：${title}`}
            className="group relative flex aspect-video w-full items-center justify-center overflow-hidden bg-primary/10"
          >
            {thumbnailUrl && (
              /* alt="" because the button already carries the video's name; a
                 described thumbnail would announce the title twice. */
              <img
                src={thumbnailUrl}
                alt=""
                loading="lazy"
                width={480}
                height={360}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-black/55 text-white transition group-hover:bg-black/75">
              <PlayCircle className="h-8 w-8" />
            </span>
          </button>
        )
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex aspect-video items-center justify-center bg-primary/10 text-primary"
        >
          <PlayCircle className="h-10 w-10" />
        </a>
      )}
      <div className="p-5">
        <p className="text-xs font-semibold text-coral">{eyebrow}</p>
        <h3 className="mt-2 line-clamp-2 text-lg font-semibold text-primary">{title}</h3>
        {summary && (
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{summary}</p>
        )}
        {footer}
      </div>
    </article>
  );
}

function formatListingPrice(listing: VideoListing) {
  if (listing.deal_type === "rent") {
    return listing.rent ? `月租 HK$${listing.rent.toLocaleString()}` : "租金請查詢";
  }
  return listing.price ? `售價 HK$${(listing.price / 10000).toLocaleString()}萬` : "售價請查詢";
}
