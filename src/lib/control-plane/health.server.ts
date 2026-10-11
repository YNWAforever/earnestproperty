// Explicit .js extension: plain-JS module with a .d.ts sibling, so the
// node --test suite imports it without a build step.
import { MIGRATION_VERSIONS, pendingMigrations } from "./migration-versions.js";
import { assessJobQueueHealth, jobQueueThresholds } from "./job-queue-health.ts";

export type HealthStatus = "healthy" | "degraded" | "failed";

export type HealthCheck = {
  key: string;
  required: boolean;
  status: HealthStatus;
  details?: Record<string, boolean>;
  /** Counts and ages shown on the row instead of the configured summary. */
  facts?: Record<string, number | null>;
};

export type ControlPlaneHealth = {
  status: HealthStatus;
  checks: HealthCheck[];
  checkedAt: string;
};

const requiredTables = [
  "app_migrations",
  "staff_users",
  "staff_roles",
  "ops_audit_logs",
  "ops_jobs",
  "ops_job_attempts",
  "ops_migration_runs",
] as const;

const requiredColumns = {
  // staff_users is here because its absence is what exposed the gap: this map
  // used to cover only the control plane's own tables, so a missing
  // staff_users.specialties reported healthy right up until 代理管理 500'd on a
  // real click. The columns below are the ones admin-data.server.ts selects by
  // name, where a missing column is a hard query failure rather than a
  // degraded read.
  staff_users: ["specialties", "served_estate_slugs", "public_slug", "show_on_website"],
  ops_audit_logs: ["permission", "action", "outcome", "request_id", "metadata", "created_at"],
  ops_jobs: [
    "job_type",
    "payload_version",
    "payload",
    "status",
    "attempt_count",
    "max_attempts",
    "run_after",
    "lease_owner",
    "lease_expires_at",
    "idempotency_key",
  ],
} as const;

export function aggregateHealth(checks: HealthCheck[]): ControlPlaneHealth {
  const status = checks.some((check) => check.required && check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status !== "healthy")
      ? "degraded"
      : "healthy";
  return { status, checks, checkedAt: new Date().toISOString() };
}

function present(value: string | undefined) {
  return Boolean(value?.trim());
}

export function environmentChecks(): HealthCheck[] {
  // Split into two checks. A single "ai" key that only inspected OPENCODE_GO_*
  // reported healthy while AI_GATEWAY_API_KEY was unset -- and the gateway is
  // what backs generateAiJson (src/lib/ai/config.server.ts), so
  // every AI call was returning AI_DISABLED behind a green dashboard. The two
  // providers are configured independently and fail independently.
  const aiGateway = {
    apiKey: present(process.env.AI_GATEWAY_API_KEY),
    model: present(process.env.AI_GATEWAY_MODEL),
  };
  const aiCopilot = {
    baseUrl: present(process.env.OPENCODE_GO_BASE_URL),
    apiKey: present(process.env.OPENCODE_GO_API_KEY),
    model: present(process.env.OPENCODE_GO_MODEL),
  };
  const woztell = {
    enabled: process.env.WOZTELL_ENABLED === "true",
    accessToken: present(process.env.WOZTELL_BOT_ACCESS_TOKEN),
    channelId: present(process.env.WOZTELL_CHANNEL_ID),
    appId: present(process.env.WOZTELL_APP_ID),
    channelSecret: present(process.env.WOZTELL_CHANNEL_SECRET),
  };
  const cronSecret = present(process.env.CRON_SECRET);
  const approvalSecret = present(process.env.CONTROL_PLANE_APPROVAL_SECRET);

  const woztellComplete =
    woztell.accessToken && woztell.appId && woztell.channelId && woztell.channelSecret;
  return [
    {
      // Backs CRM analysis only.
      key: "ai.gateway",
      required: false,
      status: aiGateway.apiKey && aiGateway.model ? "healthy" : "degraded",
      details: aiGateway,
    },
    {
      // Backs the CMS content copilot only.
      key: "ai.copilot",
      required: false,
      status: aiCopilot.baseUrl && aiCopilot.apiKey && aiCopilot.model ? "healthy" : "degraded",
      details: aiCopilot,
    },
    {
      key: "woztell",
      required: false,
      status: woztell.enabled ? (woztellComplete ? "healthy" : "failed") : "degraded",
      details: woztell,
    },
    {
      key: "cron",
      required: false,
      status: cronSecret ? "healthy" : "degraded",
      details: { configured: cronSecret },
    },
    {
      key: "migrationApproval",
      required: true,
      status: approvalSecret ? "healthy" : "failed",
      details: { configured: approvalSecret },
    },
  ];
}

