import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "代理團隊｜晉誠地產" }] }),
  component: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-primary">代理團隊</h1>
      <p className="mt-4 text-muted-foreground">代理列表即將推出。</p>
    </div>
  ),
});
