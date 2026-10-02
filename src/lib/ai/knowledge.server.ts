import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import { getSql, queryRows, stringOrEmpty, stringOrNull } from "@/lib/neon/db.server";

import type { AiKnowledgeChunk, AiKnowledgeSourceType, AiVisibility } from "./ai-types";
import { getAiServerConfig } from "./config.server.ts";
import {
  chunkKnowledgeText,
  filterPublicKnowledgeChunks,
  normalizeKnowledgeSource,
} from "./knowledge.ts";
import { embedAiTexts, generateAiText } from "./provider.server.ts";
import {
  publicKnowledgeCurrentSourcesCte,
  publicKnowledgeRevisionGate,
} from "./knowledge-freshness.server";

// Must match the embedding column dimension in the ai_knowledge_chunks migration
// (vector(1536)). A returned embedding of any other length cannot be stored, so we
// surface it loudly instead of silently degrading search to a null vector.
const EMBEDDING_DIMENSIONS = 1536;

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
  source_revision?: string;
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
  source_revision: unknown;
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

export async function rebuildAiKnowledgeIndex(
  options: {
    checkpoint?: () => Promise<void>;
    sourceKeys?: ObservedKnowledgeSource[];
    allowEmbeddings?: boolean;
  } = {},
) {
  const checkpoint = options.checkpoint ?? (async () => {});
  await checkpoint();
  const sources = await fetchPublicKnowledgeSources();
  const embeddingModel = getAiServerConfig().embeddingModel;
  let indexedSources = 0;
  let indexedChunks = 0;
  let embeddingDimensionFailures = 0;

  const sourceKeys = options.sourceKeys ? new Set(options.sourceKeys.map(sourceKey)) : null;
  for (const source of sources) {
    if (sourceKeys && !sourceKeys.has(sourceKey(source))) continue;
    await checkpoint();
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

    await checkpoint();
    const embeddings =
      options.allowEmbeddings === false
        ? { ok: false as const, embeddings: [] as number[][] }
        : await embedAiTexts(chunks.map((chunk) => chunk.text));
    await checkpoint();
    const preparedChunks = chunks.map<PreparedKnowledgeChunk>((chunk, index) => ({
      sort_order: chunk.sort_order,
      chunk_text: chunk.text,
      summary: null,
      metadata: {
        url_path: source.url_path,
        source_type: source.source_type,
        ...(source.metadata ?? {}),
        source_revision: source.source_revision,
      },
      estate_slug: source.estate_slug ?? null,
      district_slug: source.district_slug ?? null,
      listing_id: source.listing_id ?? null,
      visibility: normalized.visibility,
      freshness_score: freshnessScore(normalized.source_type),
      embedding: embeddingVectorString(embeddings.ok ? embeddings.embeddings[index] : null, {
        model: embeddingModel,
        onDimensionMismatch: () => {
          embeddingDimensionFailures += 1;
        },
      }),
      content_hash: chunk.content_hash,
    }));

    await checkpoint();
    const publishedChunks = await replaceKnowledgeChunks(
      normalized,
      source.source_revision ?? "",
      contentHash,
      preparedChunks,
    );
    await checkpoint();
    indexedChunks += publishedChunks;
    if (publishedChunks) indexedSources += 1;
  }

  await checkpoint();
  await reconcileUnobservedKnowledgeSources(options.sourceKeys);
  await checkpoint();

  if (embeddingDimensionFailures > 0) {
    console.error(
      `[ai-knowledge] rebuild stored ${embeddingDimensionFailures} chunk(s) without embeddings due to dimension mismatch (model=${embeddingModel ?? "unknown"}, expected=${EMBEDDING_DIMENSIONS}). Semantic search is degraded for those chunks.`,
    );
  }

  return { indexedSources, indexedChunks, embeddingDimensionFailures };
}

export type AiKnowledgeRebuildJobPayload = { requestedByStaffId: string };

export async function runAiKnowledgeRebuildOperation(
  _payload: AiKnowledgeRebuildJobPayload,
  deps: {
    rebuildAiKnowledgeIndex?: typeof rebuildAiKnowledgeIndex;
    checkpoint?: () => Promise<void>;
  } = {},
) {
  const rebuild = deps.rebuildAiKnowledgeIndex ?? rebuildAiKnowledgeIndex;
  const result = await rebuild({ checkpoint: deps.checkpoint });
  return {
    indexedSources: Number(result.indexedSources) || 0,
    indexedChunks: Number(result.indexedChunks) || 0,
    embeddingDimensionFailures: Number(result.embeddingDimensionFailures) || 0,
  };
}

