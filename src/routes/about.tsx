import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "關於晉誠地產 Earnest Property" }] }),
  component: () => (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-bold text-primary">關於晉誠地產</h1>
      <p className="mt-6 text-muted-foreground leading-relaxed">
        晉誠地產 Earnest Property（牌照號 C-018613）紮根深井，專營碧堤半島、浪翠園、豪景花園、海韻花園、麗都花園等深井核心屋苑。我哋以「真盤源、即時回覆、持牌代理」為核心，為深井買家、租客、業主提供最熟悉、最可靠嘅地產服務。
      </p>
    </div>
  ),
});
