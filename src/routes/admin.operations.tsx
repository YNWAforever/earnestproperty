import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminOperationsAudit } from "@/components/admin/operations/AdminOperationsAudit";
import { AdminOperationsJobs } from "@/components/admin/operations/AdminOperationsJobs";
import { AdminOperationsMigrations } from "@/components/admin/operations/AdminOperationsMigrations";
import { AdminOperationsOverview } from "@/components/admin/operations/AdminOperationsOverview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchOperationsHealth,
  fetchOperationsJobs,
  fetchOperationsMigrations,
} from "@/lib/admin/operations/operations-client";
import { useOperationsPulse } from "@/lib/admin/operations/operations-polling";
import type { ControlPlanePermission } from "@/lib/control-plane/permissions";
import {
  createOperationsHealthLoader,
  resolveOperationsRouteState,
  type OperationsHealthState,
} from "@/lib/admin/operations/operations-route-state";
import type {
  HealthData,
  JobSummary,
  MigrationState,
  OperationTab,
} from "@/lib/admin/operations/operations-types";

const operationsMetadata = { robots: "noindex, nofollow" } as const;

function parseOperationsSearch(search: Record<string, unknown>): { tab?: string } {
  return typeof search.tab === "string" ? { tab: search.tab } : {};
}

export const Route = createFileRoute("/admin/operations")({
  validateSearch: parseOperationsSearch,
  head: () => ({
    meta: [
      { title: "系統營運 | Earnest Admin" },
      { name: "robots", content: operationsMetadata.robots },
    ],
  }),
  component: AdminOperations,
});

const TAB_LABELS: Record<OperationTab, string> = {
  overview: "總覽",
  jobs: "背景工作",
  audit: "審計記錄",
  migrations: "資料庫遷移",
};

// Named so a blocked tab can say which permission unlocks it instead of just
// disappearing, which left staff with no way to know the feature exists.
//
// Typed as ControlPlanePermission rather than string: the audit tab used to
// name "system.audit.read", which does not exist in the permission list at all
// (the real name is "audit.read"), so the tooltip told staff to request a
// permission no admin could grant. The narrower type makes that a compile error.
const TAB_PERMISSIONS: Record<OperationTab, ControlPlanePermission | null> = {
  overview: null,
  jobs: "system.jobs.read",
  audit: "audit.read",
  migrations: "system.migrations.plan",
};

const ALL_OPERATION_TABS: OperationTab[] = ["overview", "jobs", "audit", "migrations"];

const HEALTH_STATUS_LABELS: Record<string, string> = {
  healthy: "正常",
  degraded: "降級",
  failed: "故障",
};

