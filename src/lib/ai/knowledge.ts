import type { AiKnowledgeSourceType, AiVisibility } from "./ai-types";

export function chunkKnowledgeText(input: { text: string; maxChars?: number }) {
  const maxChars = input.maxChars ?? 900;
  const normalized = input.text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = normalized.split(/(?<=[。.!?！？])\s*/u).filter(Boolean);
  const chunks: Array<{ text: string; sort_order: number }> = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && `${current} ${sentence}`.length > maxChars) {
      chunks.push({ text: current.trim(), sort_order: chunks.length + 1 });
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim()) chunks.push({ text: current.trim(), sort_order: chunks.length + 1 });
  return chunks;
}

export function normalizeKnowledgeSource(input: {
  source_type: AiKnowledgeSourceType;
  source_id: string;
  title: string;
  status?: string | null;
  published?: boolean | null;
  url_path?: string | null;
}) {
  const listingIsPublic = input.source_type !== "listing" || input.status === "active";
  const published = input.published ?? listingIsPublic;
  const visibility: AiVisibility = published && listingIsPublic ? "public" : "staff";

  return {
    source_type: input.source_type,
    source_id: input.source_id,
    title: input.title,
    url_path: input.url_path ?? null,
    published,
    visibility,
  };
}

export function filterPublicKnowledgeChunks<
  T extends { visibility?: string; published?: boolean; stale?: boolean },
>(chunks: T[]) {
  return chunks.filter(
    (chunk) => chunk.visibility === "public" && chunk.published !== false && chunk.stale !== true,
  );
}
