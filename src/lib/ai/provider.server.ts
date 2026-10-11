import "@tanstack/react-start/server-only";

import { getAiServerConfig, type AiServerConfig } from "./config.server.ts";

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const AI_TOTAL_BUDGET_MS = 15000;
const AI_MAX_RETRIES = 1;
const AI_RETRY_DELAY_MS = 300;
// A retry only starts when this much of the budget is still left, so it has a real
// chance to finish instead of being cut off by the budget signal.
const AI_RETRY_MIN_REMAINING_MS = AI_RETRY_DELAY_MS + 1000;

export type AiFailureReason =
  | "AI_TIMEOUT"
  | "AI_NETWORK"
  | `AI_HTTP_${number}`
  | "AI_RESPONSE_INVALID"
  | "AI_DISABLED";

export type AiJsonResult<T> = {
  ok: boolean;
  value: T | null;
  error: string | null;
  metadata?: AiProviderMetadata;
};

export type AiProviderMetadata = {
  provider: string | null;
  resolvedModel: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    costAmount: string | null;
    costCurrency: string | null;
  } | null;
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

type GatewayTransport = {
  fetchImpl: FetchLike;
  sleepImpl: (ms: number) => Promise<void>;
  budgetMs: number;
  maxRetries: number;
};

type AiGatewayDeps = {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  budgetMs?: number;
  maxRetries?: number;
  config?: AiServerConfig;
};

type GatewayOutcome =
  | { ok: true; response: Response; signal: AbortSignal }
  | { ok: false; reason: AiFailureReason; status: number | null };

class AiResponseInvalidError extends Error {}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

/**
 * Log a provider failure with only its reason and HTTP status. The prompt, system
 * text, key, URL and model output are deliberately never logged.
 */
function logProviderFailure(reason: AiFailureReason, status: number | null) {
  console.error("[ai] provider_failed", { reason, status });
}

/**
 * POST to the AI Gateway under one total budget: a single AbortSignal.timeout covers
 * every attempt. Network errors, 429 and 5xx are retried once, and only while enough
 * budget remains for the retry to finish. Other 4xx are never retried.
 */
