import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SyncWorkspace,
  SyncOperationInput,
  SyncHistoryRow,
  SyncOperationResult,
} from "@/lib/neon/admin-property-sync.types";
import { Button } from "@/components/ui/button";
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) : "未有紀錄";
const stageLabels: Record<string, string> = {
  collection: "採集",
  ingestion: "匯入",
  publication: "上架",
  verification: "驗證",
};
const statuses: Record<string, string> = {
  pending: "未開始",
  running: "處理中",
  succeeded: "完成",
  failed: "失敗",
  blocked: "待核實",
  unknown: "結果待核實",
  cancelled: "已取消",
};
export interface PropertySyncWorkspaceProps {
  roles: string[];
  actorKey?: string;
  reconcile?: (idempotencyKey: string) => Promise<SyncOperationResult>;
  initialData?: SyncWorkspace;
  load: (cursor?: SyncWorkspace["nextCursor"]) => Promise<SyncWorkspace>;
  request: (input: SyncOperationInput) => Promise<{ runId: string; status: string }>;
}
export function PropertySyncWorkspace({
  roles,
  actorKey,
  reconcile,
  initialData,
  load,
  request,
}: PropertySyncWorkspaceProps) {
  const allowed = roles.some((r) => ["admin", "manager"].includes(r));
  const admin = roles.includes("admin");
  const [data, setData] = useState(initialData ?? null),
    [loading, setLoading] = useState(!initialData),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [pendingKey, setPendingKey] = useState<string | null>(null);
  const preservePending = useCallback(
    (value: string | null) => {
      setPendingKey(value);
      if (!actorKey) return;
      try {
        const key = "earnest-property-sync-pending:" + actorKey;
        if (value) sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
      } catch {
        // Storage may be unavailable; keep the in-memory unknown outcome locked.
      }
    },
    [actorKey],
  );
  useEffect(() => {
    if (!admin || !actorKey) return;
    try {
      const value = sessionStorage.getItem("earnest-property-sync-pending:" + actorKey);
      if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        setPendingKey(value);
        setUncertain(true);
        setNotice("結果待核實，請勿重複提交");
      }
    } catch {
      // Reading storage does not authorize a retry or change server evidence.
    }
  }, [admin, actorKey]);
  const latch = useRef(false);
  const generation = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const refresh = useCallback(async (cursor?: SyncWorkspace["nextCursor"]) => {
    const token = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadRef.current(cursor);
      if (token === generation.current)
        setData((previous) =>
          cursor && previous ? { ...next, history: [...previous.history, ...next.history] } : next,
        );
    } catch {
      if (token === generation.current) setError("未能讀取同步紀錄，請重新載入。");
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const requestGeneration = generation;
    if (allowed && !initialData) void refresh();
    return () => {
      requestGeneration.current++;
    };
  }, [allowed, initialData, refresh]);
  const run = async (
    source: string,
    operation: SyncOperationInput["operation"],
    row?: SyncHistoryRow,
  ) => {
    if (!admin || latch.current || uncertain) return;
    latch.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const idempotencyKey = crypto.randomUUID();
    preservePending(idempotencyKey);
    try {
      const result = await request({
        source: source as SyncOperationInput["source"],
        operation,
        runId: row?.id,
        idempotencyKey,
      });
      if (result.status === "accepted") {
        preservePending(null);
        setNotice("已提交工作流程，請查看階段進度。");
      } else if (result.status === "failed") {
        preservePending(null);
        setError("同步失敗，保留現有資料");
      } else {
        setUncertain(true);
        setNotice("結果待核實，請勿重複提交");
      }
      await refresh();
    } catch {
      setUncertain(true);
      setNotice("結果待核實，請勿重複提交");
    } finally {
      latch.current = false;
      setBusy(false);
    }
  };
  const reconcilePending = async () => {
    if (!admin || !reconcile || !pendingKey || latch.current) return;
    latch.current = true;
    setBusy(true);
    try {
      const result = await reconcile(pendingKey);
      if (result.reconciled) {
        preservePending(null);
        setUncertain(false);
        setNotice(
          result.state === "failed"
            ? "工作流程未被接收，請查看同步紀錄。"
            : "已核對工作流程結果，請查看各階段紀錄。",
        );
        await refresh();
      } else {
        setNotice(
          ["running", "pending"].includes(result.state)
            ? "工作流程已接收，等待完成；請稍後再核對。"
            : "結果待核實，請勿重複提交",
        );
      }
    } catch {
      setNotice("結果待核實，請勿重複提交");
    } finally {
      latch.current = false;
      setBusy(false);
    }
  };
  if (!allowed) return <p role="alert">你沒有權限查看全公司盤源同步。請在所屬樓盤查看來源紀錄。</p>;
  return (
    <section aria-label="盤源同步" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          採集、匯入及上架分階段處理；待核實候選不會自動撤盤。
        </p>
        <Button variant="outline" disabled={loading || busy} onClick={() => void refresh()}>
          重新載入
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive p-3">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {admin && uncertain && pendingKey && reconcile && (
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => void reconcilePending()}
        >
          核對工作流程結果
        </Button>
      )}
      {loading && !data && <p role="status">正在讀取同步紀錄…</p>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.cards.map((card) => (
              <article key={card.label} className="rounded-xl border bg-card p-4 space-y-3">
                <h2 className="text-lg font-semibold">{card.label}</h2>
                <p className="font-medium">{card.message}</p>
                {!card.connected && <p>未接通</p>}
                <dl className="text-sm space-y-2">
                  <div>
                    <dt>最後成功採集</dt>
                    <dd>{date(card.lastCollectionAt)}</dd>
                  </div>
                  <div>
                    <dt>最後完整匯入</dt>
                    <dd>{date(card.lastAcceptedFullAt)}</dd>
                  </div>
                  <div>
                    <dt>最後上架</dt>
                    <dd>{date(card.lastPublishedAt)}</dd>
                  </div>
                  <div>
                    <dt>廣告記錄</dt>
                    <dd>{card.advertisements ?? "待核實"}</dd>
                  </div>
                  <div>
                    <dt>待上架物業</dt>
                    <dd>{card.backlog ?? "待核實"}</dd>
                  </div>
                </dl>
                {card.branchEvidence && (
                  <p className="text-sm">
                    已讀頁數：{String(card.branchEvidence.pagesRead ?? "待核實")} · 終頁：
                    {card.branchEvidence.terminalVerified === true ? "已核實" : "待核實"}
                  </p>
                )}
                {card.source === "propertyhk" && (
                  <p className="text-xs text-muted-foreground">
                    三分行共同使用完整匯入基準；待上架數為合併來源總數。
                  </p>
                )}
                {!card.capability.enabled && <p className="text-sm">{card.capability.reason}</p>}
                {admin && !card.branch && (
                  <Button
                    className="w-full"
                    disabled={busy || uncertain || !card.capability.enabled}
                    onClick={() => void run(card.source, "collect")}
                  >
                    立即同步
                  </Button>
                )}
              </article>
            ))}
          </div>
          <h2 className="text-lg font-semibold">同步紀錄</h2>
          {!data.history.length && <p>未有同步流程紀錄；完整匯入及上架結果會分開核實。</p>}
          <div className="space-y-4">
            {data.history.map((row) => (
              <article className="rounded-xl border p-4 space-y-3" key={row.id}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">
                    {row.source === "propertyhk" ? "Property.hk 三分行" : "28Hse"} ·{" "}
                    {date(row.started_at)}
                  </h3>
                  <span>
                    {row.dispatch_status === "unknown" ||
                    (row.dispatch_status === "failed" && !row.finished_at)
                      ? "結果待核實，請勿重複提交"
                      : row.dispatch_status === "failed" || row.error_code
                        ? "同步失敗，保留現有資料"
                        : null}
                  </span>
                </div>
                <ol className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Object.entries(stageLabels).map(([key, label]) => (
                    <li key={key}>
                      <span>{label}：</span>
                      <strong>{statuses[row.stages[key]?.status ?? "pending"]}</strong>
                      {key === "collection" && row.stages[key]?.pagesRead !== undefined && (
                        <p className="text-xs">
                          已讀 {row.stages[key].pagesRead} 頁；失敗{" "}
                          {row.stages[key].pagesFailed ?? 0} 頁
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                <dl className="flex flex-wrap gap-5 text-sm">
                  {[
                    ["canonicalCreated", "新增物業"],
                    ["canonicalUpdated", "更新物業"],
                    ["published", "已上架"],
                    ["held", "待核實"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{row.counts[key] ?? "未有結果"}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  {row.dispatch_status === "failed" && row.finished_at && !row.request_asset
                    ? "工作流程未被接收；請管理員核對接駁設定後再提交同步。"
                    : "等待核實，暫不下架。失敗後可按階段重試，沿用原採集證據。"}
                </p>
                {admin && row.request_asset && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        uncertain ||
                        !data.cards.find((c) => c.source === row.source)?.capability.enabled
                      }
                      onClick={() => void run(row.source, "ingestion", row)}
                    >
                      重試匯入
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        uncertain ||
                        !row.receipt_id ||
                        !data.cards.find((c) => c.source === row.source)?.capability.enabled
                      }
                      onClick={() => void run(row.source, "publication", row)}
                    >
                      重試上架
                    </Button>
                  </div>
                )}
                <details className="text-xs break-all">
                  <summary>支援診斷</summary>
                  <dl>
                    <dt>Run</dt>
                    <dd>{row.id}</dd>
                    <dt>Commit</dt>
                    <dd>{row.git_sha ?? "未有紀錄"}</dd>
                    <dt>Receipt</dt>
                    <dd>{row.receipt_id ?? "未有紀錄"}</dd>
                    <dt>私有證據識別</dt>
                    <dd>{row.request_asset ?? "未有紀錄"}</dd>
                    <dt>錯誤代碼</dt>
                    <dd>{row.error_code ?? "未有錯誤代碼"}</dd>
                  </dl>
                </details>
              </article>
            ))}
          </div>
          {data.nextCursor && (
            <Button
              variant="outline"
              disabled={loading || busy}
              onClick={() => void refresh(data.nextCursor)}
            >
              載入較早紀錄
            </Button>
          )}
          <details className="rounded-xl border p-4">
            <summary>進階設定</summary>
            <p className="mt-3 text-sm">
              工作流程接駁由管理員在部署平台設定。此頁只顯示可用狀態，不讀取或顯示憑證。
            </p>
            <p className="text-sm">
              PROPERTY_SYNC_ADMIN_DISPATCH_ENABLED · PROPERTY_SYNC_WORKFLOW_TOKEN ·
              PROPERTY_SYNC_EXPECTED_BRANCH
            </p>
          </details>
        </>
      )}
    </section>
  );
}
