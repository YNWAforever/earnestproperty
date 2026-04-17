import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

const ESTATES: Record<string, { name: string; units: number; year: number; psf: number; phases: number; developer: string }> = {
  "belvedere-garden": { name: "碧堤半島", units: 3200, year: 2002, psf: 9200, phases: 3, developer: "新鴻基地產" },
  "sea-crest-villa": { name: "浪翠園", units: 2584, year: 1998, psf: 8500, phases: 5, developer: "新世界發展" },
  "hong-kong-garden": { name: "豪景花園", units: 2499, year: 1990, psf: 7800, phases: 8, developer: "信和置業" },
  "sea-pearl-garden": { name: "海韻花園", units: 800, year: 1999, psf: 9000, phases: 1, developer: "嘉華國際" },
  "lido-garden": { name: "麗都花園", units: 600, year: 1980, psf: 8200, phases: 1, developer: "希慎興業" },
};

export const Route = createFileRoute("/estate/$slug")({
  loader: ({ params }) => {
    const estate = ESTATES[params.slug];
    if (!estate) throw notFound();
    return { estate, slug: params.slug };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.estate.name}｜晉誠地產屋苑專頁` },
      { name: "description", content: `${loaderData?.estate.name} ${loaderData?.estate.units} 個單位，平均實呎 $${loaderData?.estate.psf}。即時放盤、成交、FAQ。` },
    ],
  }),
  notFoundComponent: () => (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="text-2xl font-bold">屋苑未找到</h1>
      <Link to="/" className="mt-4 inline-block text-primary underline">回首頁</Link>
    </div>
  ),
  component: EstatePage,
});

function EstatePage() {
  const { estate } = Route.useLoaderData();
  return (
    <div className="bg-background">
      <section className="bg-gradient-to-br from-primary to-primary/70 py-16 text-primary-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm opacity-80">深井屋苑</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{estate.name}</h1>
          <p className="mt-3 text-base opacity-85">{estate.developer} · {estate.year} 年落成 · 共 {estate.units.toLocaleString()} 個單位</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <Stat label="平均實呎" value={`$${estate.psf.toLocaleString()}`} />
        <Stat label="單位總數" value={estate.units.toLocaleString()} />
        <Stat label="期數" value={`${estate.phases} 期`} />
        <Stat label="落成年份" value={String(estate.year)} />
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">完整屋苑資料、放盤、近期成交、平面圖、FAQ 即將推出。</p>
        <a
          href={`https://wa.me/852XXXXXXXX?text=你好，我想查詢${estate.name}物業`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block"
        >
          <Button className="bg-coral text-coral-foreground hover:bg-coral/90">
            <MessageCircle className="h-4 w-4" />
            WhatsApp 查詢 {estate.name}
          </Button>
        </a>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
    </div>
  );
}
