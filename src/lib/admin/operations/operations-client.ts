import type {
  AuditPage,
  HealthData,
  JobStatus,
  JobsPage,
  MigrationPlan,
  MigrationState,
} from "./operations-types.ts";

type ControlPlaneRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ControlPlaneRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryPath(path: string, query: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export class OperationsClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    code: string,
    requestId: string | null,
    retryable: boolean,
  ) {
    super(message);
    this.name = "OperationsClientError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export async function requestControlPlane<T>(
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ data: T; requestId: string }> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetchImpl(`/api/admin/control-plane${path}`, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const parsed = await response.json().catch(() => null);
  const body = isRecord(parsed) ? parsed : null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : null;

  if (!body || typeof body.ok !== "boolean") {
    throw new OperationsClientError(
      "Invalid control-plane response.",
      response.status,
      "INVALID_RESPONSE",
      requestId,
      false,
    );
  }

  if (!body.ok) {
    const error = isRecord(body.error) ? body.error : {};
    throw new OperationsClientError(
      typeof error.message === "string" ? error.message : "Control-plane request failed.",
      response.status,
      typeof error.code === "string" ? error.code : "INTERNAL_ERROR",
      requestId,
      error.retryable === true,
    );
  }

  if (!requestId || !("data" in body)) {
    throw new OperationsClientError(
      "Invalid control-plane response.",
      response.status,
      "INVALID_RESPONSE",
      requestId,
      false,
    );
  }

  return { data: body.data as T, requestId };
}

export function fetchOperationsHealth() {
  return requestControlPlane<HealthData>("/health");
}

export function fetchOperationsJobs(
  query: { status?: JobStatus; jobType?: string; cursor?: string; limit?: number } = {},
) {
  return requestControlPlane<JobsPage>(queryPath("/jobs", query));
}

export function retryOperationsJob(id: string) {
  return requestControlPlane<{ id: string; status: JobStatus }>(`/jobs/${encodeURIComponent(id)}/retry`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function cancelOperationsJob(id: string) {
  return requestControlPlane<{ id: string; status: JobStatus }>(`/jobs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function fetchOperationsAudit(
  query: {
    cursor?: string;
    limit?: number;
    outcome?: "success" | "failure" | "denied";
    action?: string;
    requestId?: string;
  } = {},
) {
  return requestControlPlane<AuditPage>(queryPath("/audit", query));
}

export function fetchOperationsMigrations() {
  return requestControlPlane<MigrationState[]>("/migrations");
}

export function planOperationsMigration(id: string) {
  return requestControlPlane<MigrationPlan>(`/migrations/${encodeURIComponent(id)}/plan`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function applyOperationsMigration(id: string, approvalToken: string) {
  return requestControlPlane<{
    migrationId: string;
    status: "succeeded";
    schemaFingerprint: string;
  }>(`/migrations/${encodeURIComponent(id)}/apply`, {
    method: "POST",
    body: JSON.stringify({ approvalToken }),
  });
}
