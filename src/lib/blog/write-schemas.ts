import { ARTICLE_SLUG_MAX_LENGTH, validateCategoryKey } from "./validation";
import { z } from "zod";
import {
  validateArticleBody,
  validateEditorialMetadata,
  validateSupplementalLinks,
  isSafeArticleUrl,
} from "./content";
import type { ArticleBody } from "./types";

const nullableText = z.string().max(100_000).nullable();
const slug = z
  .string()
  .min(1)
  .max(ARTICLE_SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((value) => value !== "editorial-standards", "BLOG_RESERVED_SLUG");
const safeImage = z
  .string()
  .max(4096)
  .refine((value) => isSafeArticleUrl(value) && !value.startsWith("#"))
  .nullable();
const body = z.unknown().transform((value) => validateArticleBody(value as ArticleBody));
const links = z.unknown().transform(validateSupplementalLinks);
const editorial = z.unknown().transform(validateEditorialMetadata);
const version = z.number().int().nonnegative();
export const articleInputSchema = z
  .object({
    slug,
    title: z.string().trim().min(1).max(500),
    excerpt: nullableText,
    categoryId: z.string().uuid().nullable(),
    published: z.boolean(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    coverImage: safeImage,
    coverAlt: nullableText,
    body,
    links,
    editorial,
    readingMinutes: z.number().int().min(1).max(10000),
    seoTitle: nullableText,
    seoDescription: nullableText,
  })
  .strict();
export const articleEditStateSchema = z
  .object({
    resourceId: z.string().uuid(),
    draftRevisionId: z.string().uuid().nullable(),
    draftVersion: version.nullable(),
    draftEditVersion: version.nullable(),
    currentPublishedVersion: version.nullable(),
    basePublishedVersion: version.nullable(),
    restoredFromRevisionId: z.string().uuid().nullable(),
  })
  .strict();
export const saveArticleSchema = z
  .object({
    id: z.string().uuid().optional(),
    expectedVersion: version.optional(),
    editState: articleEditStateSchema.optional(),
    input: articleInputSchema,
    action: z.enum(["save", "publish", "unpublish", "reconcile"]),
    requestId: z.string().uuid(),
  })
  .strict()
  .superRefine((cmd, ctx) => {
    if (
      cmd.id
        ? cmd.expectedVersion === undefined || !cmd.editState || cmd.editState.resourceId !== cmd.id
        : cmd.expectedVersion !== undefined ||
          cmd.editState !== undefined ||
          cmd.action === "unpublish" ||
          cmd.action === "reconcile"
    )
      ctx.addIssue({ code: "custom", message: "BLOG_REVISION_CONFLICT" });
  });
export const articleQuerySchema = z
  .object({
    search: z.string().max(500).default(""),
    categoryId: z.string().uuid().optional(),
    state: z.enum(["all", "draft", "published"]).default("all"),
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();
const copy = {
  heading: z.string().trim().max(500),
  introduction: z.string().max(100_000),
  seoTitle: nullableText,
  seoDescription: nullableText,
};
export const blogSettingsSchema = z
  .object({
    ...copy,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("main") }).strict(),
      z.object({ kind: z.literal("category"), categoryId: z.string().uuid() }).strict(),
    ]),
    featuredIds: z
      .array(z.string().uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    version,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope.kind === "main" && !value.heading)
      ctx.addIssue({ code: "custom", message: "主頁標題不可留空", path: ["heading"] });
  });
export const blogCategorySchema = z
  .object({
    ...copy,
    id: z.string().uuid().optional(),
    key: z.string().min(1).max(200).transform(validateCategoryKey),
    name: z.string().trim().min(1).max(200),
    navigationOrder: z.number().int(),
    hidden: z.boolean(),
    version,
    settingsVersion: version,
  })
  .strict();
export const articleIdSchema = z.string().uuid();

/** The old UI still sends scalar snake_case payloads. Validate without losing omitted-field semantics. */
export function validateLegacyArticlePayload(payload: Record<string, unknown>) {
  z.object({
    slug,
    title: z.string().trim().min(1).max(500),
    content: z.string().max(1_000_000).nullable().optional(),
    content_format: z.enum(["legacy-text", "editor-json-v1"]).optional(),
    category: z.string().nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
    cover_image: safeImage.optional(),
    cover_alt: nullableText.optional(),
    published_at: z.string().datetime({ offset: true }).nullable().optional(),
    reading_minutes: z.number().int().min(1).max(10000).optional(),
  })
    .passthrough()
    .parse(payload);
  validateArticleBody(
    payload.content_format === "editor-json-v1"
      ? { format: "editor-json-v1", document: JSON.parse(String(payload.content)) }
      : { format: "legacy-text", text: String(payload.content ?? "") },
  );
  if ("supplemental_links" in payload) validateSupplementalLinks(payload.supplemental_links);
  if ("editorial_metadata" in payload) validateEditorialMetadata(payload.editorial_metadata);
  return payload;
}
