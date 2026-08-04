import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Brain,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminContentCopilot } from "@/components/admin/AdminContentCopilot";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useDirtyCloseGuard } from "@/hooks/use-unsaved-changes-guard";
import { parseAdminFaqImport } from "@/lib/admin/faq-import";
import { isYouTubeVideoUrl } from "@/lib/youtube-video-url.js";
import {
  deleteAdminFaq,
  fetchAdminCms,
  fetchAdminAiKnowledgeStatus,
  fetchAdminCmsVideos,
  fetchAdminMediaAssets,
  rebuildAdminAiKnowledge,
  saveAdminArticle,
  saveAdminCmsVideo,
  saveAdminEstate,
  saveAdminFaq,
  updateAdminMediaAsset,
} from "@/lib/neon/admin-data";
import type {
  AdminAiKnowledgeStatus,
  AdminArticleCmsRow,
  AdminArticleInput,
  AdminCmsData,
  AdminCmsVideoInput,
  AdminCmsVideoRow,
  AdminEstateCmsRow,
  AdminEstateInput,
  AdminFaqCmsRow,
  AdminFaqInput,
  AdminMediaAssetRow,
} from "@/lib/neon/admin-data.types";

const adminCmsTabs = ["estates", "articles", "videos", "faqs", "media"] as const;
type AdminCmsTab = (typeof adminCmsTabs)[number];

function parseAdminCmsSearch(search: Record<string, unknown>): { tab?: AdminCmsTab } {
  const tab = search.tab;
  return {
    tab:
      typeof tab === "string" && adminCmsTabs.includes(tab as AdminCmsTab)
        ? (tab as AdminCmsTab)
        : undefined,
  };
}

