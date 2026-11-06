import type {
  ArticleInput,
  ArticleRecord,
  ArticleQuery,
  ArticleSummary,
  Scope,
  SaveArticleCommand,
  ValidatedArticleBody,
} from "@/lib/blog/types";
import { ServerFnResponseError } from "@/lib/neon/server-fn-response";
export function emptyArticle(): ArticleInput {
  return {
    slug: "",
    title: "",
    excerpt: null,
    categoryId: null,
    published: false,
    publishedAt: null,
    coverImage: null,
    coverAlt: null,
    body: { format: "legacy-text", text: "" },
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
}
export function articleInput(a: ArticleRecord): ArticleInput {
  const {
    slug,
    title,
    excerpt,
    categoryId,
    published,
    publishedAt,
    coverImage,
    coverAlt,
    body,
    links,
    editorial,
    readingMinutes,
    seoTitle,
    seoDescription,
  } = a;
  return {
    slug,
    title,
    excerpt,
    categoryId,
    published,
    publishedAt,
    coverImage,
    coverAlt,
    body,
    links,
    editorial,
    readingMinutes,
    seoTitle,
    seoDescription,
  };
}
export function changeQuery(q: ArticleQuery, patch: Partial<ArticleQuery>): ArticleQuery {
  return { ...q, ...patch, page: patch.page ?? 1 };
}
export function articleError(error: unknown): string {
  if (error instanceof ServerFnResponseError) {
    if (error.status === 409)
      return "資料版本已改變；你的修改已保留。請先複製備份，再重新載入及核對，切勿直接覆蓋。";
    if (error.status === 401 || error.status === 403)
      return "登入或權限已改變；修改已保留，請確認登入及權限後重試。";
    if (error.status === 422)
      return `內容未通過檢查（${error.message}）；請核對網址、分類及內容，修改已保留。`;
  }
  return "未能完成操作，修改已保留。請重試；如剛才儲存結果未確認，重試會沿用相同操作編號。";
}
export function createSaveSession() {
  let pending: { key: string; command: SaveArticleCommand } | undefined;
  return {
    async save(
      command: Omit<SaveArticleCommand, "requestId">,
      write: (c: SaveArticleCommand) => Promise<ArticleRecord>,
      install: (a: ArticleRecord) => void,
      refresh: () => Promise<void>,
    ) {
      const key = JSON.stringify(command);
      if (pending?.key !== key)
        pending = { key, command: { ...command, requestId: crypto.randomUUID() } };
      const result = await write(pending.command);
      install(result); // Resource identity and every CAS token precede any fallible read.
      pending = undefined;
      try {
        await refresh();
        return { record: result, refreshFailed: false };
      } catch {
        return { record: result, refreshFailed: true };
      }
    },
  };
}
export function convertLiteralBody(text: string): ValidatedArticleBody {
  return {
    format: "editor-json-v1",
    document: {
      type: "doc",
      content: [
        { type: "paragraph", ...(text ? { content: [{ type: "text" as const, text }] } : {}) },
      ],
    },
  };
}
export function eligibleFeature(a: ArticleSummary, scope: Scope) {
  return (
    a.published &&
    (!a.publishedAt || Date.parse(a.publishedAt) <= Date.now()) &&
    (scope.kind === "main" || a.categoryId === scope.categoryId)
  );
}
