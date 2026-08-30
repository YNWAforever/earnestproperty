import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Text-only preview mockup for a transaction's social copy -- deliberately
 * NOT a rendered image. This project has no image-rendering pipeline
 * (no satori/@vercel-og/puppeteer) today; building one is separate future
 * work. This component exists so staff can review the AI-generated FB/IG
 * copy against the real deal facts before pasting it elsewhere by hand.
 */
export function TransactionSocialPreview({
  estateName,
  dealType,
  price,
  saleableArea,
  saleablePsf,
  dealDate,
  copyFb,
  copyIg,
}: {
  estateName: string;
  dealType: "sale" | "rent";
  price: number;
  saleableArea: number;
  saleablePsf: number;
  dealDate: string;
  copyFb: string | null;
  copyIg: string | null;
}) {
  const [tab, setTab] = useState<"fb" | "ig">("fb");
  const copy = tab === "fb" ? copyFb : copyIg;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">社交媒體文案預覽</h3>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={tab === "fb" ? "default" : "outline"}
            onClick={() => setTab("fb")}
          >
            Facebook
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "ig" ? "default" : "outline"}
            onClick={() => setTab("ig")}
          >
            Instagram
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-sm rounded-md border bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">預覽（非正式發布圖片，僅供內部參考）</p>
        <p className="mt-2 text-lg font-bold">{estateName}</p>
        <p className="text-sm text-muted-foreground">
          {dealType === "sale" ? "買賣" : "租賃"} · ${price.toLocaleString()} · {saleableArea} 呎 ·
          實呎 ${saleablePsf.toLocaleString()} · {dealDate}
        </p>
        <p className="mt-3 whitespace-pre-wrap text-sm">
          {copy || "尚未有文案，請使用旁邊嘅 AI 協作生成。"}
        </p>
      </div>
    </div>
  );
}