export async function runControlPlaneHealthChecks({
  now = new Date(),
}: { now?: Date } = {}): Promise<ControlPlaneHealth> {
  const checks: HealthCheck[] = [];
  try {
    const { queryRows } = await import("../neon/db.server.ts");
    const tableRows = await queryRows<{ table_name: unknown }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [[...requiredTables]],
    );
    const existingTables = new Set(tableRows.map((row) => String(row.table_name)));
    const tableDetails = Object.fromEntries(
      requiredTables.map((table) => [table, existingTables.has(table)]),
    );
    checks.push({
      key: "database.tables",
      required: true,
      status: Object.values(tableDetails).every(Boolean) ? "healthy" : "failed",
      details: tableDetails,
    });

    const columnRows = await queryRows<{ table_name: unknown; column_name: unknown }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [Object.keys(requiredColumns)],
    );
    const existingColumns = new Set(
      columnRows.map((row) => `${String(row.table_name)}.${String(row.column_name)}`),
    );
    const columnDetails = Object.fromEntries(
      Object.entries(requiredColumns).flatMap(([table, columns]) =>
        columns.map((column) => {
          const key = `${table}.${column}`;
          return [key, existingColumns.has(key)];
        }),
      ),
    );
    checks.push({
      key: "database.columns",
      required: true,
      status: Object.values(columnDetails).every(Boolean) ? "healthy" : "failed",
      details: columnDetails,
    });

    // The column check above only catches drift someone remembered to register.
    // This catches the general case: a migration that shipped in the repo but was
    // never run against this database. app_migrations.version holds the full
    // filename, which is exactly what MIGRATION_VERSIONS lists.
    //
    // Reported as degraded rather than failed. Pending migrations mean this
    // database is behind the code, which is serious -- but it is also the normal,
    // transient state during a deploy, and a hard failure would make the control
    // plane cry wolf on every release.
    const migrationRows = await queryRows<{ version: unknown }>(
      "SELECT version FROM app_migrations",
    );
    const pending = new Set(pendingMigrations(migrationRows.map((row) => String(row.version))));

    // One boolean per migration rather than counts or a list of names. The
    // overview renders details by counting truthy values ("14 項設定中已完成 13
    // 項"), so this shape reads correctly there for free -- whereas a
    // `{ pending: [...] }` array would be truthy even when non-empty and make
    // the row claim 已完成設定 while migrations were outstanding.
    const migrationDetails = Object.fromEntries(
      MIGRATION_VERSIONS.map((version) => [version, !pending.has(version)]),
    );
    checks.push({
      key: "database.migrations",
      required: true,
      status: pending.size === 0 ? "healthy" : "degraded",
      details: migrationDetails,
    });

    // FX-07: background work is overdue, or a lane's scheduled worker has gone
    // quiet. Counts every job type, not only woztell.% (L-03). The grace comes
    // from the HKT-clock helper, so future-scheduled jobs and retry backoffs are
    // excluded by construction and the hourly night cadence does not cry wolf.
    const thresholds = jobQueueThresholds(now);
    try {
      const [queue] = await queryRows<{
        overdue_queued: unknown;
        expired_leases: unknown;
        service_seen_at: unknown;
        general_seen_at: unknown;
      }>(
        `SELECT
           count(*) FILTER (WHERE status='queued' AND run_after < now() - make_interval(mins => $1::int))::int AS overdue_queued,
           count(*) FILTER (WHERE status='running' AND lease_expires_at < now() - make_interval(mins => $1::int))::int AS expired_leases,
           (SELECT seen_at FROM whatsapp_service_worker_heartbeats WHERE worker_id='service-v2') AS service_seen_at,
           (SELECT seen_at FROM whatsapp_service_worker_heartbeats WHERE worker_id='general-v1') AS general_seen_at
         FROM ops_jobs`,
        [thresholds.overdueGraceMinutes],
      );
      const seenAt = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
      checks.push(
        assessJobQueueHealth(
          {
            overdueQueued: Number(queue?.overdue_queued ?? 0),
            expiredLeases: Number(queue?.expired_leases ?? 0),
            serviceHeartbeatAt: seenAt(queue?.service_seen_at),
            generalHeartbeatAt: seenAt(queue?.general_seen_at),
            wakeConfigured: present(process.env.OPS_WAKE_URL),
          },
          now,
          thresholds,
        ),
      );
    } catch (error) {
      // A database without the service-workflow migration has no heartbeat
      // table. That degrades this row; it must not fail the database checks.
      console.error("[health] JOBS_QUEUE_UNREADABLE", error instanceof Error ? error.message : "");
      checks.push({
        key: "jobs.queue",
        required: false,
        status: "degraded",
        details: { readable: false },
      });
    }
  } catch {
    checks.push({ key: "database", required: true, status: "failed" });
  }

  return aggregateHealth([...checks, ...environmentChecks()]);
}