export const Route = createFileRoute("/admin/cms")({
  validateSearch: parseAdminCmsSearch,
  head: () => ({
    meta: [{ title: "CMS｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminCms,
});

type EditingMediaAsset = Pick<
  AdminMediaAssetRow,
  "id" | "url" | "pathname" | "alt_text" | "owner_type" | "owner_id"
>;

const emptyEstate: AdminEstateInput = {
  slug: "",
  name_zh: "",
  name_en: null,
  district_slug: "",
  developer: null,
  year_completed: null,
  phases: null,
  total_units: null,
  area_min: null,
  area_max: null,
  description: null,
  hero_image: null,
  facilities: [],
  seo_title: null,
  seo_description: null,
};

const emptyArticle: AdminArticleInput = {
  slug: "",
  title: "",
  excerpt: null,
  content: null,
  cover_image: null,
  category: null,
  reading_minutes: 5,
  published: false,
  published_at: null,
  seo_title: null,
  seo_description: null,
};

const emptyFaq: AdminFaqInput = {
  scope: "general",
  question: "",
  answer: "",
  sort_order: 0,
};

const emptyCmsVideo: AdminCmsVideoInput = {
  title: "",
  video_url: "",
  description: null,
  sort_order: 0,
  published: true,
};

// Captures the editing object's shape at the moment a dialog opens (the ref
// only resets when the tracked value transitions to null, i.e. on close), so
// any later field edit flips `isDirty`. Backs the dirty-close guard on every
// editor dialog below -- before this, one stray click on the dim overlay or
// Esc silently discarded a half-written article/estate/FAQ/video/media edit.
function useEditingDirty<T>(value: T | null): boolean {
  const baselineRef = useRef<string | null>(null);
  if (value === null) {
    baselineRef.current = null;
  } else if (baselineRef.current === null) {
    baselineRef.current = JSON.stringify(value);
  }
  return value !== null && JSON.stringify(value) !== baselineRef.current;
}

function AdminCms() {
  const { user } = useNeonAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<AdminCmsData | null>(null);
  const [mediaAssets, setMediaAssets] = useState<AdminMediaAssetRow[] | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<AdminAiKnowledgeStatus | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  // A failed status fetch used to be swallowed, leaving `knowledgeStatus` null --
  // which the badge rendered as 「AI 未啟用」, i.e. a read failure looked like the
  // AI being switched off. Tracked separately so it can say so.
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeTab = search.tab ?? "estates";
  const [saving, setSaving] = useState(false);
  const [editingEstate, setEditingEstate] = useState<AdminEstateInput | null>(null);
  const [editingArticle, setEditingArticle] = useState<AdminArticleInput | null>(null);
  const [editingFaq, setEditingFaq] = useState<AdminFaqInput | null>(null);
  const [cmsVideos, setCmsVideos] = useState<AdminCmsVideoRow[] | null>(null);
  const [editingCmsVideo, setEditingCmsVideo] = useState<AdminCmsVideoInput | null>(null);
  const [faqImportOpen, setFaqImportOpen] = useState(false);
  const [faqImportText, setFaqImportText] = useState("");
  const [faqImportScope, setFaqImportScope] = useState(emptyFaq.scope);
  const [faqImportSaving, setFaqImportSaving] = useState(false);
  const [faqImportConfirmOpen, setFaqImportConfirmOpen] = useState(false);
  const [editingMedia, setEditingMedia] = useState<EditingMediaAsset | null>(null);
  const [deletingFaq, setDeletingFaq] = useState<AdminFaqCmsRow | null>(null);
  const [faqDeleting, setFaqDeleting] = useState(false);
  const [faqDeleteError, setFaqDeleteError] = useState<string | null>(null);
  // One box per tab, not one shared box: staff move between tabs mid-task and a
  // shared query would silently filter the tab they just landed on.
  const [searchByTab, setSearchByTab] = useState<Record<AdminCmsTab, string>>({
    estates: "",
    articles: "",
    videos: "",
    faqs: "",
    media: "",
  });
  const [faqScopeFilter, setFaqScopeFilter] = useState("all");
  const faqFileInputRef = useRef<HTMLInputElement>(null);

  const refreshCmsData = useCallback(async () => {
    const [cms, media, videos] = await Promise.all([
      fetchAdminCms(),
      fetchAdminMediaAssets(),
      fetchAdminCmsVideos(),
    ]);
    setData(cms as AdminCmsData);
    setMediaAssets(media as AdminMediaAssetRow[]);
    setCmsVideos(videos as AdminCmsVideoRow[]);
    setError(null);
  }, []);

  const refreshKnowledgeStatus = useCallback(async () => {
    if (!user) return;
    setKnowledgeLoading(true);
    try {
      setKnowledgeStatus((await fetchAdminAiKnowledgeStatus()) as AdminAiKnowledgeStatus);
      setKnowledgeError(null);
    } catch (err) {
      // Deliberately not rethrown: a status read failing must not report the
      // rebuild that just succeeded as a failure.
      setKnowledgeStatus(null);
      setKnowledgeError(errorText(err));
    } finally {
      setKnowledgeLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    refreshCmsData().catch((err) => setError(errorText(err)));
    void refreshKnowledgeStatus();
  }, [refreshCmsData, refreshKnowledgeStatus, user]);

  const filteredEstates = useMemo(
    () =>
      (data?.estates ?? []).filter((estate) =>
        matchesSearch(searchByTab.estates, [
          estate.name_zh,
          estate.name_en,
          estate.slug,
          estate.district_slug,
          estate.seo_title,
        ]),
      ),
    [data?.estates, searchByTab.estates],
  );

  const filteredArticles = useMemo(
    () =>
      (data?.articles ?? []).filter((article) =>
        matchesSearch(searchByTab.articles, [
          article.title,
          article.slug,
          article.category,
          article.seo_title,
        ]),
      ),
    [data?.articles, searchByTab.articles],
  );

  const filteredCmsVideos = useMemo(
    () =>
      (cmsVideos ?? []).filter((video) =>
        matchesSearch(searchByTab.videos, [video.title, video.description, video.video_url]),
      ),
    [cmsVideos, searchByTab.videos],
  );

  const filteredMediaAssets = useMemo(
    () =>
      (mediaAssets ?? []).filter((asset) =>
        matchesSearch(searchByTab.media, [asset.pathname, asset.alt_text, asset.owner_id]),
      ),
    [mediaAssets, searchByTab.media],
  );

  const faqScopes = useMemo(
    () => Array.from(new Set((data?.faqs ?? []).map((faq) => faq.scope))),
    [data?.faqs],
  );

  const faqsByScope = useMemo(() => {
    const groups = new Map<string, AdminFaqCmsRow[]>();
    for (const faq of data?.faqs ?? []) {
      if (faqScopeFilter !== "all" && faq.scope !== faqScopeFilter) continue;
      if (!matchesSearch(searchByTab.faqs, [faq.question, faq.answer, faq.scope])) continue;
      const existing = groups.get(faq.scope) ?? [];
      existing.push(faq);
      groups.set(faq.scope, existing);
    }
    return Array.from(groups.entries());
  }, [data?.faqs, faqScopeFilter, searchByTab.faqs]);

  const parsedFaqImportRows = useMemo(
    () => parseAdminFaqImport(faqImportText, faqImportScope),
    [faqImportScope, faqImportText],
  );

  /**
   * The importer writes with `upsert: true` (`ON CONFLICT (scope, question) DO
   * UPDATE SET answer`), so a re-import silently replaces answers. Diffing the
   * parsed rows against the loaded FAQs is what turns that into a decision staff
   * can actually make before submitting.
   */
  const faqImportPreview = useMemo(() => {
    const existing = new Map(
      (data?.faqs ?? []).map((faq) => [faqImportKey(faq.scope, faq.question), faq]),
    );
    return parsedFaqImportRows.map((row) => {
      const scope = row.scope ?? faqImportScope;
      const current = existing.get(faqImportKey(scope, row.question));
      return {
        scope,
        question: row.question,
        answer: row.answer,
        previousAnswer: current?.answer ?? null,
        overwrite: Boolean(current),
      };
    });
  }, [data?.faqs, faqImportScope, parsedFaqImportRows]);

  const faqImportOverwriteCount = faqImportPreview.filter((row) => row.overwrite).length;

  async function handleSaveEstate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingEstate) return;
    if (
      !editingEstate.slug.trim() ||
      !editingEstate.name_zh.trim() ||
      !editingEstate.district_slug.trim()
    ) {
      toast.error("請填寫屋苑 slug、中文名及地區");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminEstate({ data: editingEstate }));
      await refreshCmsData();
      toast.success(editingEstate.id ? "屋苑 SEO 已更新" : "屋苑 SEO 已新增");
      setEditingEstate(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingArticle) return;
    if (!editingArticle.slug.trim() || !editingArticle.title.trim()) {
      toast.error("請填寫文章 slug 及標題");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminArticle({ data: editingArticle }));
      await refreshCmsData();
      toast.success(editingArticle.id ? "文章編輯已儲存" : "文章已新增");
      setEditingArticle(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveFaq(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingFaq) return;
    if (!editingFaq.scope.trim() || !editingFaq.question.trim() || !editingFaq.answer.trim()) {
      toast.error("請填寫 FAQ 分組、問題及答案");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminFaq({ data: editingFaq }));
      await refreshCmsData();
      toast.success(editingFaq.id ? "FAQ 編輯已儲存" : "FAQ 已新增");
      setEditingFaq(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteFaq() {
    if (!deletingFaq) return;
    setFaqDeleting(true);
    setFaqDeleteError(null);
    try {
      assertNoServerError(await deleteAdminFaq({ data: { id: deletingFaq.id } }));
      await refreshCmsData();
      toast.success("已刪除");
      setDeletingFaq(null);
    } catch (err) {
      const message = errorText(err);
      setFaqDeleteError(message === "Not found" ? "此 FAQ 已被刪除，請重新載入頁面。" : message);
    } finally {
      setFaqDeleting(false);
    }
  }

  async function handleSaveCmsVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCmsVideo) return;
    if (!editingCmsVideo.title.trim() || !editingCmsVideo.video_url.trim()) {
      toast.error("請填寫影片標題及 YouTube 連結");
      return;
    }
    if (!isYouTubeVideoUrl(editingCmsVideo.video_url)) {
      toast.error("請輸入有效 YouTube 連結");
      return;
    }

    setSaving(true);
    try {
      assertNoServerError(await saveAdminCmsVideo({ data: editingCmsVideo }));
      await refreshCmsData();
      toast.success(editingCmsVideo.id ? "影片已更新" : "影片已新增");
      setEditingCmsVideo(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleFaqFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setFaqImportText(text);
      setFaqImportOpen(true);
      toast.success(`已讀取 ${file.name}`);
    } catch {
      toast.error("未能讀取 FAQ 檔案");
    }
  }

  function handleImportFaqsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsedFaqImportRows.length) {
      toast.error("未能從檔案內容解析 FAQ");
      return;
    }
    setFaqImportConfirmOpen(true);
  }

  async function handleImportFaqs() {
    if (!faqImportPreview.length) return;

    setFaqImportSaving(true);
    const total = faqImportPreview.length;
    let imported = 0;
    let failure: { position: number; message: string } | null = null;
    try {
      for (const [index, row] of faqImportPreview.entries()) {
        try {
          assertNoServerError(
            await saveAdminFaq({
              data: {
                scope: row.scope,
                question: row.question,
                answer: row.answer,
                sort_order: index + 1,
                // Bulk re-import of the same file is expected and must update in
                // place. The single-FAQ form deliberately does not set this.
                upsert: true,
              },
            }),
          );
          imported += 1;
        } catch (err) {
          // Stop at the first failure and report how far it got: the loop is not
          // transactional, so silently continuing left staff with no idea which
          // rows landed in the live agent's knowledge base.
          failure = { position: index + 1, message: errorText(err) };
          break;
        }
      }

      await refreshCmsData();
      if (failure) {
        setFaqImportConfirmOpen(false);
        toast.error(
          `已匯入 ${imported}／${total}，第 ${failure.position} 條失敗：${failure.message}`,
        );
        return;
      }

      const result = await rebuildAdminAiKnowledge();
      await refreshKnowledgeStatus();
      toast.success(`已匯入 ${total} 條 FAQ，AI 知識庫已重建 ${result.indexedChunks} 段內容`);
      setFaqImportConfirmOpen(false);
      setFaqImportOpen(false);
      setFaqImportText("");
    } catch (err) {
      setFaqImportConfirmOpen(false);
      toast.error(`已匯入 ${imported}／${total}，其後失敗：${errorText(err)}`);
    } finally {
      setFaqImportSaving(false);
    }
  }

  async function handleSaveMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMedia) return;

    setSaving(true);
    try {
      assertNoServerError(
        await updateAdminMediaAsset({
          data: {
            id: editingMedia.id,
            alt_text: nullIfBlank(editingMedia.alt_text ?? ""),
            owner_type: editingMedia.owner_type,
            owner_id: editingMedia.owner_id,
          },
        }),
      );
      await refreshCmsData();
      toast.success("媒體庫資料已更新");
      setEditingMedia(null);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRebuildKnowledge() {
    setKnowledgeLoading(true);
    try {
      const result = await rebuildAdminAiKnowledge();
      toast.success(
        `AI 知識庫已重建：${result.indexedSources} 個來源，${result.indexedChunks} 段內容`,
      );
      await refreshKnowledgeStatus();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setKnowledgeLoading(false);
    }
  }

  return (
    <AdminShell title="CMS" description="管理屋苑內容、文章、FAQ 及 SEO 資料。">
      {error ? <AdminError message={error} /> : null}
      {!data && !error ? <Skeleton className="h-72 w-full" /> : null}
      {data ? (
        <>
          <Card className="mb-4">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                  <Brain className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <CardTitle as="h2" className="text-base">
                    AI Agent FAQ Knowledge
                  </CardTitle>
                  <CardDescription>
                    FAQ、屋苑、文章及放盤會被索引成前台 live agent 的回答來源。
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleRebuildKnowledge}
                disabled={knowledgeLoading}
              >
                <RefreshCw className={`h-4 w-4 ${knowledgeLoading ? "animate-spin" : ""}`} />
                {knowledgeLoading ? (knowledgeStatus ? "重建中…" : "載入中…") : "重建索引"}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-6">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    knowledgeError ? "outline" : knowledgeStatus?.enabled ? "default" : "secondary"
                  }
                >
                  {knowledgeError
                    ? "狀態未知"
                    : knowledgeStatus?.enabled
                      ? "AI 已啟用"
                      : "AI 未啟用"}
                </Badge>
              </div>
              <KnowledgeMetric
                label="來源"
                value={knowledgeLoading && !knowledgeStatus ? "…" : knowledgeStatus?.sources}
              />
              <KnowledgeMetric
                label="內容段數"
                value={knowledgeLoading && !knowledgeStatus ? "…" : knowledgeStatus?.chunks}
              />
              <KnowledgeMetric
                label="公開段數"
                value={knowledgeLoading && !knowledgeStatus ? "…" : knowledgeStatus?.publicChunks}
              />
              <KnowledgeMetric
                label="待重建段數"
                value={knowledgeLoading && !knowledgeStatus ? "…" : knowledgeStatus?.staleChunks}
              />
              <KnowledgeMetric
                label="最後索引時間"
                value={formatDateTime(knowledgeStatus?.lastIndexedAt)}
              />
              {knowledgeError ? (
                <div
                  className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-6"
                  role="alert"
                >
                  <p className="text-sm text-muted-foreground">
                    狀態未知 — 未能讀取 AI 知識庫狀態，請重新載入。
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshKnowledgeStatus()}
                    disabled={knowledgeLoading}
                  >
                    <RefreshCw className={`h-4 w-4 ${knowledgeLoading ? "animate-spin" : ""}`} />
                    重新載入狀態
                  </Button>
                </div>
              ) : null}
              {knowledgeStatus && knowledgeStatus.staleChunks > 0 ? (
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-6">
                  <p className="text-sm text-muted-foreground">
                    有 {knowledgeStatus.staleChunks} 段內容已過時，前台 AI
                    仍會引用舊資料，請重建索引。
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRebuildKnowledge}
                    disabled={knowledgeLoading}
                  >
                    <RefreshCw className={`h-4 w-4 ${knowledgeLoading ? "animate-spin" : ""}`} />
                    重建索引
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Tabs
            value={activeTab}
            onValueChange={(tab) => {
              const nextTab = tab as AdminCmsTab;
              // A real history entry per tab: `replace: true` made browser Back
              // exit the CMS entirely instead of stepping back one tab.
              void navigate({
                search: { tab: nextTab === "estates" ? undefined : nextTab },
                resetScroll: false,
              });
            }}
          >
            <TabsList className="mb-4 grid h-auto w-full grid-cols-2 sm:grid-cols-3 lg:inline-flex lg:w-auto">
              <TabsTrigger value="estates">屋苑 SEO</TabsTrigger>
              <TabsTrigger value="articles">文章編輯</TabsTrigger>
              <TabsTrigger value="videos">YouTube影片</TabsTrigger>
              <TabsTrigger value="faqs">FAQ 編輯</TabsTrigger>
              <TabsTrigger value="media">媒體庫</TabsTrigger>
            </TabsList>

            <TabsContent value="estates">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle as="h2" className="text-base">
                      屋苑 SEO
                    </CardTitle>
                    <CardDescription>SEO 標題、描述、設施及屋苑頁內容。</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TableSearch
                      label="搜尋屋苑名稱、slug 或地區"
                      value={searchByTab.estates}
                      onChange={(value) =>
                        setSearchByTab((current) => ({ ...current, estates: value }))
                      }
                    />
                    <Button onClick={() => setEditingEstate({ ...emptyEstate })}>
                      <Plus className="h-4 w-4" />
                      新增屋苑
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {filteredEstates.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>屋苑</TableHead>
                          <TableHead>地區</TableHead>
                          <TableHead className="text-right">伙數</TableHead>
                          <TableHead>SEO 標題</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredEstates.map((estate) => (
                          <TableRow key={estate.id}>
                            <TableCell>
                              <p className="font-medium" title={estate.name_zh}>
                                {estate.name_zh}
                              </p>
                              <p className="text-xs text-muted-foreground">{estate.slug}</p>
                            </TableCell>
                            <TableCell>{estate.district_slug}</TableCell>
                            <TableCell className="text-right">
                              {estate.total_units?.toLocaleString() ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-xs truncate" title={estate.seo_title ?? ""}>
                              {estate.seo_title ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingEstate(estateToInput(estate))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      {searchByTab.estates.trim() ? (
                        <NoSearchMatch
                          label="屋苑"
                          query={searchByTab.estates}
                          onClear={() => setSearchByTab((current) => ({ ...current, estates: "" }))}
                        />
                      ) : (
                        <AdminEmptyState
                          title="未有屋苑"
                          description="新增第一個屋苑後即可管理 SEO 及頁面內容。"
                          action={
                            <Button onClick={() => setEditingEstate({ ...emptyEstate })}>
                              <Plus className="h-4 w-4" />
                              新增屋苑
                            </Button>
                          }
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="articles">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle as="h2" className="text-base">
                      文章編輯
                    </CardTitle>
                    <CardDescription>管理文章內容、分類、發布狀態及 SEO。</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TableSearch
                      label="搜尋標題、slug 或分類"
                      value={searchByTab.articles}
                      onChange={(value) =>
                        setSearchByTab((current) => ({ ...current, articles: value }))
                      }
                    />
                    <Button onClick={() => setEditingArticle({ ...emptyArticle })}>
                      <Plus className="h-4 w-4" />
                      新增文章
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {filteredArticles.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>標題</TableHead>
                          <TableHead>分類</TableHead>
                          <TableHead>狀態</TableHead>
                          <TableHead>SEO 標題</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredArticles.map((article) => (
                          <TableRow key={article.id}>
                            <TableCell>
                              <p className="font-medium">{article.title}</p>
                              <p className="text-xs text-muted-foreground">{article.slug}</p>
                            </TableCell>
                            <TableCell>{article.category ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={article.published ? "default" : "outline"}>
                                {article.published ? "已發布" : "草稿"}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {article.seo_title ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingArticle(articleToInput(article))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      {searchByTab.articles.trim() ? (
                        <NoSearchMatch
                          label="文章"
                          query={searchByTab.articles}
                          onClear={() =>
                            setSearchByTab((current) => ({ ...current, articles: "" }))
                          }
                        />
                      ) : (
                        <AdminEmptyState
                          title="未有文章"
                          description="新增文章後即可管理內容及發布狀態。"
                          action={
                            <Button onClick={() => setEditingArticle({ ...emptyArticle })}>
                              <Plus className="h-4 w-4" />
                              新增文章
                            </Button>
                          }
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="videos">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle as="h2" className="text-base">
                      YouTube影片
                    </CardTitle>
                    <CardDescription>管理 /videos 顯示的官方頻道影片連結。</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <TableSearch
                      label="搜尋影片標題或描述"
                      value={searchByTab.videos}
                      onChange={(value) =>
                        setSearchByTab((current) => ({ ...current, videos: value }))
                      }
                    />
                    <Button onClick={() => setEditingCmsVideo({ ...emptyCmsVideo })}>
                      <Plus className="h-4 w-4" />
                      新增影片
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {filteredCmsVideos.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>影片</TableHead>
                          <TableHead>狀態</TableHead>
                          <TableHead className="text-right">排序</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCmsVideos.map((video) => (
                          <TableRow key={video.id}>
                            <TableCell>
                              <p className="font-medium">{video.title}</p>
                              <a
                                href={video.video_url}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-xs text-muted-foreground hover:underline"
                              >
                                {video.video_url}
                              </a>
                            </TableCell>
                            <TableCell>
                              <Badge variant={video.published ? "default" : "outline"}>
                                {video.published ? "已發布" : "已隱藏"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{video.sort_order}</TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingCmsVideo(cmsVideoToInput(video))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      {searchByTab.videos.trim() ? (
                        <NoSearchMatch
                          label="影片"
                          query={searchByTab.videos}
                          onClear={() => setSearchByTab((current) => ({ ...current, videos: "" }))}
                        />
                      ) : (
                        <AdminEmptyState
                          title="未有 YouTube 影片"
                          description="新增影片連結後，/videos 會顯示官方頻道影片。"
                          action={
                            <Button onClick={() => setEditingCmsVideo({ ...emptyCmsVideo })}>
                              <Plus className="h-4 w-4" />
                              新增影片
                            </Button>
                          }
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="faqs">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle as="h2" className="text-base">
                      FAQ / AI Agent 配置
                    </CardTitle>
                    <CardDescription>
                      上載或貼上 FAQ 檔案，儲存後會自動重建 AI live agent 知識庫。
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={faqScopeFilter} onValueChange={setFaqScopeFilter}>
                      <SelectTrigger className="w-40" aria-label="依分組篩選">
                        <SelectValue placeholder="全部分組" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部分組</SelectItem>
                        {faqScopes.map((scope) => (
                          <SelectItem key={scope} value={scope}>
                            {scope}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <TableSearch
                      label="搜尋問題或答案"
                      value={searchByTab.faqs}
                      onChange={(value) =>
                        setSearchByTab((current) => ({ ...current, faqs: value }))
                      }
                    />
                    <Button variant="outline" asChild>
                      <label>
                        <Upload className="h-4 w-4" />
                        上載 FAQ 檔案
                        <input
                          className="sr-only"
                          type="file"
                          accept=".txt,.md,.csv,.tsv,text/plain,text/markdown,text/csv"
                          onChange={handleFaqFileChange}
                        />
                      </label>
                    </Button>
                    <Button variant="outline" onClick={() => setFaqImportOpen(true)}>
                      <FileText className="h-4 w-4" />
                      貼上 FAQ
                    </Button>
                    <Button
                      onClick={() =>
                        setEditingFaq({
                          ...emptyFaq,
                          scope: data.faqGroups[0]?.scope ?? emptyFaq.scope,
                        })
                      }
                    >
                      <Plus className="h-4 w-4" />
                      新增 FAQ
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {faqsByScope.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>分組</TableHead>
                          <TableHead>問題</TableHead>
                          <TableHead className="text-right">排序</TableHead>
                          <TableHead className="w-40 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {faqsByScope.map(([scope, rows]) => (
                          <Fragment key={scope}>
                            <TableRow className="bg-muted/50">
                              <TableCell colSpan={4}>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{scope}</span>
                                  <Badge variant="secondary">{rows.length}</Badge>
                                </div>
                              </TableCell>
                            </TableRow>
                            {rows.map((faq) => (
                              <TableRow key={faq.id}>
                                <TableCell>{faq.scope}</TableCell>
                                <TableCell>
                                  <p className="font-medium">{faq.question}</p>
                                  <p className="line-clamp-2 text-xs text-muted-foreground">
                                    {faq.answer}
                                  </p>
                                </TableCell>
                                <TableCell className="text-right">{faq.sort_order}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setEditingFaq(faqToInput(faq))}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      編輯
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setDeletingFaq(faq)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      刪除
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-6">
                      {searchByTab.faqs.trim() ? (
                        <NoSearchMatch
                          label="FAQ"
                          query={searchByTab.faqs}
                          onClear={() => setSearchByTab((current) => ({ ...current, faqs: "" }))}
                        />
                      ) : (
                        <AdminEmptyState
                          title="未有 FAQ"
                          description="新增 FAQ 後即可在對應頁面顯示常見問題。"
                          action={
                            <Button onClick={() => setEditingFaq({ ...emptyFaq })}>
                              <Plus className="h-4 w-4" />
                              新增 FAQ
                            </Button>
                          }
                        />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="media">
              <Card>
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle as="h2" className="text-base">
                      媒體庫
                    </CardTitle>
                    <CardDescription>更新圖片替代文字，改善搜尋及無障礙內容。</CardDescription>
                  </div>
                  {mediaAssets ? (
                    <TableSearch
                      label="搜尋檔案路徑或替代文字"
                      value={searchByTab.media}
                      onChange={(value) =>
                        setSearchByTab((current) => ({ ...current, media: value }))
                      }
                    />
                  ) : null}
                </CardHeader>
                <CardContent className="p-0">
                  {!mediaAssets ? <Skeleton className="m-6 h-48 w-auto" /> : null}
                  {filteredMediaAssets.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>檔案</TableHead>
                          <TableHead>類型</TableHead>
                          <TableHead>用途</TableHead>
                          <TableHead>替代文字</TableHead>
                          <TableHead className="w-28 text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMediaAssets.map((asset) => (
                          <TableRow key={asset.id}>
                            <TableCell>
                              <a
                                href={asset.url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium hover:underline"
                              >
                                {asset.pathname}
                              </a>
                              <p className="text-xs text-muted-foreground">
                                {formatBytes(asset.size_bytes)}
                              </p>
                            </TableCell>
                            <TableCell>{asset.content_type ?? "—"}</TableCell>
                            <TableCell>
                              {asset.owner_type}
                              {asset.owner_id ? (
                                <p className="text-xs text-muted-foreground">{asset.owner_id}</p>
                              ) : null}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                              {asset.alt_text ?? "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setEditingMedia(mediaToInput(asset))}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                  {mediaAssets && !filteredMediaAssets.length ? (
                    <div className="p-6">
                      {searchByTab.media.trim() ? (
                        <NoSearchMatch
                          label="媒體"
                          query={searchByTab.media}
                          onClear={() => setSearchByTab((current) => ({ ...current, media: "" }))}
                        />
                      ) : (
                        <AdminEmptyState
                          title="未有媒體"
                          description="上載相片後即可在媒體庫管理替代文字。"
                        />
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <EstateDialog
            estate={editingEstate}
            fingerprintValues={estateFingerprintValues(
              editingEstate,
              data?.estates.find((item) => item.id === editingEstate?.id) ?? null,
            )}
            saving={saving}
            onChange={setEditingEstate}
            onClose={() => setEditingEstate(null)}
            onSubmit={handleSaveEstate}
          />
          <ArticleDialog
            article={editingArticle}
            fingerprintValues={articleFingerprintValues(
              editingArticle,
              data?.articles.find((item) => item.id === editingArticle?.id) ?? null,
            )}
            saving={saving}
            onChange={setEditingArticle}
            onClose={() => setEditingArticle(null)}
            onSubmit={handleSaveArticle}
          />
          <CmsVideoDialog
            video={editingCmsVideo}
            fingerprintValues={cmsVideoFingerprintValues(
              editingCmsVideo,
              cmsVideos?.find((item) => item.id === editingCmsVideo?.id) ?? null,
            )}
            saving={saving}
            onChange={setEditingCmsVideo}
            onClose={() => setEditingCmsVideo(null)}
            onSubmit={handleSaveCmsVideo}
          />
          <FaqDialog
            faq={editingFaq}
            fingerprintValues={faqFingerprintValues(
              editingFaq,
              data?.faqs.find((item) => item.id === editingFaq?.id) ?? null,
            )}
            saving={saving}
            onChange={setEditingFaq}
            onClose={() => setEditingFaq(null)}
            onSubmit={handleSaveFaq}
          />
          <AdminConfirmDialog
            open={deletingFaq !== null}
            title="刪除 FAQ"
            description={
              deletingFaq
                ? `確定要刪除「${deletingFaq.question}」？此操作無法復原，公開頁面及 AI Agent 知識庫會即時移除此問答。`
                : ""
            }
            confirmLabel="刪除"
            confirmVariant="destructive"
            isPending={faqDeleting}
            error={faqDeleteError}
            onOpenChange={(open) => {
              if (!open) {
                setDeletingFaq(null);
                setFaqDeleteError(null);
              }
            }}
            onConfirm={handleDeleteFaq}
          />
          <FaqImportDialog
            open={faqImportOpen}
            scope={faqImportScope}
            text={faqImportText}
            parsedCount={parsedFaqImportRows.length}
            saving={faqImportSaving}
            onScopeChange={setFaqImportScope}
            onTextChange={setFaqImportText}
            onClose={() => setFaqImportOpen(false)}
            onSubmit={handleImportFaqsSubmit}
          />
          <AdminConfirmDialog
            open={faqImportConfirmOpen}
            title="確認匯入 FAQ"
            description={
              faqImportOverwriteCount > 0
                ? `共 ${faqImportPreview.length} 條，其中 ${faqImportOverwriteCount} 條會覆寫現有答案（相同分組及問題視為同一條）。此操作無法復原。`
                : `共 ${faqImportPreview.length} 條，全部為新增，不會覆寫現有 FAQ。`
            }
            confirmLabel="確認匯入"
            confirmVariant={faqImportOverwriteCount > 0 ? "destructive" : "default"}
            isPending={faqImportSaving}
            onOpenChange={setFaqImportConfirmOpen}
            onConfirm={handleImportFaqs}
          >
            {faqImportOverwriteCount > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>問題</TableHead>
                      <TableHead>狀態</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faqImportPreview.map((row) => (
                      <TableRow key={`${row.scope}::${row.question}`}>
                        <TableCell className="max-w-xs truncate" title={row.question}>
                          {row.question}
                        </TableCell>
                        <TableCell>
                          {row.overwrite ? (
                            <Badge variant="destructive">覆寫</Badge>
                          ) : (
                            <Badge variant="outline">新增</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </AdminConfirmDialog>
          <MediaDialog
            media={editingMedia}
            saving={saving}
            onChange={setEditingMedia}
            onClose={() => setEditingMedia(null)}
            onSubmit={handleSaveMedia}
          />
        </>
      ) : null}
    </AdminShell>
  );
}

function CmsVideoDialog({
  video,
  saving,
  fingerprintValues,
  onChange,
  onClose,
  onSubmit,
}: {
  video: AdminCmsVideoInput | null;
  saving: boolean;
  fingerprintValues: Record<string, unknown>;
  onChange: (video: AdminCmsVideoInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { requestClose, dialog } = useDirtyCloseGuard({
    isDirty: useEditingDirty(video),
    onClose,
    description: "你未儲存的影片修改會遺失。",
  });
  return (
    <>
      <Dialog open={!!video} onOpenChange={(open) => (!open ? requestClose() : undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{video?.id ? "編輯 YouTube 影片" : "新增 YouTube 影片"}</DialogTitle>
            <DialogDescription>影片會顯示於 /videos。關閉發布即可隱藏。</DialogDescription>
          </DialogHeader>
          {video ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
              <form className="grid gap-4" onSubmit={onSubmit}>
                <TextField
                  label="標題"
                  value={video.title}
                  onChange={(value) => onChange({ ...video, title: value })}
                  required
                />
                <TextField
                  label="YouTube 連結"
                  value={video.video_url}
                  onChange={(value) => onChange({ ...video, video_url: value })}
                  required
                />
                <TextAreaField
                  label="描述"
                  value={video.description ?? ""}
                  onChange={(value) => onChange({ ...video, description: nullIfBlank(value) })}
                  rows={3}
                />
                <NumberField
                  label="排序"
                  value={video.sort_order}
                  onChange={(value) => onChange({ ...video, sort_order: value ?? 0 })}
                />
                <Field label="發布">
                  <div className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                    <Switch
                      checked={video.published}
                      onCheckedChange={(checked) => onChange({ ...video, published: checked })}
                      aria-label="切換影片發布狀態"
                    />
                    <span className="text-sm text-muted-foreground">
                      {video.published ? "已發布" : "已隱藏"}
                    </span>
                  </div>
                </Field>
                <EditorFooter saving={saving} onClose={requestClose} />
              </form>
              <AdminContentCopilot
                resourceType="video"
                resourceId={video.id ?? null}
                fingerprintValues={fingerprintValues}
                values={{ title: video.title, description: video.description }}
                onApply={(patch) => onChange({ ...video, ...patch })}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

function EstateDialog({
  estate,
  saving,
  fingerprintValues,
  onChange,
  onClose,
  onSubmit,
}: {
  estate: AdminEstateInput | null;
  saving: boolean;
  fingerprintValues: Record<string, unknown>;
  onChange: (estate: AdminEstateInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { requestClose, dialog } = useDirtyCloseGuard({
    isDirty: useEditingDirty(estate),
    onClose,
    description: "你未儲存的屋苑 SEO 修改會遺失。",
  });
  return (
    <>
      <Dialog open={!!estate} onOpenChange={(open) => (!open ? requestClose() : undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{estate?.id ? "編輯屋苑 SEO" : "新增屋苑 SEO"}</DialogTitle>
            <DialogDescription>完整欄位會一併儲存，避免覆寫未載入資料。</DialogDescription>
          </DialogHeader>
          {estate ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
              <form className="grid gap-4" onSubmit={onSubmit}>
                <div className="grid gap-4 md:grid-cols-3">
                  <TextField
                    label="Slug"
                    value={estate.slug}
                    onChange={(value) => onChange({ ...estate, slug: value })}
                    required
                  />
                  <TextField
                    label="中文名"
                    value={estate.name_zh}
                    onChange={(value) => onChange({ ...estate, name_zh: value })}
                    required
                  />
                  <TextField
                    label="英文名"
                    value={estate.name_en ?? ""}
                    onChange={(value) => onChange({ ...estate, name_en: nullIfBlank(value) })}
                  />
                  <TextField
                    label="地區"
                    value={estate.district_slug}
                    onChange={(value) => onChange({ ...estate, district_slug: value })}
                    required
                  />
                  <TextField
                    label="發展商"
                    value={estate.developer ?? ""}
                    onChange={(value) => onChange({ ...estate, developer: nullIfBlank(value) })}
                  />
                  <TextField
                    label="Hero 圖片"
                    value={estate.hero_image ?? ""}
                    onChange={(value) => onChange({ ...estate, hero_image: nullIfBlank(value) })}
                  />
                  <NumberField
                    label="落成年份"
                    value={estate.year_completed}
                    onChange={(value) => onChange({ ...estate, year_completed: value })}
                  />
                  <NumberField
                    label="期數"
                    value={estate.phases}
                    onChange={(value) => onChange({ ...estate, phases: value })}
                  />
                  <NumberField
                    label="伙數"
                    value={estate.total_units}
                    onChange={(value) => onChange({ ...estate, total_units: value })}
                  />
                  <NumberField
                    label="面積下限"
                    value={estate.area_min}
                    onChange={(value) => onChange({ ...estate, area_min: value })}
                  />
                  <NumberField
                    label="面積上限"
                    value={estate.area_max}
                    onChange={(value) => onChange({ ...estate, area_max: value })}
                  />
                </div>
                <TextAreaField
                  label="設施"
                  value={estate.facilities.join("\n")}
                  onChange={(value) => onChange({ ...estate, facilities: splitList(value) })}
                  rows={4}
                />
                <TextAreaField
                  label="描述"
                  value={estate.description ?? ""}
                  onChange={(value) => onChange({ ...estate, description: nullIfBlank(value) })}
                  rows={5}
                />
                <TextField
                  label="SEO 標題"
                  value={estate.seo_title ?? ""}
                  onChange={(value) => onChange({ ...estate, seo_title: nullIfBlank(value) })}
                />
                <TextAreaField
                  label="SEO 描述"
                  value={estate.seo_description ?? ""}
                  onChange={(value) => onChange({ ...estate, seo_description: nullIfBlank(value) })}
                  rows={3}
                />
                <EditorFooter saving={saving} onClose={requestClose} />
              </form>
              <AdminContentCopilot
                resourceType="estate"
                resourceId={estate.id ?? null}
                fingerprintValues={fingerprintValues}
                values={{
                  name_zh: estate.name_zh,
                  name_en: estate.name_en,
                  description: estate.description,
                  seo_title: estate.seo_title,
                  seo_description: estate.seo_description,
                }}
                onApply={(patch) => onChange({ ...estate, ...patch })}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

function ArticleDialog({
  article,
  saving,
  fingerprintValues,
  onChange,
  onClose,
  onSubmit,
}: {
  article: AdminArticleInput | null;
  saving: boolean;
  fingerprintValues: Record<string, unknown>;
  onChange: (article: AdminArticleInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { requestClose, dialog } = useDirtyCloseGuard({
    isDirty: useEditingDirty(article),
    onClose,
    description: "你未儲存的文章修改會遺失。",
  });
  return (
    <>
      <Dialog open={!!article} onOpenChange={(open) => (!open ? requestClose() : undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{article?.id ? "文章編輯" : "新增文章"}</DialogTitle>
            <DialogDescription>內容、發布狀態及 SEO 欄位會一併儲存。</DialogDescription>
          </DialogHeader>
          {article ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
              <form className="grid gap-4" onSubmit={onSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Slug"
                    value={article.slug}
                    onChange={(value) => onChange({ ...article, slug: value })}
                    required
                  />
                  <TextField
                    label="標題"
                    value={article.title}
                    onChange={(value) => onChange({ ...article, title: value })}
                    required
                  />
                  <TextField
                    label="分類"
                    value={article.category ?? ""}
                    onChange={(value) => onChange({ ...article, category: nullIfBlank(value) })}
                  />
                  <NumberField
                    label="閱讀分鐘"
                    value={article.reading_minutes}
                    onChange={(value) => onChange({ ...article, reading_minutes: value })}
                  />
                  <TextField
                    label="封面圖片"
                    value={article.cover_image ?? ""}
                    onChange={(value) => onChange({ ...article, cover_image: nullIfBlank(value) })}
                  />
                  <TextField
                    label="發布時間"
                    value={article.published_at ?? ""}
                    onChange={(value) => onChange({ ...article, published_at: nullIfBlank(value) })}
                  />
                </div>
                <Field label="發布">
                  <div className="flex min-h-11 items-center gap-3 rounded-md border px-3">
                    <Switch
                      checked={article.published}
                      onCheckedChange={(checked) => onChange({ ...article, published: checked })}
                      aria-label="切換文章發布狀態"
                    />
                    <span className="text-sm text-muted-foreground">
                      {article.published ? "已發布" : "草稿"}
                    </span>
                  </div>
                </Field>
                <TextAreaField
                  label="摘要"
                  value={article.excerpt ?? ""}
                  onChange={(value) => onChange({ ...article, excerpt: nullIfBlank(value) })}
                  rows={3}
                />
                <TextAreaField
                  label="內容"
                  value={article.content ?? ""}
                  onChange={(value) => onChange({ ...article, content: nullIfBlank(value) })}
                  rows={8}
                />
                <TextField
                  label="SEO 標題"
                  value={article.seo_title ?? ""}
                  onChange={(value) => onChange({ ...article, seo_title: nullIfBlank(value) })}
                />
                <TextAreaField
                  label="SEO 描述"
                  value={article.seo_description ?? ""}
                  onChange={(value) =>
                    onChange({ ...article, seo_description: nullIfBlank(value) })
                  }
                  rows={3}
                />
                <EditorFooter saving={saving} onClose={requestClose} />
              </form>
              <AdminContentCopilot
                resourceType="article"
                resourceId={article.id ?? null}
                fingerprintValues={fingerprintValues}
                values={{
                  title: article.title,
                  excerpt: article.excerpt,
                  content: article.content,
                  seo_title: article.seo_title,
                  seo_description: article.seo_description,
                }}
                onApply={(patch) => onChange({ ...article, ...patch })}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

function FaqDialog({
  faq,
  saving,
  fingerprintValues,
  onChange,
  onClose,
  onSubmit,
}: {
  faq: AdminFaqInput | null;
  saving: boolean;
  fingerprintValues: Record<string, unknown>;
  onChange: (faq: AdminFaqInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { requestClose, dialog } = useDirtyCloseGuard({
    isDirty: useEditingDirty(faq),
    onClose,
    description: "你未儲存的 FAQ 修改會遺失。",
  });
  return (
    <>
      <Dialog open={!!faq} onOpenChange={(open) => (!open ? requestClose() : undefined)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{faq?.id ? "FAQ 編輯" : "新增 FAQ"}</DialogTitle>
            <DialogDescription>FAQ 會按 scope 分組並依排序值顯示。</DialogDescription>
          </DialogHeader>
          {faq ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
              <form className="grid gap-4" onSubmit={onSubmit}>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField
                    label="Scope"
                    value={faq.scope}
                    onChange={(value) => onChange({ ...faq, scope: value })}
                    required
                  />
                  <NumberField
                    label="排序"
                    value={faq.sort_order}
                    onChange={(value) => onChange({ ...faq, sort_order: value ?? 0 })}
                  />
                </div>
                <TextField
                  label="問題"
                  value={faq.question}
                  onChange={(value) => onChange({ ...faq, question: value })}
                  required
                />
                <TextAreaField
                  label="答案"
                  value={faq.answer}
                  onChange={(value) => onChange({ ...faq, answer: value })}
                  rows={6}
                  required
                />
                <EditorFooter saving={saving} onClose={requestClose} />
              </form>
              <AdminContentCopilot
                resourceType="faq"
                resourceId={faq.id ?? null}
                fingerprintValues={fingerprintValues}
                values={{ question: faq.question, answer: faq.answer }}
                onApply={(patch) => onChange({ ...faq, ...patch })}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

function FaqImportDialog({
  open,
  scope,
  text,
  parsedCount,
  saving,
  onScopeChange,
  onTextChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  scope: string;
  text: string;
  parsedCount: number;
  saving: boolean;
  onScopeChange: (scope: string) => void;
  onTextChange: (text: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>FAQ 檔案匯入 / AI Agent 訓練</DialogTitle>
          <DialogDescription>
            支援 Q:/A:、問題:/答案:、Markdown heading、CSV 或 TSV。匯入後會自動重建 AI 知識庫。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <TextField label="預設 Scope" value={scope} onChange={onScopeChange} required />
          <TextAreaField
            label="FAQ 檔案內容"
            value={text}
            onChange={onTextChange}
            rows={14}
            required
          />
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            已解析 <span className="font-medium text-foreground">{parsedCount}</span> 條 FAQ。
            每條會儲存到 Neon，然後即時重建 live agent 知識庫。
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving || parsedCount === 0}>
              <Upload className="h-4 w-4" />
              {saving ? "匯入及訓練中…" : "匯入並訓練 AI"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MediaDialog({
  media,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  media: EditingMediaAsset | null;
  saving: boolean;
  onChange: (media: EditingMediaAsset | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { requestClose, dialog } = useDirtyCloseGuard({
    isDirty: useEditingDirty(media),
    onClose,
    description: "你未儲存的替代文字修改會遺失。",
  });
  return (
    <>
      <Dialog open={!!media} onOpenChange={(open) => (!open ? requestClose() : undefined)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>媒體庫</DialogTitle>
            <DialogDescription>{media?.pathname ?? "更新媒體資料"}</DialogDescription>
          </DialogHeader>
          {media ? (
            <form className="grid gap-4" onSubmit={onSubmit}>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <a
                  href={media.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-medium hover:underline"
                >
                  {media.url}
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {media.owner_type}
                  {media.owner_id ? ` · ${media.owner_id}` : ""}
                </p>
              </div>
              <TextAreaField
                label="替代文字"
                value={media.alt_text ?? ""}
                onChange={(value) => onChange({ ...media, alt_text: value })}
                rows={4}
              />
              <EditorFooter saving={saving} onClose={requestClose} />
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}

function EditorFooter({ saving, onClose }: { saving: boolean; onClose: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
        取消
      </Button>
      <Button type="submit" disabled={saving}>
        <Save className="h-4 w-4" />
        {saving ? "儲存中…" : "儲存"}
      </Button>
    </DialogFooter>
  );
}

function KnowledgeMetric({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value ?? "—"}</p>
    </div>
  );
}

function TableSearch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="w-56 pl-8 pr-8"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清除搜尋"
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function NoSearchMatch({
  label,
  query,
  onClear,
}: {
  label: string;
  query: string;
  onClear: () => void;
}) {
  return (
    <AdminEmptyState
      title={`找不到符合「${query}」的${label}`}
      description="請檢查關鍵字，或清除搜尋查看全部。"
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          清除搜尋
        </Button>
      }
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <Input value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </Field>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(parseNullableNumber(event.target.value))}
      />
    </Field>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <Textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </Field>
  );
}

function estateFingerprintValues(
  estate: AdminEstateInput | null,
  persisted: AdminEstateCmsRow | null,
): Record<string, unknown> {
  if (!estate) return {};
  return {
    id: estate.id ?? "",
    name_zh: estate.name_zh,
    name_en: estate.name_en,
    description: estate.description,
    seo_title: estate.seo_title,
    seo_description: estate.seo_description,
    slug: estate.slug,
    district_slug: estate.district_slug,
    developer: estate.developer,
    year_completed: estate.year_completed,
    phases: estate.phases,
    total_units: estate.total_units,
    area_min: estate.area_min,
    area_max: estate.area_max,
    facilities: estate.facilities,
    updated_at: persisted?.updated_at ?? null,
  };
}

function articleFingerprintValues(
  article: AdminArticleInput | null,
  persisted: AdminArticleCmsRow | null,
): Record<string, unknown> {
  if (!article) return {};
  return {
    id: article.id ?? "",
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    seo_title: article.seo_title,
    seo_description: article.seo_description,
    slug: article.slug,
    category: article.category,
    reading_minutes: article.reading_minutes,
    published: article.published,
    published_at: article.published_at,
    updated_at: persisted?.updated_at ?? null,
  };
}

function faqFingerprintValues(
  faq: AdminFaqInput | null,
  persisted: AdminFaqCmsRow | null,
): Record<string, unknown> {
  if (!faq) return {};
  return {
    id: faq.id ?? "",
    question: faq.question,
    answer: faq.answer,
    scope: faq.scope,
    sort_order: faq.sort_order,
    created_at: persisted?.created_at ?? null,
  };
}

function cmsVideoFingerprintValues(
  video: AdminCmsVideoInput | null,
  persisted: AdminCmsVideoRow | null,
): Record<string, unknown> {
  if (!video) return {};
  return {
    id: video.id ?? "",
    title: video.title,
    description: video.description,
    video_url: video.video_url,
    sort_order: video.sort_order,
    published: video.published,
    created_at: persisted?.created_at ?? null,
    updated_at: persisted?.updated_at ?? null,
  };
}
function estateToInput(estate: AdminEstateCmsRow): AdminEstateInput {
  return {
    id: estate.id,
    slug: estate.slug,
    name_zh: estate.name_zh,
    name_en: estate.name_en,
    district_slug: estate.district_slug,
    developer: estate.developer,
    year_completed: estate.year_completed,
    phases: estate.phases,
    total_units: estate.total_units,
    area_min: estate.area_min,
    area_max: estate.area_max,
    description: estate.description,
    hero_image: estate.hero_image,
    facilities: estate.facilities,
    seo_title: estate.seo_title,
    seo_description: estate.seo_description,
  };
}

function articleToInput(article: AdminArticleCmsRow): AdminArticleInput {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    cover_image: article.cover_image,
    category: article.category,
    reading_minutes: article.reading_minutes,
    published: article.published,
    published_at: article.published_at,
    seo_title: article.seo_title,
    seo_description: article.seo_description,
  };
}

function cmsVideoToInput(video: AdminCmsVideoRow): AdminCmsVideoInput {
  return {
    id: video.id,
    title: video.title,
    video_url: video.video_url,
    description: video.description,
    sort_order: video.sort_order,
    published: video.published,
  };
}

function faqToInput(faq: AdminFaqCmsRow): AdminFaqInput {
  return {
    id: faq.id,
    scope: faq.scope,
    question: faq.question,
    answer: faq.answer,
    sort_order: faq.sort_order,
  };
}

function mediaToInput(asset: AdminMediaAssetRow): EditingMediaAsset {
  return {
    id: asset.id,
    url: asset.url,
    pathname: asset.pathname,
    alt_text: asset.alt_text,
    owner_type: asset.owner_type,
    owner_id: asset.owner_id,
  };
}

function nullIfBlank(value: string) {
  const text = value.trim();
  return text ? text : null;
}

// Case/whitespace-insensitive substring match across whichever fields a tab
// wants searchable. Blank query matches everything (no query = no filter).
function matchesSearch(query: string, fields: Array<string | null | undefined>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

// Composite key for diffing an import row against an already-loaded FAQ --
// must match the (scope, question) uniqueness the upsert's ON CONFLICT relies on.
function faqImportKey(scope: string, question: string) {
  return `${scope}::${question.trim().toLowerCase()}`;
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNullableNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatBytes(value: number | null) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function assertNoServerError(result: unknown) {
  if (!result || typeof result !== "object" || !("error" in result)) return;
  const error = (result as { error?: unknown }).error;
  if (typeof error === "string" && error) throw new Error(error);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "操作失敗，請稍後再試";
}
