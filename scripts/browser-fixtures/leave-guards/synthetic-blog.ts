import { encodeArticle } from "../../../src/lib/blog/article-codec";
// Local fixture ports only. No Auth, database, external upload or production claims.
import { membership, draftSaves } from "./synthetic-api";
import { emptyArticle } from "../../../src/components/admin/blog/blog-editor-state";
import {
  articleQuerySchema,
  saveArticleSchema,
  blogSettingsSchema,
  blogCategorySchema,
} from "../../../src/lib/blog/write-schemas";
import { ServerFnResponseError } from "../../../src/lib/neon/server-fn-response";
import type {
  ArticleRecord,
  ArticleQuery,
  SaveArticleCommand,
  BlogCategory,
  BlogSettings,
} from "../../../src/lib/blog/types";
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = {
  heading: "合成頁面標題",
  introduction: "合成介紹",
  seoTitle: null,
  seoDescription: null,
};
let categories: BlogCategory[] = [
  {
    ...copy,
    id: id(2001),
    key: "成交分析",
    name: "成交分析",
    navigationOrder: 0,
    hidden: false,
    version: 1,
    settingsVersion: 1,
  },
  {
    ...copy,
    id: id(2002),
    key: "買樓",
    name: "買樓",
    navigationOrder: 1,
    hidden: false,
    version: 1,
    settingsVersion: 1,
  },
];
let settings: BlogSettings[] = [
  {
    ...copy,
    scope: { kind: "main" },
    version: 1,
    featuredIds: sessionStorage.getItem("blog-fixture-offpage") ? [id(100), id(2)] : [id(2), id(4)],
  },
  ...categories.map((c) => ({
    ...copy,
    scope: { kind: "category" as const, categoryId: c.id },
    version: 1,
    featuredIds: c.id === id(2001) ? [id(2)] : [],
  })),
];
let records: ArticleRecord[] = Array.from({ length: 101 }, (_, i) => ({
  ...emptyArticle(),
  id: id(i + 1),
  slug: `fixture-${i + 1}`,
  title: `合成文章 ${i + 1}`,
  categoryId: id(2001),
  published: i % 2 === 1,
  body: { format: "legacy-text", text: "  <b>合成內容</b>\n第二行  " },
  createdAt: "2026-11-05T00:00:00Z",
  version: i % 2 === 1 ? 1 : 0,
  slugLocked: true,
  editorial: {
    author: "作者",
    reviewer: "覆核者",
    sourcesNote: "來源",
    answerSummary: "重點",
    compareEstateSlugs: ["sea-crest", "ocean-pointe"],
  },
  editState: {
    resourceId: id(i + 1),
    draftRevisionId: id(i + 501),
    draftVersion: 1,
    draftEditVersion: 1,
    currentPublishedVersion: i % 2 === 1 ? 1 : null,
    basePublishedVersion: i % 2 === 1 ? 1 : null,
    restoredFromRevisionId: null,
  },
}));
const stored = (() => {
  try {
    return localStorage.getItem("owned-blog-fixture");
  } catch {
    return null;
  }
})();
if (stored) ({ records, categories, settings } = JSON.parse(stored));
const persist = () =>
  localStorage.setItem("owned-blog-fixture", JSON.stringify({ records, categories, settings }));
