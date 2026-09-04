import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useState } from "react";
import { MessageCircle, ReceiptText, Share2, X } from "lucide-react";

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
import { Container } from "@/components/layout/Container";
import { DataNote } from "@/components/layout/DataNote";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHero } from "@/components/site/PageHero";
import { whatsappUrl } from "@/config/site";
import { canonicalLink, SITE_URL } from "@/content/seo";
import { formatArea, formatHkd, formatHkDate, formatManDisplay } from "@/lib/format";
import { shareUrl } from "@/lib/share";
import {
  fetchEstateOptions,
  fetchRecentTransactions,
  fetchRecentTransactionsCount,
  type RecentTransaction,
} from "@/lib/queries";
import { buildContext, track } from "@/lib/analytics/events";

const DISTRICT_LABELS: Record<string, string> = {
  "sham-tseng": "深井",
  "ting-kau": "汀九",
  "tsuen-wan": "荃灣",
  "castle-peak-road": "青山公路",
};

const DEAL_TYPE_LABELS = {
  all: "全部",
  sale: "買賣",
  rent: "租賃",
} as const;

type DealTypeFilter = keyof typeof DEAL_TYPE_LABELS;

// Kept generous relative to the old hardcoded 24 -- filters now narrow the
// same result set the old three-district loop used to produce unfiltered,
// so a wider cap keeps a filtered view from looking sparser than it is.
const RESULT_LIMIT = 30;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const searchSchema = z.object({
  district: fallback(z.string().optional(), undefined),
  estate: fallback(z.string().optional(), undefined),
  dealType: fallback(z.enum(["all", "sale", "rent"]), "all").default("all"),
  month: fallback(z.string().regex(MONTH_PATTERN).optional(), undefined),
  minPrice: fallback(z.number().int().min(0).optional(), undefined),
  maxPrice: fallback(z.number().int().min(0).optional(), undefined),
  // Shareable per-transaction reference. No dedicated single-transaction
  // route exists (and this task deliberately doesn't invent one, with its
  // own SEO/sitemap handling, just for a one-row highlight) -- `?tx=<id>`
  // highlights and scrolls to that row within the existing filtered table
  // instead. A shared link only resolves if the target row is still inside
  // the current filters' top RESULT_LIMIT rows -- a known, low-risk
  // limitation, not a bug.
  tx: fallback(z.string().optional(), undefined),
  page: fallback(z.number().int().min(1), 1).default(1),
});

export const Route = createFileRoute("/transactions")({
  validateSearch: zodValidator(searchSchema),
  loaderDeps: ({ search }) => ({
    district: search.district,
    estate: search.estate,
    dealType: search.dealType,
    month: search.month,
    minPrice: search.minPrice,
    maxPrice: search.maxPrice,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const countFilters = {
      districtSlug: deps.district,
      estateSlug: deps.estate,
      dealType: deps.dealType,
      month: deps.month,
      minPrice: deps.minPrice,
      maxPrice: deps.maxPrice,
    };
    const [transactions, estates, totalCount] = await Promise.all([
      fetchRecentTransactions({
        ...countFilters,
        limit: RESULT_LIMIT,
        offset: (deps.page - 1) * RESULT_LIMIT,
      }),
      fetchEstateOptions(),
      fetchRecentTransactionsCount(countFilters),
    ]);
    return { transactions, estates, totalCount };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "晉誠地產最新成交｜深井 青山公路 汀九近期成交" },
      {
        name: "description",
        content:
          "晉誠地產最新成交：深井、青山公路、汀九近期屋苑成交價、實用面積及呎價，配合前線市場資訊。",
      },
      // fetchRecentTransactions only ever returns published + human-verified
      // rows (see its own comment in public-data.server.ts) -- an indexed
      // empty page is a soft-404 risk, so this stays noindex whenever that
      // filtered result is empty, whether because the DB has no rows at all
      // or because nothing has been verified yet. sitemap.xml drops this
      // path under the same condition; both self-heal once a row is
      // verified, no redeploy needed.
      ...(!loaderData || loaderData.transactions.length === 0
        ? [{ name: "robots", content: "noindex,follow" }]
        : []),
    ],
    links: [canonicalLink("/transactions")],
  }),
  component: TransactionsPage,
});

/** Mirrors listings.tsx's useListingFiltersState shape: local, editable
 * filter-panel state plus apply()/reset(), resynced from the URL whenever it
 * changes elsewhere (a dismissed chip, browser back/forward). */