function AdminOperations() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { pulse, refreshNow } = useOperationsPulse();
  const [healthState, setHealthState] = useState<OperationsHealthState>({
    health: null,
    error: null,
    stale: false,
  });
  const [jobsSummary, setJobsSummary] = useState<JobSummary | null>(null);
  const [migrations, setMigrations] = useState<MigrationState[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [mutationRevision, setMutationRevision] = useState(0);
  const { health, error, stale } = healthState;

  useEffect(() => {
    let cancelled = false;
    let fetchedHealth: HealthData | null = null;
    const loader = createOperationsHealthLoader({
      fetchHealth: async () => {
        const result = await fetchOperationsHealth();
        fetchedHealth = result.data;
        return result;
      },
      setState: (updater) => {
        if (!cancelled) setHealthState(updater);
      },
    });

    async function loadOperationsOverview() {
      await loader.load();
      if (cancelled || !fetchedHealth) return;

      const currentHealth = fetchedHealth as HealthData;
      const refreshedTab = resolveOperationsRouteState(search.tab, currentHealth).activeTab;
      if (refreshedTab !== "overview") return;

      // Deliberately NOT cleared to null first: doing so unmounted the job and
      // migration sections on every 30s tick, guaranteeing a flash and a layout
      // jump mid-read. The values are replaced in place once the fetch resolves.
      setOverviewError(null);
      const jobsPromise = currentHealth.capabilities.jobsRead
        ? fetchOperationsJobs({ limit: 5 })
        : Promise.resolve(null);
      const migrationsPromise = currentHealth.capabilities.migrationsPlan
        ? fetchOperationsMigrations()
        : Promise.resolve(null);

      try {
        const [jobsPage, migrationPage] = await Promise.all([jobsPromise, migrationsPromise]);
        if (cancelled) return;
        setJobsSummary(jobsPage?.data.summary ?? null);
        setMigrations(migrationPage?.data ?? null);
      } catch (reason) {
        if (!cancelled) setOverviewError(safeOperationsRefreshError(reason));
      }
    }

    void loadOperationsOverview();
    return () => {
      cancelled = true;
    };
  }, [pulse, search.tab]);

  const { allowedTabs, activeTab, correction } = resolveOperationsRouteState(search.tab, health);

  useEffect(() => {
    if (!health || !correction) return;
    void navigate({ search: correction, replace: true });
  }, [correction, health, navigate]);

  const handleTabChange = useCallback(
    (tab: string) => {
      void navigate({ search: { tab: tab === "overview" ? undefined : tab } });
    },
    [navigate],
  );

  const handleMutationComplete = useCallback(() => {
    setMutationRevision((value) => value + 1);
    refreshNow();
  }, [refreshNow]);

  const handleMigrationApplied = useCallback(async () => {
    setMutationRevision((value) => value + 1);
    refreshNow();
    if (!health) return;

    setOverviewError(null);
    const jobsPromise = health.capabilities.jobsRead
      ? fetchOperationsJobs({ limit: 5 })
      : Promise.resolve(null);
    const migrationsPromise = health.capabilities.migrationsPlan
      ? fetchOperationsMigrations()
      : Promise.resolve(null);

    try {
      const [jobsPage, migrationPage] = await Promise.all([jobsPromise, migrationsPromise]);
      setJobsSummary(jobsPage?.data.summary ?? null);
      setMigrations(migrationPage?.data ?? null);
    } catch (reason) {
      setOverviewError(safeOperationsRefreshError(reason));
    }
  }, [health, refreshNow]);

  return (
    <AdminShell title="系統營運" description="控制平面狀態，以及按權限開放的營運工具。">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* aria-live sits on the status badge only. It previously wrapped the
            timestamp too, so screen readers re-announced the whole region every
            30s even when nothing had changed. */}
        <div className="flex items-center gap-2">
          <Badge
            aria-live="polite"
            variant={
              health?.status === "healthy"
                ? "default"
                : health?.status === "failed"
                  ? "destructive"
                  : "secondary"
            }
          >
            {health ? (HEALTH_STATUS_LABELS[health.status] ?? health.status) : "載入中"}
          </Badge>
          {health ? (
            <span className="text-sm text-muted-foreground">最後檢查：{health.checkedAt}</span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={refreshNow}
          aria-label="重新檢查控制平面狀態"
        >
          <RefreshCw className="h-4 w-4" />
          重新整理
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <AdminError
            message={stale ? `${error}／以下資料為最後一次成功讀取的結果，可能已過時。` : error}
          />
        </div>
      ) : null}
      {!health && !error ? <Skeleton className="mt-4 h-48 w-full" /> : null}

      {health ? (
        <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="mt-4">
          {/* Every tab is rendered, not just the permitted ones. Omitting them
              made the "granted when its capability is available" fallback
              unreachable dead code and left staff unable to tell a missing
              feature from a missing permission. */}
          <Tabs.List aria-label="營運工具分頁" className="flex flex-wrap gap-2 border-b">
            {ALL_OPERATION_TABS.map((tab) => {
              const permitted = allowedTabs.includes(tab);
              return (
                <Tabs.Trigger
                  key={tab}
                  value={tab}
                  disabled={!permitted}
                  title={
                    permitted ? undefined : `需要 ${TAB_PERMISSIONS[tab]} 權限，請聯絡系統管理員`
                  }
                  className="min-h-11 border-b-2 border-transparent px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:font-semibold lg:min-h-9"
                >
                  {TAB_LABELS[tab]}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>

          {ALL_OPERATION_TABS.map((tab) => (
            <Tabs.Content key={tab} value={tab} className="pt-4">
              {tab === "overview" ? (
                <AdminOperationsOverview
                  health={health}
                  jobsSummary={jobsSummary}
                  migrations={migrations}
                  stale={overviewError !== null}
                  error={overviewError}
                  onRefresh={refreshNow}
                  onOpenJobs={() => handleTabChange("jobs")}
                />
              ) : tab === "jobs" && activeTab === "jobs" && health.capabilities.jobsRead ? (
                <AdminOperationsJobs
                  capabilities={health.capabilities}
                  active
                  pulse={pulse}
                  onMutationComplete={handleMutationComplete}
                />
              ) : tab === "audit" && activeTab === "audit" && health.capabilities.auditRead ? (
                <AdminOperationsAudit active revision={mutationRevision} />
              ) : tab === "migrations" &&
                activeTab === "migrations" &&
                health.capabilities.migrationsPlan ? (
                <AdminOperationsMigrations
                  capabilities={health.capabilities}
                  active
                  onApplied={handleMigrationApplied}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  你未有存取「{TAB_LABELS[tab]}」的權限
                  {TAB_PERMISSIONS[tab] ? `（需要 ${TAB_PERMISSIONS[tab]}）` : ""}
                  。請聯絡系統管理員開通。
                </p>
              )}
            </Tabs.Content>
          ))}
        </Tabs.Root>
      ) : null}
    </AdminShell>
  );
}

function safeOperationsRefreshError(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "requestId" in error &&
    typeof error.requestId === "string"
    ? `未能重新載入營運總覽，請稍後再試。（支援參考編號：${error.requestId}）`
    : "未能重新載入營運總覽，請稍後再試。";
}
