import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/blog")({
  head: () => ({ meta: [{ title: "市場分析 Blog｜晉誠地產" }] }),
  component: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-primary">市場分析</h1>
      <p className="mt-4 text-muted-foreground">深井 / 荃灣市場文章即將推出。</p>
    </div>
  ),
});
