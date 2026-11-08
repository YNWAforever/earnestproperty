import { BlogRepositoryError } from "./errors";

/** Router may supply decoded values; decode percent-encoded input once only. */
export function parseBlogSearch(input: Record<string, unknown>): {
  category?: string;
  page: number;
} {
  let category = input.category;
  if (category !== undefined) {
    if (typeof category !== "string" || !category.length)
      throw new BlogRepositoryError("BLOG_VALIDATION", 422);
    try {
      category = decodeURIComponent(category);
    } catch {
      throw new BlogRepositoryError("BLOG_VALIDATION", 422);
    }
    if (
      (category as string).includes("%") ||
      Array.from(category as string).some((c) => c.charCodeAt(0) < 32)
    )
      throw new BlogRepositoryError("BLOG_VALIDATION", 422);
  }
  const page = input.page === undefined ? 1 : input.page;
  if (
    (typeof page !== "string" && typeof page !== "number") ||
    !/^[1-9]\d*$/.test(String(page)) ||
    !Number.isSafeInteger(Number(page)) ||
    Number(page) > 1000000
  )
    throw new BlogRepositoryError("BLOG_VALIDATION", 422);
  return {
    ...(category && category !== "全部" ? { category: category as string } : {}),
    page: Number(page),
  };
}

/** No CDN/browser storage, including failures. Router caches are disabled at each consumer. */
export function blogNoStoreHeaders() {
  return {
    "Cache-Control": "no-store",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
}
