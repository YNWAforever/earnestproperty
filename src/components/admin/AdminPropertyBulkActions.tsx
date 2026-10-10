import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdminConfirmDialog } from "./AdminConfirmDialog";
import { applyAdminPropertyBulk } from "@/lib/neon/admin-property-bulk";
import type { BulkPropertyManagementInput } from "@/lib/neon/admin-property-bulk.types";
import type { ManagedPropertySummary } from "@/lib/neon/admin-properties.types";
import { propertyStatusLabels, existingOfferingDeals } from "@/lib/admin/property-management-ui";
import { runPropertyBulkChunks, type BulkClientResult } from "@/lib/admin/property-bulk-client";

const control = "h-11 rounded-md border bg-background px-3 text-sm";
type Scope = BulkPropertyManagementInput["scope"];
export function AdminPropertyBulkActions({
  rows,
  agents,
  disabled,
  isWorkspaceCurrent,
  onBusy,
  onSettled,
  onClear,
  onReload,
  onWhatsappLinks,
}: {
  rows: ManagedPropertySummary[];
  agents: { id: string; name: string | null; email: string | null }[];
  disabled: boolean;
  isWorkspaceCurrent: () => boolean;
  onBusy: (busy: boolean) => void;
  onSettled: (results: BulkClientResult[]) => void;
  onClear: () => void;
  onReload: () => void;
  /** Omitted for roles that cannot create links (agents), so no button is offered. */
  onWhatsappLinks?: (rows: ManagedPropertySummary[]) => void;
}) {
  const active = useRef(false);
  const lifetime = useRef(0);
  useLayoutEffect(() => {
    active.current = true;
    const epoch = ++lifetime.current;
    return () => {
      active.current = false;
      lifetime.current = epoch + 1;
    };
  }, []);
  const isCurrent = (epoch: number) =>
    active.current && lifetime.current === epoch && isWorkspaceCurrent();
  const [scope, setScope] = useState<Scope>("sale");
  const [actionType, setActionType] = useState("offline");
  const [agentId, setAgentId] = useState("");
  const [pending, setPending] = useState<{
    input: BulkPropertyManagementInput;
    rows: { propertyNo: string; before: string; offerCount: number }[];
    nextLabel: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BulkClientResult[]>([]);
  const [needsReload, setNeedsReload] = useState(false);
  const action: BulkPropertyManagementInput["action"] =
    actionType === "agent"
      ? { type: "agent", agentId: agentId || null }
      : {
          type: "status",
          status: actionType as "offline" | "active" | "draft" | "sold" | "rented",
        };
  const nextLabel =
    action.type === "status"
      ? propertyStatusLabels[action.status]
      : (agents.find((a) => a.id === action.agentId)?.name ??
        agents.find((a) => a.id === action.agentId)?.email ??
        "未指派代理");
  const previews = rows.map((row) => {
    const deals = scope === "all" ? existingOfferingDeals(row.offerings) : [scope];
    const offers = deals.map((deal) => row.offerings[deal]);
    let reason = row.unlinked
      ? "樓編尚未核實"
      : scope === "all" && !row.editableShared
        ? "沒有整個物業的修改權限"
        : offers.some((o) => !o)
          ? "沒有此類放盤，不會自動建立"
          : offers.some((o) => !o?.editable)
            ? "沒有修改權限"
            : "";
    if (
      !reason &&
      action.type === "status" &&
      action.status === "active" &&
      (offers.some((o) => !o?.title.trim()) ||
        offers.some((o) => !o || Number(o.dealType === "sale" ? o.price : o.rent) <= 0))
    )
      reason = "缺少標題或有效價格，請先補齊";
    const before = offers
      .filter((o) => o !== null)
      .map(
        (o) =>
          `${o!.dealType === "sale" ? "售" : "租"}：${action.type === "agent" ? (o!.agentName ?? "未指派代理") : (propertyStatusLabels[o!.status] ?? o!.status)}`,
      )
      .join("；");
    return { row, reason, before, offerCount: offers.filter(Boolean).length };
  });
  const ready = previews.filter((p) => !p.reason);
  async function submit() {
    const epoch = lifetime.current;
    if (!pending || busy || !isCurrent(epoch)) return;
    setBusy(true);
    onBusy(true);
    setResults([]);
    try {
      const completed = await runPropertyBulkChunks(
        pending.input,
        (input) => applyAdminPropertyBulk({ data: input }),
        (results) => {
          if (isCurrent(epoch)) setResults(results);
        },
        () => isCurrent(epoch),
      );
      if (!isCurrent(epoch)) return;
      setNeedsReload(completed.some((r) => r.uncertain));
      setPending(null);
      onSettled(completed);
    } finally {
      if (isCurrent(epoch)) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section aria-label="批量管理" className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-sm">已選 {rows.length} 個物業</strong>
        <fieldset
          disabled={disabled || busy || needsReload}
          className="flex flex-wrap items-center gap-2"
        >
          <select
            aria-label="批量修改範圍"
            className={control}
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as Scope);
              setActionType("offline");
            }}
          >
            <option value="sale">只改售盤</option>
            <option value="rent">只改租盤</option>
            <option value="all">整個物業下架（售及租）</option>
          </select>
          <select
            aria-label="批量操作"
            className={control}
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
          >
            <option value="offline">設為下架</option>
            {scope !== "all" && (
              <>
                <option value="active">設為公開</option>
                <option value="draft">設為草稿</option>
                <option value={scope === "sale" ? "sold" : "rented"}>
                  {scope === "sale" ? "標記已售" : "標記已租"}
                </option>
                <option value="agent">指定代理</option>
              </>
            )}
          </select>
          {actionType === "agent" && (
            <select
              aria-label="批量指定代理"
              className={control}
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">未指派代理</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.email ?? "未命名代理"}
                </option>
              ))}
            </select>
          )}
          <Button
            disabled={!ready.length}
            onClick={() =>
              setPending({
                input: {
                  scope,
                  action,
                  items: ready.map((p) => ({
                    propertyNo: p.row.propertyNo,
                    expectedVersion: p.row.version,
                  })),
                },
                rows: ready.map((p) => ({
                  propertyNo: p.row.propertyNo,
                  before: p.before,
                  offerCount: p.offerCount,
                })),
                nextLabel,
              })
            }
          >
            核對修改（{ready.length}）
          </Button>
          {onWhatsappLinks ? (
            <Button variant="outline" disabled={!rows.length} onClick={() => onWhatsappLinks(rows)}>
              建立 WhatsApp 連結（本頁已選 {rows.length} 個）
            </Button>
          ) : null}
          <Button variant="ghost" disabled={!rows.length} onClick={onClear}>
            取消勾選
          </Button>
        </fieldset>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        只處理本頁勾選項目。沒有相應放盤不會自動新增，售價及租金不會被此操作修改。
      </p>
      {previews.some((p) => p.reason) && (
        <details className="mt-2 text-sm text-amber-800">
          <summary>{previews.filter((p) => p.reason).length} 個物業未符合條件，將不會提交</summary>
          {previews
            .filter((p) => p.reason)
            .map((p) => (
              <p key={p.row.propertyNo}>
                #{p.row.propertyNo}：{p.reason}
              </p>
            ))}
        </details>
      )}
      {results.length > 0 && (
        <div role="status" className="mt-3 text-sm">
          <p>
            已成功 {results.filter((r) => r.ok).length} 個；
            {busy ? "處理中…" : `未成功或未提交 ${results.filter((r) => !r.ok).length} 個`}
          </p>
          {results.some((r) => !r.ok) && (
            <details open>
              <summary>查看處理結果</summary>
              <ul className="max-h-40 overflow-auto">
                {results
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <li key={r.propertyNo}>
                      #{r.propertyNo}：{r.error ?? "未能儲存，請重新核對"}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {needsReload && (
        <Button
          className="mt-2"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => {
            setNeedsReload(false);
            onClear();
            onReload();
          }}
        >
          重新載入並核對結果
        </Button>
      )}
      <AdminConfirmDialog
        open={!!pending}
        title="確認批量修改"
        description={`將修改 ${pending?.rows.length ?? 0} 個物業，共 ${pending?.rows.reduce((n, p) => n + p.offerCount, 0) ?? 0} 筆現有放盤。每個物業獨立儲存，失敗項目會保留原因。`}
        confirmLabel={`確認修改 ${pending?.rows.length ?? 0} 個物業`}
        confirmVariant={
          action.type === "status" && action.status !== "active" ? "destructive" : "default"
        }
        isPending={busy}
        disabled={disabled}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onConfirm={() => void submit()}
      >
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">樓編</th>
                <th>目前</th>
                <th>改為</th>
              </tr>
            </thead>
            <tbody>
              {pending?.rows.map((p) => (
                <tr key={p.propertyNo} className="border-t">
                  <td className="p-2">{p.propertyNo}</td>
                  <td>{p.before}</td>
                  <td>{pending.nextLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminConfirmDialog>
    </section>
  );
}