function useTransactionFiltersState(initial: ReturnType<typeof Route.useSearch>) {
  const navigate = useNavigate({ from: "/transactions" });
  const [district, setDistrict] = useState(initial.district ?? "all");
  const [estate, setEstate] = useState(initial.estate ?? "any");
  const [dealType, setDealType] = useState<DealTypeFilter>(initial.dealType);
  const [month, setMonth] = useState(initial.month ?? "");
  const [minPrice, setMinPrice] = useState(initial.minPrice?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice?.toString() ?? "");

  useEffect(() => {
    setDistrict(initial.district ?? "all");
    setEstate(initial.estate ?? "any");
    setDealType(initial.dealType);
    setMonth(initial.month ?? "");
    setMinPrice(initial.minPrice?.toString() ?? "");
    setMaxPrice(initial.maxPrice?.toString() ?? "");
  }, [
    initial.district,
    initial.estate,
    initial.dealType,
    initial.month,
    initial.minPrice,
    initial.maxPrice,
  ]);

  function apply() {
    navigate({
      search: {
        district: district === "all" ? undefined : district,
        estate: estate === "any" ? undefined : estate,
        dealType,
        month: month || undefined,
        minPrice: minPrice ? Number(minPrice) : undefined,
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
      },
    });
  }

  function reset() {
    navigate({ search: { dealType: "all" } });
  }

  return {
    district,
    setDistrict,
    estate,
    setEstate,
    dealType,
    setDealType,
    month,
    setMonth,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
    apply,
    reset,
  };
}

type TransactionFiltersState = ReturnType<typeof useTransactionFiltersState>;

type EstateOption = { slug: string; name_zh: string };

