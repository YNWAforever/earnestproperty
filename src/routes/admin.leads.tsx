import { adminErrorMessage } from "@/components/admin/admin-error-text";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { aiResultPresentation } from "@/lib/admin/ai-result-presentation";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  StickyNote,
  Trophy,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { staffSessionStore, useStaffSession } from "@/components/admin/staff-session";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { ForwardedEnquiryForm } from "@/components/admin/whatsapp/ForwardedEnquiryForm";
import { ForwardedEnquiryEvidence } from "@/components/admin/whatsapp/ForwardedEnquiryEvidence";
import { RelatedLeadConversations } from "@/components/admin/whatsapp/RelatedLeadConversations";
import { LeadChatTranscript } from "@/components/admin/LeadChatTranscript";
import { leadTimelineHasNoFollowUp } from "@/lib/admin/crm-presentation";
import { LeadContactEditor } from "@/components/admin/whatsapp/LeadContactEditor";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminStatusSelect } from "@/components/admin/AdminStatusSelect";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { useDirtyCloseGuard, useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import { assignableAgents, bulkAssignableAgents } from "@/lib/admin/lead-assignment";
import { leadBudgetError } from "@/lib/admin/lead-budget";
import { LeadConflictNotice } from "@/components/admin/leads/LeadConflictNotice";
import {
  LEAD_CHANGED_MESSAGE,
  LEAD_CHANGED_NOTE_SAVED_MESSAGE,
  isLeadChangedError,
  leadSaveErrorMessage,
} from "@/lib/admin/lead-save-errors";
import {
  analyzeAdminLeadAiProfile,
  approveAdminAiTag,
  createAdminLeadActivity,
  fetchAdminAgents,
  fetchAdminLead,
  fetchAdminLeadAiProfile,
  fetchAdminPage,
  rejectAdminAiTag,
  bulkUpdateAdminLeads,
  updateAdminLead,
} from "@/lib/neon/admin-data";
import type {
  AdminAgentRow,
  AdminLeadAiProfile,
  AdminLeadDetail,
  AdminLeadRow,
  AdminLeadUpdateInput,
} from "@/lib/neon/admin-data.types";

import {
  type LeadStage,
  stageFilterOptions,
  stageOptions,
  stageLabels,
  intentLabels,
  intentOptions,
  sourceLabels,
  labeledFilterOptions,
  quickLeadFilter,
  aiScoreLabel,
} from "@/lib/admin/crm-presentation";
import { ContactIdentityReviewList } from "@/components/admin/leads/ContactIdentityReviewList";
import { adminAttentionIdentity, adminAttentionStore } from "@/components/admin/admin-attention";
type OptInFilter = "all" | "yes" | "no";

type LeadFilters = {
  /** Lead id of the open detail panel. Not a filter, but it shares the search
   * schema so one navigate() call can change both. */
  lead?: string;
  cursor?: string;
  stage: string;
  intent: string;
  source: string;
  agent_id: string;
  optIn: OptInFilter;
  query: string;
  /** FX-12: the 可能重複客戶 list (admin/manager only) replaces the lead table. */
  review?: "identity";
  /** FX-12: the review to highlight, from the inbox's 前往核對 link. */
  item?: string;
};

type LeadDraft = {
  stage: LeadStage;
  intent: string;
  budget_min: number | null;
  budget_max: number | null;
  preferred_estates: string;
  assigned_agent_id: string | null;
  note: string;
};

const defaultFilters: LeadFilters = {
  stage: "all",
  intent: "all",
  source: "all",
  agent_id: "all",
  optIn: "all",
  query: "",
};

const bulkErrorLabels: Record<string, string> = {
  NO_LEADS_SELECTED: "請先選擇至少一筆客戶查詢。",
  TOO_MANY_LEADS_SELECTED: "一次最多只可更新 200 筆客戶查詢，請分批處理。",
  NO_CHANGES_REQUESTED: "請選擇要套用的階段或負責代理。",
  ASSIGNEE_INACTIVE: "所選同事已停用，不能指派客戶查詢。請選擇其他同事。",
};

// Filters used to live in local useState, so reload, browser Back from a lead,
// or a round trip to Command Center reset the agent's whole working view and
// scroll position, and no filtered view was shareable. Only non-default values
// are kept in the URL, so a plain /admin/leads stays clean.
function parseLeadFilters(search: Record<string, unknown>): Partial<LeadFilters> {
  const result: Partial<LeadFilters> = {};
  if (typeof search.stage === "string" && search.stage !== defaultFilters.stage) {
    result.stage = search.stage;
  }
  if (typeof search.intent === "string" && search.intent !== defaultFilters.intent) {
    result.intent = search.intent;
  }
  if (typeof search.source === "string" && search.source !== defaultFilters.source) {
    result.source = search.source;
  }
  if (typeof search.agent_id === "string" && search.agent_id !== defaultFilters.agent_id) {
    result.agent_id = search.agent_id;
  }
  if (search.optIn === "yes" || search.optIn === "no") {
    result.optIn = search.optIn;
  }
  if (typeof search.query === "string" && search.query.trim()) {
    result.query = search.query;
  }
  // The open lead lives in the URL too, so a detail view is shareable and
  // survives reload -- and so Command Center can link straight to a specific
  // lead instead of dumping the agent on an unfiltered list.
  if (typeof search.lead === "string" && search.lead.trim()) {
    result.lead = search.lead;
  }
  if (typeof search.cursor === "string") result.cursor = search.cursor;
  if (search.review === "identity") result.review = "identity";
  if (typeof search.item === "string" && /^[0-9a-f-]{36}$/i.test(search.item))
    result.item = search.item;
  return result;
}

export const Route = createFileRoute("/admin/leads")({
  validateSearch: parseLeadFilters,
  head: () => ({
    meta: [{ title: "CRM｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminLeads,
});

// Mirrors the `LIMIT 100` in `listAdminLeads` (src/lib/neon/admin-data.server.ts).
// Only used to label the row count honestly -- raising it here alone changes
// nothing, the query is the source of truth.

function AdminLeads() {
  const { user } = useNeonAuth();
  const { session } = useStaffSession(user?.id ?? null);
  if (!user || session?.status !== "ok") {
    return (
      <AdminShell title="客戶查詢" description="集中處理買樓、租樓及業主估價查詢。">
        {null}
      </AdminShell>
    );
  }
  // Scope resolution can change while Auth keeps the same user object. A new
  // workspace drops private rows, selections, details and late read callbacks.
  // Actor-keyed unsent forwarded drafts retain their existing storage boundary.
  const identity = JSON.stringify([user.id, session.staffId, [...session.roles].sort()]);
  return <AdminLeadsWorkspace key={identity} identity={identity} />;
}

function AdminLeadsWorkspace({ identity }: { identity: string }) {
  const { user } = useNeonAuth();
  const { session: staffSession } = useStaffSession(user?.id ?? null);
  // FX-12: 可能重複客戶 is admin/manager only; the server refuses everyone else too.
  const canReviewIdentity =
    staffSession?.status === "ok" &&
    staffSession.roles.some((role) => role === "admin" || role === "manager");
  const attentionIdentity = adminAttentionIdentity(user?.id ?? null, staffSession);
  // Read the shell's shared attention counts; the shell owns the polling.
  const attentionSnapshot = useSyncExternalStore(
    adminAttentionStore.subscribe,
    adminAttentionStore.getSnapshot,
    adminAttentionStore.getSnapshot,
  );
  const identityReviewsOpen =
    attentionSnapshot.identity === attentionIdentity
      ? (attentionSnapshot.counts?.identityReviewsOpen ?? 0)
      : 0;
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [rows, setRows] = useState<AdminLeadRow[] | null>(null);
  const [agents, setAgents] = useState<AdminAgentRow[]>([]);
  const filters: LeadFilters = useMemo(() => ({ ...defaultFilters, ...search }), [search]);
  const reviewMode = canReviewIdentity && filters.review === "identity";
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [queryIsComposing, setQueryIsComposing] = useState(false);
  const queryCompositionActive = useRef(false);
  const queryResetRevision = useRef(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState("");
  const [bulkAgentId, setBulkAgentId] = useState("");
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Keeps the box in step when the URL changes from elsewhere (back/forward, or
  // the filtered-empty state's 清除篩選) without making every keystroke a
  // navigation.
  useEffect(() => {
    setQueryDraft(filters.query);
  }, [filters.query]);

  useEffect(() => {
    if (queryIsComposing || queryDraft === filters.query) return;
    const resetRevision = queryResetRevision.current;
    const timer = window.setTimeout(() => {
      // Composition and explicit reset can arrive before passive cleanup.
      if (!queryCompositionActive.current && resetRevision === queryResetRevision.current)
        setFilters((current) => ({ ...current, query: queryDraft }), { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
    // Re-arm against the whole filter snapshot so pending text cannot restore
    // an older stage/agent filter. setFilters is redeclared on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft, filters, queryIsComposing]);
  function resetFilters() {
    // Invalidate an already queued callback before the effect cleans up.
    queryResetRevision.current += 1;
    queryCompositionActive.current = false;
    setQueryIsComposing(false);
    setQueryDraft(defaultFilters.query);
    setFilters(defaultFilters);
  }
  function setFilters(
    updater: LeadFilters | ((current: LeadFilters) => LeadFilters),
    options: { replace?: boolean } = {},
  ) {
    const next = typeof updater === "function" ? updater(filters) : updater;
    if (
      ["stage", "intent", "source", "agent_id", "optIn", "query"].some(
        (key) => next[key as keyof LeadFilters] !== filters[key as keyof LeadFilters],
      )
    )
      delete next.cursor;
    void navigate({
      search: parseLeadFilters(next),
      resetScroll: false,
      // Search keystrokes replace rather than push: one history entry per
      // character made browser Back walk backwards through a half-typed query
      // instead of leaving the page.
      replace: options.replace ?? false,
    });
  }
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminLeadDetail | null>(null);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  // The version the draft was loaded from (or last saved as). Not `detail.version`:
  // addNote refreshes `detail` without touching the draft, which would otherwise
  // launder a colleague's newer version onto a stale draft.
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  // The draft as loaded, for the dirty check. Not leadToDraft(detail) for the
  // same reason: after addNote brings in a colleague's change, an untouched
  // draft must not look edited.
  const [draftBaseline, setDraftBaseline] = useState<LeadDraft | null>(null);
  const [conflictLeadId, setConflictLeadId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [aiProfile, setAiProfile] = useState<AdminLeadAiProfile | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  // A failed fetch used to render the same 「未有 AI 分析」 empty state as a lead
  // that was simply never analysed, so a broken AI backend looked like normal
  // data and nobody retried.
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMutatingTagId, setAiMutatingTagId] = useState<string | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const aiRequestRef = useRef(0);
  const aiRunRequestsRef = useRef(new Map<string, string>());
  const selectedIdRef = useRef<string | null>(null);
  const panelOpenRef = useRef(false);

  const workspaceActiveRef = useRef(true);
  const workspaceLifetimeRef = useRef(0);
  useLayoutEffect(() => {
    workspaceActiveRef.current = true;
    workspaceLifetimeRef.current += 1;
    return () => {
      // Unmount cannot cancel an accepted write, but must stop its next phase.
      // Layout cleanup also closes the window before deferred passive cleanup.
      workspaceActiveRef.current = false;
      workspaceLifetimeRef.current += 1;
      listRequestRef.current += 1;
      detailRequestRef.current += 1;
      aiRequestRef.current += 1;
      selectedIdRef.current = null;
      panelOpenRef.current = false;
    };
  }, []);
  const isWorkspaceCurrent = useCallback(
    (lifetime = workspaceLifetimeRef.current) => {
      const snapshot = staffSessionStore.getSnapshot();
      const session = snapshot.session;
      return (
        workspaceActiveRef.current &&
        lifetime === workspaceLifetimeRef.current &&
        session?.status === "ok" &&
        JSON.stringify([snapshot.userId, session.staffId, [...session.roles].sort()]) === identity
      );
    },
    [identity],
  );
  const canApplyLeadDetail = useCallback(
    (id: string) => isWorkspaceCurrent() && panelOpenRef.current && selectedIdRef.current === id,
    [isWorkspaceCurrent],
  );

  function resetAiProfileState() {
    aiRequestRef.current += 1;
    setAiProfile(null);
    setAiLoading(false);
    // Clear the error too, or one lead's failure banner outlives it and is
    // shown against the next lead the agent opens.
    setAiError(null);
    setAiMutatingTagId(null);
  }

  const refreshLeads = useCallback(async () => {
    if (!user || !isWorkspaceCurrent()) return;

    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoadingRows(true);
    try {
      const data = await fetchAdminPage({
        data: {
          resource: "leads",
          cursor: filters.cursor,
          q: filters.query,
          stage: filters.stage,
          intent: filters.intent,
          source: filters.source,
          agentId: filters.agent_id,
          optIn: filters.optIn,
        },
      });
      if (requestId !== listRequestRef.current || !isWorkspaceCurrent()) return;
      setRows(data.rows);
      setNextCursor(data.nextCursor);
      setTotalRows(data.total);
      setError(null);
    } catch (err) {
      if (requestId !== listRequestRef.current || !isWorkspaceCurrent()) return;
      setError(errorText(err));
    } finally {
      if (requestId === listRequestRef.current && isWorkspaceCurrent()) setLoadingRows(false);
    }
  }, [
    user,
    isWorkspaceCurrent,
    filters.cursor,
    filters.query,
    filters.stage,
    filters.intent,
    filters.source,
    filters.agent_id,
    filters.optIn,
  ]);

  const loadLeadAiProfile = useCallback(
    async (id: string) => {
      if (!isWorkspaceCurrent()) return null;
      const requestId = aiRequestRef.current + 1;
      aiRequestRef.current = requestId;
      setAiError(null);
      setAiLoading(true);

      try {
        const profile = await fetchAdminLeadAiProfile({ data: { leadId: id } });
        if (requestId !== aiRequestRef.current || !canApplyLeadDetail(id)) return null;
        if (profile.analysis?.status === "pending" && profile.analysis.runId)
          aiRunRequestsRef.current.set(id, profile.analysis.runId);
        setAiProfile(profile as AdminLeadAiProfile);
        setAiError(null);
        return profile as AdminLeadAiProfile;
      } catch (err) {
        if (requestId === aiRequestRef.current && canApplyLeadDetail(id)) {
          setAiProfile(null);
          setAiError(errorText(err));
        }
        return null;
      } finally {
        if (requestId === aiRequestRef.current && canApplyLeadDetail(id)) setAiLoading(false);
      }
    },
    [canApplyLeadDetail, isWorkspaceCurrent],
  );

  const loadLeadDetail = useCallback(
    async (id: string, options: { resetNote?: boolean; closeOnError?: boolean } = {}) => {
      if (!isWorkspaceCurrent()) return null;
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setDetailLoading(true);
      setDetailError(null);

      try {
        const data = await fetchAdminLead({ data: { id } });
        if (requestId !== detailRequestRef.current || !canApplyLeadDetail(id)) return null;
        if (!data) throw new Error("找不到客戶查詢");

        const lead = data as AdminLeadDetail;
        setDetail(lead);
        const loaded = leadToDraft(lead);
        setDraft(loaded);
        setDraftBaseline(loaded);
        setDraftVersion(lead.version);
        setConflictLeadId(null);
        if (options.resetNote) setNoteBody("");
        void loadLeadAiProfile(id);
        return lead;
      } catch (err) {
        if (requestId !== detailRequestRef.current || !canApplyLeadDetail(id)) return null;

        const message = errorText(err);
        setDetail(null);
        setDraft(null);
        aiRequestRef.current += 1;
        setAiProfile(null);
        setAiLoading(false);
        setDetailError(message);
        if (options.closeOnError !== false) {
          selectedIdRef.current = null;
          panelOpenRef.current = false;
          setSelectedId(null);
          setPanelOpen(false);
        }
        toast.error(message);
        return null;
      } finally {
        if (requestId === detailRequestRef.current && canApplyLeadDetail(id)) {
          setDetailLoading(false);
        }
      }
    },
    [canApplyLeadDetail, isWorkspaceCurrent, loadLeadAiProfile],
  );

  const reloadLeadContact = useCallback(
    async (id: string) => {
      const requestId = detailRequestRef.current;
      if (!canApplyLeadDetail(id)) return false;
      const next = (await fetchAdminLead({ data: { id } })) as AdminLeadDetail | null;
      if (requestId !== detailRequestRef.current || !canApplyLeadDetail(id)) return false;
      if (!next) throw new Error("未能核對聯絡資料或權限。");
      // Contact-only readback must preserve unsaved CRM fields and follow-up notes.
      setDetail((current) =>
        current?.id === id
          ? {
              ...current,
              contact_id: next.contact_id,
              name: next.name,
              email: next.email,
              phone: next.phone,
              opt_in_whatsapp: next.opt_in_whatsapp,
            }
          : current,
      );
      void refreshLeads();
      return true;
    },
    [canApplyLeadDetail, refreshLeads],
  );

  useEffect(() => {
    // FX-12: the 可能重複客戶 list replaces the lead table, so the lead page is not read.
    if (!user || reviewMode) return;
    refreshLeads();
  }, [refreshLeads, user, reviewMode]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    if (!user || !isWorkspaceCurrent()) return;
    let cancelled = false;

    fetchAdminAgents()
      .then((data) => {
        if (!cancelled && isWorkspaceCurrent()) setAgents(data as AdminAgentRow[]);
      })
      .catch((err) => {
        if (!cancelled && isWorkspaceCurrent()) setError(errorText(err));
      });

    return () => {
      cancelled = true;
    };
  }, [user, isWorkspaceCurrent]);

  useEffect(() => {
    if (!selectedId || !panelOpen) return;
    loadLeadDetail(selectedId, { resetNote: true });
  }, [loadLeadDetail, panelOpen, selectedId]);

  const intentFilterOptions = labeledFilterOptions(
    intentLabels,
    uniqueValues(rows, "intent"),
    filters.intent,
  );
  const sourceFilterOptions = labeledFilterOptions(
    sourceLabels,
    uniqueValues(rows, "source"),
    filters.source,
  );
  const filteredRows = useMemo(() => rows ?? [], [rows]);

  // Selection is pruned to what is currently visible, so a filter change cannot
  // leave rows selected that the operator can no longer see -- and then act on
  // them from the bulk bar.
  const visibleIds = useMemo(() => filteredRows.map((lead) => lead.id), [filteredRows]);
  const selectedVisibleIds = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [selectedIds, visibleIds],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;

  function toggleSelected(id: string, next: boolean) {
    setSelectedIds((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  }

  function toggleSelectAll(next: boolean) {
    setSelectedIds(next ? new Set(visibleIds) : new Set());
  }

  async function runBulkUpdate() {
    if (!selectedVisibleIds.length || !isWorkspaceCurrent()) return;
    const lifetime = workspaceLifetimeRef.current;
    const assignAgent = bulkAgentId !== "";
    setBulkPending(true);
    try {
      const result = (await bulkUpdateAdminLeads({
        data: {
          ids: selectedVisibleIds,
          ...(bulkStage ? { stage: bulkStage } : {}),
          ...(assignAgent
            ? { assignAgent: true, assigned_agent_id: bulkAgentId === "none" ? null : bulkAgentId }
            : {}),
        },
      })) as { ok?: boolean; error?: string; updated?: number; requested?: number };

      if (!isWorkspaceCurrent(lifetime)) return;
      if (!result.ok) throw new Error(bulkErrorLabels[result.error ?? ""] ?? "批量更新失敗");

      await refreshLeads();
      if (!isWorkspaceCurrent(lifetime)) return;
      setSelectedIds(new Set());
      setBulkStage("");
      setBulkAgentId("");
      setBulkConfirmOpen(false);
      // Agent-scoped staff can only touch leads assigned to them, so the server
      // may legitimately update fewer rows than were asked for. Saying so beats
      // a green toast that implies all of them moved.
      const updated = result.updated ?? 0;
      const requested = result.requested ?? selectedVisibleIds.length;
      toast.success(
        updated === requested
          ? `已更新 ${updated} 筆客戶查詢`
          : `已更新 ${updated}／${requested} 筆客戶查詢，其餘沒有權限修改`,
      );
    } catch (err) {
      if (isWorkspaceCurrent(lifetime))
        toast.error(bulkErrorLabels[errorText(err)] ?? errorText(err));
    } finally {
      if (isWorkspaceCurrent(lifetime)) setBulkPending(false);
    }
  }

  function setFilter<K extends keyof LeadFilters>(key: K, value: LeadFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function openLead(id: string) {
    resetAiProfileState();
    selectedIdRef.current = id;
    panelOpenRef.current = true;
    setSelectedId(id);
    setPanelOpen(true);
    if (filters.lead !== id) setFilters((current) => ({ ...current, lead: id }), { replace: true });
  }

  function handlePanelOpenChange(open: boolean) {
    panelOpenRef.current = open;
    setPanelOpen(open);
    if (!open) {
      detailRequestRef.current += 1;
      selectedIdRef.current = null;
      setSelectedId(null);
      setDetail(null);
      setDraft(null);
      setDraftBaseline(null);
      setDraftVersion(null);
      setConflictLeadId(null);
      setDetailError(null);
      setNoteBody("");
      resetAiProfileState();
      if (filters.lead)
        setFilters((current) => ({ ...current, lead: undefined }), { replace: true });
    }
  }

  // Opens the panel for a `?lead=` arriving from the URL -- a shared link, a
  // reload, or Command Center's 開啟完整 Lead.
  useEffect(() => {
    const requested = filters.lead;
    if (!requested || requested === selectedIdRef.current) return;
    openLead(requested);
    // openLead is redeclared each render; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.lead]);

  // `handlePanelOpenChange(false)` used to run unconditionally, so Esc, an
  // overlay click, or opening another row silently discarded typed edits
  // (budget, 負責代理, 備註, 意圖) and an unwritten follow-up note. `draft` is
  // compared against `draftBaseline`, the draft as loadLeadDetail set it, not
  // against `detail`, which addNote can refresh to a colleague's newer row.
  const isLeadDetailDirty = Boolean(
    draft &&
    detail &&
    (JSON.stringify(draft) !== JSON.stringify(draftBaseline) || noteBody.trim() !== ""),
  );
  const { requestClose: requestPanelClose, dialog: unsavedLeadDialog } = useDirtyCloseGuard({
    isDirty: isLeadDetailDirty,
    onClose: () => handlePanelOpenChange(false),
    description: "你有未儲存的查詢修改或跟進備註，離開後會遺失。",
  });
  // The sheet was guarded but the page was not, so clicking a sidebar entry or
  // the browser Back button while the panel was open still destroyed the edits.
  const { dialog: leadRouteLeaveGuard } = useRouteLeaveGuard(isLeadDetailDirty);

  function updateDraft<K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveLead(nextDraft = draft, successMessage = "客戶查詢已更新") {
    if (!detail || !nextDraft || draftVersion === null || !isWorkspaceCurrent()) return;
    const lifetime = workspaceLifetimeRef.current;

    // Without this the inline error was decorative: 儲存 still wrote a reversed
    // or negative range straight through to the columns that drive segment
    // filters and blast audiences.
    const budgetProblem = leadBudgetError(nextDraft.budget_min, nextDraft.budget_max);
    if (budgetProblem) {
      toast.error(budgetProblem);
      return;
    }

    const targetLeadId = detail.id;
    let noteWritten = false;
    setMutatingAction("save");
    try {
      // 儲存 used to submit only the field draft while reporting 「客戶查詢已更新」,
      // so a follow-up note typed just above the button was silently discarded
      // and the toast said everything had saved.
      //
      // Written BEFORE the lead update, not after: the same 儲存 can reassign the
      // lead to another agent, and createAdminLeadActivity is now scoped to the
      // caller's own leads. Writing the note second meant an agent handing over
      // a lead with a parting note got a 403 and lost the note -- after the
      // reassignment had already committed.
      const pendingNote = noteBody.trim();
      if (pendingNote) {
        await createAdminLeadActivity({
          data: {
            lead_id: targetLeadId,
            contact_id: detail.contact_id,
            activity_type: "note",
            body: pendingNote,
            due_at: null,
            completed_at: null,
          },
        });
        if (!isWorkspaceCurrent(lifetime)) return;
        noteWritten = true;
        setNoteBody("");
        setNoteError(null);
      }

      const result = await updateAdminLead({
        data: draftToInput(targetLeadId, nextDraft, draftVersion),
      });
      if (!isWorkspaceCurrent(lifetime)) return;
      assertNoMutationError(result);
      // Narrows the union for `result.version`; also catches an undefined `ok`.
      if (!result.ok) throw new Error("更新失敗");
      // Guarded like `detail` below: the user may have switched to another lead.
      if (canApplyLeadDetail(targetLeadId)) setDraftVersion(result.version);
      setDetail((current) =>
        current?.id === targetLeadId ? { ...current, version: result.version } : current,
      );

      await refreshLeads();
      if (!isWorkspaceCurrent(lifetime) || !canApplyLeadDetail(targetLeadId)) return;

      const refreshed = await loadLeadDetail(targetLeadId);
      if (isWorkspaceCurrent(lifetime) && refreshed && canApplyLeadDetail(targetLeadId))
        toast.success(successMessage);
    } catch (err) {
      if (isWorkspaceCurrent(lifetime) && canApplyLeadDetail(targetLeadId)) {
        if (isLeadChangedError(err)) {
          setConflictLeadId(targetLeadId);
          toast.error(noteWritten ? LEAD_CHANGED_NOTE_SAVED_MESSAGE : LEAD_CHANGED_MESSAGE);
        } else toast.error(leadSaveErrorMessage(err));
      }
    } finally {
      if (isWorkspaceCurrent(lifetime)) setMutatingAction(null);
    }
  }

  async function addNote() {
    if (!detail || !isWorkspaceCurrent()) return;
    const body = noteBody.trim();
    if (!body) {
      // A distant toast gave no pointer to the field itself. The inline error
      // (rendered next to the Textarea in LeadDetailEditor) plus focusing it
      // is what actually gets the user's cursor where the fix needs to happen.
      setNoteError("請輸入跟進內容");
      return;
    }
    setNoteError(null);

    const targetLeadId = detail.id;
    const requestId = detailRequestRef.current;
    const submittedNote = noteBody;
    setMutatingAction("note");
    try {
      await createAdminLeadActivity({
        data: {
          lead_id: targetLeadId,
          contact_id: detail.contact_id,
          activity_type: "note",
          body,
          due_at: null,
          completed_at: null,
        },
      });
      if (!canApplyLeadDetail(targetLeadId) || requestId !== detailRequestRef.current) return;
      // The note is committed now. Retain any newer text, even if refreshing fails.
      setNoteBody((current) => (current === submittedNote ? "" : current));
      await refreshLeads();
      if (!canApplyLeadDetail(targetLeadId) || requestId !== detailRequestRef.current) return;
      // A note-only save must not run loadLeadDetail, which resets field drafts.
      const refreshed = await fetchAdminLead({ data: { id: targetLeadId } });
      if (!canApplyLeadDetail(targetLeadId) || requestId !== detailRequestRef.current) return;
      if (!refreshed) throw new Error("跟進紀錄已儲存，但未能重新載入查詢");
      setDetail(refreshed as AdminLeadDetail);
      setDetailError(null);
      toast.success("跟進紀錄已新增");
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId) && requestId === detailRequestRef.current)
        toast.error(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  async function markStage(stage: LeadStage, label: string) {
    if (!draft) return;
    await saveLead({ ...draft, stage }, `客戶查詢已標記為${label}`);
  }

  // `markStage` submits the whole draft (budget/負責代理/備註/意圖 included), not
  // just the stage, because `AdminLeadUpdateInput` requires every field on this
  // update path. A button labelled "標記失敗"/"標記成交" silently committing every
  // other pending edit is a surprise worth confirming -- but only when there is
  // something extra to warn about, so the common one-click case stays one click.
  const [pendingStageAction, setPendingStageAction] = useState<{
    stage: LeadStage;
    label: string;
  } | null>(null);

  function requestMarkStage(stage: LeadStage, label: string) {
    if (isLeadDetailDirty) {
      setPendingStageAction({ stage, label });
      return;
    }
    void markStage(stage, label);
  }

  async function refreshAiProfile() {
    if (!detail || !isWorkspaceCurrent()) return;

    const targetLeadId = detail.id;
    const requestId = aiRequestRef.current + 1;
    const runRequestId = aiRunRequestsRef.current.get(targetLeadId) ?? crypto.randomUUID();
    aiRunRequestsRef.current.set(targetLeadId, runRequestId);
    aiRequestRef.current = requestId;
    setAiLoading(true);
    // This is the retry the error banner asks for, so it must clear the banner
    // on the way in -- otherwise the error and the loading skeleton render at
    // the same time -- and set it again if the retry also fails.
    setAiError(null);
    try {
      const profile = await analyzeAdminLeadAiProfile({
        data: { leadId: targetLeadId, requestId: runRequestId },
      });
      if (requestId !== aiRequestRef.current || !canApplyLeadDetail(targetLeadId)) return;
      if (profile.analysis?.status !== "pending") aiRunRequestsRef.current.delete(targetLeadId);
      setAiProfile(profile as AdminLeadAiProfile);
      if (profile.analysis && profile.analysis.status !== "completed") {
        setAiError(
          profile.analysis.status === "denied"
            ? "權限或負責同事已更新，結果未有保存。"
            : "來源或分析狀態已更新，結果未有保存。請重新覆核。",
        );
        return;
      }
      toast.success(
        profile.profile?.result_kind === "model_validated"
          ? "模型分析已驗證及保存"
          : "備用建議已保存，請由同事覆核",
      );
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId)) {
        setAiError(errorText(err));
        toast.error(errorText(err));
      }
    } finally {
      if (requestId === aiRequestRef.current && canApplyLeadDetail(targetLeadId)) {
        setAiLoading(false);
      }
    }
  }

  async function decideAiTag(tagId: string, approve: boolean) {
    if (!detail || !isWorkspaceCurrent()) return;

    const targetLeadId = detail.id;
    setAiMutatingTagId(tagId);
    try {
      const tag = approve
        ? await approveAdminAiTag({ data: { tagId } })
        : await rejectAdminAiTag({ data: { tagId } });
      if (!canApplyLeadDetail(targetLeadId)) return;

      if (tag) {
        setAiProfile((current) =>
          current
            ? {
                ...current,
                tags: current.tags.map((item) =>
                  item.id === tagId ? (tag as AdminLeadAiProfile["tags"][number]) : item,
                ),
              }
            : current,
        );
      }
      toast.success(approve ? "AI 標籤 已批准" : "AI 標籤 已拒絕");
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId)) toast.error(errorText(err));
    } finally {
      if (canApplyLeadDetail(targetLeadId)) setAiMutatingTagId(null);
    }
  }

  const isMutating = mutatingAction !== null;
  const panelTitle = detail?.name ?? detail?.phone ?? "客戶查詢詳情";
  const panelDescription = detail
    ? `${stageLabels[detail.stage] ?? detail.stage} · ${formatIntent(detail.intent)} · ${formatDate(
        detail.created_at,
      )}`
    : "查看聯絡資料、查詢資料及 內部跟進紀錄。";

  return (
    <AdminShell title="客戶查詢" description="集中處理買樓、租樓及業主估價查詢。">
      <AdminToolbar
        filters={
          reviewMode ? null : (
            <>
              <div className="relative min-w-[14rem] flex-1 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                {/* Bound to local state, not to the router. It used to be
                  controlled by `filters.query`, so every character round-tripped
                  through an async navigation and anything typed faster than the
                  router committed was computed against a stale value and lost --
                  which a Chinese IME does constantly. */}
                <Input
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  onCompositionStart={() => {
                    queryCompositionActive.current = true;
                    setQueryIsComposing(true);
                  }}
                  onCompositionEnd={(event) => {
                    queryCompositionActive.current = false;
                    setQueryDraft(event.currentTarget.value);
                    setQueryIsComposing(false);
                  }}
                  className="h-11 pl-9 lg:h-9"
                  placeholder="搜尋客戶、電話、放盤"
                  aria-label="搜尋客戶查詢"
                />
              </div>

              <Select value={filters.stage} onValueChange={(value) => setFilter("stage", value)}>
                <SelectTrigger className="h-11 w-[8.5rem] lg:h-9" aria-label="階段">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部階段</SelectItem>
                  {stageFilterOptions.map((stage) => (
                    <SelectItem key={stage.value} value={stage.value}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.agent_id}
                onValueChange={(value) => setFilter("agent_id", value)}
              >
                <SelectTrigger className="h-11 w-[10rem] lg:h-9" aria-label="負責代理">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部代理</SelectItem>
                  <SelectItem value="unassigned">未指定代理</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agentLabel(agent)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 lg:h-9"
                onClick={resetFilters}
              >
                <RotateCcw className="h-4 w-4" />
                重設
              </Button>
            </>
          )
        }
        actions={
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => setForwardOpen(true)}>
              記錄人工轉交
            </Button>
            <Button asChild size="sm" className="h-11 lg:h-9">
              <Link to="/admin/leads/command-center">前往跟進工作台</Link>
            </Button>
            {/* `listAdminLeads` is capped at LIMIT 100 server-side and every
                filter here runs client-side over that slice, so a bare
                "{n} Leads" read as a total and made filtering look like it had
                deleted older leads. Say what the number actually is, and admit
                the cap when we are sitting on it. */}
            {reviewMode ? null : (
              <Badge variant="secondary" className="h-11 rounded-md px-3 lg:h-9">
                顯示 {filteredRows.length} 筆 / 共 {totalRows} 筆
              </Badge>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2" aria-label="快速篩選">
        <Button
          variant={filters.stage === "new" ? "secondary" : "outline"}
          aria-pressed={filters.stage === "new"}
          onClick={() => setFilters((current) => quickLeadFilter(current, "new"))}
        >
          新查詢
        </Button>
        <Button
          variant={filters.agent_id === "unassigned" ? "secondary" : "outline"}
          aria-pressed={filters.agent_id === "unassigned"}
          onClick={() => setFilters((current) => quickLeadFilter(current, "unassigned"))}
        >
          未指派代理
        </Button>
        {canReviewIdentity ? (
          <Button
            variant={reviewMode ? "secondary" : "outline"}
            aria-pressed={reviewMode}
            onClick={() =>
              setFilters((current) =>
                current.review === "identity"
                  ? { ...current, review: undefined, item: undefined }
                  : { ...current, review: "identity", lead: undefined },
              )
            }
          >
            可能重複客戶（{identityReviewsOpen}）
          </Button>
        ) : null}
      </div>
      {reviewMode ? null : (
        <details className="mb-4 rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            進階篩選
            {filters.intent !== "all" || filters.source !== "all" || filters.optIn !== "all"
              ? "（已套用）"
              : ""}
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            <AdminStatusSelect
              ariaLabel="意圖篩選"
              value={filters.intent}
              options={[{ value: "all", label: "全部意圖" }, ...intentFilterOptions]}
              onChange={(value) => setFilter("intent", value)}
            />
            <AdminStatusSelect
              ariaLabel="來源篩選"
              value={filters.source}
              options={[{ value: "all", label: "全部來源" }, ...sourceFilterOptions]}
              onChange={(value) => setFilter("source", value)}
            />
            <Select
              value={filters.optIn}
              onValueChange={(value) => setFilter("optIn", value as OptInFilter)}
            >
              <SelectTrigger className="h-11 w-[9rem] lg:h-9" aria-label="WhatsApp 推廣同意">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部推廣同意狀態</SelectItem>
                <SelectItem value="yes">已同意推廣</SelectItem>
                <SelectItem value="no">未有推廣同意</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </details>
      )}
      {reviewMode ? (
        <ContactIdentityReviewList
          focusId={filters.item ?? null}
          onResolved={() => {
            if (attentionIdentity) void adminAttentionStore.refresh(attentionIdentity);
          }}
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!filters.cursor || loadingRows}
              onClick={() => setFilters((current) => ({ ...current, cursor: undefined }))}
            >
              第一頁
            </Button>
            <Button
              variant="outline"
              disabled={!nextCursor || loadingRows}
              onClick={() =>
                setFilters((current) => ({ ...current, cursor: nextCursor ?? undefined }))
              }
            >
              下一頁
            </Button>
          </div>
          {error ? <AdminError message={error} /> : null}
          {loadingRows && !rows ? <Skeleton className="h-72 w-full" /> : null}
          {rows && filteredRows.length === 0 ? (
            <AdminEmptyState
              title="沒有符合條件的客戶查詢"
              description="搜尋及篩選已套用至全部可查看的查詢。可清除篩選再試。"
              action={
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  <RotateCcw className="h-4 w-4" />
                  清除篩選
                </Button>
              }
            />
          ) : null}
          {/* Reassigning or re-staging leads was one open -> save -> refetch cycle
            per lead, each refetching the whole list. */}
          {selectedVisibleIds.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
              <span className="text-sm font-medium">
                已選 {selectedVisibleIds.length} 筆客戶查詢
              </span>
              <AdminStatusSelect
                ariaLabel="批量設定階段"
                value={bulkStage}
                placeholder="改為階段…"
                options={stageOptions.map((stage) => ({ value: stage.value, label: stage.label }))}
                onChange={setBulkStage}
              />
              <Select value={bulkAgentId} onValueChange={setBulkAgentId}>
                <SelectTrigger className="h-11 w-44 lg:h-9" aria-label="批量指派負責代理">
                  <SelectValue placeholder="指派代理…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">取消指派</SelectItem>
                  {bulkAssignableAgents(agents).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name ?? agent.email ?? agent.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                className="h-11 lg:h-9"
                disabled={(!bulkStage && !bulkAgentId) || bulkPending}
                onClick={() => setBulkConfirmOpen(true)}
              >
                套用
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 lg:h-9"
                onClick={() => setSelectedIds(new Set())}
              >
                清除選取
              </Button>
            </div>
          ) : null}

          {filteredRows.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            aria-label="全選本頁客戶查詢"
                            checked={allVisibleSelected}
                            onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                          />
                        </TableHead>
                        <TableHead className="w-[28%]">客戶</TableHead>
                        <TableHead>意圖</TableHead>
                        <TableHead>來源</TableHead>
                        <TableHead>相關放盤</TableHead>
                        <TableHead className="text-right">預算</TableHead>
                        <TableHead>階段</TableHead>
                        {/* The 負責代理 filter existed with no matching column, so an
                        agent could filter by assignment but never see or verify
                        it. */}
                        <TableHead>負責代理</TableHead>
                        <TableHead>WhatsApp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.map((lead) => (
                        <LeadRow
                          key={lead.id}
                          lead={lead}
                          agents={agents}
                          selected={selectedIds.has(lead.id)}
                          onToggleSelected={toggleSelected}
                          onOpen={openLead}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <AdminDetailPanel
        open={panelOpen}
        title={panelTitle}
        description={panelDescription}
        onOpenChange={(open) => (open ? handlePanelOpenChange(true) : requestPanelClose())}
        footer={
          detail && draft ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isMutating || draft.stage === "closed_lost"}
                onClick={() => requestMarkStage("closed_lost", stageLabels.closed_lost)}
              >
                <XCircle className="h-4 w-4" />
                結束（未成交）
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isMutating || draft.stage === "closed_won"}
                onClick={() => requestMarkStage("closed_won", stageLabels.closed_won)}
              >
                <Trophy className="h-4 w-4" />
                標記已成交
              </Button>
              <p role="status" className="w-full text-sm text-muted-foreground">
                {isMutating
                  ? "儲存中…"
                  : isLeadDetailDirty
                    ? "有未儲存的修改"
                    : "目前沒有未儲存修改"}
              </p>
              <Button type="button" disabled={isMutating} onClick={() => saveLead()}>
                <Save className="h-4 w-4" />
                {mutatingAction === "save" ? "儲存中…" : "儲存"}
              </Button>
            </div>
          ) : null
        }
      >
        {detailLoading && !detail ? <Skeleton className="h-72 w-full" /> : null}
        {detailError ? <AdminError message={detailError} /> : null}
        {conflictLeadId === detail?.id ? (
          <LeadConflictNotice
            reloading={detailLoading}
            onReload={() => void loadLeadDetail(detail.id, { closeOnError: false })}
          />
        ) : null}
        {detail && draft ? (
          <LeadDetailEditor
            lead={detail}
            draft={draft}
            agents={agents}
            noteBody={noteBody}
            noteError={noteError}
            aiProfile={aiProfile}
            aiLoading={aiLoading}
            aiError={aiError}
            aiMutatingTagId={aiMutatingTagId}
            disabled={isMutating}
            onDraftChange={updateDraft}
            onReloadContact={() => reloadLeadContact(detail.id)}
            onNoteChange={(value) => {
              setNoteBody(value);
              if (noteError) setNoteError(null);
            }}
            onAddNote={addNote}
            onRefreshAiProfile={refreshAiProfile}
            onAiTagDecision={decideAiTag}
            noteSaving={mutatingAction === "note"}
          />
        ) : null}
        {detail?.source === "manual_forward" ? (
          <ForwardedEnquiryEvidence leadId={detail.id} />
        ) : null}
      </AdminDetailPanel>
      <Dialog
        open={forwardOpen}
        onOpenChange={(open) => {
          if (!forwardBusy) setForwardOpen(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle>記錄人工轉交查詢</DialogTitle>
          <DialogDescription>
            保存原文及來源；不會建立 WhatsApp 客戶對話或發送訊息。
          </DialogDescription>
          {forwardOpen ? (
            <ForwardedEnquiryForm
              key={user?.id}
              draftKey={user?.id}
              onBusyChange={setForwardBusy}
              agents={agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
                active: agent.active,
              }))}
              onCancel={() => setForwardOpen(false)}
              onSaved={(leadId) => {
                if (!isWorkspaceCurrent()) return;
                setForwardOpen(false);
                void refreshLeads();
                openLead(leadId);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {unsavedLeadDialog}
      {leadRouteLeaveGuard}
      <AdminConfirmDialog
        open={bulkConfirmOpen}
        title="確認批量更新？"
        description={`此操作會一次過修改 ${selectedVisibleIds.length} 筆客戶查詢，無法一次過復原。`}
        confirmLabel={`更新 ${selectedVisibleIds.length} 筆客戶查詢`}
        confirmVariant="destructive"
        isPending={bulkPending}
        onOpenChange={(open) => {
          if (!bulkPending) setBulkConfirmOpen(open);
        }}
        onConfirm={() => void runBulkUpdate()}
      >
        <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
          {bulkStage ? (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">階段改為</dt>
              <dd className="font-medium">{stageLabels[bulkStage] ?? bulkStage}</dd>
            </div>
          ) : null}
          {bulkAgentId ? (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">負責代理改為</dt>
              <dd className="font-medium">
                {bulkAgentId === "none"
                  ? "取消指派"
                  : (agents.find((agent) => agent.id === bulkAgentId)?.name ?? bulkAgentId)}
              </dd>
            </div>
          ) : null}
        </dl>
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={pendingStageAction !== null}
        title={`標記為${pendingStageAction?.label ?? ""}`}
        description="此客戶查詢 有其他未儲存的修改（預算、負責代理、備註或意圖），會一併儲存。確定要繼續嗎？"
        confirmLabel="確定並儲存"
        onOpenChange={(open) => {
          if (!open) setPendingStageAction(null);
        }}
        onConfirm={() => {
          if (pendingStageAction)
            void markStage(pendingStageAction.stage, pendingStageAction.label);
          setPendingStageAction(null);
        }}
      />
    </AdminShell>
  );
}

function LeadRow({
  lead,
  agents,
  selected,
  onToggleSelected,
  onOpen,
}: {
  lead: AdminLeadRow;
  agents: AdminAgentRow[];
  selected: boolean;
  onToggleSelected: (id: string, next: boolean) => void;
  onOpen: (id: string) => void;
}) {
  // `role="button"` on the whole `<tr>` used to replace its cell semantics, so a
  // screen reader announced only "開啟 X 詳情, button" and never the 意向/來源/
  // 預算/階段/opt-in cells. A real focusable control inside the Lead cell keeps
  // every column reachable by keyboard while still announcing per-column.
  return (
    <TableRow className="hover:bg-muted/40" data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          aria-label={`選擇 ${lead.name ?? "未命名"}`}
          onCheckedChange={(checked) => onToggleSelected(lead.id, checked === true)}
        />
      </TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => onOpen(lead.id)}
          className="rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {lead.name ?? "未命名"}
        </button>
        <p className="text-xs text-muted-foreground">{lead.phone ?? lead.email ?? "—"}</p>
      </TableCell>
      <TableCell>{formatIntent(lead.intent)}</TableCell>
      <TableCell>{formatSource(lead.source)}</TableCell>
      <TableCell>
        <p className="line-clamp-1" title={lead.property_title ?? undefined}>
          {lead.property_title ?? lead.listing_no ?? "—"}
        </p>
        {lead.listing_no ? (
          <p className="text-xs text-muted-foreground">#{lead.listing_no}</p>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {formatBudget(lead)}
      </TableCell>
      <TableCell>
        <Badge variant={lead.stage === "new" ? "default" : "outline"}>
          {stageLabels[lead.stage] ?? lead.stage}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {lead.assigned_agent_id ? (
          (agents.find((agent) => agent.id === lead.assigned_agent_id)?.name ?? "未知代理")
        ) : (
          <span className="text-muted-foreground">未指派</span>
        )}
      </TableCell>
      <TableCell>
        {lead.opt_in_whatsapp ? (
          <Badge variant="secondary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已同意推廣
          </Badge>
        ) : (
          <Badge variant="outline">未有推廣同意</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

function LeadDetailEditor({
  lead,
  draft,
  agents,
  noteBody,
  noteError,
  aiProfile,
  aiLoading,
  aiError,
  aiMutatingTagId,
  disabled,
  noteSaving,
  onDraftChange,
  onReloadContact,
  onNoteChange,
  onAddNote,
  onRefreshAiProfile,
  onAiTagDecision,
}: {
  lead: AdminLeadDetail;
  draft: LeadDraft;
  agents: AdminAgentRow[];
  noteBody: string;
  noteError: string | null;
  aiProfile: AdminLeadAiProfile | null;
  aiLoading: boolean;
  aiError: string | null;
  aiMutatingTagId: string | null;
  disabled: boolean;
  noteSaving: boolean;
  onDraftChange: <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) => void;
  onReloadContact: () => Promise<boolean>;
  onNoteChange: (value: string) => void;
  onAddNote: () => void;
  onRefreshAiProfile: () => void;
  onAiTagDecision: (tagId: string, approve: boolean) => void;
}) {
  const noteInputRef = useRef<HTMLTextAreaElement>(null);
  const budgetError = leadBudgetError(draft.budget_min, draft.budget_max);
  useEffect(() => {
    if (noteError) noteInputRef.current?.focus();
  }, [noteError]);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">聯絡資料</h3>
        <dl className="mt-3 grid gap-3 text-sm">
          <DetailItem label="姓名" value={lead.name ?? "未命名"} />
          <DetailItem label="電話" value={lead.phone ?? "—"} />
          <DetailItem label="電郵" value={lead.email ?? "—"} />
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">WhatsApp</dt>
            <dd>
              {lead.opt_in_whatsapp ? (
                <Badge variant="secondary">已同意推廣</Badge>
              ) : (
                <Badge variant="outline">未有推廣同意</Badge>
              )}
            </dd>
          </div>
        </dl>
        {lead.contact_id ? (
          <LeadContactEditor
            key={`${lead.id}:${lead.contact_id}`}
            leadId={lead.id}
            contactId={lead.contact_id}
            name={lead.name}
            email={lead.email}
            disabled={disabled}
            onReload={onReloadContact}
          />
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            尚未連結已核實客戶聯絡資料；原文聯絡方式不會自動建立客戶身分。
          </p>
        )}
        <RelatedLeadConversations
          key={`${lead.id}:${lead.contact_id ?? "none"}`}
          leadId={lead.id}
        />
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">查詢資料</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="階段">
            <AdminStatusSelect
              ariaLabel="查詢階段"
              value={draft.stage}
              options={stageOptions}
              disabled={disabled}
              onChange={(value) => onDraftChange("stage", value as LeadStage)}
            />
          </Field>

          <Field label="負責代理">
            <Select
              value={draft.assigned_agent_id ?? "none"}
              disabled={disabled}
              onValueChange={(value) =>
                onDraftChange("assigned_agent_id", value === "none" ? null : value)
              }
            >
              <SelectTrigger aria-label="負責代理">
                <SelectValue placeholder="選擇代理" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未指定代理</SelectItem>
                {assignableAgents(agents, lead.assigned_agent_id).map(
                  ({ agent, inactiveCurrent }) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agentLabel(agent)}
                      {inactiveCurrent ? "（已停用，請改派）" : ""}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="意圖">
            {/* Was a free-text Input bound to the raw enum: agents saw English
                "buyer" where the list shows 買樓, could type anything (breaking
                the CRM's 意圖 filter dropdown), and clearing it silently rewrote
                the lead to 買樓 (draftToInput's `|| "buyer"` fallback). An extra
                option covers a current value outside the known set so it is
                never silently discarded. */}
            <AdminStatusSelect
              ariaLabel="意圖"
              value={draft.intent}
              options={
                intentLabels[draft.intent]
                  ? intentOptions
                  : [...intentOptions, { value: draft.intent, label: draft.intent }]
              }
              disabled={disabled}
              onChange={(value) => onDraftChange("intent", value)}
            />
          </Field>

          <ReadonlyField label="來源" value={formatSource(lead.source)} />

          {/* A reversed or negative range was accepted and saved silently, then
              fed straight into the segment/audience filters that decide who
              receives a WhatsApp blast. */}
          <Field label="最低預算" error={budgetError}>
            <Input
              type="number"
              min={0}
              value={draft.budget_min ?? ""}
              disabled={disabled}
              aria-invalid={budgetError ? true : undefined}
              onChange={(event) =>
                onDraftChange("budget_min", parseNullableNumber(event.target.value))
              }
            />
          </Field>

          <Field label="最高預算">
            <Input
              type="number"
              min={0}
              value={draft.budget_max ?? ""}
              disabled={disabled}
              aria-invalid={budgetError ? true : undefined}
              onChange={(event) =>
                onDraftChange("budget_max", parseNullableNumber(event.target.value))
              }
            />
          </Field>

          <ReadonlyField
            label="相關放盤"
            value={lead.property_title ?? lead.listing_no ?? "—"}
            description={lead.listing_no ? `#${lead.listing_no}` : undefined}
          />

          <ReadonlyField label="建立時間" value={formatDate(lead.created_at)} />

          <Field label="偏好屋苑">
            <Textarea
              value={draft.preferred_estates}
              rows={3}
              disabled={disabled}
              placeholder="以逗號或換行分隔"
              onChange={(event) => onDraftChange("preferred_estates", event.target.value)}
            />
          </Field>

          <Field label="內部備註（不會傳送給客戶）">
            <Textarea
              aria-label="內部備註（不會傳送給客戶）"
              value={draft.note}
              rows={3}
              disabled={disabled}
              onChange={(event) => onDraftChange("note", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">內部跟進紀錄</h3>
          <Badge variant="outline">{lead.activities.length}</Badge>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          只供團隊查看，不會傳送 WhatsApp。下方「儲存」會一併儲存查詢修改及這則紀錄。
        </p>
        <div className="mt-4 grid gap-3">
          <Textarea
            ref={noteInputRef}
            aria-label="新增內部跟進紀錄"
            aria-invalid={Boolean(noteError)}
            aria-describedby={noteError ? "note-error" : undefined}
            value={noteBody}
            rows={3}
            disabled={disabled}
            placeholder="輸入內部跟進紀錄，不會傳送 WhatsApp"
            onChange={(event) => onNoteChange(event.target.value)}
          />
          {noteError ? (
            <p id="note-error" role="alert" className="text-sm text-destructive">
              {noteError}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || noteSaving}
            onClick={onAddNote}
          >
            <StickyNote className="h-4 w-4" />
            {noteSaving ? "儲存中…" : "只儲存跟進紀錄"}
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {/* Only system flags (e.g. 疑似機械人) so far: still not followed up, rows shown below. */}
          {lead.activities.length > 0 && leadTimelineHasNoFollowUp(lead.activities) ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              未有跟進紀錄
            </p>
          ) : null}
          {lead.activities.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              未有跟進紀錄
            </p>
          ) : (
            lead.activities.map((activity) => (
              <article key={activity.id} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={activity.activity_type === "note" ? "secondary" : "outline"}>
                    {formatActivityType(activity.activity_type)}
                  </Badge>
                  <time className="text-xs text-muted-foreground">
                    {formatDate(activity.created_at)}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{activity.body ?? "—"}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {activity.staff_name ?? "未記名"}
                  {activity.due_at ? ` · 到期 ${formatDate(activity.due_at)}` : ""}
                </p>
              </article>
            ))
          )}
        </div>
      </section>

      {lead.source === "live_agent" ? <LeadChatTranscript key={lead.id} leadId={lead.id} /> : null}

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" />
              AI 分析
            </h3>
            {aiProfile?.profile?.last_analyzed_at ? (
              <p className="mt-1 text-xs text-muted-foreground">
                最後分析 {formatDate(aiProfile.profile.last_analyzed_at)}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || aiLoading}
            onClick={onRefreshAiProfile}
          >
            <Sparkles className="h-4 w-4" />
            {aiLoading ? "分析中…" : "AI 分析"}
          </Button>
        </div>

        {aiLoading && !aiProfile ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : null}

        {aiProfile?.profile ? (
          <div className="mt-4 grid gap-3 text-sm">
            <p>
              {
                aiResultPresentation({
                  method: aiProfile.analysis?.resultKind,
                  status: aiProfile.analysis?.status,
                }).label
              }
            </p>
            <p className="text-xs text-muted-foreground">
              來源時間：
              {aiProfile.analysis?.startedAt
                ? formatDate(aiProfile.analysis.startedAt)
                : "未提供"}{" "}
              · 版本：{aiProfile.analysis?.schemaVersion ?? "未提供"} · 費用：
              {
                aiResultPresentation({
                  costAmount: aiProfile.analysis?.usage?.costAmount,
                  costCurrency: aiProfile.analysis?.usage?.costCurrency,
                }).cost
              }
            </p>
            {aiResultPresentation({ status: aiProfile.analysis?.status }).blocker && (
              <p role="status" className="text-destructive">
                {aiResultPresentation({ status: aiProfile.analysis?.status }).blocker}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">
                跟進排序參考 {aiScoreLabel(aiProfile.profile.lead_score)}
              </Badge>
              {aiProfile.profile.urgency ? (
                <Badge variant="outline">{formatAiUrgency(aiProfile.profile.urgency)}</Badge>
              ) : null}
              {aiProfile.profile.timeline ? (
                <Badge variant="outline">{formatAiTimeline(aiProfile.profile.timeline)}</Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              按查詢完整度、跟進狀態及規則排序，並非成交率。過時內容只供歷史參考。
            </p>
            {aiProfile.profile.summary ? (
              <p className="whitespace-pre-wrap">{aiProfile.profile.summary}</p>
            ) : null}
            {aiProfile.profile.next_best_action ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
                {aiProfile.profile.next_best_action}
              </p>
            ) : null}
          </div>
        ) : aiError ? (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {aiError}
          </p>
        ) : !aiLoading ? (
          <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            未有 AI 分析
          </p>
        ) : null}

        {aiProfile?.tags.length ? (
          <div className="mt-4 space-y-2">
            {aiProfile.tags.map((tag) => (
              <div
                key={tag.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={aiTagVariant(tag.status)}>{tag.tag}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatAiTagStatus(tag.status)} · 模型自評（未校準）
                    </span>
                  </div>
                  {tag.reason ? (
                    <p
                      className="mt-1 line-clamp-2 text-xs text-muted-foreground"
                      title={tag.reason ?? undefined}
                    >
                      {tag.reason}
                    </p>
                  ) : null}
                </div>
                {tag.status === "suggested" ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        disabled ||
                        aiMutatingTagId === tag.id ||
                        !aiResultPresentation({
                          method: aiProfile.analysis?.resultKind,
                          status: aiProfile.analysis?.status,
                        }).canApply
                      }
                      onClick={() => onAiTagDecision(tag.id, true)}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      批准
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || aiMutatingTagId === tag.id}
                      onClick={() => onAiTagDecision(tag.id, false)}
                    >
                      <XCircle className="h-4 w-4" />
                      拒絕
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-normal text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function ReadonlyField({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  return (
    <div className="grid gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <div className="rounded-md border bg-muted/30 px-3 py-2">
        <p>{value}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
    </div>
  );
}

function uniqueValues(rows: AdminLeadRow[] | null, key: "intent" | "source") {
  return Array.from(new Set((rows ?? []).map((row) => row[key]).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function leadToDraft(lead: AdminLeadDetail): LeadDraft {
  return {
    stage: lead.stage as LeadStage,
    intent: lead.intent,
    budget_min: nullableNumber(lead.budget_min),
    budget_max: nullableNumber(lead.budget_max),
    preferred_estates: lead.preferred_estates.join(", "),
    assigned_agent_id: lead.assigned_agent_id,
    note: lead.note ?? "",
  };
}

function draftToInput(id: string, draft: LeadDraft, expectedVersion: string): AdminLeadUpdateInput {
  return {
    id,
    stage: draft.stage,
    intent: draft.intent.trim() || "buyer",
    budget_min: draft.budget_min,
    budget_max: draft.budget_max,
    preferred_estates: parsePreferredEstates(draft.preferred_estates),
    assigned_agent_id: draft.assigned_agent_id,
    note: draft.note.trim() || null,
    expected_version: expectedVersion,
  };
}

function parsePreferredEstates(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function parseNullableNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableNumber(value: number | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatIntent(intent: string) {
  return intentLabels[intent] ?? intent;
}

function formatSource(source: string) {
  return sourceLabels[source] ?? source;
}

function formatBudget(lead: AdminLeadRow) {
  if (lead.budget_min && lead.budget_max) {
    return `${formatMoney(lead.budget_min)} - ${formatMoney(lead.budget_max)}`;
  }
  if (lead.budget_min) return `${formatMoney(lead.budget_min)}+`;
  if (lead.budget_max) return `<= ${formatMoney(lead.budget_max)}`;
  return "—";
}

function formatMoney(value: number) {
  return `$${Number(value).toLocaleString("zh-HK")}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatActivityType(type: string) {
  const labels: Record<string, string> = {
    note: "內部備註",
    call: "電話",
    viewing: "睇樓",
    follow_up: "跟進",
    suspected_bot: "疑似機械人",
  };
  return labels[type] ?? type;
}

function formatAiUrgency(value: string) {
  const labels: Record<string, string> = {
    recent: "近期互動",
    normal: "一般",
    urgent: "高優先",
  };
  return labels[value] ?? value;
}

function formatAiTimeline(value: string) {
  const labels: Record<string, string> = {
    "30_days": "30日內",
    "90_days": "90日內",
    later: "稍後",
  };
  return labels[value] ?? value;
}

function formatAiTagStatus(status: AdminLeadAiProfile["tags"][number]["status"]) {
  const labels: Record<AdminLeadAiProfile["tags"][number]["status"], string> = {
    suggested: "建議",
    approved: "已批准",
    rejected: "已拒絕",
    auto_applied: "自動套用",
  };
  return labels[status] ?? status;
}

function aiTagVariant(status: AdminLeadAiProfile["tags"][number]["status"]) {
  if (status === "approved" || status === "auto_applied") return "secondary";
  if (status === "rejected") return "outline";
  return "default";
}

function agentLabel(agent: AdminAgentRow) {
  return agent.name ?? agent.email ?? "未命名代理";
}

function assertNoMutationError(result: unknown) {
  if (!result || typeof result !== "object") return;
  const maybeError = (result as { error?: unknown }).error;
  if (maybeError) throw new Error(String(maybeError));
  if ((result as { ok?: unknown }).ok === false) throw new Error("更新失敗");
}

function errorText(error: unknown) {
  // Bulk codes stay raw: the caller maps them through bulkErrorLabels.
  const raw = error instanceof Error ? error.message : error;
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(bulkErrorLabels, raw))
    return raw;
  return adminErrorMessage(error);
}
