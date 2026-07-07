import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Building2, MessageCircle, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCastlePeakRoadSegment } from "@/content/castle-peak-road";
import { pageSeo, SITE_URL } from "@/content/seo";
import { whatsappUrl } from "@/config/site";
import {
  fetchDistrictTransactions,
  fetchEstatesByDistrict,
  type DistrictTransaction,
  type EstateSummary,
} from "@/lib/queries";

type TingKauLoaderData = {
  estates: EstateSummary[];
  transactions: DistrictTransaction[];
};

export const Route = createFileRoute("/district/ting-kau")({
  loader: async (): Promise<TingKauLoaderData> => {
    const [estates, transactions] = await Promise.all([
      fetchEstatesByDistrict("ting-kau"),
      fetchDistrictTransactions("ting-kau", 12),
    ]);

    return { estates, transactions };
  },
  head: () => ({
    meta: [
      { title: pageSeo.tingKau.title },
      { name: "description", content: pageSeo.tingKau.description },
      { property: "og:title", content: pageSeo.tingKau.title },
      { property: "og:description", content: pageSeo.tingKau.description },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}${pageSeo.tingKau.path}` }],
  }),
  component: TingKauPage,
});

function TingKauPage() {
  const { estates, transactions } = Route.useLoaderData();
  const segment = getCastlePeakRoadSegment("ting-kau");
  const inquiryUrl = whatsappUrl("你好，我想查詢汀九樓盤");
  const recentTransactions = transactions.slice(0, 6);

  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">青山公路汀九段</p>
          <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            汀九 Ting Kau · 低密度海景住宅
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            {segment?.description ??
              "汀九介乎荃灣與深井之間，主打低密度海景住宅、別墅及洋房，適合重視私隱、車位和青山公路生活圈的買家。"}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="bg-coral text-coral-foreground hover:bg-coral/90">
              <a href={inquiryUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-4 w-4" />
                WhatsApp 查詢汀九筍盤
              </a>
            </Button>
            <Button asChild variant="outline">
              <Link to="/listings" search={{ deal: "all", district: "ting-kau", page: 1 }}>
                搜尋汀九放盤
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <article className="space-y-4 text-base leading-8 text-muted-foreground">
          {(segment?.intro ?? []).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </article>
        <div className="rounded-lg border bg-card p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">常見汀九搜尋</h2>
          <div className="mt-4 grid gap-2 text-sm">
            {(segment?.featuredEstates ?? ["觀海別墅", "嘉御龍庭", "汀九別墅"]).map((estate) => (
              <span key={estate} className="rounded-md border bg-background px-3 py-2">
                {estate}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-coral">屋苑入口</p>
            <h2 className="mt-2 text-2xl font-bold text-primary">汀九屋苑</h2>
          </div>
          <Link
            to="/castle-peak-road/$segment"
            params={{ segment: "ting-kau" }}
            className="text-sm font-semibold text-primary hover:underline"
          >
            查看青山公路汀九指南
          </Link>
        </div>

        {estates.length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {estates.map((estate) => (
              <Link
                key={estate.slug}
                to="/estate/$slug"
                params={{ slug: estate.slug }}
                className="rounded-lg border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-elegant"
              >
                <Building2 className="h-6 w-6 text-coral" />
                <h3 className="mt-4 text-lg font-semibold text-primary">{estate.name_zh}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {(estate.total_units ?? 0).toLocaleString()} 個單位
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="暫未有汀九屋苑資料"
            text="資料庫未建立汀九屋苑時，頁面會保持可用。可直接 WhatsApp 查詢未公開汀九盤源。"
            cta="WhatsApp 查詢汀九屋苑"
            href={inquiryUrl}
          />
        )}
      </section>

      <section className="border-y bg-card">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">成交快訊</p>
          <h2 className="mt-2 text-2xl font-bold text-primary">汀九近期成交</h2>
          {recentTransactions.length > 0 ? (
            <div className="mt-6 overflow-hidden rounded-lg border bg-background">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">日期</th>
                    <th className="px-4 py-3 font-medium">屋苑</th>
                    <th className="px-4 py-3 font-medium">成交價</th>
                    <th className="px-4 py-3 font-medium">實呎</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentTransactions.map((transaction) => (
                    <tr key={`${transaction.deal_date}-${transaction.unit}`}>
                      <td className="px-4 py-3">{formatDate(transaction.deal_date)}</td>
                      <td className="px-4 py-3">{transaction.estates?.name_zh ?? "-"}</td>
                      <td className="px-4 py-3">{formatPrice(transaction.price)}</td>
                      <td className="px-4 py-3">{formatPsf(transaction.saleable_psf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<ReceiptText className="h-6 w-6" />}
              title="暫未有汀九成交資料"
              text="未有近期成交時不會報錯。想了解最新叫價、實收價或銀行估價，可直接聯絡門市。"
              cta="WhatsApp 查詢汀九成交"
              href={inquiryUrl}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  cta,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="mt-6 rounded-lg border bg-card p-6 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">{text}</p>
      <Button asChild className="mt-5 bg-coral text-coral-foreground hover:bg-coral/90">
        <a href={href} target="_blank" rel="noopener noreferrer">
          {cta}
        </a>
      </Button>
    </div>
  );
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-HK").format(new Date(value)) : "-";
}

function formatPrice(value: number | null) {
  return value ? `$${(value / 10000).toLocaleString()}萬` : "-";
}

function formatPsf(value: number | null) {
  return value ? `$${value.toLocaleString()}` : "-";
}
