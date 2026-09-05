export type JobHandler<T = unknown> = {
  jobType: string;
  payloadVersion: number;
  parsePayload(input: unknown): T;
  run(
    payload: T,
    context: { jobId: string; attempt: number; workerId?: string; checkpoint: () => Promise<void> },
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
  return Boolean(
    error && typeof error === "object" && "retryable" in error && error.retryable === true,
  );
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
    runKnowledgeRebuild?: (
      payload: AiKnowledgeRebuildPayload,
      options: { checkpoint: () => Promise<void> },
    ) => Promise<AiKnowledgeRebuildResult>;
  } = {},
): JobHandler<AiKnowledgeRebuildPayload> {
  return {
    jobType: "ai.knowledge.rebuild",
    payloadVersion: 1,
    parsePayload: parseAiKnowledgeRebuildPayload,
    async run(payload, context) {
      await context.checkpoint();
      try {
        const run =
          deps.runKnowledgeRebuild ??
          (async (
            input: AiKnowledgeRebuildPayload,
            options: { checkpoint: () => Promise<void> },
          ) => {
            const module = await import("../ai/knowledge.server.ts");
            return module.runAiKnowledgeRebuildOperation(input, {
              checkpoint: options.checkpoint,
            });
          });
        const result = await run(payload, { checkpoint: context.checkpoint });
        await context.checkpoint();
        return { summary: result };
      } catch (error) {
        if (isProviderTimeout(error)) {
          throw retryableJobError(
            "AI_KNOWLEDGE_REBUILD_TIMEOUT",
            "AI knowledge rebuild timed out.",
          );
        }
        throw error;
      }
    },
  };
}

export const aiKnowledgeRebuildHandler = registerJobHandler(createAiKnowledgeRebuildHandler());

type WoztellCampaignDeliveryPayload = { campaignId: string };
type WoztellCampaignDeliveryResult = {
  sent: number;
  blocked: number;
  failed: number;
  checked: number;
};

function parseWoztellCampaignDeliveryPayload(input: unknown): WoztellCampaignDeliveryPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("WozTell campaign delivery payload is invalid."), {
      code: "VALIDATION_ERROR",
    });
  }
  const payload = input as Record<string, unknown>;
  if (
    Object.keys(payload).length !== 1 ||
    typeof payload.campaignId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.campaignId,
    )
  ) {
    throw Object.assign(new Error("WozTell campaign delivery payload is invalid."), {
      code: "VALIDATION_ERROR",
    });
  }
  return { campaignId: payload.campaignId };
}

function isRetryableWoztellError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const name = "name" in error ? String(error.name) : "";
  return (
    name === "AbortError" ||
    code === "WOZTELL_PROVIDER_TIMEOUT" ||
    code === "WOZTELL_PROVIDER_UNAVAILABLE" ||
    code === "WOZTELL_CONFIGURATION_UNAVAILABLE" ||
    code === "WOZTELL_DELIVERY_INCOMPLETE"
  );
}

export function createWoztellCampaignDeliveryHandler(
  deps: {
    deliverCampaign?: (
      campaignId: string,
      options: {
        checkpoint: () => Promise<void>;
        job?: { jobId: string; workerId: string; attempt: number };
      },
    ) => Promise<WoztellCampaignDeliveryResult>;
  } = {},
): JobHandler<WoztellCampaignDeliveryPayload> {
  return {
    jobType: "woztell.campaign.deliver",
    payloadVersion: 1,
    parsePayload: parseWoztellCampaignDeliveryPayload,
    async run(payload, context) {
      try {
        const deliver =
          deps.deliverCampaign ??
          (async (
            campaignId: string,
            options: {
              checkpoint: () => Promise<void>;
              job?: { jobId: string; workerId: string; attempt: number };
            },
          ) => {
            const module = await import("../woztell/campaign-delivery.server.ts");
            return module.deliverWoztellCampaign(campaignId, options);
          });
        const result = await deliver(payload.campaignId, {
          checkpoint: context.checkpoint,
          job: context.workerId
            ? { jobId: context.jobId, workerId: context.workerId, attempt: context.attempt }
            : undefined,
        });
        if (result.failed > 0) {
          throw Object.assign(new Error("One or more campaign recipients were rejected."), {
            code: "WOZTELL_CAMPAIGN_REJECTED",
          });
        }
        return { summary: result };
      } catch (error) {
        if (isRetryableWoztellError(error)) {
          throw retryableJobError(
            "WOZTELL_CAMPAIGN_RETRYABLE",
            "WozTell campaign delivery could not be completed yet.",
          );
        }
        throw error;
      }
    },
  };
}

export const woztellCampaignDeliveryHandler = registerJobHandler(
  createWoztellCampaignDeliveryHandler(),
);

export const woztellReplyDeliveryHandler = registerJobHandler<{ intentId: string }>({
  jobType: "woztell.reply.deliver",
  payloadVersion: 1,
  parsePayload(input) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("intentId" in input) ||
      typeof input.intentId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(input.intentId)
    )
      throw Object.assign(new Error("Reply intent payload is invalid."), {
        code: "VALIDATION_ERROR",
      });
    return { intentId: input.intentId };
  },
  async run(payload, context) {
    const { deliverOutboundIntent } = await import("../woztell/outbound-intent.server.ts");
    const summary = await deliverOutboundIntent(payload.intentId, {
      checkpoint: context.checkpoint,
      job: context.workerId ? { jobId: context.jobId, workerId: context.workerId } : undefined,
    });
    return { summary };
  },
});

export const woztellHistoryImportHandler = registerJobHandler<
  import("../woztell/history-import.server.ts").HistoryJobPayload
>({
  jobType: "woztell.history.import",
  payloadVersion: 1,
  parsePayload(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid history job");
    const p = input as Record<string, unknown>;
    if (
      Object.keys(p).length !== 4 ||
      typeof p.importId !== "string" ||
      !/^[a-f0-9]{64}$/.test(p.importId) ||
      (p.cursor !== null && (typeof p.cursor !== "string" || p.cursor.length > 4096)) ||
      (p.mode !== "forward" && p.mode !== "backward") ||
      typeof p.channelId !== "string" ||
      !p.channelId ||
      p.channelId.length > 512
    )
      throw new Error("Invalid history job");
    return { importId: p.importId, cursor: p.cursor, mode: p.mode, channelId: p.channelId };
  },
  async run(payload, context) {
    const { runHistoryImportPage } = await import("../woztell/history-import.server.ts");
    try {
      return { summary: await runHistoryImportPage(payload, context.checkpoint) };
    } catch {
      throw retryableJobError(
        "WOZTELL_HISTORY_IMPORT_RETRYABLE",
        "History import paused; retry resumes its persisted cursor.",
      );
    }
  },
});