export const fixture = {
  failList: false,
  restoreCalls: 0,
  failRestoreRead: false,
  failPreviewIds: [] as string[],
  previewReads: [] as string[],
  previewDelayMs: 0,
  saveDelayMs: 0,
  failSave: 0,
  afterSaveFailList: false,
  stateReads: 0,
  optionReads: 0,
  commands: [] as SaveArticleCommand[],
  queries: [] as ArticleQuery[],
  records: () => records,
  settings: () => settings,
};
(window as unknown as { blogFixture: typeof fixture }).blogFixture = fixture;
const publishRole = () => ["admin", "manager"].includes(membership.role);
const requireAdmin = () => {
  if (!publishRole()) throw new ServerFnResponseError("Forbidden", 403);
};
export async function listBlogArticles({ data }: { data: ArticleQuery }) {
  const q = articleQuerySchema.parse(data);
  fixture.queries.push(q);
  if (fixture.failList) throw new ServerFnResponseError("BLOG_UNAVAILABLE", 503);
  const items = records.filter(
    (a) =>
      (q.state === "all" || a.published === (q.state === "published")) &&
      (!q.categoryId || a.categoryId === q.categoryId) &&
      (a.title + " " + a.slug + " " + categories.find((c) => c.id === a.categoryId)?.name).includes(
        q.search,
      ),
  );
  return structuredClone({
    items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
  });
}
export async function getBlogCategoryOptions() {
  fixture.optionReads++;
  return categories.map(({ id, key, name, hidden }) => ({ id, key, name, hidden }));
}
export async function getBlogAdminState() {
  fixture.stateReads++;
  requireAdmin();
  return structuredClone({ categories, settings });
}
export async function getArticlePreview({ data }: { data: { id: string } }) {
  await new Promise((resolve) => setTimeout(resolve, fixture.previewDelayMs));
  fixture.previewReads.push(data.id);
  if (fixture.failPreviewIds.includes(data.id))
    throw new ServerFnResponseError("BLOG_UNAVAILABLE", 503);
  const a = records.find((x) => x.id === data.id);
  if (!a) throw new ServerFnResponseError("Not found", 404);
  return structuredClone(a);
}
export async function saveBlogArticle({ data }: { data: SaveArticleCommand }) {
  const c = saveArticleSchema.parse(data);
  fixture.commands.push(structuredClone(c));
  await new Promise((resolve) => setTimeout(resolve, fixture.saveDelayMs));
  if (fixture.failSave)
    throw new ServerFnResponseError(
      fixture.failSave === 409 ? "BLOG_VERSION_CONFLICT" : "BLOG_UNAVAILABLE",
      fixture.failSave,
    );
  if (c.action !== "save" && c.action !== "reconcile") requireAdmin();
  const old = records.find((a) => a.id === c.id);
  if (
    old &&
    (JSON.stringify(old.editState) !== JSON.stringify(c.editState) ||
      c.expectedVersion !== old.version)
  )
    throw new ServerFnResponseError("BLOG_VERSION_CONFLICT", 409);
  const resourceId = old?.id ?? crypto.randomUUID();
  if (
    old &&
    c.action !== "reconcile" &&
    old.editState.basePublishedVersion !== old.editState.currentPublishedVersion
  )
    throw new ServerFnResponseError("BLOG_REVISION_CONFLICT", 409);
  if (records.some((a) => a.id !== c.id && a.slug === c.input.slug))
    throw new ServerFnResponseError("BLOG_VALIDATION", 422);
  const published =
    c.action === "publish" ||
    ((c.action === "save" || c.action === "reconcile") && !!old?.published);
  const version = (old?.version ?? 0) + (published && publishRole() ? 1 : 0);
  const a: ArticleRecord = {
    ...c.input,
    id: resourceId,
    createdAt: old?.createdAt ?? "2026-11-05T00:00:00Z",
    published,
    slugLocked: !!old?.slugLocked || published,
    version,
    editState: {
      resourceId,
      draftRevisionId: old?.editState.draftRevisionId ?? crypto.randomUUID(),
      draftVersion: version + 1,
      draftEditVersion: (old?.editState.draftEditVersion ?? 0) + 1,
      currentPublishedVersion: published ? version : null,
      basePublishedVersion: published ? version : null,
      restoredFromRevisionId: null,
    },
  };
  records = old ? records.map((x) => (x.id === old.id ? a : x)) : [a, ...records];
  settings = settings.map((s) => ({
    ...s,
    featuredIds: s.featuredIds.filter(
      (x) =>
        x !== a.id ||
        (a.published && (s.scope.kind === "main" || s.scope.categoryId === a.categoryId)),
    ),
  }));
  draftSaves.push({
    resourceType: "article",
    resourceId,
    payload: { title: a.title, category_id: a.categoryId },
  });
  if (fixture.afterSaveFailList) fixture.failList = true;
  persist();
  return structuredClone(a);
}
export async function saveBlogSettings({ data }: { data: BlogSettings }) {
  requireAdmin();
  const s = blogSettingsSchema.parse(data);
  const index = settings.findIndex((x) => JSON.stringify(x.scope) === JSON.stringify(s.scope));
  if (settings[index].version !== s.version)
    throw new ServerFnResponseError("BLOG_VERSION_CONFLICT", 409);
  const saved = { ...s, version: s.version + 1 };
  settings[index] = saved;
  persist();
  return structuredClone(saved);
}
export async function saveBlogCategory({
  data,
}: {
  data: Omit<BlogCategory, "id"> & { id?: string };
}) {
  requireAdmin();
  const c = blogCategorySchema.parse(data);
  const saved = {
    ...c,
    id: c.id ?? crypto.randomUUID(),
    version: c.version + 1,
    settingsVersion: c.settingsVersion + 1,
  };
  categories = [...categories.filter((x) => x.id !== saved.id), saved];
  persist();
  return structuredClone(saved);
}

export async function restoreFixtureArticle(
  revisionId: string,
  tokens?: import("../../../src/lib/neon/admin-cms.types").CmsArticleMutationTokens,
) {
  fixture.restoreCalls++;
  requireAdmin();
  const a = records[1];
  if (
    !tokens ||
    tokens.expectedVersion !== a.version ||
    JSON.stringify(tokens.editState) !== JSON.stringify(a.editState)
  )
    throw new ServerFnResponseError("CMS_REVISION_CONFLICT", 409);
  const payload = {
    ...a,
    body: { format: "legacy-text" as const, text: "歷史純文字 <b>不轉成 HTML</b>" },
  };
  const restored = {
    ...payload,
    editState: {
      ...a.editState,
      draftRevisionId: crypto.randomUUID(),
      draftEditVersion: 1,
      restoredFromRevisionId: revisionId,
    },
  };
  records = records.map((x) => (x.id === a.id ? restored : x));
  if (fixture.failRestoreRead) fixture.failPreviewIds.push(a.id);
  persist();
  return {
    resourceId: a.id,
    revisionId: restored.editState.draftRevisionId,
    versionNumber: a.version + 1,
    savedAt: "2026-11-05T00:00:00Z",
    editState: { ...restored.editState, payload: encodeArticle(restored) },
  };
}
