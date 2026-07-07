import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { whatsappUrl } from "@/config/site";
import { fetchRecentTransactions, type RecentTransaction } from "@/lib/queries";

const DISTRICT_LABELS: Record<string, string> = {
  "sham-tseng": "深井",
  "ting-kau": "汀九",
  "tsuen-wan": "荃灣",
};

export const Route = createFileRoute("/transactions")({
  loader: async () => fetchRecentTransactions(24),
  head: () => ({
    meta: [
      { title: "成交快訊｜深井 青山公路 汀九近期成交｜晉誠地產" },
      {
        name: "description",
        content:
          "深井、青山公路、汀九成交快訊，查看近期屋苑成交價、實用面積及呎價，配合晉誠地產前線市場資訊。",
      },
    ],
  }),
  component: TransactionsPage,
});

function TransactionsPage() {
  const transactions = Route.useLoaderData();
  const inquiryUrl = whatsappUrl("你好，我想查詢深井／青山公路／汀九近期成交及估價");

  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-coral">成交快訊</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-5xl">
            深井 青山公路 汀九近期成交
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-8 text-muted-foreground">
            集中近期屋苑成交資料，配合即時放盤和前線業主叫價，幫你判斷買樓租樓節奏。
          </p>
          <Button asChild className="mt-6 bg-coral text-coral-foreground hover:bg-coral/90">
            <a href={inquiryUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" />
              WhatsApp 查成交及估價
            </a>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {transactions.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border bg-card shadow-card">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">日期</th>
                  <th className="px-4 py-3 font-medium">地區</th>
                  <th className="px-4 py-3 font-medium">屋苑</th>
                  <th className="px-4 py-3 font-medium">單位</th>
                  <th className="px-4 py-3 font-medium">成交價</th>
                  <th className="px-4 py-3 font-medium">實用面積</th>
                  <th className="px-4 py-3 font-medium">實用呎價</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {transactions.map((transaction) => (
                  <TransactionRow key={transactionKey(transaction)} transaction={transaction} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-8 text-center shadow-card">
            <ReceiptText className="mx-auto h-8 w-8 text-coral" />
            <h2 className="mt-4 text-xl font-semibold text-primary">暫未有成交資料</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-muted-foreground">
              若資料庫未有近期成交，頁面會保持可用。你可以直接 WhatsApp
              查詢指定屋苑的最新成交、估價和叫價。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: RecentTransaction }) {
  const estate = transaction.estates;

  return (
    <tr>
      <td className="px-4 py-3">{formatDate(transaction.deal_date)}</td>
      <td className="px-4 py-3">
        {DISTRICT_LABELS[transaction.districtSlug] ?? transaction.districtSlug}
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
      <td className="px-4 py-3">{formatPrice(transaction.price)}</td>
      <td className="px-4 py-3">{formatArea(transaction.saleable_area)}</td>
      <td className="px-4 py-3">{formatPsf(transaction.saleable_psf)}</td>
    </tr>
  );
}

function transactionKey(transaction: RecentTransaction) {
  return [
    transaction.districtSlug,
    transaction.estates?.slug,
    transaction.deal_date,
    transaction.unit,
    transaction.price,
  ].join("-");
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-HK").format(new Date(value)) : "-";
}

function formatPrice(value: number | null) {
  return value ? `HK$${(value / 10000).toLocaleString()}萬` : "-";
}

function formatArea(value: number | null) {
  return value ? `${value.toLocaleString()} 呎` : "-";
}

function formatPsf(value: number | null) {
  return value ? `HK$${value.toLocaleString()}` : "-";
}
