import "@tanstack/react-start/server-only";

export type ContentCopilotConfig = {
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  enabled: boolean;
};

export function getContentCopilotConfig(): ContentCopilotConfig {
  const baseUrl = process.env.OPENCODE_GO_BASE_URL?.replace(/\/+$/, "") || null;
  const apiKey = process.env.OPENCODE_GO_API_KEY || null;
  const model = process.env.OPENCODE_GO_MODEL || null;

  return { baseUrl, apiKey, model, enabled: Boolean(baseUrl && apiKey && model) };
}
