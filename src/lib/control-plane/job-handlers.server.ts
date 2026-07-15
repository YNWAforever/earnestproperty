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

type AiKnowledgeRebuildPayload = { requestedByStaffId: string };
type AiKnowledgeRebuildResult = {
  indexedSources: number;
  indexedChunks: number;
  embeddingDimensionFailures: number;
};

function parseAiKnowledgeRebuildPayload(input: unknown): AiKnowledgeRebuildPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("AI knowledge rebuild payload is invalid."), {
      code: "VALIDATION_ERROR",
    });
  }
  const payload = input as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 1 ||
    typeof payload.requestedByStaffId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.requestedByStaffId,
    )
  ) {
    throw Object.assign(new Error("AI knowledge rebuild payload is invalid."), {
      code: "VALIDATION_ERROR",
    });
  }
  return { requestedByStaffId: payload.requestedByStaffId };
}

function isProviderTimeout(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    code === "INTEGRATION_TIMEOUT" ||
    code === "OPENCODE_GO_TIMEOUT" ||
    name === "AbortError" ||
    /timed?\s*out/i.test(message)
  );
}

export function createAiKnowledgeRebuildHandler(
  deps: {
    runKnowledgeRebuild?: (payload: AiKnowledgeRebuildPayload) => Promise<AiKnowledgeRebuildResult>;
  } = {},
): JobHandler<AiKnowledgeRebuildPayload> {
  return {
    jobType: "ai.knowledge.rebuild",
    payloadVersion: 1,
    parsePayload: parseAiKnowledgeRebuildPayload,
    async run(payload) {
      try {
        const run =
          deps.runKnowledgeRebuild ??
          (async (input: AiKnowledgeRebuildPayload) => {
            const module = await import("../ai/knowledge.server.ts");
            return module.runAiKnowledgeRebuildOperation(input);
          });
        const result = await run(payload);
        return { summary: result };
      } catch (error) {
        if (isProviderTimeout(error)) {
          throw retryableJobError("AI_KNOWLEDGE_REBUILD_TIMEOUT", "AI knowledge rebuild timed out.");
        }
        throw error;
      }
    },
  };
}

export const aiKnowledgeRebuildHandler = registerJobHandler(createAiKnowledgeRebuildHandler());
