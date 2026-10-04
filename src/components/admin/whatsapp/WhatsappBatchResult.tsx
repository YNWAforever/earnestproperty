import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LinkBatchProgress } from "@/lib/admin/whatsapp-link-batch-client";
import { batchResultCsv, batchRowsOf } from "@/lib/admin/whatsapp-link-batch-client";

export function WhatsappBatchResult({ progress }: { progress: LinkBatchProgress }) {
  const [copyStatus, setCopyStatus] = useState<{ scope: string; message: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const results = batchRowsOf(progress);
  const successful = results.filter(
    (row) => (row.outcome === "created" || row.outcome === "reused") && row.code,
  );
  const codes = successful.map((row) => row.code);
  const copyScope = JSON.stringify([progress.batchId, codes]);
  const byKey = new Map(progress.rows.map((row) => [row.rowKey, row]));
  const sources = [
    ...new Set(
      successful
        .map((result) => byKey.get(result.rowKey)?.input.placementSource)
        .filter((source): source is NonNullable<typeof source> => Boolean(source)),
    ),
  ];
  const failureSources = [
    ...new Set(
      results
        .filter((row) => row.outcome === "blocked" || row.outcome === "failed")
        .flatMap((row) => {
          const source = byKey.get(row.rowKey)?.input.placementSource;
          return source ? [source] : [];
        }),
    ),
  ];
  async function copyAll() {
    const scope = copyScope;
    setCopying(true);
    setCopyStatus(null);
    try {
      await navigator.clipboard.writeText(
        codes.map((code) => `${window.location.origin}/w/${code}`).join("\n"),
      );
      setCopyStatus({ scope, message: "已複製全部已確認連結。" });
    } catch {
      setCopyStatus({ scope, message: "複製失敗，請逐行選取連結。" });
    } finally {
      setCopying(false);
    }
  }
  function download(source: (typeof sources)[number], category: "success" | "failure" = "success") {
    const blob = new Blob([batchResultCsv(progress, source, category)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `whatsapp-links-${source}-${category === "failure" ? "failures-" : ""}${progress.batchId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const counts = {
    created: results.filter((row) => row.outcome === "created").length,
    reused: results.filter((row) => row.outcome === "reused").length,
    blocked: results.filter((row) => row.outcome === "blocked").length,
    failed: results.filter((row) => row.outcome === "failed").length,
  };
  const unsubmitted = Math.max(0, progress.rows.length - results.length);
  return (
    <section aria-label="批次結果" className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">建立結果</h3>
      <p role="status" className="text-sm">
        已建立 {counts.created} · 重用 {counts.reused} · 被阻止 {counts.blocked} · 失敗{" "}
        {counts.failed} · 未提交 {unsubmitted}
      </p>
      <p className="text-xs text-muted-foreground break-all">
        Batch ID：{progress.batchId} · 已處理 {progress.nextChunk}/{progress.chunkIds.length} 批
      </p>
      {progress.uncertain ? (
        <p role="alert" className="text-sm text-amber-800">
          連線中斷，結果未確認。請先查回伺服器紀錄，再繼續同一批次；不要建立新批次。
        </p>
      ) : null}
      {successful.length ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={copying} onClick={() => void copyAll()}>
            複製全部已確認連結
          </Button>
          {sources.map((source) => (
            <Button key={source} variant="outline" onClick={() => download(source)}>
              匯出 {source} CSV
            </Button>
          ))}
        </div>
      ) : null}
      {failureSources.length ? (
        <div className="flex flex-wrap gap-2">
          {failureSources.map((source) => (
            <Button key={source} variant="outline" onClick={() => download(source, "failure")}>
              匯出 {source} 已確認失敗 CSV
            </Button>
          ))}
          <p className="w-full text-xs text-muted-foreground">
            只包含已確認被阻止或失敗的行；未提交及結果待核對的行不列作失敗。
          </p>
        </div>
      ) : null}
      {copyStatus?.scope === copyScope ? (
        <p role="status" className="text-sm">
          {copyStatus.message}
        </p>
      ) : null}
      <ul className="max-h-80 space-y-2 overflow-auto text-sm">
        {results.map((row) => (
          <li key={row.rowKey} className="rounded border p-2">
            <span className="font-medium">{row.outcome}</span> · {row.rowKey}
            {row.code ? <code className="ml-2 select-all">/w/{row.code}</code> : null}
            {row.reasonCode ? <span className="ml-2">{row.reasonCode}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
