import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useState, useEffect } from "react";
import { Bed, Bath, Maximize2, MapPin, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchFallbackCTA } from "@/components/site/SearchFallbackCTA";
import { searchListings, fetchEstateOptions, type ListingRow } from "@/lib/queries";

const PAGE_SIZE = 12;

const searchSchema = z.object({
  deal: fallback(z.enum(["all", "sale", "rent"]), "all").default("all"),
  district: fallback(z.string().optional(), undefined),
  minPrice: fallback(z.number().int().min(0).optional(), undefined),
  maxPrice: fallback(z.number().int().min(0).optional(), undefined),
  bedrooms: fallback(z.number().int().min(0).max(4).optional(), undefined),
  estate: fallback(z.string().optional(), undefined),
  keyword: fallback(z.string().optional(), undefined),
  page: fallback(z.number().int().min(1), 1).default(1),
});

export const Route = createFileRoute("/listings")({
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [result, estates] = await Promise.all([
      searchListings({
        deal: deps.deal,
        districtSlug: deps.district === "all" ? undefined : deps.district,
        minPrice: deps.minPrice,
        maxPrice: deps.maxPrice,
        bedrooms: deps.bedrooms,
        estateSlug: deps.estate,
        page: deps.page,
        pageSize: PAGE_SIZE,
      }),
      fetchEstateOptions(),
    ]);
    return { ...result, estates };
  },
  head: () => ({
    meta: [
      { title: "搜尋放盤｜深井買樓租樓 — 晉誠地產" },
      {
        name: "description",
        content: "篩選深井區放盤：售盤／租盤、價格區間、房數、屋苑。即時 WhatsApp 查詢堅盤源。",
      },
      { property: "og:title", content: "搜尋放盤｜晉誠地產" },
      {
        property: "og:description",
        content: "深井區堅盤源篩選，按價錢、房數、屋苑搜尋。",
      },
    ],
  }),
  component: ListingsPage,
});

function describeListingSearch(
  search: ReturnType<typeof Route.useSearch>,
  estates: Array<{ slug: string; name_zh: string }>,
) {
  const parts = [
    search.deal === "sale" ? "售盤" : search.deal === "rent" ? "租盤" : "全部租售",
    search.estate ? estates.find((estate) => estate.slug === search.estate)?.name_zh : undefined,
    search.district,
    search.minPrice ? `最低 $${search.minPrice.toLocaleString()}` : undefined,
    search.maxPrice ? `最高 $${search.maxPrice.toLocaleString()}` : undefined,
    search.bedrooms !== undefined
      ? `${search.bedrooms === 4 ? "4+" : search.bedrooms} 房`
      : undefined,
    search.keyword ? `補充：${search.keyword}` : undefined,
  ].filter(Boolean);
  return parts.join(" / ") || "未指定條件";
}

