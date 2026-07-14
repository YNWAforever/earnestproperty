import type { StaffAccess } from "../neon/auth.server.ts";
import type { ControlPlanePermission } from "./permissions.ts";
import type { OperationContext } from "./request-context.ts";

const sensitiveAuditKeys = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "phone",
  "prompt",
  "sql",
  "stack",
] as const;

const maxAuditDepth = 5;
const maxAuditArrayItems = 50;
const maxAuditStringLength = 500;

function isSensitiveAuditKey(key: string) {
  const normalized = key.toLowerCase();
  return sensitiveAuditKeys.some((sensitiveKey) => normalized.includes(sensitiveKey));
}

function sanitizeAuditValue(value: unknown, depth: number): unknown {
  if (depth >= maxAuditDepth && value !== null && typeof value === "object") {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") return value.slice(0, maxAuditStringLength);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, maxAuditArrayItems)
      .map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        isSensitiveAuditKey(key) ? "[REDACTED]" : sanitizeAuditValue(nestedValue, depth + 1),
      ]),
    );
  }
  return String(value);
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAuditValue(metadata, 0) as Record<string, unknown>;
}

export async function writeAudit(input: {
  actor: StaffAccess;
  permission: ControlPlanePermission;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "success" | "failure" | "denied";
  context: OperationContext;
  metadata?: Record<string, unknown>;
}) {
  const { queryRows } = await import("../neon/db.server.ts");
  await queryRows(
    `INSERT INTO ops_audit_logs
      (actor_staff_id, permission, action, resource_type, resource_id, outcome, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8::jsonb)`,
    [
      input.actor.staffId,
      input.permission,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      input.outcome,
      input.context.requestId,
      JSON.stringify(sanitizeAuditMetadata(input.metadata ?? {})),
    ],
  );
}

export async function listAuditLogs(input: { limit?: number } = {}) {
  const { queryRows } = await import("../neon/db.server.ts");
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  return queryRows(
    `SELECT
       id::text AS id,
       actor_staff_id::text AS actor_staff_id,
       permission,
       action,
       resource_type,
       resource_id,
       outcome,
       request_id::text AS request_id,
       metadata,
       created_at
     FROM ops_audit_logs
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit],
  );
}
