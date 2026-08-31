import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ExternalLink, MessageCircle, PlayCircle, Search, Video } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppImage } from "@/components/media/AppImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SITE_YOUTUBE_CHANNEL, whatsappUrl } from "@/config/site";
import { canonicalLink } from "@/content/seo";
import { VIDEO_CATEGORIES } from "@/content/video-categories";
import { fetchVideosPageData, type CmsVideo, type VideoListing } from "@/lib/queries";
import { jsonLdScript, videoObjectSchema } from "@/lib/schema";
import { summarizeVideoDescription } from "@/lib/video-description.js";
import { buildTagCounts, deriveEstateTag } from "@/lib/video-tags.js";
import { getYouTubeEmbedUrl, getYouTubeThumbnailUrl } from "@/lib/youtube-video-url.js";

// The channel sync imports the full back catalogue, so this page went from 1
// video to 96 in a single run. Rendering every card at once produced a 60,710px
// page whose load event fired at 20.3s. Cards are paged in batches, and (DR-6)
// the VideoObject schema below is capped to that same rendered/filtered
// subset, so paging affects what a crawler indexes too.
const VIDEOS_PER_PAGE = 12;

// Values are English and decoupled from the Chinese labels (最新 / 最舊 / 精選) so
// rewording a label never invalidates a link someone already shared.
const searchSchema = z.object({
  estate: fallback(z.string().optional(), undefined),
  category: fallback(z.string().optional(), undefined),
  sort: fallback(z.enum(["newest", "oldest", "featured"]), "newest").default("newest"),
  q: fallback(z.string().optional(), undefined),
});

