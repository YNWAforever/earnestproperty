import {
  validateArticleBody,
  validateEditorialMetadata,
  validateSupplementalLinks,
} from "./content";
import type { ArticleInput, ArticleRecord, ArticleEditState } from "./types";
import type { CmsPayloadValue } from "../neon/admin-cms.types";

export function encodeArticle(input: ArticleInput): Record<string, CmsPayloadValue> {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    category_id: input.categoryId,
    published_at: input.publishedAt,
    cover_image: input.coverImage,
    cover_alt: input.coverAlt,
    content_format: input.body.format,
    content:
      input.body.format === "legacy-text" ? input.body.text : JSON.stringify(input.body.document),
    supplemental_links: input.links,
    editorial_metadata: input.editorial,
    reading_minutes: input.readingMinutes,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
  };
}
const nullable = (value: unknown) => (value == null ? null : String(value));
const date = (value: unknown) => (value == null ? null : new Date(String(value)).toISOString());
export function decodeArticle(raw: Record<string, unknown>): ArticleRecord {
  const p = raw.payload as Record<string, unknown>;
  return {
    id: String(raw.id),
    slug: String(p.slug),
    title: String(p.title),
    excerpt: nullable(p.excerpt),
    categoryId: nullable(p.category_id),
    published: raw.published === true,
    publishedAt: date(raw.published_at),
    createdAt: date(raw.created_at)!,
    coverImage: nullable(p.cover_image),
    coverAlt: nullable(p.cover_alt),
    body: validateArticleBody(
      p.content_format === "editor-json-v1"
        ? { format: "editor-json-v1", document: JSON.parse(String(p.content)) }
        : { format: "legacy-text", text: String(p.content ?? "") },
    ),
    links: validateSupplementalLinks(p.supplemental_links ?? []),
    editorial: validateEditorialMetadata(
      p.editorial_metadata ?? {
        author: nullable(p.author),
        reviewer: null,
        sourcesNote: null,
        answerSummary: null,
        compareEstateSlugs: [],
      },
    ),
    readingMinutes: Number(p.reading_minutes ?? 5),
    seoTitle: nullable(p.seo_title),
    seoDescription: nullable(p.seo_description),
    version: Number(raw.version),
    slugLocked: raw.slug_locked === true,
    editState: raw.editState as ArticleEditState,
  };
}
