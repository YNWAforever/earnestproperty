import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Clock3, Home, MessageCircle, ShieldCheck } from "lucide-react";

import { SITE_CONTACT } from "@/config/site";

const STANDARDS = [
  {
    icon: ShieldCheck,
    title: "持牌代理團隊",
    body: `晉誠地產持有香港地產代理公司牌照 ${SITE_CONTACT.licenceNo}，專營深井、汀九、荃灣西及青山公路沿線住宅。`,
  },
  {
    icon: Home,
    title: "熟盤源同座向",
    body: "日常跟進碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園等屋苑，協助買家比較景觀、樓齡、交通和管理費。",
  },
  {
    icon: Clock3,
    title: "即時回覆狀態",
    body: "新盤、減價盤、已租已售或可睇樓時間會盡快核實，避免客人浪費時間追問過期資訊。",
  },
];

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "持牌代理團隊｜晉誠地產" },
      {
        name: "description",
        content: "晉誠地產持牌代理團隊，專營深井、汀九、荃灣西及青山公路沿線住宅買賣租務。",
      },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <main className="bg-background">
      <section className="border-b bg-muted/30">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold text-primary">代理團隊</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">
            深井持牌代理，熟悉每個屋苑的實際盤源
          </h1>
          <p className="mt-5 max-w-3xl text-muted-foreground">
            晉誠地產 Earnest Property
            以深井門市為基地，服務碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園、汀九及青山公路沿線住宅。
            公司牌照號碼：{SITE_CONTACT.licenceNo}。
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-5 px-4 py-10 sm:px-6 md:grid-cols-3 lg:px-8">
        {STANDARDS.map(({ icon: Icon, title, body }) => (
          <article key={title} className="rounded-lg border bg-card p-6">
            <Icon className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">{title}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{body}</p>
          </article>
        ))}
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
          <div>
            <BadgeCheck className="h-8 w-8 text-primary" />
            <h2 className="mt-4 text-xl font-semibold">想搵區內堅盤源？</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              可直接 WhatsApp
              或到深井麗都花園地舖門市，講低預算、屋苑、租買用途及睇樓時間，我哋會按最新盤源跟進。
            </p>
          </div>
          <Link
            to="/contact"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            <MessageCircle className="h-4 w-4" />
            聯絡持牌代理
          </Link>
        </div>
      </section>
    </main>
  );
}
