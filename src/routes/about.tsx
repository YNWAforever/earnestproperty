import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin, MessageCircle, Store } from "lucide-react";

import { pageSeo } from "@/content/seo";

const SERVICES = [
  "買賣放盤",
  "租務配對",
  "業主估價",
  "深井屋苑比較",
  "汀九低密度住宅",
  "青山公路海景盤",
];

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: pageSeo.about.title },
      { name: "description", content: pageSeo.about.description },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">關於晉誠地產</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            深井物業專家，真盤源、即時回覆、持牌可靠
          </h1>
          <p className="mt-5 max-w-3xl text-muted-foreground">
            晉誠地產 Earnest Property（牌照號
            C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園，以及汀九和青山公路沿線住宅。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-2 lg:px-8">
        <article className="rounded-lg border bg-card p-6">
          <BadgeCheck className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">我哋係邊個</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            我哋係一間以深井為核心的本地地產代理，日常接觸同管理區內真實買賣、租務和業主委託。
            對每個屋苑座向、樓層景觀、車位、會所和近期叫價都有第一手理解。
          </p>
        </article>

        <article className="rounded-lg border bg-card p-6">
          <MessageCircle className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">我哋點解唔同</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            晉誠地產重視真盤源和即時回覆。買家可以直接問到單位狀態，業主可以得到貼近市場的放盤策略，租客亦可以快速預約合適睇樓時段。
          </p>
        </article>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-10 sm:px-6 lg:px-8">
        <div className="rounded-lg border bg-card p-6">
          <MapPin className="h-8 w-8 text-primary" />
          <h2 className="mt-4 text-xl font-semibold">服務範圍</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {SERVICES.map((service) => (
              <span key={service} className="rounded-full bg-muted px-3 py-1 text-sm">
                {service}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
          <div>
            <Store className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">門市</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              深井麗都花園地舖門市，歡迎業主、買家及租客預約到店傾盤。想先了解最新放盤，可直接
              WhatsApp 聯絡。
            </p>
          </div>
          <Link
            to="/contact"
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            聯絡晉誠地產
          </Link>
        </div>
      </section>
    </main>
  );
}