function ListingsPage() {
  const search = Route.useSearch();
  const { rows, total, estates } = Route.useLoaderData();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const searchSummary = describeListingSearch(search, estates);

  return (
    <div className="bg-background">
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">搜尋放盤</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {total.toLocaleString()} 個放盤符合篩選條件
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <FiltersPanel estates={estates} initial={search} />
        </aside>

        <section>
          {rows.length === 0 ? (
            <div className="space-y-5">
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-muted-foreground">沒有符合條件的放盤</p>
                <Link
                  to="/listings"
                  search={{ deal: "all", page: 1 }}
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  清除篩選
                </Link>
              </div>
              <SearchFallbackCTA
                context={{
                  searchSummary,
                  source: "listings-zero-results",
                }}
              />
            </div>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((p: ListingRow) => (
                <ListingCard key={p.id} p={p} />
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <div className="mt-8">
              <SearchFallbackCTA
                compact
                context={{
                  searchSummary,
                  source: "listings-end-of-results",
                }}
              />
            </div>
          )}

          {totalPages > 1 && <Pagination current={search.page} total={totalPages} />}
        </section>
      </div>
    </div>
  );
}

type Estate = { slug: string; name_zh: string };

function FiltersPanel({
  estates,
  initial,
}: {
  estates: Estate[];
  initial: ReturnType<typeof Route.useSearch>;
}) {
  const navigate = useNavigate({ from: "/listings" });
  const [deal, setDeal] = useState<"all" | "sale" | "rent">(initial.deal);
  const [district, setDistrict] = useState<string>(initial.district ?? "all");
  const [minPrice, setMinPrice] = useState(initial.minPrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice?.toString() ?? "");
  const [bedrooms, setBedrooms] = useState<string>(
    initial.bedrooms !== undefined ? initial.bedrooms.toString() : "any",
  );
  const [estate, setEstate] = useState<string>(initial.estate ?? "any");

  // Resync if user navigates via Pagination/Link
  useEffect(() => {
    setDeal(initial.deal);
    setDistrict(initial.district ?? "all");
    setMinPrice(initial.minPrice?.toString() ?? "");
    setMaxPrice(initial.maxPrice?.toString() ?? "");
    setBedrooms(initial.bedrooms !== undefined ? initial.bedrooms.toString() : "any");
    setEstate(initial.estate ?? "any");
  }, [
    initial.deal,
    initial.district,
    initial.minPrice,
    initial.maxPrice,
    initial.bedrooms,
    initial.estate,
  ]);

  function apply() {
    navigate({
      search: {
        deal,
        district: district === "all" ? undefined : district,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        bedrooms: bedrooms === "any" ? undefined : Number(bedrooms),
        estate: estate === "any" ? undefined : estate,
        keyword: initial.keyword,
        page: 1,
      },
    });
  }

  function reset() {
    navigate({ search: { deal: "all", page: 1 } });
  }

  const isRent = deal === "rent";
  const priceLabel = isRent ? "月租 (HKD)" : "售價 (HKD)";

  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold">篩選條件</h2>

      <div className="space-y-4">
        <div>
          <Label className="mb-2 block text-xs">類型</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {(["all", "sale", "rent"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setDeal(v)}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium transition ${
                  deal === v
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input hover:bg-accent"
                }`}
              >
                {v === "all" ? "全部" : v === "sale" ? "售盤" : "租盤"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="mb-2 block text-xs">{priceLabel}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              placeholder="最低"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="h-9"
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="number"
              min="0"
              placeholder="最高"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="h-9"
            />
          </div>
        </div>

        <div>
          <Label className="mb-2 block text-xs">房數</Label>
          <Select value={bedrooms} onValueChange={setBedrooms}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">不限</SelectItem>
              <SelectItem value="0">開放式</SelectItem>
              <SelectItem value="1">1 房</SelectItem>
              <SelectItem value="2">2 房</SelectItem>
              <SelectItem value="3">3 房</SelectItem>
              <SelectItem value="4">4 房或以上</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-2 block text-xs">地區</Label>
          <Select value={district} onValueChange={setDistrict}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">所有地區</SelectItem>
              <SelectItem value="sham-tseng">深井</SelectItem>
              <SelectItem value="ting-kau">汀九</SelectItem>
              <SelectItem value="tsuen-wan">荃灣</SelectItem>
              <SelectItem value="castle-peak-road">青山公路</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="mb-2 block text-xs">屋苑</Label>
          <Select value={estate} onValueChange={setEstate}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">所有屋苑</SelectItem>
              {estates.map((e) => (
                <SelectItem key={e.slug} value={e.slug}>
                  {e.name_zh}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={apply} className="w-full">
            套用篩選
          </Button>
          <Button onClick={reset} variant="ghost" size="sm" className="w-full">
            清除全部
          </Button>
        </div>
      </div>
    </div>
  );
}

function ListingCard({ p }: { p: ListingRow }) {
  const cover = p.images?.[0] ?? "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800";
  const price =
    p.deal_type === "rent"
      ? p.rent
        ? `HK$${p.rent.toLocaleString()}/月`
        : "—"
      : p.price
        ? `HK$${(p.price / 1_000_000).toFixed(2)}M`
        : "—";
  const lastSeen = p.last_seen_at ? new Date(p.last_seen_at).toLocaleDateString("zh-HK") : null;

  return (
    <li className="group overflow-hidden rounded-lg border bg-card transition hover:shadow-md">
      <Link to="/property/$listingNo" params={{ listingNo: p.listing_no }}>
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <img
            src={cover}
            alt={p.title_zh}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
          <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-[11px] font-medium">
            {p.deal_type === "rent" ? "租" : "售"}
          </span>
        </div>
        <div className="p-4">
          <p className="text-lg font-bold text-primary">{price}</p>
          <h3 className="mt-1 line-clamp-1 text-sm font-semibold">{p.title_zh}</h3>
          {p.source_site && lastSeen && (
            <p className="mt-1 text-xs text-muted-foreground">最後更新：{lastSeen}</p>
          )}
          {p.estates && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {p.estates.name_zh}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            {p.saleable_area && (
              <span className="inline-flex items-center gap-1">
                <Maximize2 className="h-3 w-3" />
                {p.saleable_area} 呎
              </span>
            )}
            {p.bedrooms !== null && (
              <span className="inline-flex items-center gap-1">
                <Bed className="h-3 w-3" />
                {p.bedrooms}
              </span>
            )}
            {p.bathrooms !== null && (
              <span className="inline-flex items-center gap-1">
                <Bath className="h-3 w-3" />
                {p.bathrooms}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function Pagination({ current, total }: { current: number; total: number }) {
  const pages = pageRange(current, total);
  return (
    <nav className="mt-8 flex items-center justify-center gap-1">
      <PageLink page={current - 1} disabled={current === 1} aria-label="上一頁">
        <ChevronLeft className="h-4 w-4" />
      </PageLink>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`g${i}`} className="px-2 text-muted-foreground">
            …
          </span>
        ) : (
          <PageLink key={p} page={p} active={p === current}>
            {p}
          </PageLink>
        ),
      )}
      <PageLink page={current + 1} disabled={current === total} aria-label="下一頁">
        <ChevronRight className="h-4 w-4" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  page,
  active,
  disabled,
  children,
  ...rest
}: {
  page: number;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-input px-3 text-sm text-muted-foreground opacity-40">
        {children}
      </span>
    );
  }
  return (
    <Link
      to="/listings"
      search={(prev: Record<string, unknown>) => ({ ...prev, page })}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input hover:bg-accent"
      }`}
      {...rest}
    >
      {children}
    </Link>
  );
}

function pageRange(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
