import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/district/tsuen-wan")({
  head: () => ({
    meta: [{ title: "荃灣 Tsuen Wan 物業｜晉誠地產" }],
  }),
  component: () => (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-primary">荃灣 Tsuen Wan</h1>
      <p className="mt-4 text-muted-foreground">內容準備中。</p>
    </div>
  ),
});