function TransactionFilterFields({
  estates,
  filters,
}: {
  estates: EstateOption[];
  filters: TransactionFiltersState;
}) {
  const {
    district,
    setDistrict,
    estate,
    setEstate,
    dealType,
    setDealType,
    month,
    setMonth,
    minPrice,
    setMinPrice,
    maxPrice,
    setMaxPrice,
  } = filters;

  return (
    <>
      <div>
        <Label className="mb-2 block text-xs" htmlFor="tx-district">
          地區
        </Label>
        <Select value={district} onValueChange={setDistrict}>
          <SelectTrigger id="tx-district" className="h-11">
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
        <Label className="mb-2 block text-xs" htmlFor="tx-estate">
          屋苑
        </Label>
        <Select value={estate} onValueChange={setEstate}>
          <SelectTrigger id="tx-estate" className="h-11">
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

      <div>
        <Label className="mb-2 block text-xs" id="tx-deal-type-label">
          類型
        </Label>
        <div
          role="radiogroup"
          aria-labelledby="tx-deal-type-label"
          className="grid grid-cols-3 gap-1.5"
        >
          {(Object.keys(DEAL_TYPE_LABELS) as DealTypeFilter[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={dealType === v}
              onClick={() => setDealType(v)}
              className={`min-h-11 rounded-md border px-2 py-2 text-sm font-medium transition ${
                dealType === v
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input hover:bg-accent"
              }`}
            >
              {DEAL_TYPE_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="mb-2 block text-xs" htmlFor="tx-month">
          成交月份
        </Label>
        <Input
          id="tx-month"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-11"
        />
      </div>

      <div>
        <Label className="mb-2 block text-xs" htmlFor="tx-min-price">
          最低成交價 (HKD)
        </Label>
        <Input
          id="tx-min-price"
          type="number"
          min="0"
          placeholder="最低"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          className="h-11"
        />
      </div>

      <div>
        <Label className="mb-2 block text-xs" htmlFor="tx-max-price">
          最高成交價 (HKD)
        </Label>
        <Input
          id="tx-max-price"
          type="number"
          min="0"
          placeholder="最高"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className="h-11"
        />
      </div>
    </>
  );
}

type ActiveFilterChip = {
  key: string;
  label: string;
  removeKeys: string[];
};

function buildActiveFilterChips(
  search: ReturnType<typeof Route.useSearch>,
  estates: EstateOption[],
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (search.district) {
    chips.push({
      key: "district",
      label: `地區：${DISTRICT_LABELS[search.district] ?? search.district}`,
      removeKeys: ["district"],
    });
  }
  if (search.estate) {
    const name = estates.find((e) => e.slug === search.estate)?.name_zh ?? search.estate;
    chips.push({ key: "estate", label: `屋苑：${name}`, removeKeys: ["estate"] });
  }
  if (search.dealType !== "all") {
    chips.push({
      key: "dealType",
      label: DEAL_TYPE_LABELS[search.dealType as DealTypeFilter],
      removeKeys: ["dealType"],
    });
  }
  if (search.month) {
    chips.push({ key: "month", label: `月份：${search.month}`, removeKeys: ["month"] });
  }
  if (search.minPrice !== undefined) {
    chips.push({
      key: "minPrice",
      label: `最低 HK$${search.minPrice.toLocaleString()}`,
      removeKeys: ["minPrice"],
    });
  }
  if (search.maxPrice !== undefined) {
    chips.push({
      key: "maxPrice",
      label: `最高 HK$${search.maxPrice.toLocaleString()}`,
      removeKeys: ["maxPrice"],
    });
  }

  return chips;
}

function FilterChip({ label, removeKeys }: { label: string; removeKeys: string[] }) {
  return (
    <Link
      to="/transactions"
      search={(prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev };
        for (const key of removeKeys) {
          delete next[key];
        }
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

function handleTransactionShare(transaction: RecentTransaction) {
  const label = transaction.estates?.name_zh ?? "成交";
  const url = new URL(`${SITE_URL}/transactions`);
  url.searchParams.set("tx", transaction.id);
  void shareUrl(`${label} 成交記錄`, url.toString());
  track({ name: "transaction_share", payload: { transactionId: transaction.id } }, buildContext());
}

function TransactionsPage() {
  const search = Route.useSearch();
  const { transactions, estates, totalCount } = Route.useLoaderData();
  const filters = useTransactionFiltersState(search);
  const totalPages = Math.max(1, Math.ceil(totalCount / RESULT_LIMIT));
  const activeChips = buildActiveFilterChips(search, estates);
  const inquiryUrl = whatsappUrl("你好，我想查詢深井／青山公路／汀九近期成交及估價");
  const highlightedId = search.tx;

  // Scroll to and highlight the row a shared `?tx=<id>` link points at, once
  // the loader's data is on the page. A no-op if the row isn't in the
  // current (possibly filtered) result set.
  useEffect(() => {
    if (!highlightedId) return;
    document
      .getElementById(`tx-${highlightedId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedId, transactions]);

  // Mirrors listings.tsx's listing_search: fires on the resolved (post-loader)
  // search, so resultCount reflects the filters actually applied. Uses the
  // real totalCount (P7c pagination), not transactions.length -- the latter
  // is just the current page's row count, not the true match count.
  useEffect(() => {
    track(
      {
        name: "transaction_filter",
        payload: {
          dealType: search.dealType,
          districtSlug: search.district,
          month: search.month,
          resultCount: totalCount,
        },
      },
      buildContext({ districtSlug: search.district }),
    );
  }, [search.dealType, search.district, search.month, totalCount]);

  const sources = Array.from(
    new Set(transactions.map((t) => t.source).filter((value): value is string => Boolean(value))),
  );
  const latestVerifiedAt = transactions
    .map((t) => t.verified_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="bg-background">
      <PageHero
        eyebrow="晉誠地產最新成交"
        title="深井 青山公路 汀九近期成交"
        lead="集中近期屋苑成交資料，配合即時放盤和前線業主叫價，幫你判斷買樓租樓節奏。"
        actions={
          <Button asChild className="bg-coral text-coral-foreground hover:bg-primary-hover">
            <a href={inquiryUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 查成交及估價
            </a>
          </Button>
        }
      />

      <Container className="py-12">
        <div className="mb-6 rounded-lg border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold">篩選條件</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <TransactionFilterFields estates={estates} filters={filters} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={filters.apply}>套用篩選</Button>
            <Button onClick={filters.reset} variant="ghost" size="sm">
              清除全部
            </Button>
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.key} label={chip.label} removeKeys={chip.removeKeys} />
            ))}
            <Link
              to="/transactions"
              search={{ dealType: "all" }}
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
            >
              清除全部篩選
            </Link>
          </div>
        )}

        {transactions.length > 0 ? (
          <>
            <DataNote
              className="mb-4"
              source={sources.length > 0 ? sources.join("、") : "本行成交記錄"}
              asOf={latestVerifiedAt ? (formatHkDate(latestVerifiedAt) ?? undefined) : undefined}
              caveat="以上成交資料已經人手核實，惟實際成交詳情或因登記時間而有差異，僅供參考。"
            />
            <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">地區</th>
                    <th className="px-4 py-3 font-medium">屋苑</th>
                    <th className="px-4 py-3 font-medium">單位</th>
                    <th className="px-4 py-3 font-medium">類型</th>
                    <th className="px-4 py-3 font-medium">成交價</th>
                    <th className="px-4 py-3 font-medium">實用面積</th>
                    <th className="px-4 py-3 font-medium">實用呎價</th>
                    <th className="px-4 py-3 font-medium">
                      <span className="sr-only">分享</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transactions.map((transaction) => (
                    <TransactionRow
                      key={transaction.id}
                      transaction={transaction}
                      highlighted={transaction.id === highlightedId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <nav
                className="mt-6 flex items-center justify-center gap-3"
                aria-label="成交記錄分頁"
              >
                <Link
                  to="/transactions"
                  search={(prev: Record<string, unknown>) => ({
                    ...prev,
                    page: search.page - 1,
                  })}
                  aria-disabled={search.page === 1}
                  className={`inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium transition ${
                    search.page === 1
                      ? "pointer-events-none border-input text-muted-foreground opacity-40"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  上一頁
                </Link>
                <span className="text-sm text-muted-foreground">
                  第 {search.page} 頁，共 {totalPages} 頁
                </span>
                <Link
                  to="/transactions"
                  search={(prev: Record<string, unknown>) => ({
                    ...prev,
                    page: search.page + 1,
                  })}
                  aria-disabled={search.page === totalPages}
                  className={`inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium transition ${
                    search.page === totalPages
                      ? "pointer-events-none border-input text-muted-foreground opacity-40"
                      : "border-input hover:bg-accent"
                  }`}
                >
                  下一頁
                </Link>
              </nav>
            )}
          </>
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="暫未有成交資料"
            description={
              activeChips.length > 0
                ? "未有符合以上篩選條件嘅已核實成交，你可以調整篩選，或直接 WhatsApp 查詢指定屋苑的最新成交、估價和叫價。"
                : "若資料庫未有已核實嘅近期成交，頁面會保持可用。你可以直接 WhatsApp 查詢指定屋苑的最新成交、估價和叫價。"
            }
            action={
              activeChips.length > 0 ? (
                <Link
                  to="/transactions"
                  search={{ dealType: "all" }}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  清除篩選
                </Link>
              ) : undefined
            }
          />
        )}
      </Container>
    </div>
  );
}

function TransactionRow({
  transaction,
  highlighted,
}: {
  transaction: RecentTransaction;
  highlighted: boolean;
}) {
  const estate = transaction.estates;
  const districtSlug = estate?.district_slug;

  return (
    <tr
      id={`tx-${transaction.id}`}
      className={highlighted ? "bg-coral/10 ring-1 ring-inset ring-coral" : undefined}
    >
      <td className="px-4 py-3">{formatDate(transaction.deal_date)}</td>
      <td className="px-4 py-3">
        {districtSlug ? (DISTRICT_LABELS[districtSlug] ?? districtSlug) : "-"}
      </td>
      <td className="px-4 py-3">
        {estate?.slug ? (
          <Link
            to="/estate/$slug"
            params={{ slug: estate.slug }}
            className="font-semibold text-primary hover:underline"
          >
            {estate.name_zh}
          </Link>
        ) : (
          "-"
        )}
      </td>
      <td className="px-4 py-3">{transaction.unit ?? "-"}</td>
      <td className="px-4 py-3">{DEAL_TYPE_LABELS[transaction.deal_type]}</td>
      <td className="px-4 py-3">{formatPrice(transaction.price)}</td>
      <td className="px-4 py-3">{formatAreaCell(transaction.saleable_area)}</td>
      <td className="px-4 py-3">{formatPsf(transaction.saleable_psf)}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          onClick={() => handleTransactionShare(transaction)}
          aria-label={`分享${estate?.name_zh ?? ""}成交記錄`}
          className="rounded-full p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function formatDate(value: string | null) {
  return formatHkDate(value) ?? "-";
}

function formatPrice(value: number | null) {
  const man = formatManDisplay(value);
  return man ? `HK$${man}` : "-";
}

function formatAreaCell(value: number | null) {
  return formatArea(value) ?? "-";
}

function formatPsf(value: number | null) {
  // This local formatPsf takes an already-computed per-square-foot number (from
  // transaction.saleable_psf), not a (price, area) pair -- it maps onto
  // format.ts's formatHkd, not format.ts's formatPsf (which divides two inputs).
  const hkd = formatHkd(value);
  return hkd ? `HK${hkd}` : "-";
}
