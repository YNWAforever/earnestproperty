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

/**
 * Cursors are opaque to the client but arrive as user input. Validating with
 * Date.parse accepted anything JS could parse -- including
 * "Tue Aug 11 2026 10:00:00 GMT+0800 (...)" -- and forwarded it raw into
 * $N::timestamptz, where Postgres rejects it and the route answers 500 instead
 * of the VALIDATION_ERROR/400 it intends. Match exactly what the encoder now
 * emits (microsecond, Z-suffixed).
 */
const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

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
      !CURSOR_TIMESTAMP_PATTERN.test(String(cursor.createdAt)) ||
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
    created_at_cursor: string;
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
       created_at,
       -- Keyset cursors must carry FULL precision. created_at is timestamptz
       -- (microseconds), but the display value goes through Date.toISOString()
       -- which truncates to milliseconds. Feeding that truncated value back into
       -- the (created_at, id) < (...) predicate silently skipped every row whose
       -- timestamp fell between the truncated and true value -- audit entries
       -- vanished across page boundaries. US = microseconds.
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
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
  const page = rows.slice(0, limit);
  const pageRows = page.map(({ created_at_cursor: _cursor, ...row }) => ({
    ...row,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? sanitizeAuditMetadata(row.metadata as Record<string, unknown>)
        : {},
    created_at: stringDate(row.created_at),
  }));
  // Cursor built from the microsecond-precision column, NOT from the truncated
  // display value -- see the to_char above.
  const lastRaw = page.at(-1);
  return {
    rows: pageRows,
    nextCursor:
      rows.length > limit && lastRaw
        ? encodeAuditCursor({ createdAt: lastRaw.created_at_cursor, id: String(lastRaw.id) })
        : null,
  };
}
