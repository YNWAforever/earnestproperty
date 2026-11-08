import "@tanstack/react-start/server-only";
import { requireStaffAccess } from "./auth.server";
import * as repository from "./blog-repository.server";
import type { ArticleQuery, SaveArticleCommand, BlogSettings, BlogCategory } from "../blog/types";

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
