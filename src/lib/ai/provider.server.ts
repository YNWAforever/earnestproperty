import "@tanstack/react-start/server-only";

import { getAiServerConfig } from "./config.server.ts";

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

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
    const response = await fetch(`${AI_GATEWAY_BASE_URL}/chat/completions`, {
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
  } catch {
    return { ok: false, value: input.fallback, error: "AI_JSON_PARSE_FAILED" };
  }
}

export async function embedAiTexts(values: string[]) {
  const config = getAiServerConfig();
  if (!config.enabled || !config.embeddingModel || values.length === 0) {
    return { ok: false as const, embeddings: [] as number[][], error: "AI_EMBEDDINGS_DISABLED" };
  }

  try {
    const response = await fetch(`${AI_GATEWAY_BASE_URL}/embeddings`, {
      method: "POST",
      headers: gatewayHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.embeddingModel,
        input: values,
      }),
    });
    if (!response.ok) throw new Error(`AI Gateway embeddings failed: ${response.status}`);
    const result = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    const embeddings =
      result.data?.map((item) =>
        Array.isArray(item.embedding) ? item.embedding.map(Number) : [],
      ) ?? [];
    if (
      embeddings.length !== values.length ||
      embeddings.some((embedding) => embedding.length === 0)
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

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
