import "@tanstack/react-start/server-only";

import { getAiServerConfig } from "./config.server.ts";

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const AI_TIMEOUT_MS = 20000;
const AI_MAX_RETRIES = 2;
const AI_RETRY_BASE_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

/**
 * fetch with a hard request timeout and a small retry-with-backoff on transient
 * failures (network errors, HTTP 429, and 5xx). Non-retryable HTTP responses
 * (e.g. 4xx other than 429) are returned to the caller as-is.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (isRetryableStatus(response.status) && attempt < AI_MAX_RETRIES) {
        lastError = new Error(`AI Gateway transient status ${response.status}`);
        await sleep(AI_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      // Network error / timeout (AbortError) — retry while attempts remain.
      lastError = error;
      if (attempt < AI_MAX_RETRIES) {
        await sleep(AI_RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI Gateway request failed");
}

export type AiJsonResult<T> = {
  ok: boolean;
  value: T | null;
  error: string | null;
};

export async function generateAiText(input: {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}) {
  const config = getAiServerConfig();
  if (!config.enabled || !config.textModel) {
    return { ok: false as const, text: "", error: "AI_DISABLED" };
  }

  try {
    const response = await fetchWithRetry(`${AI_GATEWAY_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: gatewayHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.textModel,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxOutputTokens ?? 700,
        stream: false,
      }),
    });
    if (!response.ok) throw new Error(`AI Gateway text failed: ${response.status}`);
    const result = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("AI Gateway text response missing content");

    return { ok: true as const, text, error: null };
  } catch {
    return { ok: false as const, text: "", error: "AI_GENERATION_FAILED" };
  }
}

export async function generateAiJson<T>(input: {
  system: string;
  prompt: string;
  fallback: T;
}): Promise<AiJsonResult<T>> {
  const result = await generateAiText({
    system: input.system,
    prompt: `${input.prompt}\n\nReturn strict JSON only.`,
    temperature: 0.1,
    maxOutputTokens: 900,
  });

  if (!result.ok) return { ok: false, value: input.fallback, error: result.error };

  try {
    return { ok: true, value: JSON.parse(stripJsonFence(result.text)) as T, error: null };
  } catch (error) {
    console.error("[ai] failed to parse JSON response", {
      error: error instanceof Error ? error.message : error,
      sample: result.text.slice(0, 200),
    });
    return { ok: false, value: input.fallback, error: "AI_JSON_PARSE_FAILED" };
  }
}

export async function embedAiTexts(values: string[]) {
  const config = getAiServerConfig();
  if (!config.enabled || !config.embeddingModel || values.length === 0) {
    return { ok: false as const, embeddings: [] as number[][], error: "AI_EMBEDDINGS_DISABLED" };
  }

  try {
    const response = await fetchWithRetry(`${AI_GATEWAY_BASE_URL}/embeddings`, {
      method: "POST",
      headers: gatewayHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.embeddingModel,
        input: values,
      }),
    });
    if (!response.ok) throw new Error(`AI Gateway embeddings failed: ${response.status}`);
    const result = (await response.json()) as {
      data?: Array<{ embedding?: unknown; index?: unknown }>;
    };
    // OpenAI-compatible embedding APIs return an `index` field and may reorder the
    // items, so we must place each embedding at its declared position rather than
    // trusting array order.
    const data = result.data ?? [];
    const embeddings = new Array<number[]>(values.length);
    for (let position = 0; position < data.length; position += 1) {
      const item = data[position];
      const index = Number.isInteger(item?.index) ? (item.index as number) : position;
      embeddings[index] = Array.isArray(item?.embedding) ? item.embedding.map(Number) : [];
    }
    if (
      data.length !== values.length ||
      embeddings.length !== values.length ||
      embeddings.some((embedding) => !Array.isArray(embedding) || embedding.length === 0)
    ) {
      throw new Error("AI Gateway embeddings response missing vectors");
    }

    return { ok: true as const, embeddings, error: null };
  } catch {
    return { ok: false as const, embeddings: [] as number[][], error: "AI_EMBEDDINGS_FAILED" };
  }
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
