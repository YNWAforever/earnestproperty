import { adminErrorMessage } from "@/components/admin/admin-error-text";
import { WhatsappEnquiryQueue } from "@/components/admin/WhatsappEnquiryContext";
import { stageLabels as STAGE_LABELS, aiScoreLabel } from "@/lib/admin/crm-presentation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { useStaffSession } from "@/components/admin/staff-session";
import { COMMAND_CENTER_ROW_LIMIT } from "@/lib/neon/command-center";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  BACKGROUND_READ_ROLES,
  canApplyBackgroundRead,
  createBackgroundReadGate,
  rowForOpenPanel,
} from "@/lib/admin/background-refresh";
import { MIN_VISIBLE_INTERVAL_MS, useVisibleInterval } from "@/lib/admin/use-visible-interval";
import { BACKGROUND_READ_TIMEOUT_MS, withTimeout } from "@/lib/admin/with-timeout";
import {
  analyzeAdminLeadAiProfile,
  fetchCommandCenter,
  fetchCommandCenterInBackground,
} from "@/lib/neon/admin-data";
import type {
  CommandCenterData,
  CommandCenterFilterKey,
  CommandCenterRow,
} from "@/lib/neon/admin-data.types";

const FILTERS: { key: CommandCenterFilterKey; label: string }[] = [
  { key: "today", label: "今日要跟" },
  { key: "high_score", label: "AI 高分查詢" },
  { key: "unassigned", label: "未分配" },
  { key: "live_agent", label: "線上客服" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "all", label: "全部" },
];

const DEFAULT_QUEUE: CommandCenterFilterKey = "all";

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
    meta: [{ title: "跟進工作台｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: CommandCenter,
});

const REASON_LABELS: Record<string, string> = {
  OVERDUE_FOLLOWUP: "逾期跟進",
  RECENT_HANDOFF: "新線上客服轉介 轉介",
  HIGH_SCORE_UNASSIGNED: "AI 高分・未分配",
  NEW_UNASSIGNED_NEEDS_ANALYSIS: "新客・未分配・需 AI 分析",
  ACTIVE_WHATSAPP: "WhatsApp 進行中",
  BY_SCORE: "依 AI 分數排序",
  NEEDS_ANALYSIS: "需 AI 分析",
};

// Raw DB/AI enums used to print verbatim (buyer / high / 30_days) in a Chinese
// UI; unknown values still fall through to the raw string rather than hiding.
const INTENT_LABELS: Record<string, string> = {
  unknown: "待確認",
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
  CONTACT_OPTED_OUT: "客戶已退出推廣",
  OUTSIDE_24_HOUR_WINDOW: "逾 24 小時窗口",
  NO_PHONE: "缺少電話",
  NO_OPT_IN: "未有 WhatsApp 推廣同意",
  OPTED_OUT: "客戶已退出推廣",
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
  // Let the poll see a user-started read (重新整理, a reanalysis) and stay out of its way.
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // The poll reads only for the roles the board's read accepts, taken from the staff session the
  // shell already loaded (no request of its own), and stops after a refused background read
  // until a user read succeeds.
  const { session: staffSession } = useStaffSession(user?.id ?? null);
  const staffRoles = staffSession?.status === "ok" ? staffSession.roles : null;
  const [pollGate] = useState(() => createBackgroundReadGate(BACKGROUND_READ_ROLES.commandCenter));

  const refresh = useCallback(
    async (options: { background?: boolean } = {}) => {
      if (!user) return;
      if (options.background) {
        // A poll never takes the request slot or the loading flag (see canApplyBackgroundRead),
        // and a failed or timed-out one keeps the board as it is, without a banner.
        const started = { requestId: requestIdRef.current, cursor: null };
        try {
          const result = (await withTimeout(
            fetchCommandCenterInBackground(),
            BACKGROUND_READ_TIMEOUT_MS,
          )) as CommandCenterData;
          const current = {
            requestId: requestIdRef.current,
            cursor: null,
            userReadInFlight: loadingRef.current,
          };
          if (!canApplyBackgroundRead(started, current)) return;
          setData(result);
          setError(null);
        } catch (err) {
          pollGate.backgroundFailed(err);
          // The next tick, or 重新整理, reads again.
        }
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      try {
        const result = (await fetchCommandCenter()) as CommandCenterData;
        if (requestId !== requestIdRef.current) return;
        setData(result);
        setError(null);
        pollGate.foregroundSucceeded();
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(errorText(err));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [user, pollGate],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The board refreshes once a minute while the tab is visible. The queue, the open panel and the
  // URL stay as the user left them.
  useVisibleInterval(() => {
    if (!pollGate.allows(staffRoles) || loadingRef.current || busyRef.current) return undefined;
    return refresh({ background: true });
  }, MIN_VISIBLE_INTERVAL_MS);

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

  // A present row is always shown fresh (so a reanalysis appears at once); if a refresh drops
  // the selected lead, the panel stays open on the row it last showed instead of closing under
  // the user. Closing the panel or selecting another row lets that row go. Such an off-board row
  // may be stale and a reanalysis could not show its result, so the panel says so and blocks it.
  const lastShownRef = useRef<CommandCenterRow | null>(null);
  const panel = rowForOpenPanel(data?.rows, selectedId, lastShownRef.current, (row) => row.lead_id);
  const selected = panel?.row ?? null;
  const offBoard = panel?.offBoard ?? false;
  lastShownRef.current = selected;

  return (
    <AdminShell
      title="跟進工作台"
      description="每日跟進工作台：誰要跟、為何重要、下一步、WhatsApp 狀態。"
    >
      <WhatsappEnquiryQueue />
      {data ? <KpiStrip data={data} /> : null}
      {data && data.rows.length >= COMMAND_CENTER_ROW_LIMIT ? (
        <p className="mb-3 text-xs text-muted-foreground">
          只涵蓋最近更新的 {COMMAND_CENTER_ROW_LIMIT} 筆客戶查詢，較舊的未有載入。
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
          title="此佇列暫無客戶查詢"
          description="切換上方分段或選「全部」查看所有客戶查詢。"
        />
      ) : null}
      {data && visibleRows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">客戶查詢</th>
                    <th className="p-3">意向 / 預算</th>
                    <th className="p-3">階段</th>
                    <th className="p-3">負責</th>
                    <th className="p-3">AI 分數・原因</th>
                    <th className="p-3">AI 建議</th>
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
                          {aiScoreLabel(row.lead_score)}
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
        title={selected?.name ?? "客戶查詢"}
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
                  開啟完整客戶查詢
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
                disabled={busy || offBoard}
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
            {offBoard ? (
              <p className="text-xs text-muted-foreground">
                此查詢已不在跟進工作台，資料可能不是最新。
              </p>
            ) : null}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">AI 摘要</h3>
              <p className="mt-1">{selected.summary ?? "未分析"}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">AI 下一步建議</h3>
              <p className="mt-1">{selected.next_best_action ?? "—"}</p>
            </section>
            <section className="grid grid-cols-2 gap-2">
              <Detail label="AI 分數" value={aiScoreLabel(selected.lead_score)} />
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
    { label: "AI 高分查詢", value: data.kpis.hot },
    { label: "逾期跟進", value: data.kpis.overdue },
    { label: "未分配", value: data.kpis.unassigned },
    { label: "新線上客服轉介", value: data.kpis.handoffs },
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
  return adminErrorMessage(error);
}
