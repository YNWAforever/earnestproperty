import { useState } from "react";
import { Bed, Maximize, MapPin } from "lucide-react";
import fixture from "@/content/28hse-preview.json";
import { AppImage } from "@/components/media/AppImage";

export function SavedListingsPreview() {
  const [deal, setDeal] = useState("sale");
  const listings = fixture.listings.filter((listing) => listing.deal_type === deal);
  return (
    <section className="bg-muted/40" aria-labelledby="saved-listings-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-xs font-semibold tracking-widest text-coral">28HSE · 本機預覽</p>
        <h2 id="saved-listings-heading" className="mt-2 text-3xl font-bold text-primary">
          最新放盤
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          已儲存樓盤資料示範，並非即時盤源。租盤僅包括 3 個已儲存詳情頁。
        </p>
        <div className="mt-6 flex gap-2" role="tablist" aria-label="買樓或租樓">
          {[
            ["sale", "買樓"],
            ["rent", "租樓"],
          ].map(([value, label]) => (
            <button
              key={value}
              id={`saved-tab-${value}`}
              type="button"
              role="tab"
              aria-selected={deal === value}
              aria-controls="saved-listings-panel"
              tabIndex={deal === value ? 0 : -1}
              onKeyDown={(event) => {
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "sale"
                      : event.key === "End"
                        ? "rent"
                        : deal === "sale"
                          ? "rent"
                          : "sale";
                  setDeal(next);
                  document.getElementById(`saved-tab-${next}`)?.focus();
                }
              }}
              className={`rounded-full border px-6 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${deal === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-primary"}`}
              onClick={() => setDeal(value)}
            >
              {label} · {fixture.listings.filter((listing) => listing.deal_type === value).length}
            </button>
          ))}
        </div>
        <div
          id="saved-listings-panel"
          role="tabpanel"
          aria-labelledby={`saved-tab-${deal}`}
          className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {listings.map((listing) => (
            <article
              key={listing.id}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
            >
              <div className="relative h-48 bg-muted">
                <AppImage
                  src={listing.main_image_url}
                  alt={listing.estate ?? "樓盤相片"}
                  width={640}
                  height={480}
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  {deal === "sale" ? "放售" : "放租"}
                </span>
              </div>
              <div className="p-5">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {[listing.district, listing.estate].filter(Boolean).join(" · ") || "地區未提供"}
                </p>
                <h3 className="mt-2 line-clamp-2 min-h-12 text-base font-semibold text-primary">
                  <a
                    href={listing.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {listing.title_zh ?? "樓盤資料"}
                  </a>
                </h3>
                <p className="mt-3 text-2xl font-bold text-coral">
                  {(deal === "sale" ? listing.price : listing.rent) == null
                    ? "價格未提供"
                    : deal === "sale"
                      ? `$${(listing.price! / 10000).toLocaleString("zh-HK")} 萬`
                      : `$${listing.rent!.toLocaleString("zh-HK")} / 月`}
                </p>
                <div className="mt-4 flex gap-5 border-t border-border pt-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Bed className="h-4 w-4" />
                    {listing.bedrooms ?? "未提供"} 房
                  </span>
                  <span className="flex items-center gap-1">
                    <Maximize className="h-4 w-4" />
                    實用 {listing.saleable_area ?? "未提供"} 呎
                  </span>
                </div>
                <a
                  href={listing.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4"
                >
                  查看 28hse 原盤 ↗
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
