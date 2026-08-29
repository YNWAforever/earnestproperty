import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useState, useEffect } from "react";
import {
  Bed,
  Bath,
  Maximize2,
  MapPin,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  SlidersHorizontal,
  X,
} from "lucide-react";
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
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { SkeletonBlock } from "@/components/layout/SkeletonBlock";
import { SearchFallbackCTA } from "@/components/site/SearchFallbackCTA";
import { canonicalLink, pageSeo, SITE_URL } from "@/content/seo";
import {
  formatHkd,
  formatHkDate,
  formatSaleDisplay,
  sanitizeListingText,
} from "@/lib/format";
import { AppImage } from "@/components/media/AppImage";
import {
  searchListings,
  fetchEstateOptions,
  type ListingRow,
} from "@/lib/queries";
import { itemListSchema, jsonLdScript } from "@/lib/schema";

const PAGE_SIZE = 12;

const SORT_OPTIONS = [
  "newest",
  "price_asc",
  "price_desc",
  "area",
  "psf",
] as const;

const searchSchema = z.object({
  deal: fallback(z.enum(["all", "sale", "rent"]), "all").default("all"),
  district: fallback(z.string().optional(), undefined),
  minPrice: fallback(z.number().int().min(0).optional(), undefined),
  maxPrice: fallback(z.number().int().min(0).optional(), undefined),
  minArea: fallback(z.number().int().min(0).optional(), undefined),
  maxArea: fallback(z.number().int().min(0).optional(), undefined),
  bedrooms: fallback(z.number().int().min(0).max(4).optional(), undefined),
  estate: fallback(z.string().optional(), undefined),
  keyword: fallback(z.string().optional(), undefined),
  sort: fallback(z.enum(SORT_OPTIONS), "newest").default("newest"),
  page: fallback(z.number().int().min(1), 1).default(1),
});

export const Route = createFileRoute("/listings")({
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [result, estates] = await Promise.all([
      searchListings({
        deal: deps.deal,
        keyword: deps.keyword?.trim() || undefined,
        districtSlug: deps.district === "all" ? undefined : deps.district,
        minPrice: deps.minPrice,
        maxPrice: deps.maxPrice,
        minArea: deps.minArea,
        maxArea: deps.maxArea,
        bedrooms: deps.bedrooms,
        estateSlug: deps.estate,
        sort: deps.sort,
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
        content:
          "篩選深井區放盤：售盤／租盤、價格區間、房數、屋苑。即時 WhatsApp 查詢全部真盤。",
      },
      { property: "og:title", content: "搜尋放盤｜晉誠地產" },
      {
        property: "og:description",
        content: "深井區全部真盤篩選，按價錢、房數、屋苑搜尋。",
      },
    ],
    // Bare path -- the canonical must not fork per filter combination.
    links: [canonicalLink(pageSeo.listings.path)],
  }),
  pendingComponent: ListingsPendingComponent,
  errorComponent: ListingsErrorComponent,
  component: ListingsPage,
});

function describeListingSearch(
  search: ReturnType<typeof Route.useSearch>,
  estates: Array<{ slug: string; name_zh: string }>,
) {
  const parts = [
    search.deal === "sale"
      ? "售盤"
      : search.deal === "rent"
        ? "租盤"
        : "全部租售",
    search.estate
      ? estates.find((estate) => estate.slug === search.estate)?.name_zh
      : undefined,
    search.district,
    // Price bounds are only ever sent to the server when a deal type is
    // chosen (see listingWhere in public-data.server.ts -- deal="all" mixes
    // sale prices in millions with rents in thousands, so no bound can be
    // applied). Suppressing them here too keeps the summary from claiming a
    // filter that wasn't actually applied.
    search.deal !== "all" && search.minPrice
      ? `最低 $${search.minPrice.toLocaleString()}`
      : undefined,
    search.deal !== "all" && search.maxPrice
      ? `最高 $${search.maxPrice.toLocaleString()}`
      : undefined,
    search.bedrooms !== undefined
      ? `${search.bedrooms === 4 ? "4+" : search.bedrooms} 房`
      : undefined,
    search.keyword ? `關鍵字：${search.keyword}` : undefined,
  ].filter(Boolean);
  return parts.join(" / ") || "未指定條件";
}

