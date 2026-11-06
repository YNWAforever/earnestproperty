import { setResponseHeader } from "@tanstack/react-start/server";
import { blogNoStoreHeaders } from "../blog/public";
import { blogRequest } from "./blog-response";
import { publicCall } from "./blog-public";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
const filterServer = createServerFn({ method: "GET" })
  .inputValidator((data: { slugs: string[] }) =>
    z
      .object({ slugs: z.array(z.string().min(1).max(240)).max(500) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data }) => {
    for (const [key, value] of Object.entries(blogNoStoreHeaders())) setResponseHeader(key, value);
    return blogRequest(async () =>
      (await import("./blog-visibility.server")).filterPublicBlogSlugs(data.slugs),
    );
  });
/** Failed visibility reads propagate. An outage is never an empty successful collection. */
export async function filterPublicBlogArticles<T extends { slug: string }>(
  articles: readonly T[],
): Promise<T[]> {
  const allowed = new Set(
    await publicCall(() =>
      filterServer({ data: { slugs: articles.map((article) => article.slug) } }),
    ),
  );
  return articles.filter((article) => allowed.has(article.slug));
}