export async function searchPublicKnowledge(input: { query: string; limit?: number }) {
  const query = input.query.trim();
  if (!query) return [] as AiKnowledgeChunk[];

  const likePattern = escapeLike(query);
  const requestedLimit = Number(input.limit ?? 6);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.floor(requestedLimit), 1), 12)
    : 6;
  const rows = await queryRows<KnowledgeChunkRow>(
    `${publicKnowledgeCurrentSourcesCte()} SELECT
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
       s.published,
       current_source.source_revision
     FROM ai_knowledge_chunks c
     JOIN ai_knowledge_sources s ON s.id = c.source_id
     LEFT JOIN current_public_sources current_source ON current_source.source_type=s.source_type::text AND current_source.source_id=s.source_id
     WHERE c.visibility = 'public'
       AND s.public_visibility = 'public'
       AND s.published = true
       AND c.stale = false
       ${publicKnowledgeRevisionGate}
       AND (
         c.chunk_text ILIKE '%' || $1 || '%' ESCAPE '\\'
         OR s.title ILIKE '%' || $1 || '%' ESCAPE '\\'
         OR c.estate_slug ILIKE '%' || $1 || '%' ESCAPE '\\'
         OR c.district_slug ILIKE '%' || $1 || '%' ESCAPE '\\'
         OR c.metadata->>'listing_no' ILIKE '%' || $1 || '%' ESCAPE '\\'
       )
     ORDER BY c.freshness_score DESC, c.created_at DESC
     LIMIT $2`,
    [likePattern, limit],
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

    // Discard the entire answer, including the fallback excerpt, if any source
    // changed while the provider was in flight. Removing citations alone leaves
    // stale facts in the generated text.
    if (!(await revalidatePublicKnowledgeChunks(chunks))) return publicFallbackAnswer();

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
      "SELECT id, scope, question, answer, md5(to_jsonb(f)::text) AS source_revision FROM faqs f ORDER BY scope, sort_order, created_at",
    ),
    queryRows(
      `SELECT id, slug, name_zh, name_en, district_slug, developer, year_completed,
        phases, total_units, area_min, area_max, description, facilities, seo_title, seo_description,
        md5(to_jsonb(e)::text) AS source_revision
       FROM estates e
       ORDER BY name_zh`,
    ),
    queryRows(
      `SELECT id, slug, title, excerpt, content, published, category, seo_title, seo_description,
        md5(to_jsonb(a)::text) AS source_revision
       FROM articles a
       WHERE published = true
       ORDER BY published_at DESC NULLS LAST, updated_at DESC`,
    ),
    queryRows(
      `${publicKnowledgeCurrentSourcesCte()} SELECT * FROM current_public_listings ORDER BY updated_at DESC`,
    ),
  ]);

  return [
    ...faqs.map((row) => ({
      source_type: "faq" as const,
      source_id: stringOrEmpty(row.id),
      source_revision: stringOrEmpty(row.source_revision),
      title: stringOrEmpty(row.question),
      url_path: null,
      text: joinText([row.question, row.answer]),
      published: true,
      metadata: { scope: stringOrNull(row.scope) },
    })),
    ...estates.map((row) => ({
      source_type: "estate" as const,
      source_id: stringOrEmpty(row.id),
      source_revision: stringOrEmpty(row.source_revision),
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
      source_revision: stringOrEmpty(row.source_revision),
      title: stringOrEmpty(row.title),
      url_path: `/blog/${stringOrEmpty(row.slug)}`,
      text: joinText([row.title, row.excerpt, row.content, row.seo_title, row.seo_description]),
      published: row.published === true,
      metadata: { category: stringOrNull(row.category) },
    })),
    ...listings.map((row) => ({
      source_type: "listing" as const,
      source_id: stringOrEmpty(row.id),
      source_revision: stringOrEmpty(row.source_revision),
      title: stringOrEmpty(row.title_zh),
      url_path: `/property/${stringOrEmpty(row.public_listing_no)}`,
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
        public_listing_no: stringOrNull(row.public_listing_no),
        offerings: row.offerings,
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

async function replaceKnowledgeChunks(
  source: ReturnType<typeof normalizeKnowledgeSource>,
  revision: string,
  contentHash: string,
  chunks: PreparedKnowledgeChunk[],
) {
  const sql = getSql();
  const currentGate = `EXISTS(SELECT 1 FROM current_public_sources current_source
    WHERE current_source.source_type=$1::text AND current_source.source_id=$2
      AND current_source.source_revision=$3)`;
  const keyParams = [source.source_type, source.source_id, revision];
  // Lock publication before reading current revisions. An older worker must
  // never overwrite a newer worker that has already acknowledged the ledger.
  const results = await sql.transaction((tx) => [
    tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `knowledge:${sourceKey(source)}`,
    ]),
    tx.query(
      `${publicKnowledgeCurrentSourcesCte()}
      INSERT INTO ai_knowledge_sources(source_type,source_id,title,url_path,public_visibility,published,last_indexed_at,content_hash,updated_at)
      SELECT $1::text::ai_knowledge_source_type,$2,$4,$5,$6::ai_visibility,$7,now(),$8,now()
      WHERE ${currentGate}
      ON CONFLICT(source_type,source_id) DO UPDATE SET title=EXCLUDED.title,url_path=EXCLUDED.url_path,
        public_visibility=EXCLUDED.public_visibility,published=EXCLUDED.published,
        last_indexed_at=now(),content_hash=EXCLUDED.content_hash,updated_at=now()`,
      [
        ...keyParams,
        source.title,
        source.url_path,
        source.visibility,
        source.published,
        contentHash,
      ],
    ),
    tx.query(
      `${publicKnowledgeCurrentSourcesCte()}
      DELETE FROM ai_knowledge_chunks WHERE source_id IN(SELECT id FROM ai_knowledge_sources WHERE source_type::text=$1 AND source_id=$2)
      AND ${currentGate}`,
      keyParams,
    ),
    tx.query(
      `${publicKnowledgeCurrentSourcesCte()} INSERT INTO ai_knowledge_chunks (
        source_id, sort_order, chunk_text, summary, metadata, estate_slug, district_slug,
        listing_id, visibility, freshness_score, embedding, content_hash, stale, updated_at
      )
      SELECT
        s.id,
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
      FROM ai_knowledge_sources s CROSS JOIN jsonb_to_recordset($4::jsonb) AS chunk(
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
      ) WHERE s.source_type::text=$1 AND s.source_id=$2 AND ${currentGate}
      RETURNING id`,
      [...keyParams, JSON.stringify(chunks)],
    ),
  ]);
  return results[3].length;
}

async function reconcileUnobservedKnowledgeSources(sourceKeys?: ObservedKnowledgeSource[]) {
  // Absence belongs to the current authoritative view, never to an older
  // worker's captured list. A concurrent reactivation must remain published.
  await queryRows(
    `${publicKnowledgeCurrentSourcesCte()}, obsolete AS (
       UPDATE ai_knowledge_sources s
       SET published = false, public_visibility = 'staff', updated_at = now()
       WHERE s.source_type::text = ANY($2::text[])
         AND ($1::jsonb IS NULL OR EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb)
           AS target(source_type text,source_id text) WHERE target.source_type=s.source_type::text AND target.source_id=s.source_id))
         AND NOT EXISTS (SELECT 1 FROM current_public_sources current_source
           WHERE current_source.source_type=s.source_type::text AND current_source.source_id=s.source_id)
       RETURNING s.id
     )
     UPDATE ai_knowledge_chunks c
     SET stale = true, updated_at = now()
     WHERE c.source_id IN (SELECT id FROM obsolete)`,
    [sourceKeys ? JSON.stringify(sourceKeys) : null, MANAGED_REBUILD_SOURCE_TYPES],
  );
}

function sourceKey(source: ObservedKnowledgeSource) {
  return `${source.source_type}:${source.source_id}`;
}

function normalizeSourceText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

// Escape ILIKE wildcards so a visitor-supplied query containing % or _ (or a literal
// backslash) is treated as literal text. Pairs with `ESCAPE '\\'` in the SQL pattern.
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function joinText(values: unknown[]) {
  return values
    .map((value) => stringOrNull(value)?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function listingFacts(row: Record<string, unknown>) {
  const offerings = Array.isArray(row.offerings)
    ? (row.offerings as Array<Record<string, unknown>>)
    : [];
  const facts = [
    ...offerings.map((offer) =>
      offer.deal_type === "sale"
        ? `出售：${offer.price ?? "待核實"}`
        : `出租：${offer.rent ?? "待核實"}`,
    ),
    row.saleable_area ? `實用面積：${row.saleable_area}` : null,
    row.bedrooms ? `睡房：${row.bedrooms}` : null,
    row.bathrooms ? `浴室：${row.bathrooms}` : null,
    row.district_slug ? `地區：${row.district_slug}` : null,
  ].filter(Boolean);
  return facts.length ? facts.join("\n") : null;
}

export async function repairPublicKnowledgeIndex(
  options: { checkpoint?: () => Promise<void> } = {},
) {
  const requests = await queryRows<{
    source_type: AiKnowledgeSourceType;
    source_id: string;
    revision: string;
  }>(
    "SELECT source_type,source_id,revision::text FROM ai_knowledge_repair_requests WHERE revision>completed_revision ORDER BY requested_at,source_type,source_id LIMIT 200",
  );
  if (!requests.length)
    return { indexedSources: 0, indexedChunks: 0, embeddingDimensionFailures: 0 };
  const result = await rebuildAiKnowledgeIndex({
    ...options,
    sourceKeys: requests,
    allowEmbeddings: false,
  });
  await (options.checkpoint ?? (async () => {}))();
  await queryRows(
    `UPDATE ai_knowledge_repair_requests r SET completed_revision=r.revision,completed_at=now()
    FROM jsonb_to_recordset($1::jsonb) AS completed(source_type text,source_id text,revision text)
    WHERE r.source_type::text=completed.source_type AND r.source_id=completed.source_id AND r.revision=completed.revision::bigint`,
    [JSON.stringify(requests)],
  );
  // A batch may exceed the bounded work limit, or change during provider/DB
  // work. Keep a new durable job for whatever has not been acknowledged by CAS.
  await queryRows(`INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,idempotency_key)
    SELECT 'ai.knowledge.repair',1,jsonb_build_object('batchId',txid_current()::text),'queued',5,'ai.knowledge.repair:'||txid_current()::text
    WHERE EXISTS(SELECT 1 FROM ai_knowledge_repair_requests WHERE revision>completed_revision)
    ON CONFLICT(idempotency_key) DO NOTHING`);
  return result;
}

function freshnessScore(sourceType: AiKnowledgeSourceType) {
  if (sourceType === "listing") return 1;
  if (sourceType === "article") return 0.9;
  if (sourceType === "faq") return 0.85;
  return 0.8;
}

function embeddingVectorString(
  value: number[] | null | undefined,
  context: { model: string | null; onDimensionMismatch: () => void },
) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  if (value.length !== EMBEDDING_DIMENSIONS) {
    // A non-empty embedding with the wrong dimension would otherwise be dropped to
    // null and silently degrade search. Report the model + actual length and let the
    // caller count the failure so rebuildAiKnowledgeIndex can flag it.
    console.error(
      `[ai-knowledge] embedding dimension mismatch: model=${context.model ?? "unknown"} expected=${EMBEDDING_DIMENSIONS} actual=${value.length}`,
    );
    context.onDimensionMismatch();
    return null;
  }
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
      source_revision: stringOrNull(row.source_revision),
    })),
  ) as AiKnowledgeChunk[];
}

