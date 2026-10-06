import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWebsiteTrackingCoverage, previewCoverageBackfill } from "@/lib/neon/whatsapp-coverage";
import type { WebsiteTrackingCoverage } from "@/lib/neon/whatsapp-coverage.types";
import {
  linkBatchProgressKey,
  type LinkBatchProgress,
} from "@/lib/admin/whatsapp-link-batch-client";
import { staffActionErrorText } from "@/components/admin/admin-error-text";

export function WhatsappCoveragePanel({
  actorScope,
  revision,
}: {
  actorScope: string;
  revision: number;
}) {
  const [dealType, setDealType] = useState<"sale" | "rent" | "">("");
  const [draftQ, setDraftQ] = useState("");
  const [q, setQ] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [coverage, setCoverage] = useState<WebsiteTrackingCoverage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWebsiteTrackingCoverage({
      dealType: dealType || undefined,
      q: q || undefined,
      missingOnly,
    })
      .then((result) => {
        if (!cancelled) {
          setCoverage(result);
          setSelected([]);
          setError("");
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(staffActionErrorText(cause, "覆蓋資料未能載入"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dealType, q, missingOnly, revision]);
  async function preview() {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      if (sessionStorage.getItem(linkBatchProgressKey(actorScope)))
        throw new Error("先處理上方既有批次，再預覽補建。");
      const result = await previewCoverageBackfill(selected);
      const progress: LinkBatchProgress = {
        batchId: result.preview.batchId,
        rows: result.rows,
        preview: result.preview,
        chunkIds: Array.from({ length: Math.ceil(result.rows.length / 50) }, () =>
          crypto.randomUUID(),
        ),
        nextChunk: 0,
        completed: [],
        uncertain: false,
      };
      sessionStorage.setItem(linkBatchProgressKey(actorScope), JSON.stringify(progress));
      window.location.reload();
    } catch (cause) {
      setError(staffActionErrorText(cause, "補建預覽未完成"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="網站追蹤覆蓋" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">網站追蹤覆蓋</h2>
      <p className="text-sm">
        現時公開租售 {coverage?.eligibleOffers ?? "—"} · 有 /w/ 追蹤{" "}
        {coverage?.coveredOffers ?? "—"} · 未覆蓋 {coverage?.missingOffers ?? "—"} · 衝突待處理{" "}
        {coverage?.conflictedOffers ?? "—"}
      </p>
      <p className="text-xs text-muted-foreground">
        核對時間：{coverage?.checkedAt ? new Date(coverage.checkedAt).toLocaleString("zh-HK") : "—"}
        。 網站首頁、搜尋和詳情共用 website:primary；外部平台刊登仍需人工核對。 無 /w/
        時公開頁使用帶樓編及租售的聯絡後備，後備不等同完整追蹤。
      </p>
      {coverage && !coverage.trackingEnabled ? (
        <p role="status" className="text-sm">
          追蹤功能目前停用；公開頁使用後備聯絡，補建預覽暫不可用。
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQ(draftQ.trim());
          }}
        >
          <Input
            aria-label="搜尋覆蓋樓編"
            placeholder="公開樓編"
            value={draftQ}
            onChange={(event) => setDraftQ(event.target.value)}
          />
          <Button variant="outline" disabled={loading || busy}>
            搜尋
          </Button>
        </form>
        <label className="text-sm">
          租售
          <select
            className="ml-2 min-h-11 rounded border bg-background px-2"
            value={dealType}
            onChange={(event) => setDealType(event.target.value as "sale" | "rent" | "")}
          >
            <option value="">全部</option>
            <option value="sale">出售</option>
            <option value="rent">出租</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(event) => setMissingOnly(event.target.checked)}
          />
          只看未有網站連結
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm">
          正在核對覆蓋…
        </p>
      ) : null}
      {coverage?.truncated ? (
        <p className="text-sm">僅顯示首 1000 筆，請按樓編或租售縮小範圍。</p>
      ) : null}
      {coverage && !loading ? (
        <ul className="max-h-64 space-y-1 overflow-auto text-sm">
          {coverage.items.map((item) => (
            <li key={item.propertyId} className="flex items-center gap-2 rounded border p-2">
              {item.status === "missing" ? (
                <input
                  type="checkbox"
                  aria-label={`選擇補建 ${item.publicListingNo} ${item.dealType}`}
                  checked={selected.includes(item.propertyId)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.propertyId]
                        : current.filter((id) => id !== item.propertyId),
                    )
                  }
                />
              ) : null}
              <span>
                {item.publicListingNo} · {item.dealType === "sale" ? "售" : "租"} ·
                {item.status === "covered"
                  ? "已有追蹤"
                  : item.status === "missing"
                    ? "未覆蓋"
                    : "衝突待處理"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {coverage?.items.some((item) => item.status === "missing") ? (
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() =>
            setSelected(
              coverage.items
                .filter((item) => item.status === "missing")
                .map((item) => item.propertyId),
            )
          }
        >
          選取本頁未覆蓋
        </Button>
      ) : null}
      <Button
        disabled={busy || loading || !selected.length || !coverage?.trackingEnabled}
        onClick={() => void preview()}
      >
        預覽補建 {selected.length} 筆
      </Button>
      <p className="text-xs text-muted-foreground">
        預覽只檢查並保存待確認批次；必須在上方再次核對及明確提交，才會建立連結。
      </p>
    </section>
  );
}
