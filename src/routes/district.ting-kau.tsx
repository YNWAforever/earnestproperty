import { createFileRoute, Link } from "@tanstack/react-router";
import { Waves, Home, MessageCircle } from "lucide-react";

import { pageSeo } from "@/content/seo";

const VILLAS = [
  "觀海別墅",
  "嘉御龍庭",
  "汀九別墅",
  "帝華軒",
  "海濤花園",
  "青山公路汀九段低密度住宅",
];

export const Route = createFileRoute("/district/ting-kau")({
  head: () => ({
    meta: [
      { title: pageSeo.tingKau.title },
      { name: "description", content: pageSeo.tingKau.description },
    ],
  }),
  component: TingKauPage,
});

function TingKauPage() {
  return (
    <main className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">汀九 Ting Kau</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            汀九 Ting Kau · 青山公路低密度海景住宅
          </h1>
          <p className="mt-5 max-w-3xl text-muted-foreground">
            汀九位於荃灣與深井之間，沿青山公路面向汀九橋及藍巴勒海峽，主打低密度別墅、洋房和少量分層海景住宅。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <article className="rounded-lg border bg-card p-6">
          <Waves className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-2xl font-semibold">適合邊類買家</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            汀九適合重視私隱、泊車、海景和低密度生活的家庭。相比荃灣市中心，這裡商業配套較少，但換來更安靜的居住感；
            相比深井大型屋苑，汀九盤源更稀少，買賣前需要更仔細比較實用面積、管理費、車位和維修狀況。
          </p>
        </article>

        <article className="rounded-lg border bg-card p-6">
          <Home className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-2xl font-semibold">常見屋苑 / 住宅</h2>
          <ul className="mt-4 grid gap-2 text-sm">
            {VILLAS.map((villa) => (
              <li key={villa} className="rounded-md border px-3 py-2">
                {villa}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
        <div className="rounded-lg border bg-muted/30 p-6">
          <h2 className="text-2xl font-semibold">汀九睇樓 FAQ</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div>
              <h3 className="font-semibold">交通方便嗎？</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                主要靠青山公路巴士、小巴和自駕，往荃灣、深井、機場方向都成熟。
              </p>
            </div>
            <div>
              <h3 className="font-semibold">是否適合家庭？</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                適合想要海景、空間、車位和安靜生活的家庭，但需預留交通接駁時間。
              </p>
            </div>
            <div>
              <h3 className="font-semibold">盤源多嗎？</h3>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                低密度物業流通較少，建議預早講清預算、車位和面積要求。
              </p>
            </div>
          </div>
          <Link
            to="/contact"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <MessageCircle className="h-4 w-4" />
            WhatsApp 查詢汀九放盤
          </Link>
        </div>
      </section>
    </main>
  );
}