async function fallbackSearchPublicKnowledge(input: { query: string; limit: number }) {
  const tokens = knowledgeSearchTokens(input.query);
  if (!tokens.length) return [] as AiKnowledgeChunk[];

  const rows = await queryRows<KnowledgeChunkRow>(
    `${publicKnowledgeCurrentSourcesCte()} SELECT
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
       s.published,
       current_source.source_revision
     FROM ai_knowledge_chunks c
     JOIN ai_knowledge_sources s ON s.id = c.source_id
     LEFT JOIN current_public_sources current_source ON current_source.source_type=s.source_type::text AND current_source.source_id=s.source_id
     WHERE c.visibility = 'public'
       AND s.public_visibility = 'public'
       AND s.published = true
       AND c.stale = false
       ${publicKnowledgeRevisionGate}
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

export async function revalidatePublicKnowledgeChunks(chunks: AiKnowledgeChunk[]) {
  if (!chunks.length) return true;
  const rows = await queryRows<{ id: string; source_revision: string }>(
    `${publicKnowledgeCurrentSourcesCte()} SELECT c.id,current_source.source_revision
     FROM ai_knowledge_chunks c JOIN ai_knowledge_sources s ON s.id=c.source_id
     LEFT JOIN current_public_sources current_source ON current_source.source_type=s.source_type::text AND current_source.source_id=s.source_id
     WHERE c.id=ANY($1::uuid[]) AND c.visibility='public' AND s.public_visibility='public'
       AND s.published=true AND c.stale=false ${publicKnowledgeRevisionGate}`,
    [chunks.map((chunk) => chunk.id)],
  );
  const revisions = new Map(rows.map((row) => [row.id, row.source_revision]));
  return chunks.every(
    (chunk) => Boolean(chunk.source_revision) && revisions.get(chunk.id) === chunk.source_revision,
  );
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
  // `title` is optional on AiKnowledgeChunk, so this threw on any chunk stored
  // without one -- taking down the whole live-agent retrieval scoring pass.
  const title = (chunk.title ?? "").toLowerCase();
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
