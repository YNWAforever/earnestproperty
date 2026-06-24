import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import { getSql, queryRows, stringOrEmpty, stringOrNull } from "@/lib/neon/db.server";

import type { AiKnowledgeChunk, AiKnowledgeSourceType, AiVisibility } from "./ai-types";
import {
  chunkKnowledgeText,
  filterPublicKnowledgeChunks,
  normalizeKnowledgeSource,
} from "./knowledge.ts";
import { embedAiTexts, generateAiText } from "./provider.server.ts";

type RawSource = {
  source_type: AiKnowledgeSourceType;
  source_id: string;
  title: string;
  url_path: string | null;
  text: string;
  status?: string | null;
  published?: boolean | null;
  estate_slug?: string | null;
  district_slug?: string | null;
  listing_id?: string | null;
  metadata?: Record<string, unknown>;
};

type KnowledgeChunkRow = {
  id: unknown;
  source_id: unknown;
  source_type: unknown;
  title: unknown;
  url_path: unknown;
  sort_order: unknown;
  chunk_text: unknown;
  summary: unknown;
  metadata: unknown;
  estate_slug: unknown;
  district_slug: unknown;
  listing_id: unknown;
  visibility: unknown;
  freshness_score: unknown;
  stale: unknown;
  published: unknown;
};

type ObservedKnowledgeSource = {
  source_type: AiKnowledgeSourceType;
  source_id: string;
};

type PreparedKnowledgeChunk = {
  sort_order: number;
  chunk_text: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  estate_slug: string | null;
  district_slug: string | null;
  listing_id: string | null;
  visibility: AiVisibility;
  freshness_score: number;
  embedding: string | null;
  content_hash: string;
};

const MANAGED_REBUILD_SOURCE_TYPES: AiKnowledgeSourceType[] = [
  "faq",
  "estate",
  "article",
  "listing",
];

export async function rebuildAiKnowledgeIndex() {
  const sources = await fetchPublicKnowledgeSources();
  const observedSources = new Map<string, ObservedKnowledgeSource>();
  let indexedSources = 0;
  let indexedChunks = 0;

  for (const source of sources) {
    const normalizedText = normalizeSourceText(source.text);
    if (!normalizedText) continue;

    const normalized = normalizeKnowledgeSource({
      ...source,
      title: source.title.trim() || "Earnest Property",
    });
    const contentHash = hashText(`${normalized.title}\n${normalizedText}`);
    const chunks = chunkKnowledgeText({ text: normalizedText }).map((chunk) => ({
      ...chunk,
      content_hash: hashText(chunk.text),
    }));
    if (chunks.length === 0) continue;

    const embeddings = await embedAiTexts(chunks.map((chunk) => chunk.text));
    const preparedChunks = chunks.map<PreparedKnowledgeChunk>((chunk, index) => ({
      sort_order: chunk.sort_order,
      chunk_text: chunk.text,
      summary: null,
      metadata: {
        url_path: source.url_path,
        source_type: source.source_type,
        ...(source.metadata ?? {}),
      },
      estate_slug: source.estate_slug ?? null,
      district_slug: source.district_slug ?? null,
      listing_id: source.listing_id ?? null,
      visibility: normalized.visibility,
      freshness_score: freshnessScore(normalized.source_type),
      embedding: embeddingVectorString(embeddings.ok ? embeddings.embeddings[index] : null),
      content_hash: chunk.content_hash,
    }));

    observedSources.set(sourceKey(normalized), {
      source_type: normalized.source_type,
      source_id: normalized.source_id,
    });

    const sourceRows = await queryRows(
      `INSERT INTO ai_knowledge_sources (
        source_type, source_id, title, url_path, public_visibility, published,
        last_indexed_at, content_hash, updated_at
      )
      VALUES ($1::ai_knowledge_source_type,$2,$3,$4,$5::ai_visibility,$6,now(),$7,now())
      ON CONFLICT (source_type, source_id) DO UPDATE SET
        title = EXCLUDED.title,
        url_path = EXCLUDED.url_path,
        public_visibility = EXCLUDED.public_visibility,
        published = EXCLUDED.published,
        last_indexed_at = now(),
        content_hash = EXCLUDED.content_hash,
        updated_at = now()
      RETURNING id`,
      [
        normalized.source_type,
        normalized.source_id,
        normalized.title,
        normalized.url_path,
        normalized.visibility,
        normalized.published,
        contentHash,
      ],
    );

    const sourceId = stringOrEmpty(sourceRows[0]?.id);
    if (!sourceId) continue;

    await replaceKnowledgeChunks(sourceId, preparedChunks);
    indexedChunks += preparedChunks.length;

    indexedSources += 1;
  }

  await reconcileUnobservedKnowledgeSources(Array.from(observedSources.values()));

  return { indexedSources, indexedChunks };
}

