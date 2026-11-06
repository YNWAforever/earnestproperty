import { AdminContentCopilot } from "@/components/admin/AdminContentCopilot";
import {
  articleCopilotValues,
  articleCopilotBody,
  applyArticleCopilotPatch,
} from "./article-copilot-state";
import { useRef, useState, useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { articleEditorExtensions } from "@/lib/blog/editor-schema";
import { validateArticleBody } from "@/lib/blog/content";
import { ArticleBody } from "@/components/blog/ArticleBody";
import { CmsImageField } from "@/components/admin/CmsEditorFields";
import { CmsPublicationCompare } from "@/components/admin/CmsPublicationCompare";
import { CmsRestoreConfirm } from "@/components/admin/CmsRestoreConfirm";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { useDirtyCloseGuard, useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nativeFieldClassName } from "@/components/ui/native-field";
import { getArticlePreview, getBlogAdminState } from "@/lib/neon/blog-admin";
import { fetchAdminCmsEditor, restoreAdminCmsRevision } from "@/lib/neon/admin-cms";
import { encodeArticle, decodeArticle } from "@/lib/blog/article-codec";
import type {
  ArticleInput,
  ArticleRecord,
  BlogCategoryOption,
  SaveArticleCommand,
  ValidatedArticleBody,
} from "@/lib/blog/types";
import type { CmsRevisionSummary } from "@/lib/neon/admin-cms.types";
import {
  articleInput,
  emptyArticle,
  articleError,
  createSaveSession,
  convertLiteralBody,
} from "./blog-editor-state";
import { Field } from "./blog-fields";

function RichBody({
  body,
  onChange,
  onUploadingChange,
  disabled,
  onInvalidChange,
}: {
  body: Extract<ValidatedArticleBody, { format: "editor-json-v1" }>;
  onChange: (b: ValidatedArticleBody) => void;
  onUploadingChange: (b: boolean) => void;
  disabled: boolean;
  onInvalidChange: (invalid: boolean) => void;
}) {
  const [, render] = useState(0);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [alt, setAlt] = useState("");
  const editor = useEditor({
    extensions: articleEditorExtensions,
    immediatelyRender: false,
    content: body.document,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "文章內容",
        "aria-multiline": "true",
        class:
          "min-h-52 rounded border p-3 whitespace-pre-wrap [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6",
      },
    },
    onUpdate: ({ editor }) => {
      try {
        onChange(validateArticleBody({ format: "editor-json-v1", document: editor.getJSON() }));
        setError("");
        onInvalidChange(false);
      } catch {
        onInvalidChange(true);
        setError("內容格式不支援；請復原剛才的修改後重試。");
      }
    },
    onSelectionUpdate: () => render((n) => n + 1),
  });
  useEffect(() => {
    // A lock/unlock is not an edit: do not emit normalized JSON into the form.
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  if (!editor) return <p role="status">載入文字編輯器…</p>;
  return (
    <div className="grid min-w-0 gap-3">
      <div role="toolbar" aria-label="文章格式" className="flex flex-wrap gap-2">
        {(
          [
            ["粗體", "bold"],
            ["斜體", "italic"],
            ["底線", "underline"],
            ["刪除線", "strike"],
            ["程式文字", "code"],
          ] as const
        ).map(([label, mark]) => (
          <Button
            key={mark}
            type="button"
            variant="outline"
            aria-pressed={editor.isActive(mark)}
            onClick={() => editor.chain().focus().toggleMark(mark).run()}
          >
            {label}
          </Button>
        ))}
        {([2, 3, 4] as const).map((level) => (
          <Button
            key={level}
            type="button"
            variant="outline"
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            標題 {level}
          </Button>
        ))}
        <Button type="button" onClick={() => editor.chain().focus().setParagraph().run()}>
          段落
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          項目清單
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          編號清單
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          引言
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          分隔線
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().undo().run()}>
          復原
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().redo().run()}>
          重做
        </Button>
      </div>
      <EditorContent editor={editor} />
      {editor.isActive("orderedList") ? (
        <label>
          編號起點
          <Input
            type="number"
            min={1}
            value={editor.getAttributes("orderedList").start ?? 1}
            onChange={(e) =>
              editor
                .chain()
                .focus()
                .updateAttributes("orderedList", { start: Number(e.target.value) })
                .run()
            }
          />
        </label>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="連結網址" value={link} onChange={setLink} />
        <Button
          type="button"
          onClick={() => {
            try {
              validateArticleBody({
                format: "editor-json-v1",
                document: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "link",
                          marks: [{ type: "link", attrs: { href: link } }],
                        },
                      ],
                    },
                  ],
                },
              });
              editor.chain().focus().extendMarkRange("link").setLink({ href: link }).run();
              setError("");
            } catch {
              setError("請輸入有效的連結網址。");
            }
          }}
        >
          設定所選文字連結
        </Button>
        <Button type="button" onClick={() => editor.chain().focus().unsetLink().run()}>
          移除連結
        </Button>
      </div>
      <details>
        <summary>內文圖片</summary>
        <div className="grid gap-3">
          <CmsImageField
            label="內文圖片"
            ownerType="article"
            value={imageUrl}
            onChange={setImageUrl}
            onUploadingChange={onUploadingChange}
          />
          <Field label="新增圖片替代文字" value={alt} onChange={setAlt} />
          <Button
            type="button"
            onClick={() => {
              try {
                validateArticleBody({
                  format: "editor-json-v1",
                  document: {
                    type: "doc",
                    content: [{ type: "image", attrs: { src: imageUrl, alt } }],
                  },
                });
                editor.chain().focus().setImage({ src: imageUrl, alt }).run();
                setError("");
              } catch {
                setError("請輸入有效的圖片網址。");
              }
            }}
          >
            插入圖片
          </Button>
          {editor.isActive("image") ? (
            <fieldset className="grid gap-2">
              <legend>編輯已選圖片</legend>
              {(
                [
                  ["src", "所選圖片網址"],
                  ["alt", "所選圖片替代文字"],
                  ["title", "所選圖片標題"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={String(editor.getAttributes("image")[key] ?? "")}
                  onChange={(v) =>
                    editor
                      .chain()
                      .updateAttributes("image", { [key]: v || null })
                      .run()
                  }
                />
              ))}
              {(["width", "height"] as const).map((key) => (
                <label key={key}>
                  {key === "width" ? "圖片寬度" : "圖片高度"}
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={editor.getAttributes("image")[key] ?? ""}
                    onChange={(e) =>
                      editor
                        .chain()
                        .updateAttributes("image", {
                          [key]: e.target.value ? Number(e.target.value) : null,
                        })
                        .run()
                    }
                  />
                </label>
              ))}
              <Button type="button" onClick={() => editor.chain().focus().deleteSelection().run()}>
                移除所選圖片
              </Button>
            </fieldset>
          ) : null}
        </div>
      </details>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export function ArticleEditor({
  article,
  categories,
  canPublish,
  onSave,
  onRefresh,
  onClose,
}: {
  article: ArticleRecord | null;
  categories: BlogCategoryOption[];
  canPublish: boolean;
  onSave: (command: SaveArticleCommand) => Promise<ArticleRecord>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [record, setRecord] = useState(article),
    [value, setValue] = useState<ArticleInput>(() =>
      article ? articleInput(article) : emptyArticle(),
    );
  const [baseline, setBaseline] = useState(value),
    [busy, setBusy] = useState(false),
    [inlineUploading, setInlineUploading] = useState(false),
    [coverUploading, setCoverUploading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const uploading = inlineUploading || coverUploading;
  const [restoreSyncPending, setRestoreSyncPending] = useState(false);
  const locked = busy || restoreSyncPending;
  const [invalidBody, setInvalidBody] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [reviewId, setReviewId] = useState("");
  const [reviewed, setReviewed] = useState<ArticleRecord | null>(null);
  const [preview, setPreview] = useState<ArticleRecord | null>(null),
    [revisions, setRevisions] = useState<CmsRevisionSummary[] | null>(null),
    [revisionError, setRevisionError] = useState("");
  const [retryHistory, setRetryHistory] = useState(0);
  const [restore, setRestore] = useState<CmsRevisionSummary | null>(null);
  const restoreTokens = useRef<
    import("@/lib/neon/admin-cms.types").CmsArticleMutationTokens | undefined
  >(undefined);
  const [reconcile, setReconcile] = useState<ArticleRecord | null>(null);
  const [confirm, setConfirm] = useState<{
    action: SaveArticleCommand["action"];
    placements: string[];
  } | null>(null);
  const session = useRef(createSaveSession());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dirty = invalidBody || JSON.stringify(value) !== JSON.stringify(baseline);
  const guard = useDirtyCloseGuard({ isDirty: dirty || uploading, onClose });
  const leave = useRouteLeaveGuard(dirty || busy || uploading);
  const patch = (p: Partial<ArticleInput>) => setValue((v) => ({ ...v, ...p }));
  function install(a: ArticleRecord) {
    if (!mounted.current) return;
    setRecord(a);
    setRestoreSyncPending(false);
    setEditorEpoch((n) => n + 1);
    setInvalidBody(false);
    const input = articleInput(a);
    setValue(input);
    setBaseline(input);
    setPreview(null);
    setReviewed(null);
    setRetryHistory((n) => n + 1);
  }
  useEffect(() => {
    if (!record?.id) return;
    let active = true;
    setRevisionError("");
    fetchAdminCmsEditor({ data: { resourceType: "article", resourceId: record.id } })
      .then((r) => {
        if (active) setRevisions(r.revisions);
      })
      .catch(() => {
        if (active) setRevisionError("未能載入版本紀錄。");
      });
    return () => {
      active = false;
    };
  }, [record?.id, retryHistory]);
  async function save(action: SaveArticleCommand["action"], snapshot = record) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await session.current.save(
        {
          ...(snapshot
            ? { id: snapshot.id, expectedVersion: snapshot.version, editState: snapshot.editState }
            : {}),
          input: value,
          action,
        },
        onSave,
        install,
        onRefresh,
      );
      if (mounted.current)
        setNotice(
          result.refreshFailed
            ? "內容已儲存，但清單更新失敗；已保留新版本，可重試載入清單。"
            : action === "reconcile"
              ? "已保留你的內容並更新草稿基準；請核對後再發布。"
              : action === "unpublish"
                ? "文章已取消發布"
                : action === "publish" || (record?.published && canPublish)
                  ? "文章已更新發布"
                  : "草稿已儲存",
        );
    } catch (err) {
      if (mounted.current) setError(articleError(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function requestSave(action: SaveArticleCommand["action"]) {
    if (locked || uploading || invalidBody) return;
    if (!canPublish || (!record?.published && action === "save")) {
      await save(action);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const state = await getBlogAdminState();
      const placements = state.settings
        .filter(
          (s) =>
            record &&
            s.featuredIds.includes(record.id) &&
            (action === "unpublish" ||
              (s.scope.kind === "category" && s.scope.categoryId !== value.categoryId)),
        )
        .map((s) =>
          s.scope.kind === "main"
            ? "網誌首頁"
            : (state.categories.find(
                (c) => s.scope.kind === "category" && c.id === s.scope.categoryId,
              )?.name ?? "分類頁"),
        );
      setConfirm({ action, placements });
    } catch (err) {
      setError(articleError(err));
    } finally {
      setBusy(false);
    }
  }
  async function review(revision: Pick<CmsRevisionSummary, "id">) {
    if (!record) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetchAdminCmsEditor({
        data: {
          resourceType: "article",
          resourceId: record.id,
          reviewDraftRevisionId: revision.id,
        },
      });
      if (!r.editState || !r.payload) throw Error("missing");
      const { payload, ...editState } = r.editState;
      setReviewed(
        decodeArticle({
          id: record.id,
          created_at: record.createdAt,
          published_at: payload.published_at,
          published: record.published,
          version: record.version,
          slug_locked: true,
          payload: r.payload,
          editState,
        }),
      );
    } catch (err) {
      setError(articleError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy && !uploading) guard.requestClose();
        }}
      >
        <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{record ? "文章編輯" : "新增文章"}</DialogTitle>
            <DialogDescription>
              {restoreSyncPending
                ? "已還原草稿，請重新載入確認文章狀態。"
                : record?.published && canPublish
                  ? "更新已發布內容會同步公開；取消發布需確認。"
                  : "儲存草稿不會公開。"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto pr-1">
            <form
              id="blog-article-form"
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!locked && !uploading && !invalidBody) void requestSave("save");
              }}
            >
              <fieldset disabled={locked} className="grid min-w-0 gap-4">
                <CmsPublicationCompare
                  resourceType="article"
                  resourceId={record?.id}
                  localPayload={encodeArticle(value)}
                />
                <Field
                  label="網址代稱（Slug）"
                  required
                  readOnly={record?.slugLocked ?? false}
                  value={value.slug}
                  onChange={(slug) => patch({ slug })}
                />
                {record?.slugLocked ? <p className="text-sm">現有網址已鎖定。</p> : null}
                <Field
                  label="標題"
                  required
                  value={value.title}
                  onChange={(title) => patch({ title })}
                />
                <label className="grid gap-1">
                  分類
                  <select
                    aria-label="分類"
                    className={nativeFieldClassName}
                    value={value.categoryId ?? ""}
                    onChange={(e) => patch({ categoryId: e.target.value || null })}
                  >
                    <option value="">未分類（只在網誌首頁顯示）</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.hidden ? "（隱藏導覽）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label="摘要"
                  multiline
                  value={value.excerpt ?? ""}
                  onChange={(excerpt) => patch({ excerpt: excerpt || null })}
                />
                <label>
                  閱讀分鐘
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={value.readingMinutes}
                    onChange={(e) => patch({ readingMinutes: Number(e.target.value) })}
                  />
                </label>
                <Field
                  label="發布日期（ISO，留空保留無日期）"
                  value={value.publishedAt ?? ""}
                  onChange={(publishedAt) => patch({ publishedAt: publishedAt || null })}
                />
                {value.body.format === "legacy-text" ? (
                  <div className="grid gap-2">
                    <Field
                      label="內容"
                      multiline
                      value={value.body.text}
                      onChange={(text) => patch({ body: { format: "legacy-text", text } })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (value.body.format === "legacy-text")
                          patch({ body: convertLiteralBody(value.body.text) });
                      }}
                    >
                      轉換為格式編輯（保留原文字）
                    </Button>
                  </div>
                ) : (
                  <RichBody
                    key={editorEpoch}
                    body={value.body}
                    disabled={locked}
                    onInvalidChange={setInvalidBody}
                    onChange={(body) => patch({ body })}
                    onUploadingChange={setInlineUploading}
                  />
                )}
                <fieldset className="grid gap-3 rounded border p-3">
                  <legend>編輯資料</legend>
                  {(
                    [
                      ["author", "作者"],
                      ["reviewer", "覆核者"],
                      ["sourcesNote", "資料來源備註"],
                      ["answerSummary", "重點答案"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      multiline={key === "sourcesNote" || key === "answerSummary"}
                      value={value.editorial[key] ?? ""}
                      onChange={(v) =>
                        patch({ editorial: { ...value.editorial, [key]: v || null } })
                      }
                    />
                  ))}
                  <Field
                    label="比較屋苑代稱（每行一個）"
                    multiline
                    value={value.editorial.compareEstateSlugs.join("\n")}
                    onChange={(v) =>
                      patch({
                        editorial: {
                          ...value.editorial,
                          compareEstateSlugs: v ? v.split("\n") : [],
                        },
                      })
                    }
                  />
                </fieldset>
                <fieldset className="grid gap-3 rounded border p-3">
                  <legend>延伸閱讀</legend>
                  {value.links.map((link, i) => (
                    <div key={i} className="grid gap-2">
                      <Field
                        label={`連結 ${i + 1} 標題`}
                        value={link.label}
                        onChange={(label) =>
                          patch({
                            links: value.links.map((l, j) => (j === i ? { ...l, label } : l)),
                          })
                        }
                      />
                      <Field
                        label={`連結 ${i + 1} 網址`}
                        value={link.href}
                        onChange={(href) =>
                          patch({
                            links: value.links.map((l, j) => (j === i ? { ...l, href } : l)),
                          })
                        }
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          disabled={i === 0}
                          onClick={() => {
                            const links = [...value.links];
                            [links[i - 1], links[i]] = [links[i], links[i - 1]];
                            patch({ links });
                          }}
                        >
                          上移連結 {i + 1}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => patch({ links: value.links.filter((_, j) => j !== i) })}
                        >
                          移除連結 {i + 1}
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    onClick={() => patch({ links: [...value.links, { label: "", href: "" }] })}
                  >
                    新增延伸閱讀
                  </Button>
                </fieldset>
                <CmsImageField
                  label="封面圖片"
                  ownerType="article"
                  value={value.coverImage ?? ""}
                  onChange={(coverImage) => patch({ coverImage: coverImage || null })}
                  onUploadingChange={setCoverUploading}
                />
                <Field
                  label="封面替代文字"
                  value={value.coverAlt ?? ""}
                  onChange={(coverAlt) => patch({ coverAlt: coverAlt || null })}
                />
                <Field
                  label="SEO 標題"
                  value={value.seoTitle ?? ""}
                  onChange={(seoTitle) => patch({ seoTitle: seoTitle || null })}
                />
                <Field
                  label="SEO 描述"
                  multiline
                  value={value.seoDescription ?? ""}
                  onChange={(seoDescription) => patch({ seoDescription: seoDescription || null })}
                />
              </fieldset>
            </form>
            <details className="my-4">
              <summary className="cursor-pointer">AI 內容建議</summary>
              <fieldset disabled={locked || uploading || invalidBody}>
                <p className="my-2 text-sm text-muted-foreground">
                  正文建議會取代正文及其格式、內文圖片；套用後可復原，仍須另行儲存。與目前草稿不符的建議不會套用。
                </p>
                <AdminContentCopilot
                  key={JSON.stringify([record?.id, record?.version, record?.editState])}
                  resourceType="article"
                  resourceId={record?.id ?? null}
                  values={articleCopilotValues(value)}
                  fingerprintValues={{
                    ...value,
                    id: record?.id,
                    version: record?.version,
                    editState: record?.editState,
                  }}
                  disabled={locked || uploading || invalidBody}
                  renderFieldValue={(field, suggestion) => {
                    if (field !== "content" || typeof suggestion !== "string")
                      return Array.isArray(suggestion)
                        ? suggestion.join("\n")
                        : suggestion || "（留空）";
                    try {
                      return (
                        <ArticleBody
                          body={articleCopilotBody(value.body.format, suggestion)}
                          links={[]}
                        />
                      );
                    } catch {
                      return "建議內容格式不受支援，無法套用。";
                    }
                  }}
                  onApply={(suggestion) => {
                    const next = applyArticleCopilotPatch(value, suggestion);
                    setValue(next);
                    if (next.body !== value.body) setEditorEpoch((n) => n + 1);
                    return articleCopilotValues(next);
                  }}
                />
              </fieldset>
            </details>
            <div className="my-4 grid gap-2">
              <h3>版本紀錄</h3>
              {canPublish && record ? (
                <div className="grid gap-2">
                  <Field label="指定草稿版本編號" value={reviewId} onChange={setReviewId} />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!reviewId || locked || uploading || dirty}
                    onClick={() => void review({ id: reviewId })}
                  >
                    審閱指定草稿
                  </Button>
                </div>
              ) : null}
              {reviewed ? (
                <section aria-label="指定草稿審閱" className="grid gap-2 rounded border p-3">
                  <h4>{reviewed.title}</h4>
                  <p>這是指定版本的唯讀內容；採用內容後會編輯你自己的草稿。</p>
                  <ArticleBody body={reviewed.body} links={reviewed.links} />
                  <p>
                    {reviewed.editorial.author} · {reviewed.editorial.reviewer}
                  </p>
                  <p>{reviewed.editorial.sourcesNote}</p>
                  <p>{reviewed.editorial.answerSummary}</p>
                  <p>比較屋苑：{reviewed.editorial.compareEstateSlugs.join("、")}</p>
                  <Button
                    type="button"
                    disabled={locked || uploading || dirty}
                    onClick={() => {
                      setValue({
                        ...articleInput(reviewed),
                        slug: value.slug,
                        published: value.published,
                      });
                      setReviewed(null);
                      setEditorEpoch((n) => n + 1);
                    }}
                  >
                    採用審閱內容
                  </Button>
                </section>
              ) : null}
              {revisionError ? (
                <p role="alert">
                  {revisionError}
                  <Button onClick={() => setRetryHistory((n) => n + 1)}>重試版本紀錄</Button>
                </p>
              ) : null}
              {revisions?.map((r) => (
                <div key={r.id} className="flex flex-wrap gap-2">
                  <span>
                    v{r.versionNumber} ·{" "}
                    {r.state === "draft" ? "草稿" : r.state === "published" ? "已發布" : "歷史版本"}
                  </span>
                  {canPublish ? (
                    r.state === "draft" ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={locked || uploading || dirty}
                        onClick={() => void review(r)}
                      >
                        審閱草稿 v{r.versionNumber}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={locked || uploading || invalidBody}
                        onClick={() => {
                          if (!record) return;
                          restoreTokens.current = {
                            requestId: crypto.randomUUID(),
                            expectedVersion: record.version,
                            editState: record.editState,
                          };
                          setRestore(r);
                        }}
                      >
                        還原 v{r.versionNumber}
                      </Button>
                    )
                  ) : null}
                </div>
              ))}
            </div>
            {record ? (
              <Button
                type="button"
                variant="outline"
                disabled={locked || uploading || invalidBody}
                onClick={async () => {
                  setError("");
                  try {
                    setPreview(await getArticlePreview({ data: { id: record.id } }));
                  } catch (err) {
                    setError(articleError(err));
                  }
                }}
              >
                預覽已儲存內容
              </Button>
            ) : null}
            {preview ? (
              <section aria-label="已儲存文章預覽" className="my-3 rounded border p-3">
                <p>只顯示已儲存版本；未儲存修改不會包含在內。</p>
                <h2>{preview.title}</h2>
                <p>
                  {preview.editorial.author} · {preview.editorial.reviewer}
                </p>
                <p>{preview.editorial.answerSummary}</p>
                <ArticleBody body={preview.body} links={preview.links} />
                <p>{preview.editorial.sourcesNote}</p>
                <p>比較屋苑：{preview.editorial.compareEstateSlugs.join("、")}</p>
              </section>
            ) : null}
            {error ? (
              <div role="alert">
                {error}
                <details>
                  <summary>複製目前內容備份</summary>
                  <textarea
                    aria-label="目前內容備份"
                    readOnly
                    className="w-full"
                    value={JSON.stringify(value, null, 2)}
                  />
                </details>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
                      setNotice("備份已複製");
                    } catch {
                      setNotice("請在備份欄位手動複製。");
                    }
                  }}
                >
                  複製備份
                </Button>
                {record ? (
                  <Button
                    type="button"
                    disabled={busy || uploading}
                    onClick={async () => {
                      if (!window.confirm("重新載入會放棄未儲存修改；請先複製備份。")) return;
                      setBusy(true);
                      try {
                        const fresh = await getArticlePreview({ data: { id: record.id } });
                        if (!mounted.current) return;
                        install(fresh);
                        setError("");
                        setNotice("");
                      } catch (err) {
                        if (mounted.current) setError(articleError(err));
                      } finally {
                        if (mounted.current) setBusy(false);
                      }
                    }}
                  >
                    重新載入文章
                  </Button>
                ) : null}
              </div>
            ) : null}
            {notice ? (
              <div className="py-2">
                {notice}
                {notice.includes("清單更新失敗") ? (
                  <Button
                    type="button"
                    onClick={async () => {
                      try {
                        await onRefresh();
                        setNotice("清單已更新");
                      } catch {
                        setNotice("內容已儲存，但清單更新失敗；已保留新版本，可重試載入清單。");
                      }
                    }}
                  >
                    重試載入清單
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <p role="status">
            {busy
              ? "處理中…"
              : restoreSyncPending
                ? "草稿已還原，請重新載入確認文章狀態"
                : uploading
                  ? "圖片上載中…"
                  : dirty
                    ? "有未儲存修改"
                    : "目前內容已儲存"}
          </p>
          <div className="flex flex-wrap gap-2">
            {record?.editState.draftRevisionId ? (
              <Button
                type="button"
                variant="outline"
                disabled={locked || uploading || invalidBody}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const fresh = await getArticlePreview({ data: { id: record.id } });
                    if (!mounted.current) return;
                    if (
                      fresh.editState.draftRevisionId !== record.editState.draftRevisionId ||
                      fresh.editState.draftEditVersion !== record.editState.draftEditVersion
                    )
                      throw new Error("DRAFT_CHANGED");
                    setReconcile(fresh);
                  } catch {
                    setError(
                      "未能核對草稿，或另一分頁已修改草稿。你的內容已保留；請複製備份並重新載入核對。",
                    );
                  } finally {
                    if (mounted.current) setBusy(false);
                  }
                }}
              >
                核對最新版本並保留我的內容
              </Button>
            ) : null}
            <Button
              form="blog-article-form"
              type="submit"
              disabled={locked || uploading || invalidBody}
            >
              {restoreSyncPending
                ? "同步後才可儲存"
                : record?.published && canPublish
                  ? "更新已發布文章"
                  : "儲存草稿"}
            </Button>
            {canPublish && !restoreSyncPending && !record?.published ? (
              <Button
                disabled={locked || uploading || invalidBody}
                onClick={() => void requestSave("publish")}
              >
                發布
              </Button>
            ) : null}
            {canPublish && !restoreSyncPending && record?.published ? (
              <Button
                variant="destructive"
                disabled={locked || uploading || invalidBody}
                onClick={() => void requestSave("unpublish")}
              >
                取消發布
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy || uploading} onClick={guard.requestClose}>
              關閉
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {guard.dialog}
      {leave.dialog}
      <AdminConfirmDialog
        open={!!reconcile}
        title="保留我的內容並更新草稿基準？"
        description={`目前發布版本：${reconcile?.editState.currentPublishedVersion ?? "未發布"}。此操作保留編輯器內的內容為私人草稿，不會合併或發布。請先核對下方發布內容；確認後仍會檢查版本。`}
        confirmLabel="確認保留我的內容"
        isPending={busy}
        onOpenChange={(open) => {
          if (!open) setReconcile(null);
        }}
        onConfirm={() => {
          const snapshot = reconcile;
          setReconcile(null);
          if (snapshot) void save("reconcile", snapshot);
        }}
      >
        <CmsPublicationCompare
          resourceType="article"
          resourceId={record?.id}
          localPayload={encodeArticle(value)}
        />
      </AdminConfirmDialog>
      <AdminConfirmDialog
        open={!!confirm}
        title={confirm?.action === "unpublish" ? "確認取消發布？" : "確認發布內容？"}
        description={
          confirm?.action === "unpublish"
            ? "文章將停止公開，並從以下精選位置移除。"
            : "內容將公開；如分類改變，不再符合的精選位置會移除。"
        }
        confirmLabel={confirm?.action === "unpublish" ? "確認取消發布" : "確認發布"}
        isPending={busy}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm) {
            const action = confirm.action;
            setConfirm(null);
            void save(action);
          }
        }}
      >
        <ul>
          {confirm?.placements.length ? (
            confirm.placements.map((p) => <li key={p}>{p}</li>)
          ) : (
            <li>沒有受影響的精選位置。</li>
          )}
        </ul>
      </AdminConfirmDialog>
      <CmsRestoreConfirm
        resource="article"
        revision={restore}
        error={error}
        savedPayload={encodeArticle(baseline)}
        form={encodeArticle(value)}
        savedDraft={revisions?.find((r) => r.id === record?.editState.draftRevisionId)}
        isPending={busy}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
        onConfirm={async (revisionId) => {
          if (!record || locked || uploading) return;
          setBusy(true);
          setError("");
          try {
            const restored = await restoreAdminCmsRevision({
              data: { revisionId, articleTokens: restoreTokens.current },
            });
            const { payload, ...editState } = restored.editState;
            install(
              decodeArticle({
                id: restored.resourceId,
                payload,
                published: record.published,
                published_at: payload.published_at,
                created_at: record.createdAt,
                version: record.version,
                slug_locked: true,
                editState,
              }),
            );
            // The restore receipt owns the new draft identity, but does not include the
            // live article version/publication flag. Retain it before any fallible read,
            // and keep edits/actions locked until an authoritative ArticleRecord arrives.
            setRestore(null);
            setRestoreSyncPending(true);
            try {
              install(await getArticlePreview({ data: { id: restored.resourceId } }));
            } catch (err) {
              setError(articleError(err));
              setNotice("草稿已還原，但未能確認最新發布狀態。請重新載入文章後繼續；無需再次還原。");
              return;
            }
            setNotice("已還原為新草稿，請核對後發布。");
            try {
              await onRefresh();
            } catch {
              setNotice("新草稿已還原，清單更新失敗。");
            }
          } catch (err) {
            setError(articleError(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
