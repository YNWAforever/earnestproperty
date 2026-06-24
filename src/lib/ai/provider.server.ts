import { embedMany, generateText } from "ai";

import { getAiServerConfig } from "./config.server.ts";

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

  const result = await generateText({
    model: config.textModel,
    system: input.system,
    prompt: input.prompt,
    temperature: input.temperature ?? 0.2,
    maxOutputTokens: input.maxOutputTokens ?? 700,
  });

  return { ok: true as const, text: result.text, error: null };
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

  const result = await embedMany({
    model: config.embeddingModel,
    values,
  });

  return { ok: true as const, embeddings: result.embeddings, error: null };
}

function stripJsonFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}