export async function searchPublicKnowledge(input: { query: string; limit?: number }) {
  const query = input.query.trim();
  if (!query) return [] as AiKnowledgeChunk[];

  const requestedLimit = Number(input.limit ?? 6);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 12)
    : 6;
  const rows = await queryRows<KnowledgeChunkRow>(
    `SELECT
       c.id,
       c.source_id,
       s.source_type,
       s.title,
       s.url_path,
       c.sort_order,
       c.chunk_text,
       c.summary,
       c.metadata,
       c.estate_slug,
       c.district_slug,
       c.listing_id,
       c.visibility,
       c.freshness_score::float AS freshness_score,
       c.stale,
       s.published
     FROM ai_knowledge_chunks c
     JOIN ai_knowledge_sources s ON s.id = c.source_id
     WHERE c.visibility = 'public'
       AND s.public_visibility = 'public'
       AND s.published = true
       AND c.stale = false
       AND (
         c.chunk_text ILIKE '%' || $1 || '%'
         OR s.title ILIKE '%' || $1 || '%'
         OR c.estate_slug ILIKE '%' || $1 || '%'
         OR c.district_slug ILIKE '%' || $1 || '%'
         OR c.metadata->>'listing_no' ILIKE '%' || $1 || '%'
       )
     ORDER BY c.freshness_score DESC, c.created_at DESC
     LIMIT $2`,
    [query, limit],
  );

  if (rows.length) return mapKnowledgeChunkRows(rows);

  return fallbackSearchPublicKnowledge({ query, limit });
}

export async function answerFromPublicKnowledge(input: { question: string }) {
  try {
    const chunks = await searchPublicKnowledge({ query: input.question, limit: 6 });
    if (!chunks.length) return publicFallbackAnswer();

    const fallbackAnswer = chunks[0]?.chunk_text.slice(0, 350) || publicFallbackAnswer().answer;
    const prompt = [
      "Question:",
      input.question,
      "",
      "Sources:",
      ...chunks.map(
        (chunk, index) =>
          `[${index + 1}] ${chunk.title ?? "Earnest Property"} ${chunk.url_path ?? ""}\n${chunk.chunk_text}`,
      ),
    ].join("\n");

    const result = await generateAiText({
      system:
        "You are Earnest Property's public website assistant. Answer in Traditional Chinese. Use only the provided sources. If uncertain, say a licensed agent can follow up.",
      prompt,
      maxOutputTokens: 450,
    });

    return {
      answer: result.ok ? result.text : fallbackAnswer,
      confidence: result.ok ? 0.75 : 0.45,
      citations: chunks.map((chunk) => ({
        title: chunk.title ?? "Earnest Property",
        url_path: chunk.url_path ?? null,
        source_type: chunk.source_type ?? "unknown",
      })),
    };
  } catch {
    return publicFallbackAnswer();
  }
}

