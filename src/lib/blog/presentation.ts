import type { ArticleSummary, Scope } from "./types";

export function resolveBlogHeading(
  scope: Scope,
  heading: string,
  categoryName: string | null,
): string {
  return scope.kind === "category" && !heading.trim() ? (categoryName ?? "") : heading;
}

export function selectBlogArticles(
  scope: Scope,
  featuredIds: string[],
  articles: ArticleSummary[],
): { featured: ArticleSummary[]; regular: ArticleSummary[] } {
  const featuredSet = new Set(featuredIds);
  if (featuredSet.size !== featuredIds.length) throw new Error("精選文章不可重複");
  const eligible = articles.filter(
    (article) =>
      article.published &&
      (article.publishedAt === null || Date.parse(article.publishedAt) <= Date.now()) &&
      (scope.kind === "main" || article.categoryId === scope.categoryId),
  );
  const byId = new Map(eligible.map((article) => [article.id, article]));
  const featured = featuredIds.flatMap((id) => {
    const article = byId.get(id);
    return article ? [article] : [];
  });
  const regular = eligible
    .filter((article) => !featuredSet.has(article.id))
    .sort((a, b) => {
      if (a.publishedAt === null && b.publishedAt !== null) return 1;
      if (b.publishedAt === null && a.publishedAt !== null) return -1;
      const published =
        a.publishedAt !== null && b.publishedAt !== null
          ? Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
          : 0;
      return (
        published ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    });
  return { featured, regular };
}
