import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bath, Bed, Maximize2, MessageCircle } from "lucide-react";

import { AppImage } from "@/components/media/AppImage";
import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { formatHkd, formatSaleDisplay } from "@/lib/format";
import type { CorridorInventory as CorridorInventoryData, ListingRow } from "@/lib/queries";

type ListingsDeal = "all" | "sale" | "rent";

function formatPrice(row: ListingRow) {
  if (row.deal_type === "rent") {
    const hkd = formatHkd(row.rent);
    return hkd ? `HK${hkd}/月` : "查詢租金";
  }

  const sale = formatSaleDisplay(row.price);
  return sale ? `HK${sale}` : "查詢售價";
}

function ListingMiniCard({ listing }: { listing: ListingRow }) {
  const cover = listing.images?.[0];

  return (
    <Link
      to="/property/$listingNo"
      params={{ listingNo: listing.listing_no }}
      className="group overflow-hidden rounded-lg border bg-card transition hover:border-primary hover:shadow-card"
    >
      <div className="aspect-[4/3] bg-muted">
        <AppImage
          src={cover}
          alt={listing.title_zh}
          width={400}
          height={300}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="p-4">
        <p className="text-base font-bold text-primary">{formatPrice(listing)}</p>
        <h3 className="mt-1 line-clamp-1 text-sm font-semibold">{listing.title_zh}</h3>
        {listing.estates?.name_zh && (
          <p className="mt-1 text-xs text-muted-foreground">{listing.estates.name_zh}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {listing.saleable_area && (
            <span className="inline-flex items-center gap-1">
              <Maximize2 className="h-3.5 w-3.5" />
              {listing.saleable_area} 呎
            </span>
          )}
          {listing.bedrooms !== null && (
            <span className="inline-flex items-center gap-1">
              <Bed className="h-3.5 w-3.5" />
              {listing.bedrooms} 房
            </span>
          )}
          {listing.bathrooms !== null && (
            <span className="inline-flex items-center gap-1">
              <Bath className="h-3.5 w-3.5" />
              {listing.bathrooms}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function ListingColumn({
  title,
  total,
  rows,
  emptyText,
}: {
  title: string;
  total: number;
  rows: ListingRow[];
  emptyText: string;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-primary">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            即時真盤：{total.toLocaleString()} 個
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed bg-background p-6 text-sm leading-7 text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((listing) => (
            <ListingMiniCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}

function parseListingsHref(href: string) {
  const [path, query = ""] = href.split("?");
  if (path !== "/listings") return { deal: "all" as const, page: 1 };

  const params = new URLSearchParams(query);
  const dealParam = params.get("deal");
  const deal: ListingsDeal = dealParam === "sale" || dealParam === "rent" ? dealParam : "all";
  const pageParam = Number(params.get("page") ?? 1);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const district = params.get("district") ?? undefined;
  const estate = params.get("estate") ?? undefined;

  return {
    deal,
    page,
    ...(district ? { district } : {}),
    ...(estate ? { estate } : {}),
  };
}

function ListingHrefLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <Link to="/listings" search={parseListingsHref(href)} className={className}>
      {children}
    </Link>
  );
}

export function CorridorInventory({
  inventory,
  inquiryText,
  listingsHref,
  eyebrow = "Live Listings",
  heading = "即時放盤",
  description = "放盤數字來自網站已接入的公開真盤資料，實際可睇盤源可 WhatsApp 再確認。",
}: {
  inventory: CorridorInventoryData;
  inquiryText: string;
  listingsHref: string;
  eyebrow?: string;
  heading?: string;
  description?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-coral">{eyebrow}</p>
          <h2 className="mt-1 text-2xl font-bold text-primary">{heading}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/listings" search={{ deal: "all", page: 1 }}>
              全部放盤
            </Link>
          </Button>
          <Button asChild className="bg-coral text-coral-foreground hover:bg-primary-hover">
            <a href={whatsappUrl(inquiryText)} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 查詢
            </a>
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-8">
        <ListingColumn
          title="買賣 Sale"
          total={inventory.saleTotal}
          rows={inventory.saleRows}
          emptyText="暫時未有公開售盤符合這個分段。可 WhatsApp 查詢最新業主盤或未公開盤源。"
        />
        <ListingColumn
          title="租盤 Rent"
          total={inventory.rentTotal}
          rows={inventory.rentRows}
          emptyText="暫時未有公開租盤符合這個分段。可 WhatsApp 查詢最新租盤和即將放租單位。"
        />
      </div>

      <div className="mt-6 border-t pt-4">
        <ListingHrefLink
          href={listingsHref}
          className="text-sm font-semibold text-primary hover:underline"
        >
          用完整篩選搜尋更多放盤
        </ListingHrefLink>
      </div>
    </section>
  );
}