async function fetchPublicKnowledgeSources(): Promise<RawSource[]> {
  const [faqs, estates, articles, listings] = await Promise.all([
    queryRows(
      "SELECT id, scope, question, answer FROM faqs ORDER BY scope, sort_order, created_at",
    ),
    queryRows(
      `SELECT id, slug, name_zh, name_en, district_slug, developer, year_completed,
        phases, total_units, area_min, area_max, description, facilities, seo_title, seo_description
       FROM estates
       ORDER BY name_zh`,
    ),
    queryRows(
      `SELECT id, slug, title, excerpt, content, published, category, seo_title, seo_description
       FROM articles
       WHERE published = true
       ORDER BY published_at DESC NULLS LAST, updated_at DESC`,
    ),
    queryRows(
      `SELECT
        p.id,
        p.listing_no,
        p.title_zh,
        p.deal_type,
        p.price,
        p.rent,
        p.saleable_area,
        p.bedrooms,
        p.bathrooms,
        p.description,
        p.status,
        p.district_slug,
        p.estate_id,
        p.seo_title,
        p.seo_description,
        e.slug AS estate_slug,
        e.name_zh AS estate_name_zh
       FROM properties p
       LEFT JOIN estates e ON e.id = p.estate_id
       WHERE p.status = 'active'
       ORDER BY p.updated_at DESC
       LIMIT 500`,
    ),
  ]);

  return [
    ...faqs.map((row) => ({
      source_type: "faq" as const,
      source_id: stringOrEmpty(row.id),
      title: stringOrEmpty(row.question),
      url_path: null,
      text: joinText([row.question, row.answer]),
      published: true,
      metadata: { scope: stringOrNull(row.scope) },
    })),
    ...estates.map((row) => ({
      source_type: "estate" as const,
      source_id: stringOrEmpty(row.id),
      title: stringOrEmpty(row.name_zh),
      url_path: `/estate/${stringOrEmpty(row.slug)}`,
      text: joinText([
        row.name_zh,
        row.name_en,
        row.description,
        row.seo_title,
        row.seo_description,
        Array.isArray(row.facilities) ? `設施：${row.facilities.map(String).join("、")}` : null,
      ]),
      published: true,
      estate_slug: stringOrNull(row.slug),
      district_slug: stringOrNull(row.district_slug),
      metadata: {
        developer: stringOrNull(row.developer),
        year_completed: row.year_completed ?? null,
        phases: row.phases ?? null,
        total_units: row.total_units ?? null,
        area_min: row.area_min ?? null,
        area_max: row.area_max ?? null,
      },
    })),
    ...articles.map((row) => ({
      source_type: "article" as const,
      source_id: stringOrEmpty(row.id),
      title: stringOrEmpty(row.title),
      url_path: `/blog/${stringOrEmpty(row.slug)}`,
      text: joinText([row.title, row.excerpt, row.content, row.seo_title, row.seo_description]),
      published: row.published === true,
      metadata: { category: stringOrNull(row.category) },
    })),
    ...listings.map((row) => ({
      source_type: "listing" as const,
      source_id: stringOrEmpty(row.id),
      title: stringOrEmpty(row.title_zh),
      url_path: `/property/${stringOrEmpty(row.listing_no)}`,
      text: joinText([
        row.title_zh,
        row.estate_name_zh,
        row.description,
        row.seo_title,
        row.seo_description,
        listingFacts(row),
      ]),
      status: stringOrNull(row.status),
      published: row.status === "active",
      estate_slug: stringOrNull(row.estate_slug),
      district_slug: stringOrNull(row.district_slug),
      listing_id: stringOrEmpty(row.id),
      metadata: {
        listing_no: stringOrNull(row.listing_no),
        deal_type: stringOrNull(row.deal_type),
        estate_id: stringOrNull(row.estate_id),
        price: row.price ?? null,
        rent: row.rent ?? null,
        saleable_area: row.saleable_area ?? null,
        bedrooms: row.bedrooms ?? null,
        bathrooms: row.bathrooms ?? null,
      },
    })),
  ];
}

