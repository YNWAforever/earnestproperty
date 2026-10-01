import { EnquiryResolutionPanel } from "@/components/admin/whatsapp/EnquiryResolutionPanel";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useCallback, useEffect, useState } from "react";
import { getWhatsappAssignment, getWhatsappEnquiryQueue } from "@/lib/neon/whatsapp-assignment";
type Episode = {
  id: string;
  property: string | null;
  source: string | null;
  dealType: string | null;
  requestedStaffId: string | null;
  requestedStaffName: string | null;
  firstResponseAt: string | null;
  dueAt: string | null;
  review: boolean;
};
const assignmentStates: Record<string, string> = {
  pending: "等候處理",
  executing: "正在要求分派",
  unknown: "結果待核實",
  confirmed: "已確認",
  failed: "分派失敗",
  blocked: "已阻擋",
  superseded: "已由較新要求取代",
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
  const [resolutionId, setResolutionId] = useState<string | null>(null);
  const [resolutionBusy, setResolutionBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const refreshEvidence = useCallback(() => setRetry((value) => value + 1), []);
  useEffect(() => {
    let cancelled = false;
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
  const resolutionDialog = (
    <Dialog
      key="resolution-dialog"
      open={resolutionId !== null}
      onOpenChange={(open) => {
        if (!open && !resolutionBusy) setResolutionId(null);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>本次查詢例外修正</DialogTitle>
        <DialogDescription>
          只查看及修改本次查詢；儲存不會發送訊息或轉移整段對話。
        </DialogDescription>
        {resolutionId ? (
          <EnquiryResolutionPanel
            key={resolutionId}
            inquiryId={resolutionId}
            onBusyChange={setResolutionBusy}
            onReadback={refreshEvidence}
            onClose={() => setResolutionId(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
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
      <>
        <div role="alert" className="space-y-2 p-4 text-sm text-destructive">
          <p>
            {message}
            {result?.kind === "error" ? `（參考編號：${result.requestId}）` : null}
          </p>
          <button
            type="button"
            className="underline"
            onClick={() => setRetry((value) => value + 1)}
          >
            重新整理
          </button>
        </div>
        {resolutionDialog}
      </>
    );
  }
  const context = result?.kind === "ok" ? result.context : null;
  if (!context) return resolutionDialog;
  const episodes = (context.enquiries ?? []) as Episode[];
  return (
    <>
      <section
        className="max-h-32 shrink-0 space-y-2 overflow-y-auto border-b bg-muted/20 p-4"
        aria-label="查詢及分派證據"
      >
        <h3 className="font-semibold">查詢跟進</h3>
        <p className="text-xs text-muted-foreground">
          配對建議：
          {context.proposedStaffName ??
            (context.proposedStaffId ? "同事名稱待核實" : "需要總台人工處理")}
        </p>
        <p className="text-sm">
          已確認負責人：
          {context.confirmed_staff_name ??
            (context.confirmed_staff_id ? "負責同事名稱待核實" : "未經供應商確認")}
          {" · 分派："}
          {context.assignment_state
            ? (assignmentStates[context.assignment_state] ?? "狀態待核實")
            : "未要求"}
        </p>
        {context.desired_staff_id ? (
          <p className="text-sm">
            要求分派至：{context.desired_staff_name ?? "未命名同事"}（待確認）
          </p>
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
                {e.source}
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
              指定同事：
              {e.requestedStaffName ?? (e.requestedStaffId ? "指定同事名稱待核實" : "沒有指定")}
              {" · "}
              {e.review ? "需要核實關聯" : "已有關聯"}
            </p>
            {e.review ? (
              <button type="button" className="underline" onClick={() => setResolutionId(e.id)}>
                查看及修正本次查詢
              </button>
            ) : null}
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
      <details className="max-h-24 shrink-0 overflow-y-auto border-b px-4 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">支援診斷</summary>
        <p>配對原因：{context.proposalReason}</p>
        <p>建議同事 ID：{context.proposedStaffId ?? "—"}</p>
        <p>已確認同事 ID：{context.confirmed_staff_id ?? "—"}</p>
        <p>分派狀態代碼：{context.assignment_state ?? "—"}</p>
        {episodes.map((e) => (
          <p key={e.id}>
            查詢 ID：{e.id} · 指定同事 ID：{e.requestedStaffId ?? "—"}
          </p>
        ))}
      </details>
      {resolutionDialog}
    </>
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
