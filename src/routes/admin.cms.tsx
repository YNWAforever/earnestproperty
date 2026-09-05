import { uploadAdminMedia } from "@/lib/admin/media-upload";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Archive,
  Brain,
  FileText,
  History,
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

import { CmsPublicationCompare } from "@/components/admin/CmsPublicationCompare";
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
import { VIDEO_CATEGORIES } from "@/content/video-categories";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useDirtyCloseGuard } from "@/hooks/use-unsaved-changes-guard";
import { parseAdminFaqImport } from "@/lib/admin/faq-import";
import { isYouTubeVideoUrl } from "@/lib/youtube-video-url.js";
import {
  archiveAdminCmsResource,
  fetchAdminCmsEditor,
  publishAdminCmsRevision,
  restoreAdminCmsRevision,
  saveAdminCmsDraft,
} from "@/lib/neon/admin-cms";
import type {
  CmsEditState,
  CmsHubRow,
  CmsPayloadValue,
  CmsRevisionSummary,
} from "@/lib/neon/admin-cms.types";
import {
  checkAdminFaqConflicts,
  deleteAdminFaq,
  fetchAdminPage,
  fetchAdminAiKnowledgeStatus,
  rebuildAdminAiKnowledge,
  saveAdminCmsVideo,
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

// Mirrors the LIMITs in listAdminCms() (admin-data.server.ts). Kept here so the
// tables can state the cap rather than presenting a truncated page as the whole
// dataset.
const CMS_ROW_LIMITS = { estates: 50, articles: 50, faqs: 50 } as const;

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
  category: null,
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
  // Server-resolved (scope|question) keys that already exist. `null` means "not
  // checked yet"; the confirm must not claim anything about overwrites until
  // this is populated, because the loaded FAQ page is capped at 120 rows.
  const [faqImportConflicts, setFaqImportConflicts] = useState<Set<string> | null>(null);
  const [faqImportChecking, setFaqImportChecking] = useState(false);
  const [editingMedia, setEditingMedia] = useState<EditingMediaAsset | null>(null);
  const [estateRevisions, setEstateRevisions] = useState<CmsRevisionSummary[] | null>(null);
  // The full latest-revision payload, including the ~10 estate fields this
  // dialog has no UI for (aliases/geo/PSF/etc, added by the /admin/estates
  // editor). Every draft save here must carry them forward unchanged --
  // otherwise saving through this dialog would silently blank them out on
  // next publish, since the shared projector writes whatever key is (or
  // isn't) present in the payload it's given.
  const [estateLatestPayload, setEstateLatestPayload] = useState<Record<
    string,
    CmsPayloadValue
  > | null>(null);
  const [articleRevisions, setArticleRevisions] = useState<CmsRevisionSummary[] | null>(null);
  const estateLoadSequence = useRef(0);
  const articleLoadSequence = useRef(0);
  const [estateEdit, setEstateEdit] = useState<CmsEditState<
    Record<string, CmsPayloadValue>
  > | null>(null);
  const [articleEdit, setArticleEdit] = useState<CmsEditState<
    Record<string, CmsPayloadValue>
  > | null>(null);
  const [draftRows, setDraftRows] = useState<CmsHubRow[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState<{ type: "estate" | "article"; id: string } | null>(
    null,
  );
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
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  const [mediaUploading, setMediaUploading] = useState(false);

  const [cmsCursor, setCmsCursor] = useState<string | null>(null);
  const [cmsNextCursor, setCmsNextCursor] = useState<string | null>(null);
  const [cmsTotal, setCmsTotal] = useState(0);
  const cmsRequest = useRef(0);
  const activeSearch = searchByTab[activeTab];
  const refreshCmsData = useCallback(
    async (cursor: string | null = null) => {
      const sequence = ++cmsRequest.current;
      const page = await fetchAdminPage({
        data: {
          resource: activeTab,
          cursor,
          q: activeSearch,
          ...(activeTab === "faqs" ? { scope: faqScopeFilter } : {}),
        },
      });
      if (sequence !== cmsRequest.current) return;
      setCmsCursor(cursor);
      setCmsNextCursor(page.nextCursor);
      setCmsTotal(page.total);
      setDraftRows(
        (
          page.rows as Array<{
            id: string;
            is_draft?: boolean;
            draft_revision_id?: string;
            draft_version?: number;
            title?: string;
            name_zh?: string;
          }>
        )
          .filter((row) => row.is_draft)
          .map((row) => ({
            resourceType: activeTab === "estates" ? "estate" : "article",
            resourceId: row.id,
            title: row.title ?? row.name_zh ?? "",
            slug: null,
            state: "draft",
            latestRevisionId: row.draft_revision_id!,
            latestVersion: row.draft_version!,
            publishedVersion: null,
            updatedAt: "",
            updatedBy: null,
          })),
      );
      const visible = page.rows.filter((row) => !(row as { is_draft?: boolean }).is_draft);
      if (activeTab === "media") setMediaAssets(visible as AdminMediaAssetRow[]);
      else if (activeTab === "videos") setCmsVideos(visible as AdminCmsVideoRow[]);
      else
        setData(
          (current) =>
            ({
              ...{ estates: [], articles: [], faqs: [], faqGroups: [] },
              ...current,
              [activeTab]: visible,
            }) as AdminCmsData,
        );
      setData((current) => current ?? { estates: [], articles: [], faqs: [], faqGroups: [] });
      setError(null);
    },
    [activeTab, activeSearch, faqScopeFilter],
  );

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
  }, [refreshCmsData, user]);
  useEffect(() => {
    if (user) void refreshKnowledgeStatus();
  }, [refreshKnowledgeStatus, user]);

  const filteredEstates = data?.estates ?? [];
  const filteredArticles = data?.articles ?? [];
  const filteredVideos = cmsVideos ?? [];
  const filteredMediaAssets = mediaAssets ?? [];

  const faqScopes = useMemo(
    () => Array.from(new Set((data?.faqs ?? []).map((faq) => faq.scope))),
    [data?.faqs],
  );

  const faqsByScope = useMemo(() => {
    const groups = new Map<string, AdminFaqCmsRow[]>();
    for (const faq of data?.faqs ?? []) {
      if (faqScopeFilter !== "all" && faq.scope !== faqScopeFilter) continue;

      const existing = groups.get(faq.scope) ?? [];
      existing.push(faq);
      groups.set(faq.scope, existing);
    }
    return Array.from(groups.entries());
  }, [data?.faqs, faqScopeFilter]);

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
    // `data.faqs` is only used for the previous-answer text, which is a nicety.
    // Whether a row overwrites is decided by the server-resolved conflict set,
    // because the loaded page cannot see past its LIMIT.
    const loaded = new Map(
      (data?.faqs ?? []).map((faq) => [faqImportKey(faq.scope, faq.question), faq]),
    );
    return parsedFaqImportRows.map((row) => {
      const scope = row.scope ?? faqImportScope;
      const key = faqImportKey(scope, row.question);
      return {
        scope,
        question: row.question,
        answer: row.answer,
        previousAnswer: loaded.get(key)?.answer ?? null,
        overwrite: faqImportConflicts ? faqImportConflicts.has(key) : false,
      };
    });
  }, [data?.faqs, faqImportConflicts, faqImportScope, parsedFaqImportRows]);

  const faqImportOverwriteCount = faqImportPreview.filter((row) => row.overwrite).length;

  /** Refresh the tables after a write that already succeeded.
   *
   * The five editors used to `await refreshCmsData()` inside the same try as
   * the write, so a refetch failure surfaced as a red toast with the dialog
   * still open and the table still showing pre-save data -- every signal saying
   * "it did not save". Staff pressed 儲存 again, and for a new estate/article/
   * video with no `id` that created a second row or hit a raw Postgres unique
   * violation. A failed refresh is now reported as exactly what it is. */
  async function refreshAfterWrite(successMessage: string) {
    try {
      await refreshCmsData();
      toast.success(successMessage);
    } catch {
      toast.success(`${successMessage}（列表未能更新，請重新載入頁面）`);
    }
  }

  async function loadEstateRevisions(resourceId: string | undefined) {
    const sequence = ++estateLoadSequence.current;
    if (!resourceId) {
      setEstateRevisions(null);
      setEstateLatestPayload(null);
      setEstateEdit(null);
      return;
    }
    try {
      const { revisions, payload, editState } = await fetchAdminCmsEditor({
        data: { resourceType: "estate", resourceId },
      });
      if (sequence !== estateLoadSequence.current) return;
      setEstateEdit(editState);
      if (payload)
        setEditingEstate({ ...emptyEstate, ...payload, id: resourceId } as AdminEstateInput);
      setEstateRevisions(revisions);
      setEstateLatestPayload(payload);
    } catch {
      if (sequence === estateLoadSequence.current) toast.error("未能載入完整草稿，請重試。");
    }
  }

  async function handleSaveEstateDraft(event: FormEvent<HTMLFormElement>) {
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

    const sequence = estateLoadSequence.current;
    setSaving(true);
    try {
      const result = await callCms(() =>
        saveAdminCmsDraft({
          data: {
            resourceType: "estate",
            resourceId: editingEstate.id,
            // estateLatestPayload first so this dialog's own 15 known fields
            // (from editingEstate) always win for the fields it controls,
            // while the ~10 fields it has no UI for pass through unchanged.
            payload: { ...estateLatestPayload, ...editingEstate },
            basePublishedVersion: estateEdit?.basePublishedVersion ?? null,
            draftRevisionId: estateEdit?.draftRevisionId ?? null,
            draftEditVersion: estateEdit?.draftEditVersion ?? null,
          },
        }),
      );
      if (sequence === estateLoadSequence.current) {
        setEstateEdit(result.editState);
        setEditingEstate((current) => (current ? { ...current, id: result.resourceId } : current));
      }
      void refreshCmsData().catch(() => undefined);
      toast.success("草稿已儲存");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishEstate() {
    if (!editingEstate) return;
    setPublishing(true);
    try {
      if (
        !estateEdit?.draftRevisionId ||
        Object.entries(editingEstate).some(
          ([key, value]) =>
            key !== "id" &&
            JSON.stringify(value) !==
              JSON.stringify(
                ({ ...emptyEstate, ...estateEdit.payload } as Record<string, unknown>)[key],
              ),
        )
      ) {
        throw new Error("請先儲存草稿並核對內容後發布。");
      }
      const draft = { resourceId: estateEdit.resourceId, revisionId: estateEdit.draftRevisionId };
      await callCms(() =>
        publishAdminCmsRevision({
          data: {
            resourceType: "estate",
            resourceId: draft.resourceId,
            revisionId: draft.revisionId,
            basePublishedVersion: estateEdit.basePublishedVersion,
            draftEditVersion: estateEdit.draftEditVersion,
          },
        }),
      );
      setEditingEstate(null);
      await refreshAfterWrite("屋苑已發布");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPublishing(false);
    }
  }

  async function handleRestoreEstateRevision(revisionId: string) {
    setSaving(true);
    try {
      const result = await callCms(() => restoreAdminCmsRevision({ data: { revisionId } }));
      await loadEstateRevisions(result.resourceId);
      toast.success("已還原為新草稿，請檢查內容後發布");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveEstate(estateId: string) {
    setSaving(true);
    try {
      await callCms(() =>
        archiveAdminCmsResource({ data: { resourceType: "estate", resourceId: estateId } }),
      );
      setArchiving(null);
      await refreshAfterWrite("屋苑已封存");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function loadArticleRevisions(resourceId: string | undefined) {
    const sequence = ++articleLoadSequence.current;
    if (!resourceId) {
      setArticleRevisions(null);
      setArticleEdit(null);
      return;
    }
    try {
      const { revisions, payload, editState } = await fetchAdminCmsEditor({
        data: { resourceType: "article", resourceId },
      });
      if (sequence !== articleLoadSequence.current) return;
      setArticleEdit(editState);
      if (payload)
        setEditingArticle({ ...emptyArticle, ...payload, id: resourceId } as AdminArticleInput);
      setArticleRevisions(revisions);
    } catch {
      if (sequence === articleLoadSequence.current) toast.error("未能載入完整草稿，請重試。");
    }
  }

  async function handleSaveArticleDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingArticle) return;
    if (!editingArticle.slug.trim() || !editingArticle.title.trim()) {
      toast.error("請填寫文章 slug 及標題");
      return;
    }

    const sequence = articleLoadSequence.current;
    setSaving(true);
    try {
      const result = await callCms(() =>
        saveAdminCmsDraft({
          data: {
            resourceType: "article",
            resourceId: editingArticle.id,
            payload: { ...editingArticle },
            basePublishedVersion: articleEdit?.basePublishedVersion ?? null,
            draftRevisionId: articleEdit?.draftRevisionId ?? null,
            draftEditVersion: articleEdit?.draftEditVersion ?? null,
          },
        }),
      );
      if (sequence === articleLoadSequence.current) {
        setArticleEdit(result.editState);
        setEditingArticle((current) => (current ? { ...current, id: result.resourceId } : current));
      }
      void refreshCmsData().catch(() => undefined);
      toast.success("草稿已儲存");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishArticle() {
    if (!editingArticle) return;
    setPublishing(true);
    try {
      if (
        !articleEdit?.draftRevisionId ||
        Object.entries(editingArticle).some(
          ([key, value]) =>
            key !== "id" &&
            JSON.stringify(value) !==
              JSON.stringify(
                ({ ...emptyArticle, ...articleEdit.payload } as Record<string, unknown>)[key],
              ),
        )
      ) {
        throw new Error("請先儲存草稿並核對內容後發布。");
      }
      const draft = { resourceId: articleEdit.resourceId, revisionId: articleEdit.draftRevisionId };
      await callCms(() =>
        publishAdminCmsRevision({
          data: {
            resourceType: "article",
            resourceId: draft.resourceId,
            revisionId: draft.revisionId,
            basePublishedVersion: articleEdit.basePublishedVersion,
            draftEditVersion: articleEdit.draftEditVersion,
          },
        }),
      );
      setEditingArticle(null);
      await refreshAfterWrite("文章已發布");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setPublishing(false);
    }
  }

  async function handleRestoreArticleRevision(revisionId: string) {
    setSaving(true);
    try {
      const result = await callCms(() => restoreAdminCmsRevision({ data: { revisionId } }));
      await loadArticleRevisions(result.resourceId);
      toast.success("已還原為新草稿，請檢查內容後發布");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveArticle(articleId: string) {
    setSaving(true);
    try {
      await callCms(() =>
        archiveAdminCmsResource({ data: { resourceType: "article", resourceId: articleId } }),
      );
      setArchiving(null);
      await refreshAfterWrite("文章已封存");
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
      setEditingFaq(null);
      await refreshAfterWrite(editingFaq.id ? "FAQ 編輯已儲存" : "FAQ 已新增");
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
      setDeletingFaq(null);
      await refreshAfterWrite("已刪除");
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
      setEditingCmsVideo(null);
      await refreshAfterWrite(editingCmsVideo.id ? "影片已更新" : "影片已新增");
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

  async function handleImportFaqsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsedFaqImportRows.length) {
      toast.error("未能從檔案內容解析 FAQ");
      return;
    }

    setFaqImportChecking(true);
    try {
      const keys = parsedFaqImportRows.map((row) => ({
        scope: row.scope ?? faqImportScope,
        question: row.question,
      }));
      const result = await checkAdminFaqConflicts({ data: { keys } });
      setFaqImportConflicts(
        new Set(result.existing.map((row) => faqImportKey(row.scope, row.question))),
      );
      setFaqImportConfirmOpen(true);
    } catch (err) {
      // Never fall through to the confirm on failure: without the conflict set
      // it would assert 「全部為新增」 with no basis.
      setFaqImportConflicts(null);
      toast.error(`未能檢查是否會覆寫現有 FAQ：${errorText(err)}`);
    } finally {
      setFaqImportChecking(false);
    }
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
        // The table now shows the imported rows, but the live agent still
        // answers from the pre-import index. Refresh the status so the AI card
        // shows the outstanding rebuild, and say so explicitly.
        await refreshKnowledgeStatus();
        toast.error(
          `已匯入 ${imported}／${total}，第 ${failure.position} 條失敗：${failure.message}。` +
            `AI 知識庫尚未重建，請修正後重新匯入，或按「重建索引」。`,
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
      await refreshKnowledgeStatus().catch(() => undefined);
      toast.error(
        `已匯入 ${imported}／${total}，其後失敗：${errorText(err)}。AI 知識庫可能尚未重建。`,
      );
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
      setEditingMedia(null);
      await refreshAfterWrite("媒體庫資料已更新");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  /** Uploads into the media library.
   *
   * /api/admin/media/upload has existed all along but was reachable only from
   * the property form, so the CMS's own 媒體庫 tab was read-only: staff could
   * edit alt text on assets that some other screen had happened to create, and
   * the empty state told them to "upload photos" with nowhere to do it.
   */
  async function handleMediaUpload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    setMediaUploading(true);
    const failed: string[] = [];
    let uploaded = 0;
    try {
      for (const file of list) {
        try {
          await uploadAdminMedia(file, "cms");
          uploaded += 1;
        } catch (error) {
          failed.push(`${file.name}：${error instanceof Error ? error.message : "上載未完成"}`);
        }
      }
      await refreshCmsData();
      if (failed.length) {
        toast.error(`已上載 ${uploaded}／${list.length}，失敗：${failed.join("、")}`);
      } else {
        toast.success(`已上載 ${uploaded} 個檔案`);
      }
    } finally {
      setMediaUploading(false);
      if (mediaFileInputRef.current) mediaFileInputRef.current.value = "";
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
    <AdminShell title="內容中心" description="CMS：管理屋苑內容、文章、FAQ 及 SEO 資料。">
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

          <div className="mb-4 space-y-2" aria-label="我的草稿">
            {draftRows.map((row) => (
              <Button
                key={`${row.resourceType}:${row.resourceId}`}
                variant="outline"
                onClick={() => {
                  if (row.resourceType === "estate") void loadEstateRevisions(row.resourceId);
                  else void loadArticleRevisions(row.resourceId);
                }}
              >
                草稿：{row.title}
              </Button>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2">
            <span>共 {cmsTotal} 項</span>
            <Button variant="outline" disabled={!cmsCursor} onClick={() => void refreshCmsData()}>
              第一頁
            </Button>
            <Button
              variant="outline"
              disabled={!cmsNextCursor}
              onClick={() => void refreshCmsData(cmsNextCursor)}
            >
              下一頁
            </Button>
          </div>
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
                    <Button
                      onClick={() => {
                        setEstateEdit(null);
                        ++estateLoadSequence.current;
                        setEstateRevisions(null);
                        setEstateLatestPayload(null);
                        setEditingEstate({ ...emptyEstate });
                        setEstateRevisions(null);
                        setEstateLatestPayload(null);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      新增屋苑
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <RowCapNotice
                    shown={filteredEstates.length}
                    loaded={data?.estates.length ?? 0}
                    limit={CMS_ROW_LIMITS.estates}
                    label="屋苑"
                  />
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
                                onClick={() => {
                                  void loadEstateRevisions(estate.id);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setArchiving({ type: "estate", id: estate.id })}
                              >
                                <Archive className="h-4 w-4" />
                                封存
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
                            <Button
                              onClick={() => {
                                setEstateEdit(null);
                                ++estateLoadSequence.current;
                                setEstateRevisions(null);
                                setEstateLatestPayload(null);
                                setEditingEstate({ ...emptyEstate });
                                setEstateRevisions(null);
                              }}
                            >
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
                    <Button
                      onClick={() => {
                        setArticleEdit(null);
                        ++articleLoadSequence.current;
                        setArticleRevisions(null);
                        setEditingArticle({ ...emptyArticle });
                        setArticleRevisions(null);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      新增文章
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <RowCapNotice
                    shown={filteredArticles.length}
                    loaded={data?.articles.length ?? 0}
                    limit={CMS_ROW_LIMITS.articles}
                    label="文章"
                  />
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
                                onClick={() => {
                                  void loadArticleRevisions(article.id);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                                編輯
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setArchiving({ type: "article", id: article.id })}
                              >
                                <Archive className="h-4 w-4" />
                                封存
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
                            <Button
                              onClick={() => {
                                setArticleEdit(null);
                                ++articleLoadSequence.current;
                                setArticleRevisions(null);
                                setEditingArticle({ ...emptyArticle });
                                setArticleRevisions(null);
                              }}
                            >
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
                  {filteredVideos.length ? (
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
                        {filteredVideos.map((video) => (
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
                    <Input
                      aria-label="FAQ 範圍篩選"
                      placeholder="全部範圍"
                      list="faq-scope-options"
                      value={faqScopeFilter === "all" ? "" : faqScopeFilter}
                      onChange={(event) => setFaqScopeFilter(event.target.value || "all")}
                    />
                    <datalist id="faq-scope-options">
                      {faqScopes.map((scope) => (
                        <option key={scope} value={scope} />
                      ))}
                    </datalist>

                    <TableSearch
                      label="搜尋問題或答案"
                      value={searchByTab.faqs}
                      onChange={(value) =>
                        setSearchByTab((current) => ({ ...current, faqs: value }))
                      }
                    />
                    {/* Was a <Button asChild><label> wrapping an sr-only input:
                        Tab landed on the clipped input, so the focus ring never
                        rendered and the control was effectively invisible to
                        keyboard users. A real button now forwards the click. */}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => faqFileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      上載 FAQ 檔案
                    </Button>
                    <input
                      ref={faqFileInputRef}
                      className="hidden"
                      type="file"
                      tabIndex={-1}
                      aria-hidden="true"
                      accept=".txt,.md,.csv,.tsv,text/plain,text/markdown,text/csv"
                      onChange={handleFaqFileChange}
                    />
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
                  <RowCapNotice
                    shown={faqsByScope.reduce((total, [, rows]) => total + rows.length, 0)}
                    loaded={data?.faqs.length ?? 0}
                    limit={CMS_ROW_LIMITS.faqs}
                    label="條 FAQ"
                  />
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
                  <div className="flex flex-wrap items-center gap-2">
                    {mediaAssets ? (
                      <TableSearch
                        label="搜尋檔案路徑或替代文字"
                        value={searchByTab.media}
                        onChange={(value) =>
                          setSearchByTab((current) => ({ ...current, media: value }))
                        }
                      />
                    ) : null}
                    <Button
                      type="button"
                      disabled={mediaUploading}
                      onClick={() => mediaFileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      {mediaUploading ? "上載中…" : "上載媒體"}
                    </Button>
                    <input
                      ref={mediaFileInputRef}
                      className="hidden"
                      type="file"
                      multiple
                      tabIndex={-1}
                      aria-hidden="true"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      onChange={(event) => void handleMediaUpload(event.target.files)}
                    />
                  </div>
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
                          action={
                            <Button
                              type="button"
                              disabled={mediaUploading}
                              onClick={() => mediaFileInputRef.current?.click()}
                            >
                              <Upload className="h-4 w-4" />
                              上載媒體
                            </Button>
                          }
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
            publishing={publishing}
            revisions={estateRevisions}
            onChange={setEditingEstate}
            onClose={() => {
              ++estateLoadSequence.current;
              setEditingEstate(null);
            }}
            onSubmit={handleSaveEstateDraft}
            onPublish={handlePublishEstate}
            onRestoreRevision={handleRestoreEstateRevision}
          />
          <ArticleDialog
            article={editingArticle}
            fingerprintValues={articleFingerprintValues(
              editingArticle,
              data?.articles.find((item) => item.id === editingArticle?.id) ?? null,
            )}
            saving={saving}
            publishing={publishing}
            revisions={articleRevisions}
            onChange={setEditingArticle}
            onClose={() => {
              ++articleLoadSequence.current;
              setEditingArticle(null);
            }}
            onSubmit={handleSaveArticleDraft}
            onPublish={handlePublishArticle}
            onRestoreRevision={handleRestoreArticleRevision}
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
            open={archiving !== null}
            title="封存"
            description={
              archiving
                ? `確定要封存此${archiving.type === "estate" ? "屋苑" : "文章"}？封存後會從公開網站下架，但可在版本紀錄中還原。`
                : ""
            }
            confirmLabel="封存"
            confirmVariant="destructive"
            isPending={saving}
            onOpenChange={(open) => {
              if (!open) setArchiving(null);
            }}
            onConfirm={() => {
              if (!archiving) return;
              if (archiving.type === "estate") void handleArchiveEstate(archiving.id);
              else void handleArchiveArticle(archiving.id);
            }}
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
            saving={faqImportSaving || faqImportChecking}
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
            onOpenChange={(open) => {
              setFaqImportConfirmOpen(open);
              // Force a fresh conflict check next time: the table can change
              // between attempts.
              if (!open) setFaqImportConflicts(null);
            }}
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
                <Field label="分類">
                  <Select
                    value={video.category ?? "none"}
                    onValueChange={(value) =>
                      onChange({ ...video, category: value === "none" ? null : value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="未分類" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">未分類</SelectItem>
                      {VIDEO_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
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
  publishing,
  revisions,
  fingerprintValues,
  onChange,
  onClose,
  onSubmit,
  onPublish,
  onRestoreRevision,
}: {
  estate: AdminEstateInput | null;
  saving: boolean;
  publishing: boolean;
  revisions: CmsRevisionSummary[] | null;
  fingerprintValues: Record<string, unknown>;
  onChange: (estate: AdminEstateInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPublish: () => void;
  onRestoreRevision: (revisionId: string) => void;
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
                <CmsPublicationCompare
                  resourceType="estate"
                  resourceId={estate.id}
                  localPayload={{ ...estate }}
                />
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
                  value={estate.facilities?.join("\n") ?? ""}
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
                <CmsPublishFooter
                  saving={saving}
                  publishing={publishing}
                  onClose={requestClose}
                  onPublish={onPublish}
                />
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
              <CmsRevisionHistory
                resourceId={estate.id}
                revisions={revisions}
                onRestoreRevision={onRestoreRevision}
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
  publishing,
  revisions,
  fingerprintValues,
  onChange,
  onClose,
  onSubmit,
  onPublish,
  onRestoreRevision,
}: {
  article: AdminArticleInput | null;
  saving: boolean;
  publishing: boolean;
  revisions: CmsRevisionSummary[] | null;
  fingerprintValues: Record<string, unknown>;
  onChange: (article: AdminArticleInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPublish: () => void;
  onRestoreRevision: (revisionId: string) => void;
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
            <DialogDescription>
              儲存草稿不會影響公開頁面，按「發布」才會將內容公開。
            </DialogDescription>
          </DialogHeader>
          {article ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
              <form className="grid gap-4" onSubmit={onSubmit}>
                <CmsPublicationCompare
                  resourceType="article"
                  resourceId={article.id}
                  localPayload={{ ...article }}
                />
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
                </div>
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
                <CmsPublishFooter
                  saving={saving}
                  publishing={publishing}
                  onClose={requestClose}
                  onPublish={onPublish}
                />
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
              <CmsRevisionHistory
                resourceId={article.id}
                revisions={revisions}
                onRestoreRevision={onRestoreRevision}
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

/**
 * Footer for the two CMS-revision-engine-backed dialogs (estate, article).
 * "儲存草稿" never touches the live table; "發布" saves a draft and
 * immediately publishes it. Both buttons stay visible regardless of the
 * acting staff member's role -- the server enforces the real publish/restore
 * permission boundary (admin/manager only) and callCms() surfaces a clear
 * zh-HK message on a 403, rather than this file re-deriving role state
 * client-side.
 */
function CmsPublishFooter({
  saving,
  publishing,
  onClose,
  onPublish,
}: {
  saving: boolean;
  publishing: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const disabled = saving || publishing;
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onClose} disabled={disabled}>
        取消
      </Button>
      <Button type="submit" variant="outline" disabled={disabled}>
        <Save className="h-4 w-4" />
        {saving ? "儲存中…" : "儲存草稿"}
      </Button>
      <Button type="button" onClick={onPublish} disabled={disabled}>
        <Upload className="h-4 w-4" />
        {publishing ? "發布中…" : "發布"}
      </Button>
    </DialogFooter>
  );
}

const CMS_REVISION_STATE_LABELS: Record<CmsRevisionSummary["state"], string> = {
  draft: "草稿",
  published: "已發布",
  superseded: "已被取代",
  archived: "已封存",
};

/** Read-only version history for the two revision-engine-backed dialogs. */
function CmsRevisionHistory({
  resourceId,
  revisions,
  onRestoreRevision,
}: {
  resourceId: string | undefined;
  revisions: CmsRevisionSummary[] | null;
  onRestoreRevision: (revisionId: string) => void;
}) {
  if (!resourceId || !revisions) return null;
  return (
    <div className="rounded-md border p-4 lg:col-span-2">
      <h4 className="text-sm font-semibold">版本紀錄</h4>
      {revisions.length ? (
        <ul className="mt-2 space-y-2">
          {revisions.map((revision) => (
            <li key={revision.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Badge variant={revision.state === "published" ? "default" : "outline"}>
                  {CMS_REVISION_STATE_LABELS[revision.state]}
                </Badge>
                <span className="text-muted-foreground">
                  v{revision.versionNumber} · {formatDateTime(revision.createdAt)}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onRestoreRevision(revision.id)}
              >
                <History className="h-4 w-4" />
                還原
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">暫無版本紀錄</p>
      )}
    </div>
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

/** Server LIMITs are presented honestly instead of as the complete set.
 *
 * listAdminCms() caps estates and articles at 40 and FAQs at 120. Adding
 * client-side search on top of that made the cap worse, not better: searching
 * for an estate outside the window returned a confident "not found", so an
 * editor would create a duplicate rather than editing the real row. */
function RowCapNotice({
  shown,
  loaded,
  limit,
  label,
}: {
  shown: number;
  loaded: number;
  limit: number;
  label: string;
}) {
  const capped = loaded >= limit;
  if (!capped && shown === loaded) return null;
  return (
    <p className="border-b px-4 py-2 text-xs text-muted-foreground">
      顯示 {shown} 個{label}
      {shown !== loaded ? `（已載入 ${loaded} 個）` : ""}
      {capped ? `，每頁最多 ${limit} 個；搜尋涵蓋全部記錄，可用上方按鈕翻頁` : ""}
    </p>
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
      title={`在已載入的${label}中找不到符合「${query}」的項目`}
      description="搜尋只涵蓋本頁已載入的資料，較舊的記錄可能未有載入。請檢查關鍵字，或清除搜尋查看全部。"
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
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <Field label={label}>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
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
    category: video.category,
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
    category: video.category,
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

const CMS_ERROR_MESSAGES: Record<string, string> = {
  CMS_REVISION_CONFLICT: "此草稿的發布版本已被其他人更新。本機修改已保留，請使用比較目前發布版本。",
  CMS_REVISION_NOT_FOUND: "找不到此版本，可能已被更新，請重新載入頁面。",
  CMS_REVISION_MISMATCH: "版本資料不符，請重新載入頁面後再試一次。",
  CMS_RESOURCE_NOT_FOUND: "找不到此資源，可能已被其他人刪除或封存，請重新載入頁面。",
  CMS_MEDIA_IN_USE: "此媒體仍被其他內容使用，未能封存。",
};

function cmsErrorMessage(code: string): string {
  return CMS_ERROR_MESSAGES[code] ?? "操作失敗，請重試。";
}

/**
 * Normalizes every failure shape the CMS revision engine can produce -- a
 * thrown ServerFnResponseError (401/403 from requireStaffAccess), a thrown
 * plain Error (CMS_REVISION_NOT_FOUND / CMS_REVISION_MISMATCH), and a typed
 * { ok: false, code } result (CMS_REVISION_CONFLICT / CMS_RESOURCE_NOT_FOUND /
 * CMS_MEDIA_IN_USE) -- into a single thrown Error with a zh-HK message, so
 * every call site can use the same catch-and-toast shape as the rest of
 * this file. saveAdminCmsDraft/restoreAdminCmsRevision never return an `ok`
 * field at all (they throw on failure) -- the `"ok" in result` check below
 * is what lets this one helper wrap both shapes.
 */
async function callCms<T>(call: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : 0;
    if (status === 401) throw new Error("登入已過期，請重新登入後再試。");
    if (status === 403) throw new Error("你的角色沒有此操作的權限，請聯絡管理員或主管。");
    throw new Error(cmsErrorMessage(errorText(err)));
  }
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    (result as { ok: unknown }).ok === false
  ) {
    const code = "code" in result ? String((result as { code?: unknown }).code) : "";
    throw new Error(cmsErrorMessage(code));
  }
  return result;
}
