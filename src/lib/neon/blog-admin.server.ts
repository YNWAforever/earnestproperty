import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { requireStaffAccess } from "./auth.server";
import * as repository from "./blog-repository.server";
import { queryRows } from "./db.server";
import { BlogRepositoryError } from "../blog/errors";
import {
  buildLinkImportInput,
  extractLinkImport,
  isAllowedImportUrl,
  linkImportSlug,
} from "../blog/link-import";
import type {
  ArticleQuery,
  ArticleRecord,
  SaveArticleCommand,
  BlogSettings,
  BlogCategory,
} from "../blog/types";

// Request-bearing boundary is shared by the framework handlers and real-session DB tests.
export async function listFeaturedArticles(input: ArticleQuery, request: Request) {
  return repository.listFeaturedArticles(
    input,
    await requireStaffAccess(request, ["admin", "manager", "agent"]),
  );
}
export async function getFeaturedArticle(id: string, request: Request) {
  return repository.getFeaturedArticle(
    id,
    await requireStaffAccess(request, ["admin", "manager", "agent"]),
  );
}
export async function listBlogArticles(input: ArticleQuery, request: Request) {
  return repository.listBlogArticles(
    input,
    await requireStaffAccess(request, ["admin", "manager", "agent"]),
  );
}
export async function saveBlogArticle(input: SaveArticleCommand, request: Request) {
  return repository.saveBlogArticle(
    input,
    await requireStaffAccess(request, ["admin", "manager", "agent"]),
  );
}
export async function saveBlogSettings(input: BlogSettings, request: Request) {
  return repository.saveBlogSettings(
    input,
    await requireStaffAccess(request, ["admin", "manager"]),
  );
}
export async function saveBlogCategory(
  input: Omit<BlogCategory, "id"> & { id?: string },
  request: Request,
) {
  return repository.saveBlogCategory(
    input,
    await requireStaffAccess(request, ["admin", "manager"]),
  );
}
export async function getBlogAdminState(request: Request) {
  return repository.getBlogAdminState(await requireStaffAccess(request, ["admin", "manager"]));
}
export async function getArticlePreview(id: string, request: Request) {
  return repository.getArticlePreview(
    id,
    await requireStaffAccess(request, ["admin", "manager", "agent"]),
  );
}

export async function getBlogCategoryOptions(request: Request) {
  return repository.getBlogCategoryOptions(
    await requireStaffAccess(request, ["admin", "manager", "agent"]),
  );
}

/** Category the link-import drafts land in. Staff asked for a dedicated 晉誠成交 category. */
export const LINK_IMPORT_CATEGORY_KEY = "晉誠成交";
const LINK_IMPORT_TIMEOUT_MS = 10_000;
const LINK_IMPORT_MAX_BYTES = 2_000_000;

/**
 * Bounded, staff-triggered fetch of the pasted article page. The URL is validated before the
 * request (public https only) and again on the final redirect target. Only text is kept: the
 * page is never executed, stored, or proxied.
 */
async function fetchLinkImportPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_IMPORT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (compatible; EarnestPropertyCMS/1.0; +https://www.earnestproperty.com)",
      },
    });
    const finalUrl = response.url || url;
    if (!response.ok || !isAllowedImportUrl(finalUrl)) throw new Error("BLOG_LINK_IMPORT_FAILED");
    if (!/text\/html/i.test(response.headers.get("content-type") ?? ""))
      throw new Error("BLOG_LINK_IMPORT_FAILED");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > LINK_IMPORT_MAX_BYTES) throw new Error("BLOG_LINK_IMPORT_FAILED");
    const html = await response.text();
    if (html.length > LINK_IMPORT_MAX_BYTES) throw new Error("BLOG_LINK_IMPORT_FAILED");
    return { html, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Paste the link, get a draft." Staff then review/publish in the normal editor. The draft
 * carries the source URL as a supplemental link and an editorial sources note, so the
 * published post links back to the original article.
 */
export async function createArticleFromLink(
  input: { url: string },
  request: Request,
): Promise<ArticleRecord> {
  const actor = await requireStaffAccess(request, ["admin", "manager", "agent"]);
  try {
    const { html, finalUrl } = await fetchLinkImportPage(input.url);
    const source = extractLinkImport(html, finalUrl);
    if (!source.title || source.paragraphs.length === 0) throw new Error("BLOG_LINK_IMPORT_EMPTY");
    const [category] = await queryRows<{ id: string }>(
      "SELECT id FROM blog_categories WHERE key=$1 OR name=$1 ORDER BY navigation_order,id LIMIT 1",
      [LINK_IMPORT_CATEGORY_KEY],
    );
    if (!category) throw new Error("BLOG_LINK_IMPORT_CATEGORY_MISSING");
    const command: SaveArticleCommand = {
      input: buildLinkImportInput(source, {
        categoryId: category.id,
        slug: linkImportSlug(source.url, source.title, randomUUID().slice(0, 4)),
      }),
      action: "save",
      requestId: randomUUID(),
    };
    return await repository.saveBlogArticle(command, actor);
  } catch (error) {
    if (error instanceof BlogRepositoryError || error instanceof Response) throw error;
    // A page that cannot be read is the editor's input problem, not a service outage: a 422
    // lets the UI say "this link could not be read" instead of BLOG_UNAVAILABLE.
    throw new BlogRepositoryError("BLOG_VALIDATION", 422);
  }
}
