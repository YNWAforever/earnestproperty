import { beforeEach, expect, mock, test } from "bun:test";
import { BlogRepositoryError } from "../blog/errors";
import { ServerFnResponseError } from "./server-fn-response";

type Options = { data?: unknown; headers?: Headers };
type Endpoint = (options: Options) => Promise<unknown>;
const endpoints: Endpoint[] = [];
const headers = new Map<string, string>();
const wire: Array<{ body: string; status: number; headers: Record<string, string> }> = [];
let serviceCalls = 0;
let serviceInput: unknown;
let serviceFailure: Error | Response | undefined;
const page = { items: [], total: 0, page: 1, pageSize: 25 };

// Execute the ACTUAL registered validators and handlers. Only the framework's
// registration/transport and downstream service are adapters; no HTTP claim.
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (data: unknown) => unknown = (data) => data;
    const builder = {
      inputValidator: (callback: typeof validate) => {
        validate = callback;
        return builder;
      },
      handler: (callback: (args: { data: unknown }) => Promise<unknown>) => {
        const endpoint: Endpoint = async (options) => {
          try {
            return JSON.parse(JSON.stringify(await callback({ data: validate(options.data) })));
          } catch (error) {
            if (error instanceof Response) {
              const body = await error.text();
              const responseHeaders = Object.fromEntries(error.headers);
              wire.push({ body, status: error.status, headers: responseHeaders });
              // Reconstitute only serialized body/status/headers. No Error props survive.
              return new Response(body, { status: error.status, headers: responseHeaders });
            }
            const plain = JSON.parse(
              JSON.stringify({ name: (error as Error).name, message: (error as Error).message }),
            );
            throw Object.assign(new Error(plain.message), { name: plain.name });
          }
        };
        endpoints.push(endpoint);
        return endpoint;
      },
    };
    return builder;
  },
}));
mock.module("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/fixture"),
  setResponseHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
}));
mock.module("@/auth", () => ({
  withStaffAuthHeaders: async (options: Options) => ({
    ...options,
    headers: new Headers({ authorization: "Bearer local-fixture" }),
  }),
}));
async function service(input: unknown) {
  serviceInput = input;
  serviceCalls++;
  if (serviceFailure) throw serviceFailure;
  return page;
}
mock.module("./blog-admin.server", () => ({
  listBlogArticles: service,
  listFeaturedArticles: service,
  getFeaturedArticle: service,
  saveBlogArticle: service,
  saveBlogSettings: service,
  saveBlogCategory: service,
  getBlogAdminState: service,
  getArticlePreview: service,
  getBlogCategoryOptions: service,
  createArticleFromLink: service,
}));
const api = await import("./blog-admin");
const { callStaffServerFn } = await import("./staff-server-fn");
beforeEach(() => {
  headers.clear();
  wire.length = 0;
  serviceCalls = 0;
  serviceFailure = undefined;
});
test("feature projections retain private headers and serialized auth failures", async () => {
  for (const call of [
    () =>
      api.listFeaturedArticles({ data: { search: "", state: "published", page: 1, pageSize: 25 } }),
    () => api.getFeaturedArticle({ data: { id: "11111111-1111-4111-8111-111111111111" } }),
  ]) {
    serviceFailure = undefined;
    await call();
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    serviceFailure = new Response("Forbidden", { status: 403 });
    await expect(call()).rejects.toMatchObject({ status: 403, message: "Forbidden" });
  }
});
const calls: Array<[string, () => Promise<unknown>]> = [
  ["list", () => api.listBlogArticles({ data: { page: 0 } as never })],
  ["featured list", () => api.listFeaturedArticles({ data: { page: 0 } as never })],
  ["featured article", () => api.getFeaturedArticle({ data: { id: "invalid" } })],
  ["article", () => api.saveBlogArticle({ data: {} as never })],
  ["settings", () => api.saveBlogSettings({ data: {} as never })],
  ["category", () => api.saveBlogCategory({ data: {} as never })],
  ["state", () => callStaffServerFn(endpoints[4], { data: { spoof: "admin" } })],
  ["options", () => callStaffServerFn(endpoints[6], { data: { spoof: "admin" } })],
  ["preview", () => api.getArticlePreview({ data: { id: "invalid" } })],
  ["create from link", () => api.createArticleFromLink({ data: {} as never })],
];
for (const [name, call] of calls)
  test(`${name}: actual validator emits safe 422 through browser boundary`, async () => {
    let failure: unknown;
    try {
      await call();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ServerFnResponseError);
    expect((failure as ServerFnResponseError).status).toBe(422);
    expect((failure as Error).message).toBe("BLOG_VALIDATION");
    expect((failure as { code?: string }).code).toBeUndefined();
    expect(serviceCalls).toBe(0);
    expect(wire).toEqual([
      {
        body: "BLOG_VALIDATION",
        status: 422,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow",
        },
      },
    ]);
  });