async function replaceKnowledgeChunks(sourceId: string, chunks: PreparedKnowledgeChunk[]) {
  const sql = getSql();
  await sql.transaction((tx) => [
    tx.query("DELETE FROM ai_knowledge_chunks WHERE source_id = $1", [sourceId]),
    tx.query(
      `INSERT INTO ai_knowledge_chunks (
        source_id, sort_order, chunk_text, summary, metadata, estate_slug, district_slug,
        listing_id, visibility, freshness_score, embedding, content_hash, stale, updated_at
      )
      SELECT
        $1::uuid,
        chunk.sort_order,
        chunk.chunk_text,
        chunk.summary,
        chunk.metadata,
        chunk.estate_slug,
        chunk.district_slug,
        chunk.listing_id::uuid,
        chunk.visibility::ai_visibility,
        chunk.freshness_score,
        chunk.embedding::vector,
        chunk.content_hash,
        false,
        now()
      FROM jsonb_to_recordset($2::jsonb) AS chunk(
        sort_order integer,
        chunk_text text,
        summary text,
        metadata jsonb,
        estate_slug text,
        district_slug text,
        listing_id text,
        visibility text,
        freshness_score numeric,
        embedding text,
        content_hash text
      )`,
      [sourceId, JSON.stringify(chunks)],
    ),
  ]);
}

async function reconcileUnobservedKnowledgeSources(observedSources: ObservedKnowledgeSource[]) {
  if (observedSources.length === 0) {
    await queryRows(
      `WITH obsolete AS (
         UPDATE ai_knowledge_sources
         SET published = false, public_visibility = 'staff', updated_at = now()
         WHERE source_type::text = ANY($1::text[])
         RETURNING id
       )
       UPDATE ai_knowledge_chunks c
       SET stale = true, updated_at = now()
       WHERE c.source_id IN (SELECT id FROM obsolete)`,
      [MANAGED_REBUILD_SOURCE_TYPES],
    );
    return;
  }

  await queryRows(
    `WITH observed AS (
       SELECT
         source_type::ai_knowledge_source_type AS source_type,
         source_id
       FROM jsonb_to_recordset($1::jsonb) AS source(source_type text, source_id text)
     ),
     obsolete AS (
       UPDATE ai_knowledge_sources s
       SET published = false, public_visibility = 'staff', updated_at = now()
       WHERE s.source_type::text = ANY($2::text[])
         AND NOT EXISTS (
         SELECT 1
         FROM observed o
         WHERE o.source_type = s.source_type
           AND o.source_id = s.source_id
       )
       RETURNING s.id
     )
     UPDATE ai_knowledge_chunks c
     SET stale = true, updated_at = now()
     WHERE c.source_id IN (SELECT id FROM obsolete)`,
    [JSON.stringify(observedSources), MANAGED_REBUILD_SOURCE_TYPES],
  );
}

function sourceKey(source: ObservedKnowledgeSource) {
  return `${source.source_type}:${source.source_id}`;
}

