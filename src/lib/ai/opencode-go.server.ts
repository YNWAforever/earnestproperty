import "@tanstack/react-start/server-only";

import { extractStructuredJson } from "./content-copilot.ts";
import type { ContentCopilotConfig } from "./content-copilot-config.server.ts";

const OPENCODE_GO_TIMEOUT_MS = 30_000;
const OPENCODE_GO_MAX_RETRIES = 2;
const OPENCODE_GO_RETRY_BASE_DELAY_MS = 300;
const OPENCODE_GO_MAX_RESPONSE_CHARS = 120_000;

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type SleepImpl = (ms: number) => Promise<void>;
type OpenCodeGoError =
  | "OPENCODE_GO_NOT_CONFIGURED"
  | "OPENCODE_GO_TIMEOUT"
  | "OPENCODE_GO_HTTP_ERROR"
  | "OPENCODE_GO_RESPONSE_INVALID"
  | "OPENCODE_GO_GENERATION_FAILED";

export type OpenCodeGoProposalResult = {
  ok: boolean;
  value: unknown | null;
  model: string | null;
  latencyMs: number;
  usageMetadata: Record<string, number>;
  error: OpenCodeGoError | null;
};

export function createOpenCodeGoClient({
  fetchImpl = fetch,
  sleepImpl = sleep,
  config,
}: {
  fetchImpl?: FetchImpl;
  sleepImpl?: SleepImpl;
  config: ContentCopilotConfig;
}) {
  return {
    async generateProposal(input: {
      system: string;
      prompt: string;
    }): Promise<OpenCodeGoProposalResult> {
      if (!config.enabled || !config.baseUrl || !config.apiKey || !config.model) {
        return failedResult(null, 0, "OPENCODE_GO_NOT_CONFIGURED");
      }

      const startedAt = Date.now();
      try {
        const response = await fetchWithRetry(
          normalizeChatCompletionsUrl(config.baseUrl),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: config.model,
              messages: [
                { role: "system", content: input.system },
                { role: "user", content: input.prompt },
              ],
              temperature: 0.1,
              stream: false,
              max_tokens: 8192,
              // OpenCode Go ignores DeepSeek's native thinking toggle. Its gateway
              // requires reasoning_effort=none to avoid lengthy reasoning for copy edits.
              ...(config.model.startsWith("deepseek-v4-") ? { reasoning_effort: "none" } : {}),
              response_format: { type: "json_object" },
            }),
          },
          fetchImpl,
          sleepImpl,
        );

        if (!response.ok)
          return failedResult(config.model, elapsedSince(startedAt), "OPENCODE_GO_HTTP_ERROR");

        const providerResult = await parseProviderResponse(response);
        if (!providerResult)
          return failedResult(
            config.model,
            elapsedSince(startedAt),
            "OPENCODE_GO_RESPONSE_INVALID",
          );

        return {
          ok: true,
          value: providerResult.value,
          model: config.model,
          latencyMs: elapsedSince(startedAt),
          usageMetadata: providerResult.usageMetadata,
          error: null,
        };
      } catch (error) {
        return failedResult(
          config.model,
          elapsedSince(startedAt),
          isTimeoutError(error) ? "OPENCODE_GO_TIMEOUT" : "OPENCODE_GO_GENERATION_FAILED",
        );
      }
    },
  };
}

function normalizeChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: FetchImpl,
  sleepImpl: SleepImpl,
): Promise<Response> {
  const signal = AbortSignal.timeout(OPENCODE_GO_TIMEOUT_MS);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= OPENCODE_GO_MAX_RETRIES; attempt += 1) {
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(url, {
        ...init,
        signal,
      });
      if (isRetryableStatus(response.status) && attempt < OPENCODE_GO_MAX_RETRIES) {
        await cancelResponseBody(response);
        await sleepImpl(OPENCODE_GO_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (isTimeoutError(error)) throw error;
      if (attempt < OPENCODE_GO_MAX_RETRIES) {
        await sleepImpl(OPENCODE_GO_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenCode Go request failed");
}

async function parseProviderResponse(response: Response) {
  try {
    const body = await response.text();
    if (body.length > OPENCODE_GO_MAX_RESPONSE_CHARS) return null;

    const providerBody = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };
    const content = providerBody.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length > OPENCODE_GO_MAX_RESPONSE_CHARS) return null;

    const value = extractStructuredJson(content);
    if (value === null) return null;

    return { value, usageMetadata: extractUsageMetadata(providerBody.usage) };
  } catch (error) {
    if (isTimeoutError(error)) throw error;
    return null;
  }
}

function extractUsageMetadata(usage: unknown): Record<string, number> {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return {};

  const metadata: Record<string, number> = {};
  for (const [providerKey, internalKey] of [
    ["prompt_tokens", "inputTokens"],
    ["completion_tokens", "outputTokens"],
    ["total_tokens", "totalTokens"],
  ] as const) {
    const value = (usage as Record<string, unknown>)[providerKey];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000)
      metadata[internalKey] = value;
  }
  return metadata;
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // A failed cleanup must not hide the stable provider result.
  }
}
function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

function isTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function elapsedSince(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function failedResult(
  model: string | null,
  latencyMs: number,
  error: OpenCodeGoError,
): OpenCodeGoProposalResult {
  return { ok: false, value: null, model, latencyMs, usageMetadata: {}, error };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