export const Route = createFileRoute("/videos")({
  validateSearch: zodValidator(searchSchema),
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

// The three sort values the URL ever carries. Radix's onValueChange hands back
// a plain string, so this guard is what lets updateSearch accept it without
// widening VideoSearch["sort"] to string or reaching for `as any`.
const SORT_VALUES = ["newest", "oldest", "featured"] as const;
type SortValue = (typeof SORT_VALUES)[number];
function isSortValue(value: string): value is SortValue {
  return (SORT_VALUES as readonly string[]).includes(value);
}

function VideosPage() {
  const { cmsVideos, listingVideos } = Route.useLoaderData();
  const { estate, category, sort, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/videos" });
  const [visibleCount, setVisibleCount] = useState(VIDEOS_PER_PAGE);
  const [showAllTags, setShowAllTags] = useState(false);

  const inquiryUrl = whatsappUrl("你好，我想睇深井／青山公路／汀九樓盤影片");
  const hasVideos = cmsVideos.length > 0 || listingVideos.length > 0;
  const trimmedQuery = (q ?? "").trim().toLowerCase();

  const tagCounts = useMemo(() => buildTagCounts(cmsVideos), [cmsVideos]);

  // Category is a real admin-assigned column (see video-categories.ts's own
  // doc comment for why it can't be derived like the estate tag above), so an
  // uncategorised video simply doesn't count toward any chip -- never guessed.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const video of cmsVideos) {
      if (video.category) counts.set(video.category, (counts.get(video.category) ?? 0) + 1);
    }
    return VIDEO_CATEGORIES.map((cat) => ({ category: cat, count: counts.get(cat) ?? 0 }));
  }, [cmsVideos]);

  // The chip row collapses to the top 8, but the URL can name any estate. A link
  // to a long-tail estate filtered correctly while leaving every chip
  // unpressed, so the filter read as inactive on exactly the shared links this
  // feature exists to produce. Derived rather than stored: the row auto-expands
  // whenever the active estate would otherwise be hidden.
  const topTags = tagCounts.slice(0, 8);
  const activeTagHidden = Boolean(estate) && !topTags.some((entry) => entry.tag === estate);
  const tagsExpanded = showAllTags || activeTagHidden;

  // The search box keeps its own buffer and commits to the URL on a delay. The
  // input's value must never come from the router: `q` only updates after
  // navigate() resolves, and a controlled input lagging behind the keystroke
  // cancels an in-flight IME composition. Public copy here is zh-HK, so nearly
  // every real search is typed through an IME -- syncing per keystroke garbles
  // exactly the input this box exists to receive. listings.tsx buffers for the
  // same reason, committing on an explicit apply; a debounce keeps filtering
  // live without putting the router in the typing path.
  const [queryInput, setQueryInput] = useState(q ?? "");

  // Re-sync when the URL changes from somewhere else: the back button, or the
  // 清除篩選 button in the empty state.
  useEffect(() => {
    setQueryInput(q ?? "");
  }, [q]);

  useEffect(() => {
    if (queryInput === (q ?? "")) return;
    const timer = setTimeout(() => {
      setVisibleCount(VIDEOS_PER_PAGE);
      navigate({ search: (prev) => ({ ...prev, q: queryInput || undefined }), replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [queryInput, q, navigate]);

  const matchingCmsVideos = useMemo(() => {
    return cmsVideos.filter((video) => {
      if (estate && deriveEstateTag(video.title)?.tag !== estate) return false;
      if (category && video.category !== category) return false;
      if (trimmedQuery && !video.title?.toLowerCase().includes(trimmedQuery)) return false;
      return true;
    });
  }, [cmsVideos, estate, category, trimmedQuery]);

  const sortedCmsVideos = useMemo(() => {
    const rows = [...matchingCmsVideos];
    const time = (video: CmsVideo) =>
      new Date(video.youtube_published_at ?? video.created_at ?? 0).getTime();
    if (sort === "oldest") return rows.sort((a, b) => time(a) - time(b));
    if (sort === "featured") return rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return rows.sort((a, b) => time(b) - time(a));
  }, [matchingCmsVideos, sort]);

  // The estate chip filters this section too, matched against the listing's own
  // estates relation rather than a parsed title -- a database join is a more
  // reliable signal than the ＃ marker, not a reason to skip filtering.
  //
  // The spec originally excluded this section, and preview verification showed
  // why that was wrong: filtering to 豪景花園 still rendered a 麗都花園 listing
  // video underneath, and counted it in 搵到 N 條影片. A filter that shows a
  // different estate than the one selected reads as broken.
  const matchingListingVideos = useMemo(() => {
    // Listing videos have no cms_videos row and no category column, but a
    // property-listing video is unambiguously a 樓盤實拍 by construction -- so
    // narrowing to any other category correctly excludes this whole section,
    // rather than either always showing it (wrong once a category is active)
    // or fabricating a category value for rows that don't have one.
    if (category && category !== "樓盤實拍") return [];
    return listingVideos.filter((listing) => {
      if (estate && listing.estates?.name_zh !== estate) return false;
      if (
        trimmedQuery &&
        !`${listing.title_zh} ${listing.estates?.name_zh ?? ""}`
          .toLowerCase()
          .includes(trimmedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [listingVideos, estate, category, trimmedQuery]);

  // Every filter change resets paging: page 3 of an old filter is meaningless
  // against a new one.
  type VideoSearch = { estate?: string; category?: string; sort: SortValue; q?: string };
  const updateSearch = (next: Partial<VideoSearch>) => {
    setVisibleCount(VIDEOS_PER_PAGE);
    navigate({
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    });
  };

  const visibleCmsVideos = sortedCmsVideos.slice(0, visibleCount);
  const remainingCount = sortedCmsVideos.length - visibleCmsVideos.length;
  const hasMatches = sortedCmsVideos.length > 0 || matchingListingVideos.length > 0;

  return (
    <div className="bg-background">
      {/* Capped to what's actually visible: visibleCmsVideos (paged) and
          matchingListingVideos (already ≤12 from the loader, filtered by the
          active search/category). DR-6 -- structured data for content the
          page doesn't render is misleading to crawlers and inflates payload
          for no benefit. */}
      <AllVideoSchemas cmsVideos={visibleCmsVideos} listingVideos={matchingListingVideos} />

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
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-primary">分類</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateSearch({ category: undefined })}
                    aria-pressed={!category}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      !category
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted"
                    }`}
                  >
                    全部 {cmsVideos.length}
                  </button>
                  {categoryCounts.map((entry) => (
                    <button
                      key={entry.category}
                      type="button"
                      onClick={() => updateSearch({ category: entry.category })}
                      aria-pressed={category === entry.category}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        category === entry.category
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted"
                      }`}
                    >
                      {entry.category} {entry.count}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-primary">屋苑</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateSearch({ estate: undefined })}
                    aria-pressed={!estate}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      !estate
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-muted"
                    }`}
                  >
                    全部 {cmsVideos.length}
                  </button>
                  {(tagsExpanded ? tagCounts : topTags).map((entry) => (
                    <button
                      key={entry.tag}
                      type="button"
                      onClick={() => updateSearch({ estate: entry.tag })}
                      aria-pressed={estate === entry.tag}
                      className={`rounded-full border px-3 py-1.5 text-sm transition ${
                        estate === entry.tag
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted"
                      }`}
                    >
                      {entry.tag} {entry.count}
                    </button>
                  ))}
                  {!tagsExpanded && tagCounts.length > 8 && (
                    <button
                      type="button"
                      onClick={() => setShowAllTags(true)}
                      className="rounded-full border border-dashed border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                    >
                      更多 {tagCounts.length - 8} ▾
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor="video-sort" className="text-sm font-semibold text-primary">
                    排序
                  </label>
                  <Select
                    value={sort}
                    onValueChange={(value) => {
                      if (isSortValue(value)) updateSearch({ sort: value });
                    }}
                  >
                    <SelectTrigger id="video-sort" className="mt-2 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">最新</SelectItem>
                      <SelectItem value="oldest">最舊</SelectItem>
                      <SelectItem value="featured">精選</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1">
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
                      value={queryInput}
                      onChange={(event) => setQueryInput(event.target.value)}
                      placeholder="輸入屋苑或影片名稱"
                      className="pl-9"
                    />
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground" aria-live="polite">
                {estate || category || trimmedQuery
                  ? `搵到 ${sortedCmsVideos.length + matchingListingVideos.length} 條影片`
                  : `共 ${cmsVideos.length + listingVideos.length} 條影片`}
              </p>
            </div>

            {!hasMatches && (
              <div className="rounded-lg border bg-card p-8 text-center shadow-card">
                <h2 className="text-lg font-semibold text-primary">搵唔到相關影片</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
                  試下其他關鍵字，或者 WhatsApp 我哋直接索取影片。
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() =>
                    updateSearch({ estate: undefined, category: undefined, q: undefined })
                  }
                >
                  清除篩選
                </Button>
              </div>
            )}

            {sortedCmsVideos.length > 0 && (
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
              <AppImage
                src={thumbnailUrl}
                alt=""
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
