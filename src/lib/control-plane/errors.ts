export type ControlPlaneErrorCode =
  | "SCHEMA_RELATION_MISSING"
  | "SCHEMA_COLUMN_MISSING"
  | "CONFLICT_DUPLICATE"
  | "INTEGRATION_TIMEOUT"
  | "PERMISSION_DENIED"
  | "MIGRATION_APPROVAL_INVALID"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export type PublicControlPlaneError = {
  code: ControlPlaneErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export function mapControlPlaneError(error: unknown): PublicControlPlaneError {
  if (error instanceof Response && error.status === 403) {
    return {
      code: "PERMISSION_DENIED",
      message: "You do not have permission for this operation.",
      retryable: false,
    };
  }
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "42P01" || code === "SCHEMA_RELATION_MISSING")
    return {
      code: "SCHEMA_RELATION_MISSING",
      message: "A required database relation is missing.",
      retryable: false,
    };
  if (code === "42703" || code === "SCHEMA_COLUMN_MISSING")
    return {
      code: "SCHEMA_COLUMN_MISSING",
      message: "A required database column is missing.",
      retryable: false,
    };
  if (code === "23505")
    return {
      code: "CONFLICT_DUPLICATE",
      message: "The operation conflicts with existing data.",
      retryable: false,
    };
  if (code === "MIGRATION_APPROVAL_INVALID")
    return {
      code: "MIGRATION_APPROVAL_INVALID",
      message: "Migration approval is invalid or expired.",
      retryable: false,
    };
  if (code === "VALIDATION_ERROR")
    return {
      code: "VALIDATION_ERROR",
      message: "The operation failed validation.",
      retryable: false,
    };
  if (code === "CONFLICT_DUPLICATE")
    return {
      code: "CONFLICT_DUPLICATE",
      message: "The operation conflicts with existing data.",
      retryable: false,
    };
  return {
    code: "INTERNAL_ERROR",
    message: "The operation could not be completed.",
    retryable: false,
  };
}

export function successResponse<T>(data: T, requestId: string, status = 200) {
  return Response.json({ ok: true as const, data, requestId }, { status });
}

export function errorResponse(error: unknown, requestId: string, status = 500) {
  return Response.json(
    { ok: false as const, error: mapControlPlaneError(error), requestId },
    { status },
  );
}
