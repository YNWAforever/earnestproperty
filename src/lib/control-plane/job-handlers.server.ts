export type JobHandler<T = unknown> = {
  jobType: string;
  payloadVersion: number;
  parsePayload(input: unknown): T;
  run(
    payload: T,
    context: { jobId: string; attempt: number },
  ): Promise<{ summary: Record<string, number> }>;
};

const handlers = new Map<string, JobHandler>();

function handlerKey(jobType: string, payloadVersion: number) {
  return `${jobType}@${payloadVersion}`;
}

export function registerJobHandler<T>(handler: JobHandler<T>) {
  if (!/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(handler.jobType)) {
    throw Object.assign(new Error("Job type is invalid."), { code: "VALIDATION_ERROR" });
  }
  if (!Number.isInteger(handler.payloadVersion) || handler.payloadVersion < 1) {
    throw Object.assign(new Error("Job payload version is invalid."), {
      code: "VALIDATION_ERROR",
    });
  }
  const key = handlerKey(handler.jobType, handler.payloadVersion);
  const existing = handlers.get(key);
  if (existing && existing !== handler) {
    throw Object.assign(new Error(`Job handler is already registered: ${key}`), {
      code: "CONFLICT_DUPLICATE",
    });
  }
  handlers.set(key, handler as JobHandler);
  return handler;
}

export function getJobHandler(jobType: string, payloadVersion: number) {
  return handlers.get(handlerKey(jobType, payloadVersion)) ?? null;
}

export function parseRegisteredJobPayload(
  jobType: string,
  payloadVersion: number,
  payload: unknown,
) {
  const handler = getJobHandler(jobType, payloadVersion);
  if (!handler) {
    throw Object.assign(new Error("No handler is registered for this job payload."), {
      code: "VALIDATION_ERROR",
    });
  }
  return { handler, payload: handler.parsePayload(payload) };
}

export function retryableJobError(code: string, message: string) {
  return Object.assign(new Error(message), { code, retryable: true as const });
}

export function isRetryableJobError(error: unknown) {
  return Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);
}
