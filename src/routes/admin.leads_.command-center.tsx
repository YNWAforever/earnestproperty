import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { analyzeAdminLeadAiProfile, fetchCommandCenter } from "@/lib/neon/admin-data";
import type {
  CommandCenterData,
  CommandCenterFilterKey,
  CommandCenterRow,
} from "@/lib/neon/admin-data.types";

export const Route = createFileRoute("/admin/leads_/command-center")({
  head: () => ({
    meta: [{ title: "Lead Command Center｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: CommandCenter,
});

const FILTERS: { key: CommandCenterFilterKey; label: string }[] = [
  { key: "today", label: "今日要跟" },
  { key: "high_score", label: "高分 Leads" },
  { key: "unassigned", label: "未分配" },
  { key: "live_agent", label: "Live Agent" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "all", label: "全部" },
];

const STAGE_LABELS: Record<string, string> = {
  new: "新客",
  contacted: "已聯絡",
  viewing: "睇樓",
  negotiating: "傾緊",
  closed_won: "成交",
  closed_lost: "失單",
};

const REASON_LABELS: Record<string, string> = {
  OVERDUE_FOLLOWUP: "逾期跟進",
  RECENT_HANDOFF: "新 Live Agent 轉介",
  HIGH_SCORE_UNASSIGNED: "高分・未分配",
  NEW_UNASSIGNED_NEEDS_ANALYSIS: "新客・未分配・需 AI 分析",
  ACTIVE_WHATSAPP: "WhatsApp 進行中",
  BY_SCORE: "依分數排序",
  NEEDS_ANALYSIS: "需 AI 分析",
};

const WHATSAPP_BLOCKED_LABELS: Record<string, string> = {
  WOZTELL_DISABLED: "未設定 Woztell",
  CONTACT_OPTED_OUT: "客戶已 opt-out",
  OUTSIDE_24_HOUR_WINDOW: "逾 24 小時窗口",
  NO_PHONE: "缺少電話",
  NO_OPT_IN: "未有 WhatsApp opt-in",
  OPTED_OUT: "客戶已 opt-out",
  NO_CONVERSATION: "未連接 WhatsApp",
};

function matchesFilter(row: CommandCenterRow, key: CommandCenterFilterKey): boolean {
  switch (key) {
    case "today":
      return row.has_overdue_followup || row.priority.bucket <= 2;
    case "high_score":
      return (row.lead_score ?? 0) >= 60;
    case "unassigned":
      return row.assigned_agent_id == null;
    case "live_agent":
      return row.handoff_status != null;
    case "whatsapp":
      return row.whatsapp.linked === true;
    case "all":
    default:
      return true;
  }
}

function CommandCenter() {
  const { user } = useNeonAuth();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [filter, setFilter] = useState<CommandCenterFilterKey>("today");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CommandCenterRow | null>(null);
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    try {
      const result = (await fetchCommandCenter()) as CommandCenterData;
      if (requestId !== requestIdRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(errorText(err));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function runAnalysis(row: CommandCenterRow) {
    setBusy(true);
    try {
      await analyzeAdminLeadAiProfile({ data: { leadId: row.lead_id } });
      toast.success("已重新分析");
      await refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const visibleRows = useMemo(
    () => (data ? data.rows.filter((row) => matchesFilter(row, filter)) : []),
    [data, filter],
  );

  return (
    <AdminShell
      title="Lead Command Center"
      description="每日跟進工作台：誰要跟、為何重要、下一步、WhatsApp 狀態。"
    >
      {data ? <KpiStrip data={data} /> : null}

      <AdminToolbar
        filters={
          <>
            {FILTERS.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={filter === item.key ? "default" : "outline"}
                className="h-9"
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link to="/admin/leads">返回 CRM 列表</Link>
          </Button>
        }
      />

      {error ? <AdminError message={error} /> : null}
      {loading && !data ? <Skeleton className="h-72 w-full" /> : null}
      {data && visibleRows.length === 0 ? (
        <AdminEmptyState
          title="此佇列暫無 Leads"
          description="切換上方分段或選「全部」查看所有 Leads。"
        />
      ) : null}
      {data && visibleRows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">Lead</th>
                    <th className="p-3">意向 / 預算</th>
                    <th className="p-3">階段</th>
                    <th className="p-3">負責</th>
                    <th className="p-3">AI 分數・原因</th>
                    <th className="p-3">下一步</th>
                    <th className="p-3">WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.lead_id}
                      className="cursor-pointer border-b align-top last:border-b-0 hover:bg-accent/40"
                      onClick={() => setSelected(row)}
                    >
                      <td className="p-3">
                        <p className="font-medium">{row.name ?? "未命名"}</p>
                        <p className="text-xs text-muted-foreground">{row.phone ?? "—"}</p>
                      </td>
                      <td className="p-3">
                        <p>{row.intent ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{formatBudget(row)}</p>
                      </td>
                      <td className="p-3">{STAGE_LABELS[row.stage] ?? row.stage}</td>
                      <td className="p-3">{row.assigned_agent_name ?? "未分配"}</td>
                      <td className="p-3">
                        <span className="font-semibold tabular-nums">
                          {row.lead_score ?? "未分析"}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {REASON_LABELS[row.priority.reasonCode] ?? row.priority.reasonCode}
                        </p>
                      </td>
                      <td className="max-w-[16rem] p-3 text-xs">{row.next_best_action ?? "—"}</td>
                      <td className="p-3 text-xs">{whatsappLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AdminDetailPanel
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected?.name ?? "Lead"}
        description={
          selected
            ? `${STAGE_LABELS[selected.stage] ?? selected.stage}・${selected.phone ?? "—"}`
            : ""
        }
        footer={
          selected ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/leads">開啟完整 Lead</Link>
              </Button>
              {selected.whatsapp.linked ? (
                <Button asChild size="sm">
                  <Link to="/admin/whatsapp">開啟 WhatsApp 對話</Link>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (selected) void runAnalysis(selected);
                }}
              >
                重新 AI 分析
              </Button>
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">AI 摘要</h3>
              <p className="mt-1">{selected.summary ?? "未分析"}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">下一步建議</h3>
              <p className="mt-1">{selected.next_best_action ?? "—"}</p>
            </section>
            <section className="grid grid-cols-2 gap-2">
              <Detail
                label="AI 分數"
                value={selected.lead_score == null ? "未分析" : String(selected.lead_score)}
              />
              <Detail label="緊急度" value={selected.urgency ?? "—"} />
              <Detail label="時間線" value={selected.timeline ?? "—"} />
              <Detail label="預算" value={formatBudget(selected)} />
              <Detail label="WhatsApp" value={whatsappLabel(selected)} />
              <Detail label="逾期跟進" value={selected.has_overdue_followup ? "是" : "否"} />
            </section>
          </div>
        ) : null}
      </AdminDetailPanel>
    </AdminShell>
  );
}

function KpiStrip({ data }: { data: CommandCenterData }) {
  const items = [
    { label: "Hot leads", value: data.kpis.hot },
    { label: "逾期跟進", value: data.kpis.overdue },
    { label: "未分配", value: data.kpis.unassigned },
    { label: "新 Live Agent", value: data.kpis.handoffs },
    { label: "WhatsApp 受阻", value: data.kpis.whatsapp_blocked },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function formatBudget(row: CommandCenterRow) {
  if (row.budget_band) return row.budget_band;
  const min = row.budget_min ? `$${Number(row.budget_min).toLocaleString()}` : null;
  const max = row.budget_max ? `$${Number(row.budget_max).toLocaleString()}` : null;
  if (min && max) return `${min} – ${max}`;
  return min ?? max ?? "—";
}

function whatsappLabel(row: CommandCenterRow): string {
  if (row.whatsapp.linked === false) {
    return WHATSAPP_BLOCKED_LABELS[row.whatsapp.blockedReason] ?? row.whatsapp.blockedReason;
  }
  if (!row.whatsapp.canReply && row.whatsapp.blockedReason) {
    return `已連接・${WHATSAPP_BLOCKED_LABELS[row.whatsapp.blockedReason] ?? row.whatsapp.blockedReason}`;
  }
  return "可回覆";
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
