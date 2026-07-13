import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, MessageCircle, PlayCircle, Video } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SITE_YOUTUBE_CHANNEL, whatsappUrl } from "@/config/site";
import { fetchVideosPageData, type CmsVideo, type VideoListing } from "@/lib/queries";
import { getYouTubeEmbedUrl } from "@/lib/youtube-video-url.js";

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
  }),
  component: VideosPage,
});

function VideosPage() {
  const { cmsVideos, listingVideos } = Route.useLoaderData();
  const inquiryUrl = whatsappUrl("你好，我想睇深井／青山公路／汀九樓盤影片");
  const hasVideos = cmsVideos.length > 0 || listingVideos.length > 0;

  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">YouTube影片</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            晉誠地產 YouTube影片
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            官方頻道影片、屋苑開箱及附影片樓盤集中一頁，睇樓前先了解景觀、間隔和屋苑環境。
          </p>
          <Button asChild className="mt-6 bg-coral text-coral-foreground hover:bg-coral/90">
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
            {cmsVideos.length > 0 && (
              <VideoSection title="官方頻道影片">
                {cmsVideos.map((video) => (
                  <CmsVideoCard key={video.id} video={video} />
                ))}
              </VideoSection>
            )}
            {listingVideos.length > 0 && (
              <VideoSection title="樓盤影片">
                {listingVideos.map((listing) => (
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
              <Button asChild className="bg-coral text-coral-foreground hover:bg-coral/90">
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

  return (
    <article className="overflow-hidden rounded-lg border bg-card shadow-card">
      {embedUrl ? (
        <iframe
          src={embedUrl}
          title={title}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
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
        {description && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
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
