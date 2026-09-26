import type { LinkBatchProgress } from "@/lib/admin/whatsapp-link-batch-client";
import { batchRowsOf } from "@/lib/admin/whatsapp-link-batch-client";

export function WhatsappBatchResult({ progress }: { progress: LinkBatchProgress }) {
  const results = batchRowsOf(progress);
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
