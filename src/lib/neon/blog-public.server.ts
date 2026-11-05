import "@tanstack/react-start/server-only";
import { queryRows } from "./db.server";
import { decodeArticle } from "../blog/article-codec";
import { BlogRepositoryError } from "../blog/errors";
import { parseBlogSearch } from "../blog/public";
import { resolveBlogHeading } from "../blog/presentation";
import type {
  ArticleRecord,
  ArticleSummary,
  BlogCategory,
  BlogSettings,
  ArticlePage,
} from "../blog/types";

export type PublicBlogPage = {
  settings: BlogSettings;
  categories: BlogCategory[];
  featured: ArticleSummary[];
  articles: ArticlePage;
};
export type PublicBlogArticle = ArticleRecord & {
  category: string | null;
  categoryName: string | null;
  updatedAt: string | null;
};
const PAGE_SIZE = 12;
const date = (v: unknown) => (v == null ? null : new Date(String(v)).toISOString());
const nullable = (v: unknown) => (v == null ? null : String(v));
const due =
  "a.published = true AND (a.published_at IS NULL OR a.published_at <= now()) AND a.slug <> 'editorial-standards'";
const summaryColumns =
  "a.id,a.slug,a.title,a.excerpt,a.category_id,a.published,a.published_at,a.created_at,a.cover_image,a.cover_alt,a.reading_minutes,a.editorial_metadata->>'author' AS author";
function summary(a: Record<string, unknown>): ArticleSummary {
  return {
    id: String(a.id),
    slug: String(a.slug),
    title: String(a.title),
    excerpt: nullable(a.excerpt),
    categoryId: nullable(a.category_id),
    published: true,
    publishedAt: date(a.published_at),
    createdAt: date(a.created_at)!,
    coverImage: nullable(a.cover_image),
    coverAlt: nullable(a.cover_alt),
    author: nullable(a.author),
    readingMinutes: Number(a.reading_minutes ?? 5),
  };
}
/** A read failure or malformed persisted body is never a successful empty publication. */
export async function publicBlogRead<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw new BlogRepositoryError("BLOG_UNAVAILABLE", 503);
  }
}

export async function getPublicBlogPage(input: {
  categoryKey?: string;
  page: number;
}): Promise<PublicBlogPage | null> {
  const { category, page } = parseBlogSearch({ category: input.categoryKey, page: input.page });
  return publicBlogRead(async () => {
    // Single statement snapshot: scope, eligible features, count and stable page agree.
    const [row] = await queryRows(
      `WITH scope AS (
      SELECT s.* FROM blog_settings s LEFT JOIN blog_categories c ON c.id=s.category_id
      WHERE ($1::text IS NULL AND s.scope_kind='main') OR (s.scope_kind='category' AND c.key=$1)
    ), eligible AS MATERIALIZED (
      SELECT ${summaryColumns} FROM articles a CROSS JOIN scope s
      WHERE ${due} AND (s.scope_kind='main' OR a.category_id=s.category_id)
    ), features AS (
      SELECT a.*,f.position FROM eligible a JOIN blog_featured_articles f ON f.article_id=a.id JOIN scope s ON s.id=f.scope_id
    ), regular AS (
      SELECT * FROM eligible a WHERE NOT EXISTS(SELECT 1 FROM features f WHERE f.id=a.id)
    ), page AS (
      SELECT * FROM regular ORDER BY published_at DESC NULLS LAST,created_at DESC,id ASC LIMIT $2 OFFSET $3
    ) SELECT (SELECT blog_settings_document(id) FROM scope) AS settings,
      (SELECT c.name FROM scope s JOIN blog_categories c ON c.id=s.category_id) AS category_name,
      EXISTS(SELECT 1 FROM blog_categories WHERE key=$1) AS category_exists,
      coalesce((SELECT jsonb_agg(blog_category_document(id) ORDER BY navigation_order,id) FROM blog_categories WHERE NOT hidden),'[]'::jsonb) AS categories,
      coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY position) FROM features f),'[]'::jsonb) AS featured,
      (SELECT count(*)::int FROM regular) AS total,
      coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY published_at DESC NULLS LAST,created_at DESC,id ASC) FROM page p),'[]'::jsonb) AS items`,
      [category ?? null, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
    if (!row.settings) {
      if (category && !row.category_exists) return null;
      throw new Error("Missing required blog settings");
    }
    const featured = (row.featured as Record<string, unknown>[]).map(summary);
    const savedSettings = row.settings as BlogSettings;
    return {
      settings: {
        ...savedSettings,
        heading: resolveBlogHeading(
          savedSettings.scope,
          savedSettings.heading,
          nullable(row.category_name),
        ),
        featuredIds: featured.map((a) => a.id),
      },
      categories: row.categories as BlogCategory[],
      featured: page === 1 ? featured : [],
      articles: {
        items: (row.items as Record<string, unknown>[]).map(summary),
        total: Number(row.total),
        page,
        pageSize: PAGE_SIZE,
      },
    };
  });
}

export async function getPublicBlogArticle(slug: string): Promise<PublicBlogArticle | null> {
  return publicBlogRead(async () => {
    // Never call blog_article_document: that function intentionally selects a staff draft.
    const [a] = await queryRows(
      `SELECT ${summaryColumns},a.content,a.content_format,a.supplemental_links,a.editorial_metadata,
      a.reading_minutes,a.seo_title,a.seo_description,a.updated_at,c.key AS category,c.name AS category_name
      FROM articles a LEFT JOIN blog_categories c ON c.id=a.category_id WHERE a.slug=$1 AND ${due} LIMIT 1`,
      [slug],
    );
    if (!a) return null;
    return {
      ...decodeArticle({
        id: a.id,
        payload: a,
        published: true,
        published_at: a.published_at,
        created_at: a.created_at,
        version: 0,
        slug_locked: true,
        // The shared ArticleRecord shape carries no private revision identity or CAS token publicly.
        editState: {
          resourceId: String(a.id),
          draftRevisionId: null,
          draftVersion: null,
          draftEditVersion: null,
          currentPublishedVersion: null,
          basePublishedVersion: null,
          restoredFromRevisionId: null,
        },
      }),
      category: nullable(a.category),
      categoryName: nullable(a.category_name),
      updatedAt: date(a.updated_at),
    };
  });
}

export async function getPublicRelatedArticles(
  estateSlug: string,
): Promise<Array<{ slug: string; title: string }>> {
  return publicBlogRead(() =>
    queryRows<{ slug: string; title: string }>(
      `SELECT a.slug,a.title FROM articles a WHERE ${due} AND a.editorial_metadata->'compareEstateSlugs' ? $1
     ORDER BY a.published_at DESC NULLS LAST,a.created_at DESC,a.id ASC`,
      [estateSlug],
    ),
  );
}
