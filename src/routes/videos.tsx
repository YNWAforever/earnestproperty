import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, PlayCircle, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { fetchVideoListings, type VideoListing } from "@/lib/queries";

export const Route = createFileRoute("/videos")({
  loader: async () => fetchVideoListings(12),
  head: () => ({
    meta: [
      { title: "YouTube影片｜晉誠地產 深井 青山公路 汀九樓盤" },
      {
        name: "description",
        content:
          "晉誠地產 YouTube影片入口，優先展示附有影片的深井、青山公路、汀九樓盤，方便買樓租樓前先睇實景。",
      },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const videos = Route.useLoaderData();
  const inquiryUrl = whatsappUrl("你好，我想睇深井／青山公路／汀九樓盤影片");

  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">YouTube影片</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            深井 青山公路 汀九樓盤影片
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            優先顯示現有樓盤資料中的影片連結，睇樓前先了解景觀、間隔和屋苑環境。
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {videos.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((listing) => (
              <VideoCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-8 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Video className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-xl font-semibold text-primary">暫未有樓盤影片</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
              目前資料庫未有附影片樓盤。可以 WhatsApp 我哋，直接索取最新影片、VR 或睇樓安排。
            </p>
            <Button asChild className="mt-5 bg-coral text-coral-foreground hover:bg-coral/90">
              <a href={inquiryUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" />
                WhatsApp 索取影片
              </a>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function VideoCard({ listing }: { listing: VideoListing }) {
  const embedUrl = getYouTubeEmbedUrl(listing.video_url);
  const price = formatListingPrice(listing);

  return (
    <article className="overflow-hidden rounded-lg border bg-card shadow-card">
      {embedUrl ? (
        <iframe
          src={embedUrl}
          title={listing.title_zh}
          className="aspect-video w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <a
          href={listing.video_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex aspect-video items-center justify-center bg-primary/10 text-primary"
        >
          <PlayCircle className="h-10 w-10" />
        </a>
      )}
      <div className="p-5">
        <p className="text-xs font-semibold text-coral">
          {listing.estates?.name_zh ?? "深井 / 青山公路"} ·{" "}
          {listing.deal_type === "rent" ? "租" : "售"}
        </p>
        <h2 className="mt-2 line-clamp-2 text-lg font-semibold text-primary">{listing.title_zh}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{price}</p>
        <Link
          to="/property/$listingNo"
          params={{ listingNo: listing.listing_no }}
          className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
        >
          查看樓盤詳情
        </Link>
      </div>
    </article>
  );
}

function getYouTubeEmbedUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return `https://www.youtube.com/embed/${url.pathname.slice(1)}`;
    if (!host.endsWith("youtube.com")) return null;
    if (url.pathname.startsWith("/embed/")) return value;
    if (url.pathname.startsWith("/shorts/")) {
      return `https://www.youtube.com/embed/${url.pathname.split("/")[2]}`;
    }
    const videoId = url.searchParams.get("v");
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  } catch {
    return null;
  }
}

function formatListingPrice(listing: VideoListing) {
  if (listing.deal_type === "rent") {
    return listing.rent ? `月租 HK$${listing.rent.toLocaleString()}` : "租金請查詢";
  }
  return listing.price ? `售價 HK$${(listing.price / 10000).toLocaleString()}萬` : "售價請查詢";
}
