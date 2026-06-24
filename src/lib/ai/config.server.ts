export type AiServerConfig = {
  apiKey: string | null;
  enabled: boolean;
  textModel: string | null;
  embeddingModel: string | null;
};

export function getAiServerConfig(): AiServerConfig {
  const apiKey = process.env.AI_GATEWAY_API_KEY || null;
  const textModel = process.env.AI_GATEWAY_MODEL || null;
  const embeddingModel = process.env.AI_GATEWAY_EMBEDDING_MODEL || null;

  return {
    apiKey,
    enabled: Boolean(apiKey && textModel),
    textModel,
    embeddingModel,
  };
}

export function isAiEnabled() {
  return getAiServerConfig().enabled;
}