function normalizeSourceText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function joinText(values: unknown[]) {
  return values
    .map((value) => stringOrNull(value)?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function listingFacts(row: Record<string, unknown>) {
  const facts = [
    row.deal_type ? `類型：${row.deal_type}` : null,
    row.price ? `售價：${row.price}` : null,
    row.rent ? `租金：${row.rent}` : null,
    row.saleable_area ? `實用面積：${row.saleable_area}` : null,
    row.bedrooms ? `睡房：${row.bedrooms}` : null,
    row.bathrooms ? `浴室：${row.bathrooms}` : null,
    row.district_slug ? `地區：${row.district_slug}` : null,
  ].filter(Boolean);
  return facts.length ? facts.join("\n") : null;
}

function freshnessScore(sourceType: AiKnowledgeSourceType) {
  if (sourceType === "listing") return 1;
  if (sourceType === "article") return 0.9;
  if (sourceType === "faq") return 0.85;
  return 0.8;
}

function embeddingVectorString(value: number[] | null | undefined) {
  if (!Array.isArray(value) || value.length !== 1536) return null;
  return `[${value.join(",")}]`;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return metadataRecord(parsed);
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapKnowledgeChunkRows(rows: KnowledgeChunkRow[]) {
  return filterPublicKnowledgeChunks(
    rows.map((row) => ({
      id: stringOrEmpty(row.id),
      source_id: stringOrEmpty(row.source_id),
      source_type: stringOrEmpty(row.source_type) as AiKnowledgeSourceType,
      title: stringOrEmpty(row.title),
      url_path: stringOrNull(row.url_path),
      sort_order: Number(row.sort_order ?? 1),
      chunk_text: stringOrEmpty(row.chunk_text),
      summary: stringOrNull(row.summary),
      metadata: metadataRecord(row.metadata),
      estate_slug: stringOrNull(row.estate_slug),
      district_slug: stringOrNull(row.district_slug),
      listing_id: stringOrNull(row.listing_id),
      visibility: stringOrEmpty(row.visibility) as AiVisibility,
      freshness_score: Number(row.freshness_score ?? 0),
      stale: row.stale === true,
      published: row.published === true,
    })),
  ) as AiKnowledgeChunk[];
}

async function fallbackSearchPublicKnowledge(input: { query: string; limit: number }) {
  const tokens = knowledgeSearchTokens(input.query);
  if (!tokens.length) return [] as AiKnowledgeChunk[];

  const rows = await queryRows<KnowledgeChunkRow>(
    `SELECT
       c.id,
       c.source_id,
       s.source_type,
       s.title,
       s.url_path,
       c.sort_order,
       c.chunk_text,
       c.summary,
       c.metadata,
       c.estate_slug,
       c.district_slug,
       c.listing_id,
       c.visibility,
       c.freshness_score::float AS freshness_score,
       c.stale,
       s.published
     FROM ai_knowledge_chunks c
     JOIN ai_knowledge_sources s ON s.id = c.source_id
     WHERE c.visibility = 'public'
       AND s.public_visibility = 'public'
       AND s.published = true
       AND c.stale = false
     ORDER BY c.freshness_score DESC, c.created_at DESC
     LIMIT 800`,
  );

  const scored = mapKnowledgeChunkRows(rows)
    .map((chunk) => ({ chunk, score: scoreKnowledgeChunk(chunk, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.chunk.freshness_score - a.chunk.freshness_score)
    .slice(0, input.limit)
    .map((item) => item.chunk);

  return scored;
}

function knowledgeSearchTokens(query: string) {
  const text = query.toLowerCase();
  const tokens = new Set<string>();
  for (const token of text.match(/[a-z0-9]+/g) ?? []) {
    if (token.length >= 2) tokens.add(token);
  }
  for (const phrase of text.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    for (let size = 2; size <= Math.min(4, phrase.length); size += 1) {
      for (let index = 0; index <= phrase.length - size; index += 1) {
        tokens.add(phrase.slice(index, index + size));
      }
    }
  }
  return Array.from(tokens);
}

function scoreKnowledgeChunk(chunk: AiKnowledgeChunk, tokens: string[]) {
  const title = chunk.title.toLowerCase();
  const body = chunk.chunk_text.toLowerCase();
  const slug = [chunk.estate_slug, chunk.district_slug, chunk.metadata?.listing_no]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const sourceBoost =
    chunk.source_type === "estate"
      ? 24
      : chunk.source_type === "faq"
        ? 12
        : chunk.source_type === "article"
          ? 6
          : 0;

  const score = tokens.reduce((total, token) => {
    if (title.includes(token)) return total + 8;
    if (slug.includes(token)) return total + 5;
    if (body.includes(token)) return total + 2;
    return total;
  }, 0);
  return score > 0 ? score + sourceBoost : 0;
}

function publicFallbackAnswer() {
  return {
    answer: "我暫時未能從已核實資料找到準確答案，可以留下 WhatsApp 讓持牌代理跟進。",
    confidence: 0,
    citations: [] as Array<{ title: string; url_path: string | null; source_type: string }>,
  };
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
