export type AiServerConfig = {
  apiKey: string | null;
  enabled: boolean;
  textModel: string | null;
};

export function getAiServerConfig(): AiServerConfig {
  const apiKey = process.env.AI_GATEWAY_API_KEY || null;
  const textModel = process.env.AI_GATEWAY_MODEL || null;

  return {
    apiKey,
    enabled: Boolean(apiKey && textModel),
    textModel,
  };
}

export function isAiEnabled() {
  return getAiServerConfig().enabled;
}