type SortOption = (typeof SORT_OPTIONS)[number];

const SORT_LABELS: Record<SortOption, string> = {
  newest: "最新上架",
  price_asc: "價格由低至高",
  price_desc: "價格由高至低",
  area: "面積由大至小",
  psf: "呎價由低至高",
};

function SortSelect({ sort }: { sort: SortOption }) {
  const navigate = useNavigate({ from: "/listings" });

  return (
    <div className="flex items-center gap-2">
      <Label className="whitespace-nowrap text-xs" htmlFor="listing-sort">
        排序
      </Label>
      <Select
        value={sort}
        onValueChange={(value: SortOption) =>
          navigate({
            // Sorting keeps every other active filter as-is -- only the sort
            // column changes, plus the page resets since "page 2" means a
            // different set of rows once the ordering changes.
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              sort: value,
              page: 1,
            }),
          })
        }
      >
        <SelectTrigger id="listing-sort" className="h-9 w-[168px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {SORT_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type Estate = { slug: string; name_zh: string };

const DISTRICT_LABELS: Record<string, string> = {
  "sham-tseng": "深井",
  "ting-kau": "汀九",
  "tsuen-wan": "荃灣",
  "castle-peak-road": "青山公路",
};

function districtLabel(slug: string) {
  return DISTRICT_LABELS[slug] ?? slug;
}

type ActiveFilterChip = {
  key: string;
  label: string;
  // Keys removed from the search params when this chip is dismissed. Almost
  // always a single key -- one chip removes exactly the one param it
  // represents, never a whole-object replace (see PageLink/SortSelect for
  // the established `search: (prev) => ({ ...prev, ... })` merge pattern
  // this follows).
  removeKeys: string[];
};

function buildActiveFilterChips(
  search: ReturnType<typeof Route.useSearch>,
  estates: Estate[],
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (search.deal !== "all") {
    chips.push({
      key: "deal",
      label: search.deal === "sale" ? "售盤" : "租盤",
      removeKeys: ["deal"],
    });
  }
  if (search.district) {
    chips.push({
      key: "district",
      label: `地區：${districtLabel(search.district)}`,
      removeKeys: ["district"],
    });
  }
  if (search.estate) {
    const name =
      estates.find((e) => e.slug === search.estate)?.name_zh ?? search.estate;
    chips.push({
      key: "estate",
      label: `屋苑：${name}`,
      removeKeys: ["estate"],
    });
  }
  if (search.bedrooms !== undefined) {
    chips.push({
      key: "bedrooms",
      label:
        search.bedrooms === 0
          ? "開放式"
          : search.bedrooms === 4
            ? "4 房或以上"
            : `${search.bedrooms} 房`,
      removeKeys: ["bedrooms"],
    });
  }
  if (search.minPrice !== undefined) {
    chips.push({
      key: "minPrice",
      label: `最低 $${search.minPrice.toLocaleString()}`,
      removeKeys: ["minPrice"],
    });
  }
  if (search.maxPrice !== undefined) {
    chips.push({
      key: "maxPrice",
      label: `最高 $${search.maxPrice.toLocaleString()}`,
      removeKeys: ["maxPrice"],
    });
  }
  if (search.minArea !== undefined) {
    chips.push({
      key: "minArea",
      label: `最小 ${search.minArea} 呎`,
      removeKeys: ["minArea"],
    });
  }
  if (search.maxArea !== undefined) {
    chips.push({
      key: "maxArea",
      label: `最大 ${search.maxArea} 呎`,
      removeKeys: ["maxArea"],
    });
  }
  if (search.keyword) {
    chips.push({
      key: "keyword",
      label: `關鍵字：${search.keyword}`,
      removeKeys: ["keyword"],
    });
  }
  if (search.sort !== "newest") {
    chips.push({
      key: "sort",
      label: `排序：${SORT_LABELS[search.sort as SortOption]}`,
      removeKeys: ["sort"],
    });
  }

  return chips;
}

