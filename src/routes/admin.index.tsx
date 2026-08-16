import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Building2,
  ContactRound,
  HeartPulse,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  fetchOperationsAudit,
  fetchOperationsHealth,
} from "@/lib/admin/operations/operations-client";
import type { AuditPage, HealthData } from "@/lib/admin/operations/operations-types";
import { fetchAdminOverview } from "@/lib/neon/admin-data";
import { listAdminTeam } from "@/lib/neon/admin-team";
import type { AdminTeamList } from "@/lib/neon/admin-team.types";

type Overview = Awaited<ReturnType<typeof fetchAdminOverview>>;
type MetricTarget =
  | "/admin/team"
  | "/admin/leads"
  | "/admin/listings"
  | "/admin/whatsapp"
  | "/admin/operations";
type ReadState<T> = { data: T | null; error: string | null; loading: boolean };

const initialReadState = <T,>(): ReadState<T> => ({ data: null, error: null, loading: true });

function useOverviewRead<T>(enabled: boolean, read: () => Promise<T>) {
  const [state, setState] = useState<ReadState<T>>(initialReadState);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, error: null, loading: current.data === null }));
    try {
      setState({ data: await read(), error: null, loading: false });
    } catch {
      setState((current) => ({
        ...current,
        error: "暫時無法載入此營運資料，請稍後再試。",
        loading: false,
      }));
    }
  }, [enabled, read]);

  useEffect(() => {
    if (!enabled) {
      setState(initialReadState());
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return [state, refresh] as const;
}

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Admin｜Earnest Property" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminHome,
});

function AdminHome() {
  const { user } = useNeonAuth();
  const enabled = Boolean(user);
  const readOverview = useCallback(() => fetchAdminOverview(), []);
  const readTeam = useCallback(() => listAdminTeam({ data: { limit: 50 } }), []);
  const readHealth = useCallback(async () => (await fetchOperationsHealth()).data, []);
  const readActivity = useCallback(async () => (await fetchOperationsAudit({ limit: 5 })).data, []);
  const [overview, refreshOverview] = useOverviewRead<Overview>(enabled, readOverview);
  const [team, refreshTeam] = useOverviewRead<AdminTeamList>(enabled, readTeam);
  const [health, refreshHealth] = useOverviewRead<HealthData>(enabled, readHealth);
  const [activity, refreshActivity] = useOverviewRead<AuditPage>(enabled, readActivity);
  const attention = team.data?.members.filter((member) => member.needsAttention) ?? [];
  const staffActivity =
    activity.data?.rows.filter((entry) => entry.action.startsWith("staff.")) ?? [];

  const refreshAll = () => {
    void Promise.all([refreshOverview(), refreshTeam(), refreshHealth(), refreshActivity()]);
  };

  return (
    <AdminShell title="總覽" description="團隊、客戶查詢與系統狀態的即時工作起點。">
      <section aria-labelledby="overview-metrics-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="overview-metrics-heading" className="text-base font-semibold text-slate-950">
              營運概況
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              重新進入頁面或手動整理時讀取最新資料。
            </p>
          </div>
          <Button onClick={refreshAll} size="sm" type="button" variant="outline">
            <RefreshCw aria-hidden="true" />
            重新整理
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <OverviewMetricCard
            icon={Users}
            label="啟用團隊"
            loading={team.loading}
            error={team.error}
            to="/admin/team"
            value={team.data?.counts.active}
          />
          <OverviewMetricCard
            icon={AlertTriangle}
            label="待處理邀請"
            loading={team.loading}
            error={team.error}
            to="/admin/team"
            value={team.data?.counts.invited}
          />
          <OverviewMetricCard
            icon={ContactRound}
            label="開放查詢"
            loading={overview.loading}
            error={overview.error}
            to="/admin/leads"
            value={overview.data?.openLeads}
          />
          <OverviewMetricCard
            icon={HeartPulse}
            label="系統健康"
            loading={health.loading}
            error={health.error}
            to="/admin/operations"
            value={health.data ? healthLabel(health.data.status) : undefined}
          />
          <OverviewMetricCard
            icon={Building2}
            label="公開放盤"
            loading={overview.loading}
            error={overview.error}
            to="/admin/listings"
            value={overview.data?.properties}
          />
          <OverviewMetricCard
            icon={MessageCircle}
            label="待處理對話"
            loading={overview.loading}
            error={overview.error}
            to="/admin/whatsapp"
            value={overview.data?.openConversations}
          />
        </div>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <OperationalCard
          id="overview-attention"
          title="需要跟進"
          description="失敗、逾期或需要處理的帳戶邀請會保留在團隊工作台。"
          icon={AlertTriangle}
          loading={team.loading}
          error={team.error}
        >
          {attention.length ? (
            <ul className="space-y-2 text-sm">
              {attention.slice(0, 5).map((member) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2"
                  key={member.id}
                >
                  <span className="font-medium text-slate-900">
                    {member.name?.trim() || "未命名成員"}
                  </span>
                  <span className="text-xs text-muted-foreground">需要檢查邀請或帳戶狀態</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">目前沒有需要立即處理的團隊項目。</p>
          )}
        </OperationalCard>
        <OperationalCard
          id="overview-activity"
          title="最近職員活動"
          description="只顯示已淨化的操作名稱與結果；不顯示身分資料、要求內容或中繼資料。"
          icon={ShieldCheck}
          loading={activity.loading}
          error={activity.error}
        >
          {staffActivity.length ? (
            <ul className="space-y-2 text-sm">
              {staffActivity.map((entry) => (
                <li className="flex items-center justify-between gap-3" key={entry.id}>
                  <span className="font-medium text-slate-900">
                    {staffActivityLabel(entry.action)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.outcome === "success"
                      ? "已完成"
                      : entry.outcome === "failure"
                        ? "需要檢查"
                        : "已拒絕"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">目前沒有可安全顯示的最近活動。</p>
          )}
        </OperationalCard>
      </section>
    </AdminShell>
  );
}

function healthLabel(status: HealthData["status"]) {
  return status === "healthy" ? "正常" : status === "degraded" ? "降級" : "故障";
}

function staffActivityLabel(action: string) {
  const labels: Record<string, string> = {
    "staff.invited": "已邀請團隊成員",
    "staff.invitation_resent": "已重新寄送邀請",
    "staff.password_reset.requested": "已要求重設密碼",
    "staff.session_revocation": "已撤銷工作階段",
    "staff.roles_changed": "已更新團隊角色",
    "staff.suspended": "已暫停團隊帳戶",
    "staff.reactivated": "已重新啟用團隊帳戶",
  };

  return labels[action] ?? "團隊帳戶已更新";
}

function OverviewMetricCard({
  icon: Icon,
  label,
  value,
  to,
  loading,
  error,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string | undefined;
  to: MetricTarget;
  loading: boolean;
  error: string | null;
}) {
  return (
    <Link to={to}>
      <Card className="h-full border-slate-200 bg-card transition hover:border-primary/50 hover:shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <CardContent className="flex items-start justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading && value === undefined ? (
              <Skeleton className="mt-2 h-7 w-16" />
            ) : (
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {typeof value === "number" ? value.toLocaleString() : (value ?? "—")}
              </p>
            )}
            {error ? (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  );
}

function OperationalCard({
  id,
  title,
  description,
  icon: Icon,
  loading,
  error,
  children,
}: {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <Card aria-labelledby={id} className="border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base" id={id}>
          <Icon aria-hidden="true" className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-16 w-full" /> : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {!loading && !error ? children : null}
      </CardContent>
    </Card>
  );
}
