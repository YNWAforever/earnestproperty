import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/district/sham-tseng")({
  head: () => ({
    meta: [
      { title: "深井 Sham Tseng 物業｜晉誠地產地區專頁" },
      { name: "description", content: "深井屋苑、交通、校網 62、近 12 個月成交數據及在售在租放盤一覽。" },
    ],
  }),
  component: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-primary">深井 Sham Tseng 地區專頁</h1>
      <p className="mt-4 text-muted-foreground">即將推出 — 包括交通時間、校網 62、12 個月成交走勢、區內筍盤。</p>
    </div>
  ),
});
