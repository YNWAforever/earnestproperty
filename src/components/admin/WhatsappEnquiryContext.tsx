import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useEffect, useState } from "react";
import { getWhatsappAssignment, getWhatsappEnquiryQueue } from "@/lib/neon/whatsapp-assignment";
type Episode = {
  id: string;
  property: string | null;
  source: string | null;
  dealType: string | null;
  requestedStaffId: string | null;
  firstResponseAt: string | null;
  dueAt: string | null;
  review: boolean;
};
export function WhatsappEnquiryContext({
  conversationId,
  refreshKey,
  selectedId,
  onSelect,
}: {
  conversationId: string;
  refreshKey?: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getWhatsappAssignment>> | null>(
    null,
  );
  const [networkError, setNetworkError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setNetworkError(false);
    getWhatsappAssignment({ conversationId })
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        if (!cancelled) setNetworkError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey, retry]);
  if (networkError || result?.kind === "error") {
    const message = networkError
      ? "網絡暫時無法連接。"
      : result?.code === "unauthenticated"
        ? "登入已失效，請重新登入。"
        : result?.code === "forbidden"
          ? "沒有查看此對話分派證據的權限。"
          : result?.code === "not_found"
            ? "找不到此對話。"
            : result?.code === "schema_unavailable"
              ? "分派證據功能暫時未備妥。"
              : "未能載入查詢及分派證據。";
    return (
      <div role="alert" className="space-y-2 p-4 text-sm text-destructive">
        <p>
          {message}
          {result?.kind === "error" ? `（參考編號：${result.requestId}）` : null}
        </p>
        <button type="button" className="underline" onClick={() => setRetry((value) => value + 1)}>
          重新整理
        </button>
      </div>
    );
  }
  const context = result?.kind === "ok" ? result.context : null;
  if (!context) return null;
  const episodes = (context.enquiries ?? []) as Episode[];
  return (
    <section className="space-y-2 border-b bg-muted/20 p-4" aria-label="查詢及分派證據">
      <h3 className="font-semibold">查詢跟進</h3>
      <p className="text-xs text-muted-foreground">
        觀察模式建議：{context.proposedStaffId ?? "需要總台人工處理"}（{context.proposalReason}
        ）；尚未執行自動分派。
      </p>
      <p className="text-sm">
        已確認負責人：{String(context.confirmed_staff_id ?? "未經 WOZTELL 確認")} · 分派：
        {String(context.assignment_state ?? "未要求")}
      </p>
      {context.desired_staff_id ? (
        <p className="text-sm">要求分派至：{String(context.desired_staff_id)}（未必已生效）</p>
      ) : null}
      <label className="block text-sm">
        本次回覆對應查詢
        <select
          className="ml-2 rounded border p-2"
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">{episodes.length === 1 ? "自動對應唯一查詢" : "請選擇查詢"}</option>
          {episodes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.property ?? "一般查詢"} ·{" "}
              {e.dealType === "sale" ? "售" : e.dealType === "rent" ? "租" : "未指定交易"} ·{" "}
              {e.source} · {e.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {episodes.map((e) => (
        <article key={e.id} className="rounded border p-2 text-sm">
          <strong>
            {e.property ?? "一般查詢"} ·{" "}
            {e.dealType === "sale" ? "售" : e.dealType === "rent" ? "租" : "未指定交易"}
          </strong>{" "}
          · 來源 {e.source}
          <p>
            指定同事：{e.requestedStaffId ?? "沒有指定"} · {e.review ? "需要核實關聯" : "已有關聯"}
          </p>
          <p>
            首個人手回覆：{e.firstResponseAt ?? "尚無合資格證據"} · 服務期限：
            {e.dueAt ?? "尚未啟用服務政策"}
          </p>
        </article>
      ))}
      <p className="text-xs text-muted-foreground">
        服務期限與 WhatsApp 24 小時回覆窗口分開計算。接納發送不代表送達。
      </p>
    </section>
  );
}
export function WhatsappEnquiryQueue() {
  const { user, loading } = useNeonAuth();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getWhatsappEnquiryQueue>>>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    getWhatsappEnquiryQueue()
      .then((v) => {
        if (!cancelled) setRows(v);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);
  return (
    <section className="my-4 rounded border p-4">
      <h2 className="font-semibold">WhatsApp 查詢待辦</h2>
      {error ? (
        <p>未能載入；需要管理員或經理權限。</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            最多顯示 100 項；未確認分派、待人手回覆及需要核實的查詢。服務期限未設定時不計逾時。
          </p>
          {rows.map((r) => (
            <a
              className="my-2 block rounded border p-2 text-sm underline"
              key={String(r.id)}
              href={`/admin/whatsapp?conversation=${encodeURIComponent(String(r.conversation_id))}`}
            >
              {String(r.public_listing_no ?? "一般查詢")} ·{" "}
              {r.confirmed_staff_id ? "已確認分派" : "未確認分派"} ·{" "}
              {r.association_review ? "需要核實" : String(r.assignment_state ?? "待人手回覆")} ·{" "}
              {r.response_due_at ? `期限 ${String(r.response_due_at)}` : "期限未設定"}
            </a>
          ))}
        </>
      )}
    </section>
  );
}
