import { blogError, BlogRepositoryError, parseBlog } from "../blog/errors";

/** Existing staff transport carries Response body/status, never custom Error properties. */
function errorResponse(error: unknown): Response {
  try {
    blogError(error);
  } catch (normalized) {
    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    });
    if (normalized instanceof Response) {
      const authHeaders = new Headers(normalized.headers);
      authHeaders.set("Cache-Control", "private, no-store");
      authHeaders.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(normalized.body, { status: normalized.status, headers: authHeaders });
    }
    if (normalized instanceof BlogRepositoryError)
      return new Response(normalized.code, { status: normalized.status, headers });
    return new Response("BLOG_UNAVAILABLE", { status: 503, headers });
  }
}
export function parseBlogRequest<T>(parse: () => T): T {
  try {
    return parseBlog(parse);
  } catch (error) {
    throw errorResponse(error);
  }
}
export async function blogRequest<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw errorResponse(error);
  }
}
