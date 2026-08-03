import "@tanstack/react-start/server-only";

import { normalizeCitationUrl } from "./content-copilot.ts";
import type { ContentCopilotEvidence } from "./content-copilot.ts";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 12_000;
const TAVILY_MAX_RESULTS = 5;
const TAVILY_MAX_TITLE_CHARS = 300;
const TAVILY_MAX_EXCERPT_CHARS = 500;

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;
type TavilyResearchError = "TAVILY_NOT_CONFIGURED" | "TAVILY_SEARCH_FAILED";

export type TavilyResearchResult = {
  ok: boolean;
  evidence: ContentCopilotEvidence[];
  error: TavilyResearchError | null;
};

export function createTavilyResearchClient({
  fetchImpl = fetch,
  apiKey,
}: {
  fetchImpl?: FetchImpl;
  apiKey: string | null | undefined;
}) {
  return {
    async search({
      query,
      maxResults,
    }: {
      query: string;
      maxResults: number;
    }): Promise<TavilyResearchResult> {
      const configuredApiKey = apiKey?.trim();
      if (!configuredApiKey) return failedResult("TAVILY_NOT_CONFIGURED");

      try {
        const response = await fetchImpl(TAVILY_SEARCH_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${configuredApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query,
            max_results: boundedMaxResults(maxResults),
            search_depth: "basic",
            include_answer: false,
            include_raw_content: false,
          }),
          signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
        });

        if (!response.ok) return failedResult("TAVILY_SEARCH_FAILED");

        const body = (await response.json()) as { results?: unknown };
        return { ok: true, evidence: extractEvidence(body.results), error: null };
      } catch {
        return failedResult("TAVILY_SEARCH_FAILED");
      }
    },
  };
}

function boundedMaxResults(value: number) {
  if (!Number.isFinite(value)) return TAVILY_MAX_RESULTS;
  return Math.min(Math.max(Math.floor(value), 1), TAVILY_MAX_RESULTS);
}

function extractEvidence(results: unknown): ContentCopilotEvidence[] {
  if (!Array.isArray(results)) return [];

  const evidence: ContentCopilotEvidence[] = [];
  for (const item of results) {
    if (evidence.length === TAVILY_MAX_RESULTS || !item || typeof item !== "object") continue;

    const { title, url, content } = item as Record<string, unknown>;
    if (typeof title !== "string" || typeof url !== "string" || typeof content !== "string")
      continue;

    const normalizedUrl = normalizeCitationUrl(url);
    const normalizedTitle = cleanText(title, TAVILY_MAX_TITLE_CHARS);
    const excerpt = cleanText(content, TAVILY_MAX_EXCERPT_CHARS);
    if (!normalizedUrl || !normalizedTitle || !excerpt) continue;

    evidence.push({
      id: `web-${evidence.length + 1}`,
      type: "web",
      title: normalizedTitle,
      url: normalizedUrl,
      excerpt,
    });
  }

  return evidence;
}

function cleanText(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function failedResult(error: TavilyResearchError): TavilyResearchResult {
  return { ok: false, evidence: [], error };
}