function FilterChip({
  label,
  removeKeys,
}: {
  label: string;
  removeKeys: string[];
}) {
  return (
    <Link
      to="/listings"
      search={(prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev };
        for (const key of removeKeys) {
          delete next[key];
        }
        next.page = 1;
        return next;
      }}
      className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
      aria-label={`移除篩選：${label}`}
    >
      {label}
      <X className="h-3 w-3" />
    </Link>
  );
}

/**
 * All the mutable, not-yet-applied filter-panel state plus its apply/reset
 * actions, owned once at the page level so the desktop sidebar and the
 * mobile sheet render off the exact same state and the exact same apply()/
 * reset() closures -- never two independent copies that could drift.
 */
function useListingFiltersState(initial: ReturnType<typeof Route.useSearch>) {
  const navigate = useNavigate({ from: "/listings" });
  const [deal, setDeal] = useState<"all" | "sale" | "rent">(initial.deal);
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [district, setDistrict] = useState<string>(initial.district ?? "all");
  const [minPrice, setMinPrice] = useState(initial.minPrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice?.toString() ?? "");
  const [bedrooms, setBedrooms] = useState<string>(
    initial.bedrooms !== undefined ? initial.bedrooms.toString() : "any",
  );
  const [estate, setEstate] = useState<string>(initial.estate ?? "any");

  // Resync if user navigates via Pagination/Link/a dismissed filter chip.
  useEffect(() => {
    setDeal(initial.deal);
    setKeyword(initial.keyword ?? "");
    setDistrict(initial.district ?? "all");
    setMinPrice(initial.minPrice?.toString() ?? "");
    setMaxPrice(initial.maxPrice?.toString() ?? "");
    setBedrooms(
      initial.bedrooms !== undefined ? initial.bedrooms.toString() : "any",
    );
    setEstate(initial.estate ?? "any");
  }, [
    initial.deal,
    initial.keyword,
    initial.district,
    initial.minPrice,
    initial.maxPrice,
    initial.bedrooms,
    initial.estate,
  ]);

  const isAllDeals = deal === "all";

  function apply() {
    navigate({
      search: {
        deal,
        keyword: keyword.trim() || undefined,
        district: district === "all" ? undefined : district,
        // Price is meaningless without a deal type (sale prices are in
        // millions, rents in thousands) -- the inputs are disabled under
        // "all" below, this guards a value left over from switching deal
        // types after typing a price.
        minPrice: !isAllDeals && minPrice ? Number(minPrice) : undefined,
        maxPrice: !isAllDeals && maxPrice ? Number(maxPrice) : undefined,
        bedrooms: bedrooms === "any" ? undefined : Number(bedrooms),
        estate: estate === "any" ? undefined : estate,
        // This panel doesn't manage sort/area-bound state -- pass the
        // already-active values straight through so clicking 套用/套用篩選
        // doesn't silently reset a sort the user picked via SortSelect (or
        // an area bound arriving via a shared URL) back to its default.
        sort: initial.sort,
        minArea: initial.minArea,
        maxArea: initial.maxArea,
        page: 1,
      },
    });
  }

  function reset() {
    navigate({ search: { deal: "all", page: 1 } });
  }

  return {
    deal,
    setDeal,
    keyword,
    setKeyword,
    district,
    setDistrict,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
    bedrooms,
    setBedrooms,
    estate,
    setEstate,
    isAllDeals,
    apply,
    reset,
  };
}

