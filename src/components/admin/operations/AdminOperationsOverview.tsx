import { CheckCircle2, CircleAlert, RefreshCw, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  HealthData,
  HealthStatus,
  JobSummary,
  MigrationState,
} from "@/lib/admin/operations/operations-types";

const healthLabels: Record<string, string> = {
  "database.tables": "Database tables",
  "database.columns": "Database columns",
  database: "Database",
  ai: "AI provider",
  woztell: "WozTell",
  cron: "Worker schedule",
  migrationApproval: "Migration approval",
};

const jobStatusLabels = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

function healthLabel(key: string) {
  return healthLabels[key] ?? "System check";
}

function healthVariant(status: HealthStatus) {
  return status === "healthy" ? "default" : status === "failed" ? "destructive" : "secondary";
}

function HealthStatusIcon({ status }: { status: HealthStatus }) {
  const Icon = status === "healthy" ? CheckCircle2 : status === "failed" ? XCircle : CircleAlert;
  return <Icon className="size-4 shrink-0" aria-hidden="true" />;
}

function configuredSummary(details: Record<string, boolean> | undefined) {
  if (!details) return null;

  const values = Object.values(details);
  const present = values.filter(Boolean).length;
  return present === values.length
    ? "Configured"
    : `${present} of ${values.length} configuration checks present`;
}

function HealthCheckRow({ check }: { check: HealthData["checks"][number] }) {
  const detailSummary = configuredSummary(check.details);

  return (
    <li className="flex min-h-16 items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <HealthStatusIcon status={check.status} />
        <div className="min-w-0">
          <p className="font-medium">{healthLabel(check.key)}</p>
          <p className="text-sm text-muted-foreground">
            {check.required ? "Required check" : "Optional check"}
            {detailSummary ? ` · ${detailSummary}` : ""}
          </p>
        </div>
      </div>
      <Badge variant={healthVariant(check.status)}>{check.status}</Badge>
    </li>
  );
}

function JobSummarySection({
  summary,
  onOpenJobs,
}: {
  summary: JobSummary;
  onOpenJobs: () => void;
}) {
  return (
    <section aria-labelledby="operations-job-summary" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="operations-job-summary" className="text-base font-semibold">
          Job summary
        </h2>
        {summary.attention.length ? (
          <Button type="button" variant="link" className="h-auto p-0" onClick={onOpenJobs}>
            Open Jobs
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(summary.counts).map(([status, count]) => (
          <div key={status} className="min-h-20 border-l-2 border-muted px-3 py-2">
            <p className="text-2xl font-semibold tabular-nums">{count}</p>
            <p className="text-sm text-muted-foreground">
              {jobStatusLabels[status as keyof typeof jobStatusLabels] ?? "Jobs"}
            </p>
          </div>
        ))}
      </div>
      {summary.attention.length ? (
        <p className="text-sm text-muted-foreground">
          {summary.attention.length} job{summary.attention.length === 1 ? "" : "s"} need attention.
        </p>
      ) : null}
    </section>
  );
}

function MigrationSummarySection({ migrations }: { migrations: MigrationState[] }) {
  const pending = migrations.filter((migration) => migration.status === "pending").length;
  const applied = migrations.filter((migration) => migration.status === "applied").length;
  const drift = migrations.filter((migration) => migration.status === "drift").length;

  return (
    <section aria-labelledby="operations-migration-status" className="space-y-3">
      <h2 id="operations-migration-status" className="text-base font-semibold">
        Migration status
      </h2>
      <dl className="grid grid-cols-3 gap-3">
        <div className="min-h-20 border-l-2 border-muted px-3 py-2">
          <dt className="text-sm text-muted-foreground">Pending</dt>
          <dd className="text-2xl font-semibold tabular-nums">{pending}</dd>
        </div>
        <div className="min-h-20 border-l-2 border-muted px-3 py-2">
          <dt className="text-sm text-muted-foreground">Applied</dt>
          <dd className="text-2xl font-semibold tabular-nums">{applied}</dd>
        </div>
        <div className="min-h-20 border-l-2 border-muted px-3 py-2">
          <dt className="text-sm text-muted-foreground">Drift</dt>
          <dd className="text-2xl font-semibold tabular-nums">{drift}</dd>
        </div>
      </dl>
    </section>
  );
}

export function AdminOperationsOverview({
  health,
  jobsSummary,
  migrations,
  stale,
  error,
  onRefresh,
  onOpenJobs,
}: {
  health: HealthData;
  jobsSummary: JobSummary | null;
  migrations: MigrationState[] | null;
  stale: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenJobs: () => void;
}) {
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="operations-health-status"
        className="flex min-h-24 flex-wrap items-center justify-between gap-4 border-y bg-muted/30 px-4 py-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <HealthStatusIcon status={health.status} />
          <div>
            <h2 id="operations-health-status" className="font-semibold">
              Operations health
            </h2>
            <p className="text-sm text-muted-foreground">
              {health.status === "healthy"
                ? "All reported checks are healthy."
                : "Review reported checks."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stale ? <Badge variant="secondary">Summary may be stale</Badge> : null}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={onRefresh}
                  aria-label="Refresh overview"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh overview</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="operations-health-checks">
        <h2 id="operations-health-checks" className="mb-2 text-base font-semibold">
          Health checks
        </h2>
        <ul className="border-y">
          {health.checks.map((check) => (
            <HealthCheckRow key={check.key} check={check} />
          ))}
        </ul>
      </section>

      {jobsSummary !== null ? (
        <JobSummarySection summary={jobsSummary} onOpenJobs={onOpenJobs} />
      ) : null}
      {migrations !== null ? <MigrationSummarySection migrations={migrations} /> : null}
    </div>
  );
}
