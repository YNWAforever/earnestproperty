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
  "email",
  "memberid",
  "recipient",
  "provider",
  "headers",
  "payload",
  "details",
] as const;

const maxAuditDepth = 5;
const maxAuditArrayItems = 50;
const maxAuditStringLength = 500;

const maxAuditObjectKeys = 50;
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
    return value.slice(0, maxAuditArrayItems).map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, maxAuditObjectKeys)
        .map(([key, nestedValue]) => [
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

type AuditCursor = { createdAt: string; id: string };

function encodeAuditCursor(cursor: AuditCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeAuditCursor(value: string | undefined): AuditCursor | null {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor");
    const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid cursor");
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== "string" ||
      Number.isNaN(Date.parse(cursor.createdAt)) ||
      typeof cursor.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id)
    ) {
      throw new Error("Invalid cursor");
    }
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    throw Object.assign(new Error("The audit cursor is invalid."), { code: "VALIDATION_ERROR" });
  }
}

function stringDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

export async function listAuditLogs(
  input: {
    cursor?: string;
    limit?: number;
    outcome?: "success" | "failure" | "denied";
    action?: string;
    requestId?: string;
  } = {},
) {
  const { queryRows } = await import("../neon/db.server.ts");
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const cursor = decodeAuditCursor(input.cursor);
  // Typed explicitly: spreading an untyped DbRow into an object literal drops
  // the index signature, so `last.id` below stopped resolving.
  const rows = await queryRows<{
    id: string;
    actor_staff_id: string | null;
    permission: string | null;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    outcome: string;
    request_id: string | null;
    metadata: unknown;
    created_at: unknown;
  }>(
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
     WHERE ($1::text IS NULL OR outcome = $1)
       AND ($2::text IS NULL OR action = $2)
       AND ($3::uuid IS NULL OR request_id = $3::uuid)
       AND (
         $4::timestamptz IS NULL
         OR (created_at, id) < ($4::timestamptz, $5::uuid)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT $6`,
    [
      input.outcome ?? null,
      input.action?.slice(0, 100) ?? null,
      input.requestId ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const pageRows = rows.slice(0, limit).map((row) => ({
    ...row,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? sanitizeAuditMetadata(row.metadata as Record<string, unknown>)
        : {},
    created_at: stringDate(row.created_at),
  }));
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor:
      rows.length > limit && last
        ? encodeAuditCursor({ createdAt: last.created_at, id: String(last.id) })
        : null,
  };
}
