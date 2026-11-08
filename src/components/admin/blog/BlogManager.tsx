import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/neon/blog-admin";
import type {
  ArticlePage,
  ArticleQuery,
  ArticleRecord,
  BlogCategory,
  BlogCategoryOption,
  BlogSettings,
} from "@/lib/blog/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nativeFieldClassName } from "@/components/ui/native-field";
import { useDirtyCloseGuard } from "@/hooks/use-unsaved-changes-guard";
import { ArticleEditor } from "./ArticleEditor";
import { BlogSettingsEditor } from "./BlogSettingsEditor";
import { BlogCategoryManager } from "./BlogCategoryManager";
import { articleError, changeQuery, linkImportError } from "./blog-editor-state";
type View = "articles" | "settings" | "categories";
export function BlogManager({ canPublish }: { canPublish: boolean }) {
  const [view, setView] = useState<View>("articles");
  const [query, setQuery] = useState<ArticleQuery>({
    search: "",
    state: "all",
    page: 1,
    pageSize: 25,
  });
  const [result, setResult] = useState<ArticlePage | null>(null),
    [loading, setLoading] = useState(true),
    [listError, setListError] = useState("");
  const [options, setOptions] = useState<BlogCategoryOption[] | null>(null),
    [state, setState] = useState<{ categories: BlogCategory[]; settings: BlogSettings[] } | null>(
      null,
    ),
    [stateError, setStateError] = useState("");
  const [editor, setEditor] = useState<{ article: ArticleRecord | null } | null>(null),
    [opening, setOpening] = useState(false),
    [openError, setOpenError] = useState("");
  const [settings, setSettings] = useState<BlogSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [linkUrl, setLinkUrl] = useState(""),
    [linkBusy, setLinkBusy] = useState(false),
    [linkError, setLinkError] = useState(""),
    [linkNotice, setLinkNotice] = useState("");
  const nextAction = useRef<() => void>(() => {});
  const guard = useDirtyCloseGuard({
    isDirty: dirty,
    onClose: () => {
      setDirty(false);
      nextAction.current();
    },
  });
  const sequence = useRef(0);
  const openSequence = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const loadList = useCallback(async () => {
    const seq = ++sequence.current;
    setLoading(true);
    setListError("");
    try {
      const data = await api.listBlogArticles({ data: query });
      if (active.current && sequence.current === seq) setResult(data);
    } catch (err) {
      if (active.current && sequence.current === seq) setListError(articleError(err));
      throw err;
    } finally {
      if (active.current && sequence.current === seq) setLoading(false);
    }
  }, [query]);
  const loadOptions = useCallback(async () => {
    setStateError("");
    try {
      if (canPublish) {
        const data = await api.getBlogAdminState();
        if (active.current) {
          setState(data);
          setOptions(data.categories);
        }
      } else {
        const data = await api.getBlogCategoryOptions();
        if (active.current) setOptions(data);
      }
    } catch (err) {
      if (active.current) setStateError(articleError(err));
      throw err;
    }
  }, [canPublish]);
  useEffect(() => {
    void loadList().catch(() => {});
  }, [loadList]);
  useEffect(() => {
    void loadOptions().catch(() => {});
  }, [loadOptions]);
  const refresh = async () => {
    await Promise.all([loadList(), loadOptions()]);
  };
  async function open(id: string) {
    const request = ++openSequence.current;
    setOpening(true);
    setOpenError("");
    try {
      const article = await api.getArticlePreview({ data: { id } });
      if (active.current && request === openSequence.current) setEditor({ article });
    } catch (err) {
      if (active.current && request === openSequence.current) setOpenError(articleError(err));
    } finally {
      if (active.current && request === openSequence.current) setOpening(false);
    }
  }
  async function createFromLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = linkUrl.trim();
    if (!url || linkBusy || !options) return;
    setLinkBusy(true);
    setLinkError("");
    setLinkNotice("");
    try {
      const article = await api.createArticleFromLink({ data: { url } });
      if (!active.current) return;
      setLinkUrl("");
      setLinkNotice("已建立草稿並打開編輯器；請核對內容後發布。");
      setEditor({ article });
      await refresh().catch(() => {});
    } catch (error) {
      if (active.current) setLinkError(linkImportError(error));
    } finally {
      if (active.current) setLinkBusy(false);
    }
  }
  function navigate(v: View) {
    nextAction.current = () => {
      ++openSequence.current;
      setOpening(false);
      setView(v);
      setSettings(null);
    };
    guard.requestClose();
  }
  return (
    <section className="grid min-w-0 gap-4" aria-label="網誌管理">
      <nav aria-label="網誌管理分頁" className="flex flex-wrap gap-2">
        <Button
          variant={view === "articles" ? "default" : "outline"}
          onClick={() => navigate("articles")}
        >
          文章
        </Button>
        {canPublish ? (
          <>
            <Button
              variant={view === "settings" ? "default" : "outline"}
              onClick={() => navigate("settings")}
            >
              網誌設定
            </Button>
            <Button
              variant={view === "categories" ? "default" : "outline"}
              onClick={() => navigate("categories")}
            >
              分類管理
            </Button>
          </>
        ) : null}
      </nav>
      {stateError ? (
        <div role="alert">
          {stateError}
          <Button onClick={() => void loadOptions().catch(() => {})}>重試分類及設定</Button>
        </div>
      ) : null}
      {view === "articles" ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1">
              搜尋標題、slug 或分類
              <Input
                value={query.search}
                onChange={(e) => setQuery((q) => changeQuery(q, { search: e.target.value }))}
              />
            </label>
            <label className="grid gap-1">
              文章分類
              <select
                className={nativeFieldClassName}
                value={query.categoryId ?? ""}
                onChange={(e) =>
                  setQuery((q) => changeQuery(q, { categoryId: e.target.value || undefined }))
                }
              >
                <option value="">所有分類</option>
                {options?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              文章狀態
              <select
                className={nativeFieldClassName}
                value={query.state}
                onChange={(e) =>
                  setQuery((q) =>
                    changeQuery(q, { state: e.target.value as ArticleQuery["state"] }),
                  )
                }
              >
                <option value="all">全部狀態</option>
                <option value="draft">草稿</option>
                <option value="published">已發布</option>
              </select>
            </label>
            <Button disabled={!options || opening} onClick={() => setEditor({ article: null })}>
              新增文章
            </Button>
          </div>
          <form
            onSubmit={createFromLink}
            className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3"
          >
            <Input
              aria-label="文章連結"
              className="min-w-0 flex-1"
              placeholder="貼上文章連結（例如 https://hk.on.cc/…）"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <Button type="submit" disabled={!options || linkBusy || !linkUrl.trim()}>
              {linkBusy ? "讀取中…" : "由連結建立草稿"}
            </Button>
          </form>
          {linkError ? <p role="alert">{linkError}</p> : null}
          {linkNotice ? <p role="status">{linkNotice}</p> : null}
          {listError ? (
            <div role="alert">
              未能更新文章清單；下列資料可能不是最新。{listError}
              <Button onClick={() => void loadList().catch(() => {})}>重試文章清單</Button>
            </div>
          ) : null}
          {openError ? <p role="alert">{openError}</p> : null}
          {loading ? <p role="status">載入文章…</p> : null}
          {result ? (
            <>
              <p>
                共 {result.total} 篇 · 第 {result.page} /{" "}
                {Math.max(1, Math.ceil(result.total / result.pageSize))} 頁
              </p>
              <ul className="divide-y">
                {result.items.map((a) => (
                  <li
                    key={a.id}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">{a.title}</h3>
                      <p className="break-all text-sm text-muted-foreground">
                        {a.slug} · {options?.find((c) => c.id === a.categoryId)?.name ?? "未分類"} ·{" "}
                        {a.published ? "已發布" : "草稿"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      disabled={opening || loading || !!listError || !options}
                      onClick={() => void open(a.id)}
                    >
                      編輯<span className="sr-only"> {a.title}</span>
                    </Button>
                  </li>
                ))}
              </ul>
              {!result.items.length && !listError && !loading ? <p>沒有符合條件的文章。</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={loading || query.page === 1}
                  onClick={() => setQuery((q) => changeQuery(q, { page: 1 }))}
                >
                  第一頁文章
                </Button>
                <Button
                  disabled={loading || query.page === 1}
                  onClick={() => setQuery((q) => changeQuery(q, { page: q.page - 1 }))}
                >
                  上一頁文章
                </Button>
                <Button
                  disabled={loading || query.page * query.pageSize >= result.total}
                  onClick={() => setQuery((q) => changeQuery(q, { page: q.page + 1 }))}
                >
                  下一頁文章
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {view === "settings" && canPublish && state ? (
        settings ? (
          <BlogSettingsEditor
            key={settings.scope.kind === "main" ? "main" : settings.scope.categoryId}
            settings={settings}
            onDirtyChange={setDirty}
            onClose={() => setSettings(null)}
            onSave={async (value) => {
              const saved = await api.saveBlogSettings({ data: value });
              setState((s) =>
                s
                  ? {
                      ...s,
                      settings: s.settings.map((x) =>
                        JSON.stringify(x.scope) === JSON.stringify(saved.scope) ? saved : x,
                      ),
                      categories: s.categories.map((c) =>
                        saved.scope.kind === "category" && saved.scope.categoryId === c.id
                          ? {
                              ...c,
                              heading: saved.heading,
                              introduction: saved.introduction,
                              seoTitle: saved.seoTitle,
                              seoDescription: saved.seoDescription,
                              settingsVersion: saved.version,
                            }
                          : c,
                      ),
                    }
                  : s,
              );
              return saved;
            }}
          />
        ) : (
          <div className="grid gap-2">
            <h2>選擇獨立頁面設定</h2>
            {state.settings.map((s) => (
              <Button
                key={s.scope.kind === "main" ? "main" : s.scope.categoryId}
                variant="outline"
                onClick={() => setSettings(s)}
              >
                {s.scope.kind === "main"
                  ? "網誌首頁"
                  : (state.categories.find(
                      (c) => s.scope.kind === "category" && c.id === s.scope.categoryId,
                    )?.name ?? "分類頁")}
              </Button>
            ))}
          </div>
        )
      ) : null}
      {view === "categories" && canPublish && state ? (
        <BlogCategoryManager
          categories={state.categories}
          onDirtyChange={setDirty}
          onSave={async (value) => {
            const saved = await api.saveBlogCategory({ data: value });
            setState((s) => {
              if (!s) return s;
              const prior = s.settings.find(
                (x) => x.scope.kind === "category" && x.scope.categoryId === saved.id,
              );
              const setting: BlogSettings = {
                scope: { kind: "category", categoryId: saved.id },
                heading: saved.heading,
                introduction: saved.introduction,
                seoTitle: saved.seoTitle,
                seoDescription: saved.seoDescription,
                version: saved.settingsVersion,
                featuredIds: prior?.featuredIds ?? [],
              };
              return {
                categories: [...s.categories.filter((c) => c.id !== saved.id), saved].sort(
                  (a, b) => a.navigationOrder - b.navigationOrder,
                ),
                settings: [
                  ...s.settings.filter(
                    (x) => !(x.scope.kind === "category" && x.scope.categoryId === saved.id),
                  ),
                  setting,
                ],
              };
            });
            setOptions((o) => [...(o ?? []).filter((c) => c.id !== saved.id), saved]);
            return saved;
          }}
        />
      ) : null}
      {editor && options ? (
        <ArticleEditor
          article={editor.article}
          categories={options}
          canPublish={canPublish}
          onSave={(command) => api.saveBlogArticle({ data: command })}
          onRefresh={refresh}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {guard.dialog}
    </section>
  );
}
