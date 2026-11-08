import "@tanstack/react-start/server-only";
import type { StaffAccess } from "./auth.server";
import { queryRows } from "./db.server";
import type {
  ArticleQuery,
  ArticlePage,
  ArticleRecord,
  SaveArticleCommand,
  BlogSettings,
  BlogCategory,
} from "../blog/types";
import {
  articleQuerySchema,
  saveArticleSchema,
  blogSettingsSchema,
  blogCategorySchema,
  articleIdSchema,
} from "../blog/write-schemas";
import { decodeArticle, encodeArticle } from "../blog/article-codec";
import { blogError, parseBlog } from "../blog/errors";

async function actorCheck(actor: StaffAccess, publish = false) {
  // Re-check active database roles; never trust a client-provided role array.
  await queryRows("SELECT blog_require_actor($1::uuid,$2::boolean)", [actor.staffId, publish]);
}
async function operation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return blogError(error);
  }
}
export async function saveBlogArticle(
  command: SaveArticleCommand,
  actor: StaffAccess,
): Promise<ArticleRecord> {
  const cmd = parseBlog(() => saveArticleSchema.parse(command));
  return operation(async () => {
    const { input, ...tokens } = cmd;
    const rows = await queryRows("SELECT blog_save_article($1::uuid,$2::jsonb) AS result", [
      actor.staffId,
      JSON.stringify({ ...tokens, payload: encodeArticle(input) }),
    ]);
    return decodeArticle(rows[0].result as Record<string, unknown>);
  });
}
export async function getArticlePreview(id: string, actor: StaffAccess): Promise<ArticleRecord> {
  parseBlog(() => articleIdSchema.parse(id));
  return operation(async () => {
    const rows = await queryRows("SELECT blog_article_document($1::uuid,$2::uuid) AS result", [
      id,
      actor.staffId,
    ]);
    return decodeArticle(rows[0].result as Record<string, unknown>);
  });
}
export async function getBlogAdminState(
  actor: StaffAccess,
): Promise<{ categories: BlogCategory[]; settings: BlogSettings[] }> {
  return operation(async () => {
    await actorCheck(actor, true);
    const [row] = await queryRows(`SELECT
      coalesce((SELECT jsonb_agg(blog_category_document(id) ORDER BY navigation_order,id) FROM blog_categories),'[]'::jsonb) AS categories,
      coalesce((SELECT jsonb_agg(blog_settings_document(id) ORDER BY scope_kind,id) FROM blog_settings),'[]'::jsonb) AS settings`);
    return {
      categories: row.categories as BlogCategory[],
      settings: row.settings as BlogSettings[],
    };
  });
}
export async function saveBlogSettings(
  input: BlogSettings,
  actor: StaffAccess,
): Promise<BlogSettings> {
  const parsed = parseBlog(() => blogSettingsSchema.parse(input));
  return operation(async () => {
    const [row] = await queryRows("SELECT blog_save_settings($1::uuid,$2::jsonb) AS result", [
      actor.staffId,
      JSON.stringify(parsed),
    ]);
    return row.result as BlogSettings;
  });
}
export async function saveBlogCategory(
  input: Omit<BlogCategory, "id"> & { id?: string },
  actor: StaffAccess,
): Promise<BlogCategory> {
  const parsed = parseBlog(() => blogCategorySchema.parse(input));
  return operation(async () => {
    const [row] = await queryRows("SELECT blog_save_category($1::uuid,$2::jsonb) AS result", [
      actor.staffId,
      JSON.stringify(parsed),
    ]);
    return row.result as BlogCategory;
  });
}
export async function listBlogArticles(
  query: ArticleQuery,
  actor: StaffAccess,
): Promise<ArticlePage> {
  return listArticleProjection(query, actor, false);
}

export async function listFeaturedArticles(
  query: ArticleQuery,
  actor: StaffAccess,
): Promise<ArticlePage> {
  return listArticleProjection(query, actor, true);
}

// Read the live row directly: blog_article_document intentionally prefers the caller's draft.
const publishedDocument = "to_jsonb(a) || jsonb_build_object('payload',to_jsonb(a))";
export async function getFeaturedArticle(id: string, actor: StaffAccess) {
  parseBlog(() => articleIdSchema.parse(id));
  return operation(async () => {
    await actorCheck(actor);
    const [row] = await queryRows(
      `SELECT ${publishedDocument} AS d FROM articles a WHERE id=$1::uuid`,
      [id],
    );
    if (!row) throw new Error("BLOG_NOT_FOUND");
    return articleSummary(row.d as Record<string, unknown>);
  });
}

function articleSummary(raw: Record<string, unknown>) {
  const a = decodeArticle(raw);
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    categoryId: a.categoryId,
    published: a.published,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    coverImage: a.coverImage,
    coverAlt: a.coverAlt,
  };
}

async function listArticleProjection(
  query: ArticleQuery,
  actor: StaffAccess,
  published: boolean,
): Promise<ArticlePage> {
  const q = parseBlog(() => articleQuerySchema.parse(query));
  return operation(async () => {
    await actorCheck(actor);
    // One statement/snapshot owns rows and count, including pages beyond the last row.
    const documents = published
      ? `SELECT ${publishedDocument} AS d FROM articles a WHERE a.published AND (a.published_at IS NULL OR a.published_at <= now())`
      : "SELECT blog_article_document(id,$1::uuid) AS d FROM ids";
    const [row] = await queryRows(
      `WITH ids AS (
      SELECT id FROM articles UNION SELECT resource_id FROM cms_content_revisions WHERE resource_type='article' AND state='draft' AND draft_retired_at IS NULL AND created_by=$1::uuid
    ), documents AS MATERIALIZED (${documents}), filtered AS (
      SELECT d FROM documents LEFT JOIN blog_categories category ON category.id=(d->'payload'->>'category_id')::uuid
      WHERE ($2::text='' OR d->'payload'->>'title' ILIKE $2 OR d->'payload'->>'slug' ILIKE $2
        OR category.name ILIKE $2 OR category.key ILIKE $2)
      AND ($3::uuid IS NULL OR d->'payload'->>'category_id'=$3::text)
      AND ($4='all' OR ($4='published' AND (d->>'published')::boolean) OR ($4='draft' AND NOT (d->>'published')::boolean))
    ), page AS (SELECT d FROM filtered ORDER BY d->>'created_at' DESC,d->>'id' ASC LIMIT $5 OFFSET $6)
    SELECT (SELECT count(*)::int FROM filtered) AS total,coalesce((SELECT jsonb_agg(d ORDER BY d->>'created_at' DESC,d->>'id' ASC) FROM page),'[]'::jsonb) AS documents`,
      [
        actor.staffId,
        q.search ? "%" + q.search.replace(/[\\%_]/g, "\\$&") + "%" : "",
        q.categoryId ?? null,
        q.state,
        q.pageSize,
        (q.page - 1) * q.pageSize,
      ],
    );
    const items = (row.documents as Record<string, unknown>[]).map(articleSummary);
    return { items, total: Number(row.total), page: q.page, pageSize: q.pageSize };
  });
}

export async function getBlogCategoryOptions(
  actor: StaffAccess,
): Promise<import("../blog/types").BlogCategoryOption[]> {
  return operation(async () => {
    await actorCheck(actor);
    return queryRows<import("../blog/types").BlogCategoryOption>(
      "SELECT id, key, name, hidden FROM blog_categories ORDER BY navigation_order,id",
    );
  });
}
