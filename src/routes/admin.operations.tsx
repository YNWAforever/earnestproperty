import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";

import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminOperationsJobs } from "@/components/admin/operations/AdminOperationsJobs";
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
      { title: "Operations | Earnest Admin" },
      { name: "robots", content: operationsMetadata.robots },
    ],
  }),
  component: AdminOperations,
});

const TAB_LABELS: Record<OperationTab, string> = {
  overview: "Overview",
  jobs: "Jobs",
  audit: "Audit",
  migrations: "Migrations",
};

function AdminOperations() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { pulse, refreshNow } = useOperationsPulse();
  const [healthState, setHealthState] = useState<OperationsHealthState>({ health: null, error: null });
  const [jobsSummary, setJobsSummary] = useState<JobSummary | null>(null);
  const [migrations, setMigrations] = useState<MigrationState[] | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const { health, error } = healthState;

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
      setJobsSummary(null);
      setMigrations(null);
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
        if (!cancelled) setOverviewError(errorText(reason));
      }
    }

    void loadOperationsOverview();
    return () => {
      cancelled = true;
    };
  }, [pulse]);

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

  return (
    <AdminShell title="Operations" description="Control-plane health and capability-aware operations access.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="flex items-center gap-2">
          <Badge variant={health?.status === "healthy" ? "default" : "secondary"}>
            {health?.status ?? "Loading"}
          </Badge>
          {health ? <span className="text-sm text-muted-foreground">{health.checkedAt}</span> : null}
        </div>
        <Button type="button" variant="outline" size="icon" onClick={refreshNow} aria-label="Refresh health">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error ? <AdminError message={error} /> : null}
      {!health && !error ? <Skeleton className="mt-4 h-48 w-full" /> : null}

      {health ? (
        <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="mt-4">
          <Tabs.List aria-label="Operations tabs" className="flex flex-wrap gap-2 border-b">
            {allowedTabs.map((tab) => (
              <Tabs.Trigger key={tab} value={tab} className="border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:border-primary">
                {TAB_LABELS[tab]}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {allowedTabs.map((tab) => (
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
                <AdminOperationsJobs capabilities={health.capabilities} active pulse={pulse} onMutationComplete={refreshNow} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {TAB_LABELS[tab]} becomes available when its capability is granted.
                </p>
              )}
            </Tabs.Content>
          ))}
        </Tabs.Root>
      ) : null}
    </AdminShell>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load operations overview.";
}