type ListingFiltersState = ReturnType<typeof useListingFiltersState>;

/**
 * The actual filter form controls, with no card wrapper and no apply/reset
 * actions of its own -- rendered once for the desktop sidebar and once
 * inside the mobile sheet, both times against the SAME `filters` state
 * object, so there is exactly one apply()/reset() implementation.
 * `idPrefix` keeps the two simultaneously-mounted copies' element ids
 * unique (desktop is `hidden lg:block`, not unmounted, so plain duplicate
 * ids would be invalid HTML the moment the mobile sheet is also open).
 */
function FilterFields({
  estates,
  filters,
  idPrefix,
}: {
  estates: Estate[];
  filters: ListingFiltersState;
  idPrefix: string;
}) {
  const {
    deal,
    setDeal,
    keyword,
    setKeyword,
    district,
    setDistrict,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
    bedrooms,
    setBedrooms,
    estate,
    setEstate,
    isAllDeals,
    apply,
  } = filters;

  const isRent = deal === "rent";
  const priceLabel = isAllDeals
    ? "價格 (先揀售或租)"
    : isRent
      ? "月租 (HKD)"
      : "售價 (HKD)";
  const keywordId = `${idPrefix}-listing-keyword`;
  const bedroomsId = `${idPrefix}-listing-bedrooms`;
  const districtId = `${idPrefix}-listing-district`;
  const estateId = `${idPrefix}-listing-estate`;

  return (
    <>
      <div>
        <Label className="mb-2 block text-xs" htmlFor={keywordId}>
          關鍵字
        </Label>
        <Input
          id={keywordId}
          type="search"
          placeholder="屋苑、街道或樓盤編號"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          className="h-11"
        />
      </div>

      <div>
        <Label className="mb-2 block text-xs">類型</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(["all", "sale", "rent"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setDeal(v)}
              className={`min-h-11 rounded-md border px-2 py-2 text-sm font-medium transition ${
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
            disabled={isAllDeals}
            className="h-11"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="number"
            min="0"
            placeholder="最高"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            disabled={isAllDeals}
            className="h-11"
          />
        </div>
        {isAllDeals && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            售價同月租唔同單位，揀「售盤」或「租盤」先可以設定價格。
          </p>
        )}
      </div>

      <div>
        <Label className="mb-2 block text-xs">房數</Label>
        <Select value={bedrooms} onValueChange={setBedrooms}>
          <SelectTrigger id={bedroomsId} className="h-11" aria-label="房數">
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
          <SelectTrigger id={districtId} className="h-11" aria-label="地區">
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
          <SelectTrigger id={estateId} className="h-11" aria-label="屋苑">
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
    </>
  );
}

function DesktopFiltersPanel({
  estates,
  filters,
}: {
  estates: Estate[];
  filters: ListingFiltersState;
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="mb-4 text-sm font-semibold">篩選條件</h2>
      <div className="space-y-4">
        <FilterFields estates={estates} filters={filters} idPrefix="desktop" />
        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={filters.apply} className="w-full">
            套用篩選
          </Button>
          <Button
            onClick={filters.reset}
            variant="ghost"
            size="sm"
            className="w-full"
          >
            清除全部
          </Button>
        </div>
      </div>
    </div>
  );
}

function MobileFiltersSheet({
  estates,
  filters,
  activeCount,
}: {
  estates: Estate[];
  filters: ListingFiltersState;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="relative gap-1.5 lg:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" />
          篩選
          {activeCount > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col"
      >
        <div className="flex h-full flex-col">
          <h2 className="mt-2 text-sm font-semibold">篩選條件</h2>
          <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
            <FilterFields
              estates={estates}
              filters={filters}
              idPrefix="mobile"
            />
          </div>
          <div className="mt-6 flex flex-col gap-2 border-t pt-4">
            <Button
              onClick={() => {
                filters.apply();
                setOpen(false);
              }}
              className="w-full"
            >
              套用
            </Button>
            <Button
              onClick={() => {
                filters.reset();
                setOpen(false);
              }}
              variant="ghost"
              size="sm"
              className="w-full"
            >
              清除
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: "grid" | "list";
  onChange: (mode: "grid" | "list") => void;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border p-0.5"
      role="group"
      aria-label="顯示模式"
    >
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-pressed={viewMode === "grid"}
        aria-label="格狀顯示"
        className={`rounded px-2 py-1.5 transition ${
          viewMode === "grid"
            ? "bg-accent text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-pressed={viewMode === "list"}
        aria-label="列表顯示"
        className={`rounded px-2 py-1.5 transition ${
          viewMode === "list"
            ? "bg-accent text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <List className="h-4 w-4" />
      </button>
    </div>
  );
}

function ListingsPendingComponent() {
  return (
    <div className="bg-background">
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <SkeletonBlock lines={2} className="max-w-xs" />
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        <div className="hidden lg:block">
          <div className="rounded-lg border bg-card p-5">
            <SkeletonBlock lines={7} />
          </div>
        </div>
        <div>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: PAGE_SIZE }, (_, i) => (
              <li key={i}>
                <SkeletonBlock variant="card" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function ListingsErrorComponent({ error }: { error: Error }) {
  const router = useRouter();

  return (
    <div className="bg-background px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl rounded-lg border bg-card p-6 text-center shadow-card">
        <p className="text-sm font-semibold text-coral">搜尋放盤</p>
        <h1 className="mt-2 text-2xl font-bold text-primary">
          載入放盤資料時遇到問題
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          即時放盤資料暫時未能載入。可以重新載入，或返回搜尋首頁調整篩選條件再試一次。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => router.invalidate()}>重新載入</Button>
          <Button asChild variant="outline">
            <Link to="/listings" search={{ deal: "all", page: 1 }}>
              返回搜尋首頁
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ListingsPage() {
  const search = Route.useSearch();
  const { rows, total, estates } = Route.useLoaderData();
  const filters = useListingFiltersState(search);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const searchSummary = describeListingSearch(search, estates);
  const activeChips = buildActiveFilterChips(search, estates);
  const fallbackIntent = search.deal === "rent" ? "rent" : "buy";
  const listSchema =
    rows.length > 0
      ? itemListSchema({
          items: rows.map((row) => ({
            url: `${SITE_URL}/property/${row.listing_no}`,
            name: sanitizeListingText(row.title_zh) ?? row.title_zh,
          })),
        })
      : null;

  return (
    <div className="bg-background">
      {listSchema ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdScript({
              "@context": "https://schema.org",
              ...listSchema,
            }),
          }}
        />
      ) : null}
      <div className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            搜尋放盤
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {total.toLocaleString()} 個放盤符合篩選條件
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        <aside className="hidden lg:block lg:sticky lg:top-20 lg:self-start">
          <DesktopFiltersPanel estates={estates} filters={filters} />
        </aside>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <MobileFiltersSheet
              estates={estates}
              filters={filters}
              activeCount={activeChips.length}
            />
            {rows.length > 0 && (
              <div className="ml-auto flex items-center gap-2">
                <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
                <SortSelect sort={search.sort} />
              </div>
            )}
          </div>

          {activeChips.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-2">
              {activeChips.map((chip) => (
                <FilterChip
                  key={chip.key}
                  label={chip.label}
                  removeKeys={chip.removeKeys}
                />
              ))}
              <Link
                to="/listings"
                search={{ deal: "all", page: 1 }}
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
              >
                清除全部篩選
              </Link>
            </div>
          )}

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
                intent={fallbackIntent}
                context={{
                  searchSummary,
                  source: "listings-zero-results",
                }}
              />
            </div>
          ) : viewMode === "grid" ? (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((p: ListingRow) => (
                <ListingCard key={p.id} p={p} />
              ))}
            </ul>
          ) : (
            <ul className="space-y-3">
              {rows.map((p: ListingRow) => (
                <ListingCardRow key={p.id} p={p} />
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <div className="mt-8">
              <SearchFallbackCTA
                compact
                intent={fallbackIntent}
                context={{
                  searchSummary,
                  source: "listings-end-of-results",
                }}
              />
            </div>
          )}

          {totalPages > 1 && (
            <Pagination current={search.page} total={totalPages} />
          )}
        </section>
      </div>
    </div>
  );
}

function deriveListingCardData(p: ListingRow) {
  const cover =
    p.images?.[0] ??
    "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800";
  const safeTitle = sanitizeListingText(p.title_zh) ?? p.title_zh;
  const rentDisplay = formatHkd(p.rent);
  const saleDisplay = formatSaleDisplay(p.price);
  const price =
    p.deal_type === "rent"
      ? rentDisplay
        ? `HK${rentDisplay}/月`
        : "—"
      : saleDisplay
        ? `HK${saleDisplay}`
        : "—";
  const lastSeen = formatHkDate(p.last_seen_at);
  return { cover, safeTitle, price, lastSeen };
}

function ListingCard({ p }: { p: ListingRow }) {
  const { cover, safeTitle, price, lastSeen } = deriveListingCardData(p);

  return (
    <li className="group overflow-hidden rounded-lg border bg-card transition hover:shadow-md">
      <Link to="/property/$listingNo" params={{ listingNo: p.listing_no }}>
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <AppImage
            src={cover}
            alt={safeTitle}
            width={400}
            height={300}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
          <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-[11px] font-medium">
            {p.deal_type === "rent" ? "租" : "售"}
          </span>
        </div>
        <div className="p-4">
          <p className="text-lg font-bold text-primary">{price}</p>
          <h3 className="mt-1 line-clamp-1 text-sm font-semibold">
            {safeTitle}
          </h3>
          {p.source_site && lastSeen && (
            <p className="mt-1 text-xs text-muted-foreground">
              最後更新：{lastSeen}
            </p>
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

// Same data as ListingCard, horizontal row layout for the list view toggle
// -- deliberately not a fully independent component: it shares
// deriveListingCardData() rather than re-deriving price/lastSeen itself.
function ListingCardRow({ p }: { p: ListingRow }) {
  const { cover, safeTitle, price, lastSeen } = deriveListingCardData(p);

  return (
    <li className="group overflow-hidden rounded-lg border bg-card transition hover:shadow-md">
      <Link
        to="/property/$listingNo"
        params={{ listingNo: p.listing_no }}
        className="flex gap-4 p-3 sm:p-4"
      >
        <div className="relative aspect-[4/3] w-28 flex-shrink-0 overflow-hidden rounded-md bg-muted sm:w-44">
          <AppImage
            src={cover}
            alt={safeTitle}
            width={200}
            height={150}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
          <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium">
            {p.deal_type === "rent" ? "租" : "售"}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="text-base font-bold text-primary sm:text-lg">{price}</p>
          <h3 className="mt-1 line-clamp-1 text-sm font-semibold">
            {safeTitle}
          </h3>
          {p.source_site && lastSeen && (
            <p className="mt-1 text-xs text-muted-foreground">
              最後更新：{lastSeen}
            </p>
          )}
          {p.estates && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              {p.estates.name_zh}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
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
      <PageLink
        page={current + 1}
        disabled={current === total}
        aria-label="下一頁"
      >
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
      <span className="inline-flex h-11 min-w-11 items-center justify-center rounded-md border border-input px-3 text-sm text-muted-foreground opacity-40">
        {children}
      </span>
    );
  }
  return (
    <Link
      to="/listings"
      search={(prev: Record<string, unknown>) => ({ ...prev, page })}
      className={`inline-flex h-11 min-w-11 items-center justify-center rounded-md border px-3 text-sm font-medium transition ${
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
