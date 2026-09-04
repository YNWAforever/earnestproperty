import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { COMMAND_CENTER_ROW_LIMIT } from "@/lib/neon/command-center";
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

const FILTERS: { key: CommandCenterFilterKey; label: string }[] = [
  { key: "today", label: "今日要跟" },
  { key: "high_score", label: "高分 Leads" },
  { key: "unassigned", label: "未分配" },
  { key: "live_agent", label: "Live Agent" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "all", label: "全部" },
];

const DEFAULT_QUEUE: CommandCenterFilterKey = "today";

// The active queue lives in the URL, so a reload, a browser Back from a lead, or a
// link pasted to a colleague all land on the same queue instead of silently
// resetting to 今日要跟. The default is normalised away to keep the URL clean.
function parseCommandCenterSearch(search: Record<string, unknown>): {
  queue?: CommandCenterFilterKey;
} {
  if (typeof search.queue !== "string") return {};
  const match = FILTERS.find((item) => item.key === search.queue);
  return match && match.key !== DEFAULT_QUEUE ? { queue: match.key } : {};
}

export const Route = createFileRoute("/admin/leads_/command-center")({
  validateSearch: parseCommandCenterSearch,
  head: () => ({
    meta: [{ title: "Lead Command Center｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: CommandCenter,
});

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

// Raw DB/AI enums used to print verbatim (buyer / high / 30_days) in a Chinese
// UI; unknown values still fall through to the raw string rather than hiding.
const INTENT_LABELS: Record<string, string> = {
  buyer: "買家",
  renter: "租客",
  tenant: "租客",
  seller: "賣家",
  owner: "業主",
  landlord: "業主",
  investor: "投資者",
};

const URGENCY_LABELS: Record<string, string> = {
  urgent: "緊急",
  high: "高",
  recent: "近期活躍",
  normal: "一般",
  medium: "中",
  low: "低",
};

const TIMELINE_LABELS: Record<string, string> = {
  immediate: "即時",
  asap: "即時",
  "30_days": "30 日內",
  "60_days": "60 日內",
  "90_days": "90 日內",
  "3_months": "3 個月內",
  "6_months": "6 個月內",
  "12_months": "12 個月內",
  flexible: "彈性",
  unknown: "未定",
};

function enumLabel(map: Record<string, string>, value: string | null | undefined) {
  if (!value) return "—";
  return map[value] ?? value;
}

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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<CommandCenterData | null>(null);
  const filter = search.queue ?? DEFAULT_QUEUE;
  const setFilter = (next: CommandCenterFilterKey) =>
    void navigate({
      search: { queue: next === DEFAULT_QUEUE ? undefined : next },
      resetScroll: false,
    });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Storing the id (not a snapshot of the row) is what lets the panel pick up a
  // reanalysis: `runAnalysis` refreshes `data`, and previously the panel kept
  // rendering the stale snapshot it was opened with -- the success toast fired
  // while the score/summary on screen still said 未分析, reading as a failure.
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  // 今日要跟 and 逾期跟進 are derived from `now` on the server, so a board opened
  // at 09:00 and worked from all morning showed 09:00 data at 15:00: leads that
  // became overdue, new handoffs and new WhatsApp replies simply never appeared,
  // and nothing on screen said how old the view was.
  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, 120_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, user]);

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

  const selected = useMemo(
    () => data?.rows.find((row) => row.lead_id === selectedId) ?? null,
    [data, selectedId],
  );

  return (
    <AdminShell
      title="Lead Command Center"
      description="每日跟進工作台：誰要跟、為何重要、下一步、WhatsApp 狀態。"
    >
      {data ? <KpiStrip data={data} /> : null}
      {data && data.rows.length >= COMMAND_CENTER_ROW_LIMIT ? (
        <p className="mb-3 text-xs text-muted-foreground">
          只涵蓋最近更新的 {COMMAND_CENTER_ROW_LIMIT} 個 Lead，較舊的未有載入。
        </p>
      ) : null}

      <AdminToolbar
        filters={
          <>
            {FILTERS.map((item) => (
              <Button
                key={item.key}
                type="button"
                size="sm"
                variant={filter === item.key ? "default" : "outline"}
                className="h-11 lg:h-9"
                aria-pressed={filter === item.key}
                onClick={() => setFilter(item.key)}
              >
                {filter === item.key ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {item.label}
              </Button>
            ))}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data ? (
              <span className="text-xs text-muted-foreground">
                最後更新 {formatClock(data.generated_at)}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 lg:h-9"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              重新整理
            </Button>
            <Button asChild variant="outline" size="sm" className="h-11 lg:h-9">
              <Link to="/admin/leads">返回 CRM 列表</Link>
            </Button>
          </div>
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
                    // A bare `<tr onClick>` was mouse-only, with no role, tabIndex or
                    // key handler, so the whole triage queue was unreachable from a
                    // keyboard or screen reader. `role="button"` on the row itself
                    // was tried in admin.leads.tsx and made it worse -- it replaces
                    // the row's cell semantics, so a screen reader hears only "開啟
                    // 詳情, button" and never the 意向/階段/分數/下一步 cells. A real
                    // focusable control inside one cell keeps every column announced.
                    <tr
                      key={row.lead_id}
                      className="border-b align-top last:border-b-0 hover:bg-accent/40"
                    >
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.lead_id)}
                          className="rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.name ?? "未命名"}
                        </button>
                        <p className="text-xs text-muted-foreground">{row.phone ?? "—"}</p>
                      </td>
                      <td className="p-3">
                        <p>{enumLabel(INTENT_LABELS, row.intent)}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {formatBudget(row)}
                        </p>
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
                      <td
                        className="max-w-[16rem] p-3 text-sm"
                        title={row.next_best_action ?? undefined}
                      >
                        {row.next_best_action ?? "—"}
                      </td>
                      <td className="p-3 text-sm">{whatsappLabel(row)}</td>
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
          if (!open) setSelectedId(null);
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
              {/* Both links used to drop the id and land on an unfiltered list,
                  so the agent had to find the record again by hand -- on the
                  board whose whole job is telling them which one to open. */}
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/leads" search={{ lead: selected.lead_id }}>
                  開啟完整 Lead
                </Link>
              </Button>
              {selected.whatsapp.linked ? (
                <Button asChild size="sm">
                  <Link
                    to="/admin/whatsapp"
                    search={{ conversation: selected.whatsapp.conversationId }}
                  >
                    開啟 WhatsApp 對話
                  </Link>
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
              <Detail label="緊急度" value={enumLabel(URGENCY_LABELS, selected.urgency)} />
              <Detail label="時間線" value={enumLabel(TIMELINE_LABELS, selected.timeline)} />
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
    { label: "高分 leads", value: data.kpis.hot },
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

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-HK", { timeStyle: "short" }).format(date);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