async function postToGateway(
  path: string,
  apiKey: string | null,
  body: unknown,
  deps: GatewayTransport,
): Promise<GatewayOutcome> {
  if (!apiKey) return { ok: false, reason: "AI_DISABLED", status: null };
  const headers = gatewayHeaders(apiKey);
  const signal = AbortSignal.timeout(deps.budgetMs);
  const startedAt = Date.now();
  const canRetry = (attempt: number) =>
    attempt < deps.maxRetries &&
    !signal.aborted &&
    deps.budgetMs - (Date.now() - startedAt) >= AI_RETRY_MIN_REMAINING_MS;

  let last: GatewayOutcome = { ok: false, reason: "AI_NETWORK", status: null };
  for (let attempt = 0; attempt <= deps.maxRetries; attempt += 1) {
    try {
      const response = await deps.fetchImpl(`${AI_GATEWAY_BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      if (response.ok) return { ok: true, response, signal };
      last = { ok: false, reason: `AI_HTTP_${response.status}`, status: response.status };
      if (!isRetryableStatus(response.status) || !canRetry(attempt)) return last;
      await response.body?.cancel().catch(() => {});
    } catch {
      if (signal.aborted) return { ok: false, reason: "AI_TIMEOUT", status: null };
      last = { ok: false, reason: "AI_NETWORK", status: null };
      if (!canRetry(attempt)) return last;
    }
    await deps.sleepImpl(AI_RETRY_DELAY_MS);
  }
  return last;
}

/**
 * Classify an error thrown while reading or validating a received response. Once a
 * response has arrived, only the budget abort is a timeout; anything else (a body that
 * is not JSON, null, or the wrong shape) is an invalid response, never AI_NETWORK.
 */
function readFailureReason(signal: AbortSignal): AiFailureReason {
  return signal.aborted ? "AI_TIMEOUT" : "AI_RESPONSE_INVALID";
}

type AiTextInput = {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type AiTextResult =
  | { ok: true; text: string; error: null; metadata: AiProviderMetadata }
  | {
      ok: false;
      text: "";
      error: "AI_DISABLED" | "AI_GENERATION_FAILED";
      reason: AiFailureReason;
    };

export function createAiGatewayClient(deps: AiGatewayDeps = {}) {
  const transport: GatewayTransport = {
    fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)),
    sleepImpl: deps.sleepImpl ?? sleep,
    budgetMs: deps.budgetMs ?? AI_TOTAL_BUDGET_MS,
    maxRetries: deps.maxRetries ?? AI_MAX_RETRIES,
  };
  const resolveConfig = () => deps.config ?? getAiServerConfig();

  // Returns the HTTP status alongside the result so generateJson can log it too.
  async function requestText(
    input: AiTextInput,
  ): Promise<{ result: AiTextResult; status: number | null }> {
    const config = resolveConfig();
    if (!config.enabled || !config.textModel || !config.apiKey) {
      return {
        result: { ok: false, text: "", error: "AI_DISABLED", reason: "AI_DISABLED" },
        status: null,
      };
    }

    const fail = (reason: AiFailureReason, status: number | null) => {
      logProviderFailure(reason, status);
      return {
        result: {
          ok: false as const,
          text: "" as const,
          error: "AI_GENERATION_FAILED" as const,
          reason,
        },
        status,
      };
    };

    const outcome = await postToGateway(
      "/chat/completions",
      config.apiKey,
      {
        model: config.textModel,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxOutputTokens ?? 700,
        stream: false,
      },
      transport,
    );
    if (!outcome.ok) return fail(outcome.reason, outcome.status);

    const { response, signal } = outcome;
    try {
      const result = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        model?: unknown;
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
      };
      if (!result || typeof result !== "object") throw new AiResponseInvalidError();
      const text = result.choices?.[0]?.message?.content;
      if (typeof text !== "string") throw new AiResponseInvalidError();

      const tokenCount = (value: unknown) =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
      const metadata: AiProviderMetadata = {
        provider: response.url ? new URL(response.url).hostname : null,
        resolvedModel: typeof result.model === "string" ? result.model : null,
        usage: result.usage
          ? {
              inputTokens: tokenCount(result.usage.prompt_tokens),
              outputTokens: tokenCount(result.usage.completion_tokens),
              costAmount: null,
              costCurrency: null,
            }
          : null,
      };
      return { result: { ok: true, text, error: null, metadata }, status: response.status };
    } catch {
      return fail(readFailureReason(signal), response.status);
    }
  }

  async function generateText(input: AiTextInput): Promise<AiTextResult> {
    return (await requestText(input)).result;
  }

  async function generateJson<T>(input: {
    system: string;
    prompt: string;
    fallback: T;
  }): Promise<AiJsonResult<T> & { reason?: AiFailureReason }> {
    const { result, status } = await requestText({
      system: input.system,
      prompt: `${input.prompt}\n\nReturn strict JSON only.`,
      temperature: 0.1,
      maxOutputTokens: 900,
    });

    if (!result.ok) {
      return { ok: false, value: input.fallback, error: result.error, reason: result.reason };
    }

    try {
      return {
        ok: true,
        value: JSON.parse(stripJsonFence(result.text)) as T,
        error: null,
        metadata: result.metadata,
      };
    } catch {
      // The parse error message can quote model output, so only the reason is logged.
      logProviderFailure("AI_RESPONSE_INVALID", status);
      return {
        ok: false,
        value: input.fallback,
        error: "AI_JSON_PARSE_FAILED",
        reason: "AI_RESPONSE_INVALID",
        metadata: result.metadata,
      };
    }
  }

  return { generateText, generateJson };
}

const defaultClient = createAiGatewayClient();

export async function generateAiJson<T>(input: {
  system: string;
  prompt: string;
  fallback: T;
}): Promise<AiJsonResult<T>> {
  return defaultClient.generateJson(input);
}

function gatewayHeaders(apiKey: string | null) {
  if (!apiKey) throw new Error("AI Gateway API key is not configured");
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

/**
 * Extract a JSON payload from a model response that may be wrapped in ```json
 * fences and/or surrounded by prose. We first strip code fences, then fall back to
 * extracting the first balanced JSON object/array so leading/trailing commentary
 * does not break JSON.parse.
 */
function stripJsonFence(text: string) {
  const withoutFence = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const balanced = extractBalancedJson(withoutFence);
  return balanced ?? withoutFence;
}

/**
 * Scan for the first top-level `{...}` or `[...]` block, tracking string literals
 * and escapes so braces inside strings do not affect the balance count. Returns
 * null when no balanced block is found (the caller falls back to the raw text).
 */
function extractBalancedJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
