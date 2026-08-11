export type HealthStatus = "healthy" | "degraded" | "failed";

export type HealthCheck = {
  key: string;
  required: boolean;
  status: HealthStatus;
  details?: Record<string, boolean>;
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

function environmentChecks(): HealthCheck[] {
  // Split into two checks. A single "ai" key that only inspected OPENCODE_GO_*
  // reported healthy while AI_GATEWAY_API_KEY was unset -- and the gateway is
  // what backs generateAiText/embedAiTexts (src/lib/ai/config.server.ts), so
  // every AI call was returning AI_DISABLED behind a green dashboard. The two
  // providers are configured independently and fail independently.
  const aiGateway = {
    apiKey: present(process.env.AI_GATEWAY_API_KEY),
    model: present(process.env.AI_GATEWAY_MODEL),
    embeddingModel: present(process.env.AI_GATEWAY_EMBEDDING_MODEL),
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
    channelSecret: present(process.env.WOZTELL_CHANNEL_SECRET),
  };
  const cronSecret = present(process.env.CRON_SECRET);
  const approvalSecret = present(process.env.CONTROL_PLANE_APPROVAL_SECRET);

  const woztellComplete = woztell.accessToken && woztell.channelId && woztell.channelSecret;
  return [
    {
      // Backs generateAiText/embedAiTexts. Unset => every AI call is AI_DISABLED.
      key: "ai.gateway",
      required: false,
      status:
        aiGateway.apiKey && aiGateway.model && aiGateway.embeddingModel ? "healthy" : "degraded",
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

export async function runControlPlaneHealthChecks(): Promise<ControlPlaneHealth> {
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
  } catch {
    checks.push({ key: "database", required: true, status: "failed" });
  }

  return aggregateHealth([...checks, ...environmentChecks()]);
}