test("actual handler serializes repository failure without leaking SQL or custom Error objects", async () => {
  for (const [error, code, status] of [
    [new BlogRepositoryError("BLOG_REVISION_CONFLICT", 409), "BLOG_REVISION_CONFLICT", 409],
    [new Error("sensitive database host/query"), "BLOG_UNAVAILABLE", 503],
  ] as const) {
    serviceFailure = error;
    let failure: unknown;
    try {
      await api.listBlogArticles({ data: {} as never });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ServerFnResponseError);
    expect((failure as ServerFnResponseError).status).toBe(status);
    expect((failure as Error).message).toBe(code);
    expect(wire.at(-1)?.body).toBe(code);
  }
});
test("valid inputs run real validator defaults and handler, and auth Responses retain established status", async () => {
  expect(await api.listBlogArticles({ data: {} as never })).toEqual(page);
  expect(serviceCalls).toBe(1);
  expect(serviceInput).toEqual({ search: "", state: "all", page: 1, pageSize: 25 });
  expect(headers.get("cache-control")).toBe("private, no-store");
  serviceFailure = new Response("Unauthorized", { status: 401 });
  await expect(api.listBlogArticles({ data: {} as never })).rejects.toMatchObject({
    status: 401,
    message: "Unauthorized",
  });
});

test("rich-body and category-key transform failures are normalized before the service", async () => {
  const input = {
    slug: "valid",
    title: "Valid",
    excerpt: null,
    categoryId: null,
    published: false,
    publishedAt: null,
    coverImage: null,
    coverAlt: null,
    body: {
      format: "editor-json-v1",
      document: { type: "script", text: "private-invalid-payload" },
    },
    links: [],
    editorial: {
      author: null,
      reviewer: null,
      sourcesNote: null,
      answerSummary: null,
      compareEstateSlugs: [],
    },
    readingMinutes: 5,
    seoTitle: null,
    seoDescription: null,
  };
  await expect(
    api.saveBlogArticle({
      data: { input, action: "save", requestId: "00000000-0000-4000-8000-000000000001" } as never,
    }),
  ).rejects.toMatchObject({ status: 422, message: "BLOG_VALIDATION" });
  await expect(
    api.saveBlogCategory({
      data: {
        key: "a/b",
        name: "Category",
        heading: "Heading",
        introduction: "",
        seoTitle: null,
        seoDescription: null,
        navigationOrder: 0,
        hidden: false,
        version: 0,
        settingsVersion: 0,
      },
    }),
  ).rejects.toMatchObject({ status: 422, message: "BLOG_VALIDATION" });
  expect(serviceCalls).toBe(0);
  expect(wire.map((response) => response.body)).toEqual(["BLOG_VALIDATION", "BLOG_VALIDATION"]);
});

test("category options use private serialized read boundary", async () => {
  await api.getBlogCategoryOptions();
  expect(serviceCalls).toBe(1);
  expect(headers.get("cache-control")).toBe("private, no-store");
  expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
  serviceFailure = new Response("Forbidden", { status: 403 });
  await expect(api.getBlogCategoryOptions()).rejects.toMatchObject({
    status: 403,
    message: "Forbidden",
  });
});
