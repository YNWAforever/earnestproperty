export type AiServerConfig = {
  enabled: boolean;
  textModel: string | null;
  embeddingModel: string | null;
};

export function getAiServerConfig(): AiServerConfig {
  const hasGatewayKey = Boolean(process.env.AI_GATEWAY_API_KEY);
  const textModel = process.env.AI_GATEWAY_MODEL || null;
  const embeddingModel = process.env.AI_GATEWAY_EMBEDDING_MODEL || null;

  return {
    enabled: hasGatewayKey && Boolean(textModel),
    textModel,
    embeddingModel,
  };
}

export function isAiEnabled() {
  return getAiServerConfig().enabled;
}
