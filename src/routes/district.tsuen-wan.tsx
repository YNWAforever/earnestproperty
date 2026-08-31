import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, TrainFront, MapPinned } from "lucide-react";

import { pageSeo, seo } from "@/content/seo";
import { buildContext, useTrackPageView } from "@/lib/analytics/events";

const AREAS = [
  {
    title: "荃灣市中心",
    text: "港鐵荃灣綫總站、南豐中心、荃灣廣場、愉景新城一帶，生活配套密集，適合想要鐵路和商場便利的買家。",
  },
  {
    title: "荃灣西",
    text: "西鐵 / 屯馬綫沿線連大型住宅群，往尖沙咀、九龍站及港島轉乘方便，近年新盤供應較集中。",
  },
  {
    title: "青山公路沿線",
    text: "由汀九、深井到青龍頭，主打海景、低密度和較高實用面積，適合換樓家庭及追求環境的客人。",
  },
];

export const Route = createFileRoute("/district/tsuen-wan")({
  head: () =>
    seo({
      title: pageSeo.tsuenWan.title,
      description: pageSeo.tsuenWan.description,
      path: pageSeo.tsuenWan.path,
      // Scope decision (P7a §0.2): orphaned (no nav/sitemap entry) but
      // previously indexable -- noindex it rather than silently reinstating
      // it into nav/sitemap, which is a content/IA decision this SEO-hygiene
      // pass has no mandate to make.
      noindex: true,
    }),
  component: TsuenWanPage,
});

function TsuenWanPage() {
  useTrackPageView(
    () => ({
      event: { name: "district_view", payload: { districtSlug: "tsuen-wan" } },
      context: buildContext({ districtSlug: "tsuen-wan" }),
    }),
    [],
  );
  return (
    <div className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">荃灣 Tsuen Wan</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            荃灣物業：港鐵、商場、海景生活圈一次比較
          </h1>
          <p className="mt-5 max-w-3xl text-muted-foreground">
            荃灣由港鐵荃灣綫總站到荃灣西，再伸延至青山公路深井、汀九一帶，選擇橫跨市中心鐵路盤、海景大屋苑同低密度住宅。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
        {AREAS.map((area) => (
          <article key={area.title} className="rounded-lg border bg-card p-5">
            <Building2 className="h-6 w-6 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">{area.title}</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{area.text}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-12 sm:px-6 md:grid-cols-2 lg:px-8">
        <article className="rounded-lg border bg-card p-6">
          <TrainFront className="h-7 w-7 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">交通點揀</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            想日日靠港鐵返工，荃灣市中心同荃灣西最直接；想用同等預算換取更大面積、海景或寧靜環境，就應比較深井及汀九。
            青山公路沿線靠巴士、小巴和自駕接駁，通往中環、尖沙咀、機場都成熟。
          </p>
        </article>
        <article className="rounded-lg border bg-card p-6">
          <MapPinned className="h-7 w-7 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">點樣比較荃灣同深井</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            荃灣市中心勝在鐵路和購物，深井勝在海景、屋苑尺度和生活節奏。若你需要學校、上班時間和預算同時平衡，可以先睇荃灣，再到深井、汀九作同日比較。
          </p>
        </article>
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-3 px-4 py-8 sm:px-6 lg:px-8">
          <Link
            to="/district/sham-tseng"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            深井地區攻略
          </Link>
          <Link
            to="/castle-peak-road/$segment"
            params={{ segment: "ting-kau" }}
            className="rounded-md border bg-background px-4 py-2 text-sm font-semibold"
          >
            汀九低密度住宅
          </Link>
          <Link
            to="/castle-peak-road"
            className="rounded-md border bg-background px-4 py-2 text-sm font-semibold"
          >
            青山公路沿線總覽
          </Link>
          <Link
            to="/listings"
            search={{ deal: "all", page: 1 }}
            className="rounded-md border bg-background px-4 py-2 text-sm font-semibold"
          >
            搜尋荃灣 / 深井放盤
          </Link>
        </div>
      </section>
    </div>
  );
}
