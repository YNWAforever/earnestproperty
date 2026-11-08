import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { blogRequest, parseBlogRequest } from "./blog-response";
import { unwrapServerFnResponse, ServerFnResponseError } from "./server-fn-response";
import { BlogRepositoryError } from "../blog/errors";
import { blogNoStoreHeaders, parseBlogSearch } from "../blog/public";
import { ARTICLE_SLUG_MAX_LENGTH } from "../blog/validation";

function freshHeaders() {
  for (const [key, value] of Object.entries(blogNoStoreHeaders())) setResponseHeader(key, value);
}
const pageServer = createServerFn({ method: "GET" })
  .inputValidator((data: { categoryKey?: string; page: number }) =>
    parseBlogRequest(() => {
      const input = z
        .object({ categoryKey: z.string().optional(), page: z.number() })
        .strict()
        .parse(data);
      const parsed = parseBlogSearch({ category: input.categoryKey, page: input.page });
      return { categoryKey: parsed.category, page: parsed.page };
    }),
  )
  .handler(async ({ data }) => {
    freshHeaders();
    return blogRequest(async () => (await import("./blog-public.server")).getPublicBlogPage(data));
  });
const articleServer = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) =>
    parseBlogRequest(() =>
      z
        .object({ slug: z.string().min(1).max(ARTICLE_SLUG_MAX_LENGTH) })
        .strict()
        .parse(data),
    ),
  )
  .handler(async ({ data }) => {
    freshHeaders();
    return blogRequest(async () =>
      (await import("./blog-public.server")).getPublicBlogArticle(data.slug),
    );
  });
const relatedServer = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) =>
    parseBlogRequest(() =>
      z
        .object({ slug: z.string().min(1).max(200) })
        .strict()
        .parse(data),
    ),
  )
  .handler(async ({ data }) => {
    freshHeaders();
    return blogRequest(async () =>
      (await import("./blog-public.server")).getPublicRelatedArticles(data.slug),
    );
  });
/** Normalize resolved and thrown Responses without staff auth or private preview state. */
export async function publicCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return (await unwrapServerFnResponse(
      run().catch((error) => {
        if (error instanceof Response) return error as never;
        throw error;
      }),
    )) as T;
  } catch (error) {
    if (error instanceof ServerFnResponseError)
      throw new BlogRepositoryError(
        error.status === 422 ? "BLOG_VALIDATION" : "BLOG_UNAVAILABLE",
        error.status,
      );
    throw error;
  }
}
export const getPublicBlogPage = (input: { categoryKey?: string; page: number }) =>
  publicCall(() => pageServer({ data: input }));
export const getPublicBlogArticle = (slug: string) =>
  publicCall(() => articleServer({ data: { slug } }));
export const getPublicRelatedArticles = (slug: string) =>
  publicCall(() => relatedServer({ data: { slug } }));
