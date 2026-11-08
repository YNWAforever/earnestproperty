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
/** Paste-a-link import: a 422 means the page could not be read, not that a save failed. */
export function linkImportError(error: unknown): string {
  if (error instanceof ServerFnResponseError) {
    if (error.status === 422)
      return "未能讀取這個連結（可能被網站阻擋、不是文章頁，或「晉誠成交」分類未建立）；沒有建立任何文章。";
    if (error.status === 401 || error.status === 403) return "登入或權限不足，未能建立文章。";
    if (error.status >= 500)
      return "伺服器暫時未能讀取連結，沒有建立任何文章。請稍後再試；如持續出現，請通知技術同事。";
  }
  return "未能讀取連結，沒有建立任何文章。請檢查網絡後再試。";
}
export function articleError(error: unknown): string {
  if (error instanceof ServerFnResponseError) {
    if (error.status === 409)
      return "資料版本已改變；你的修改已保留。請先複製備份，再重新載入及核對，切勿直接覆蓋。";
    if (error.status === 401 || error.status === 403)
      return "登入或權限已改變；修改已保留，請確認登入及權限後重試。";
    if (error.status === 422)
      return `內容未通過檢查（${error.message}）；請核對網址、分類及內容，修改已保留。`;
    // 5xx is the server, not the edit. Claiming "your changes were kept, retry with
    // the same operation id" is wrong twice over: nothing reached the database, and
    // the retry cannot help until the service recovers. On 2026-11-06 every article
    // read and write returned 503 BLOG_UNAVAILABLE because the schema the code
    // expected had never been applied, and this fallback told editors their work was
    // safe. Say what actually happened instead.
    if (error.status >= 500)
      return "伺服器暫時無法處理這項操作，你剛才的修改並沒有儲存。請稍後重新載入頁面再試；如持續出現，請通知技術同事（服務代碼：BLOG_UNAVAILABLE）。";
  }
  // Network failure, an unparseable response, or a non-Response throw: still not a
  // save outcome we can vouch for.
  return "未能完成操作，你剛才的修改並沒有儲存。請檢查網絡後重新載入頁面再試；如持續出現，請通知技術同事。";
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
