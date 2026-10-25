import { useRef, useState } from "react";
import { Bed, Maximize, MapPin } from "lucide-react";
import fixture from "@/content/28hse-preview.json";
import { AppImage } from "@/components/media/AppImage";

import { PREVIEW_HOME_LIMIT, previewListingsForDeal } from "@/lib/saved-preview-catalog.js";

function formatPreviewPrice(amount: number | null, deal: string) {
  if (amount === null) return "價格未提供";
  return deal === "sale"
    ? `$${(amount / 10000).toLocaleString("zh-HK")} 萬`
    : `$${amount.toLocaleString("zh-HK")} / 月`;
}

export function SavedListingsPreview() {
  const [deal, setDeal] = useState("sale");
  const catalog = useRef<HTMLDetailsElement>(null);
  const listings = previewListingsForDeal(fixture.listings, deal, PREVIEW_HOME_LIMIT);
  const saleListings = previewListingsForDeal(fixture.listings, "sale");
  const rentListings = previewListingsForDeal(fixture.listings, "rent");
  return (
    <section className="bg-muted/40" aria-labelledby="saved-listings-heading">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-xs font-semibold tracking-widest text-coral">28HSE · 本機預覽</p>
        <h2 id="saved-listings-heading" className="mt-2 text-3xl font-bold text-primary">
          最新放盤
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          比對後共 56 個新增樓盤（38 個售盤、18 個租盤），已合併重複盤，並非即時盤源。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          優先顯示已提供刊登時間的新盤；其餘按 28hse 編號排序。
        </p>
        <a
          href="#all-new-listings"
          onClick={() => {
            if (catalog.current) catalog.current.open = true;
          }}
          className="mt-4 inline-block text-sm font-semibold text-primary underline underline-offset-4"
        >
          查看全部新盤 →
        </a>
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
          {listings.length === 0 ? (
            <p className="col-span-full rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
              本次比對未有新增租盤。
            </p>
          ) : null}
          {listings.map((listing) => (
            <SavedListingCard key={listing.id} listing={listing} />
          ))}
        </div>
        <details
          id="all-new-listings"
          ref={catalog}
          className="mt-10 scroll-mt-24 rounded-xl border border-border bg-card p-5 sm:p-8"
        >
          <summary className="cursor-pointer text-xl font-bold text-primary">
            全部新盤 · {fixture.listings.length}
          </summary>
          <p className="mt-3 text-sm text-muted-foreground">
            以下為本次比對的全部新增樓盤，並非網站全部盤源。
          </p>
          {[
            { deal: "sale", label: "買樓", rows: saleListings },
            { deal: "rent", label: "租樓", rows: rentListings },
          ].map((group) => (
            <section
              key={group.deal}
              id={`preview-catalog-${group.deal}`}
              className="mt-8"
              aria-label={`${group.label}全部新盤`}
            >
              <h3 className="text-2xl font-bold text-primary">
                {group.label} · {group.rows.length}
              </h3>
              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.rows.map((listing) => (
                  <SavedListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            </section>
          ))}
        </details>
      </div>
    </section>
  );
}

function SavedListingCard({ listing }: { listing: (typeof fixture.listings)[number] }) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <div className="relative h-48 bg-muted">
        <AppImage
          src={listing.main_image_url}
          alt={listing.estate ?? "樓盤相片"}
          width={640}
          height={480}
          className="h-full w-full object-cover"
        />
        <span className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          {listing.deal_type === "sale" ? "放售" : "放租"}
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
          {formatPreviewPrice(
            listing.deal_type === "sale" ? listing.price : listing.rent,
            listing.deal_type,
          )}
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
  );
}
