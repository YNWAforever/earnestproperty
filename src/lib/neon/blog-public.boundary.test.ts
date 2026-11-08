import { beforeEach, expect, mock, test } from "bun:test";
import { BlogRepositoryError } from "../blog/errors";
const headers = new Map<string, string>();
let failure = false;
let calls = 0;
let input: unknown;
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (v: unknown) => v;
    const builder = {
      inputValidator: (fn: typeof validate) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (args: { data: unknown }) => Promise<unknown>) =>
        async (options: { data: unknown }) => {
          try {
            return JSON.parse(JSON.stringify(await fn({ data: validate(options.data) })));
          } catch (error) {
            if (error instanceof Response)
              return new Response(await error.text(), {
                status: error.status,
                headers: error.headers,
              });
            throw error;
          }
        },
    };
    return builder;
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  setResponseHeader: (key: string, value: string) => headers.set(key, value),
}));
async function service(data: unknown) {
  calls++;
  input = data;
  if (failure) throw new BlogRepositoryError("BLOG_UNAVAILABLE", 503);
  return { public: true };
}
mock.module("./blog-public.server", () => ({
  getPublicBlogPage: service,
  getPublicBlogArticle: service,
  getPublicRelatedArticles: service,
}));
const api = await import("./blog-public");
const { articleInputSchema } = await import("../blog/write-schemas");
beforeEach(() => {
  headers.clear();
  calls = 0;
  failure = false;
});

test("public article boundary accepts every supported slug length and rejects overflow", async () => {
  for (const length of [200, 201, 239, 240]) {
    const slug = "a".repeat(length);
    expect(articleInputSchema.shape.slug.safeParse(slug).success).toBe(true);
    await api.getPublicBlogArticle(slug);
    expect(input).toBe(slug);
  }
  const before = calls;
  const overflow = "a".repeat(241);
  expect(articleInputSchema.shape.slug.safeParse(overflow).success).toBe(false);
  await expect(api.getPublicBlogArticle(overflow)).rejects.toMatchObject({
    code: "BLOG_VALIDATION",
    status: 422,
  });
  expect(calls).toBe(before);
});
test("public validators normalize category once and refuse private/preview arguments", async () => {
  await api.getPublicBlogPage({ categoryKey: encodeURIComponent("成交分析"), page: 2 });
  expect(input).toEqual({ categoryKey: "成交分析", page: 2 });
  for (const data of [
    { page: 0 },
    { page: 1, preview: true },
    { page: 1, categoryKey: [] },
    { page: 1, categoryKey: "%" },
  ]) {
    const before = calls;
    await expect(api.getPublicBlogPage(data as never)).rejects.toMatchObject({
      code: "BLOG_VALIDATION",
      status: 422,
    });
    expect(calls).toBe(before);
  }
});
test("each public transport sets fresh response headers and preserves unavailable across serialized Responses", async () => {
  for (const run of [
    () => api.getPublicBlogPage({ page: 1 }),
    () => api.getPublicBlogArticle("slug"),
    () => api.getPublicRelatedArticles("bellagio"),
  ]) {
    failure = false;
    expect<unknown>(await run()).toEqual({ public: true });
    for (const key of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"])
      expect(headers.get(key)).toBe("no-store");
    failure = true;
    await expect(run()).rejects.toMatchObject({ code: "BLOG_UNAVAILABLE", status: 503 });
  }
});
