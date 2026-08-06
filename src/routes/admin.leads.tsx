import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminStatusSelect } from "@/components/admin/AdminStatusSelect";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { leadBudgetError } from "@/lib/admin/lead-budget";
import {
  analyzeAdminLeadAiProfile,
  approveAdminAiTag,
  createAdminLeadActivity,
  fetchAdminAgents,
  fetchAdminLead,
  fetchAdminLeadAiProfile,
  fetchAdminLeads,
  rejectAdminAiTag,
  updateAdminLead,
} from "@/lib/neon/admin-data";
import type {
  AdminAgentRow,
  AdminLeadAiProfile,
  AdminLeadDetail,
  AdminLeadRow,
  AdminLeadUpdateInput,
} from "@/lib/neon/admin-data.types";

type LeadStage = "new" | "contacted" | "viewing" | "negotiating" | "closed_won" | "closed_lost";
type OptInFilter = "all" | "yes" | "no";

type LeadFilters = {
  /** Lead id of the open detail panel. Not a filter, but it shares the search
   * schema so one navigate() call can change both. */
  lead?: string;
  stage: string;
  intent: string;
  source: string;
  agent_id: string;
  optIn: OptInFilter;
  query: string;
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

const stageOptions: { value: LeadStage; label: string }[] = [
  { value: "new", label: "新 Lead" },
  { value: "contacted", label: "跟進" },
  { value: "viewing", label: "睇樓" },
  { value: "negotiating", label: "商議中" },
  { value: "closed_won", label: "成交" },
  { value: "closed_lost", label: "失敗" },
];

const stageLabels = Object.fromEntries(stageOptions.map((option) => [option.value, option.label]));

const intentLabels: Record<string, string> = {
  buyer: "買樓",
  renter: "租樓",
  landlord: "放盤",
  seller: "放售",
  valuation: "估價",
};

const intentOptions: { value: string; label: string }[] = Object.entries(intentLabels).map(
  ([value, label]) => ({ value, label }),
);

const sourceLabels: Record<string, string> = {
  website: "網站",
  whatsapp: "WhatsApp",
  phone: "電話",
  referral: "轉介",
  walk_in: "到店",
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
const LEAD_ROW_LIMIT = 100;

function AdminLeads() {
  const { user } = useNeonAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [rows, setRows] = useState<AdminLeadRow[] | null>(null);
  const [agents, setAgents] = useState<AdminAgentRow[]>([]);
  const filters: LeadFilters = useMemo(() => ({ ...defaultFilters, ...search }), [search]);
  const [queryDraft, setQueryDraft] = useState(filters.query);

  // Keeps the box in step when the URL changes from elsewhere (back/forward, or
  // the filtered-empty state's 清除篩選) without making every keystroke a
  // navigation.
  useEffect(() => {
    setQueryDraft(filters.query);
  }, [filters.query]);

  useEffect(() => {
    if (queryDraft === filters.query) return;
    const timer = window.setTimeout(() => {
      setFilters((current) => ({ ...current, query: queryDraft }), { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
    // setFilters is redeclared each render; depending on it would re-arm the
    // timer continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryDraft, filters.query]);
  function setFilters(
    updater: LeadFilters | ((current: LeadFilters) => LeadFilters),
    options: { replace?: boolean } = {},
  ) {
    const next = typeof updater === "function" ? updater(filters) : updater;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminLeadDetail | null>(null);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [aiProfile, setAiProfile] = useState<AdminLeadAiProfile | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMutatingTagId, setAiMutatingTagId] = useState<string | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const aiRequestRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  const panelOpenRef = useRef(false);

  const canApplyLeadDetail = useCallback((id: string) => {
    return panelOpenRef.current && selectedIdRef.current === id;
  }, []);

  function resetAiProfileState() {
    aiRequestRef.current += 1;
    setAiProfile(null);
    setAiLoading(false);
    setAiMutatingTagId(null);
  }

  const refreshLeads = useCallback(async () => {
    if (!user) return;

    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoadingRows(true);
    try {
      const data = await fetchAdminLeads();
      if (requestId !== listRequestRef.current) return;
      setRows(data as AdminLeadRow[]);
      setError(null);
    } catch (err) {
      if (requestId !== listRequestRef.current) return;
      setError(errorText(err));
    } finally {
      if (requestId === listRequestRef.current) setLoadingRows(false);
    }
  }, [user]);

  const loadLeadAiProfile = useCallback(
    async (id: string) => {
      const requestId = aiRequestRef.current + 1;
      aiRequestRef.current = requestId;
      setAiLoading(true);

      try {
        const profile = await fetchAdminLeadAiProfile({ data: { leadId: id } });
        if (requestId !== aiRequestRef.current || !canApplyLeadDetail(id)) return null;
        setAiProfile(profile as AdminLeadAiProfile);
        return profile as AdminLeadAiProfile;
      } catch {
        if (requestId === aiRequestRef.current && canApplyLeadDetail(id)) setAiProfile(null);
        return null;
      } finally {
        if (requestId === aiRequestRef.current && canApplyLeadDetail(id)) setAiLoading(false);
      }
    },
    [canApplyLeadDetail],
  );

  const loadLeadDetail = useCallback(
    async (id: string, options: { resetNote?: boolean; closeOnError?: boolean } = {}) => {
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setDetailLoading(true);
      setDetailError(null);

      try {
        const data = await fetchAdminLead({ data: { id } });
        if (requestId !== detailRequestRef.current || !canApplyLeadDetail(id)) return null;
        if (!data) throw new Error("找不到 Lead");

        const lead = data as AdminLeadDetail;
        setDetail(lead);
        setDraft(leadToDraft(lead));
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
    [canApplyLeadDetail, loadLeadAiProfile],
  );

  useEffect(() => {
    if (!user) return;
    refreshLeads();
  }, [refreshLeads, user]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    fetchAdminAgents()
      .then((data) => {
        if (!cancelled) setAgents(data as AdminAgentRow[]);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err));
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!selectedId || !panelOpen) return;
    loadLeadDetail(selectedId, { resetNote: true });
  }, [loadLeadDetail, panelOpen, selectedId]);

  const intentOptions = useMemo(() => uniqueValues(rows, "intent"), [rows]);
  const sourceOptions = useMemo(() => uniqueValues(rows, "source"), [rows]);
  const filteredRows = useMemo(() => filterLeads(rows ?? [], filters), [filters, rows]);

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
  // compared against the loaded server value, not a captured-at-open baseline,
  // since the panel already has that value in `detail`.
  const isLeadDetailDirty = Boolean(
    draft &&
    detail &&
    (JSON.stringify(draft) !== JSON.stringify(leadToDraft(detail)) || noteBody.trim() !== ""),
  );
  const { requestClose: requestPanelClose, dialog: unsavedLeadDialog } = useDirtyCloseGuard({
    isDirty: isLeadDetailDirty,
    onClose: () => handlePanelOpenChange(false),
    description: "你有未儲存的 Lead 修改或跟進備註，離開後會遺失。",
  });
  // The sheet was guarded but the page was not, so clicking a sidebar entry or
  // the browser Back button while the panel was open still destroyed the edits.
  const { dialog: leadRouteLeaveGuard } = useRouteLeaveGuard(isLeadDetailDirty);

  function updateDraft<K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function saveLead(nextDraft = draft, successMessage = "Lead 已更新") {
    if (!detail || !nextDraft) return;

    // Without this the inline error was decorative: 儲存 still wrote a reversed
    // or negative range straight through to the columns that drive segment
    // filters and blast audiences.
    const budgetProblem = leadBudgetError(nextDraft.budget_min, nextDraft.budget_max);
    if (budgetProblem) {
      toast.error(budgetProblem);
      return;
    }

    const targetLeadId = detail.id;
    setMutatingAction("save");
    try {
      const result = await updateAdminLead({ data: draftToInput(targetLeadId, nextDraft) });
      assertNoMutationError(result);

      // 儲存 used to submit only the field draft while reporting 「Lead 已更新」,
      // so a follow-up note typed just above the button was silently discarded
      // and the toast said everything had saved.
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
        setNoteBody("");
        setNoteError(null);
      }

      await refreshLeads();
      if (!canApplyLeadDetail(targetLeadId)) return;

      const refreshed = await loadLeadDetail(targetLeadId);
      if (refreshed && canApplyLeadDetail(targetLeadId)) toast.success(successMessage);
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId)) toast.error(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  async function addNote() {
    if (!detail) return;
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
      await refreshLeads();
      if (!canApplyLeadDetail(targetLeadId)) return;

      const refreshed = await loadLeadDetail(targetLeadId, { resetNote: true });
      if (refreshed && canApplyLeadDetail(targetLeadId)) toast.success("跟進紀錄已新增");
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId)) toast.error(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  async function markStage(stage: LeadStage, label: string) {
    if (!draft) return;
    await saveLead({ ...draft, stage }, `Lead 已標記為${label}`);
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
    if (!detail) return;

    const targetLeadId = detail.id;
    const requestId = aiRequestRef.current + 1;
    aiRequestRef.current = requestId;
    setAiLoading(true);
    try {
      const profile = await analyzeAdminLeadAiProfile({ data: { leadId: targetLeadId } });
      if (requestId !== aiRequestRef.current || !canApplyLeadDetail(targetLeadId)) return;
      setAiProfile(profile as AdminLeadAiProfile);
      toast.success("AI profile 已更新");
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId)) toast.error(errorText(err));
    } finally {
      if (requestId === aiRequestRef.current && canApplyLeadDetail(targetLeadId)) {
        setAiLoading(false);
      }
    }
  }

  async function decideAiTag(tagId: string, approve: boolean) {
    if (!detail) return;

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
      toast.success(approve ? "AI tag 已批准" : "AI tag 已拒絕");
    } catch (err) {
      if (canApplyLeadDetail(targetLeadId)) toast.error(errorText(err));
    } finally {
      if (canApplyLeadDetail(targetLeadId)) setAiMutatingTagId(null);
    }
  }

  const isMutating = mutatingAction !== null;
  const panelTitle = detail?.name ?? detail?.phone ?? "Lead 詳情";
  const panelDescription = detail
    ? `${stageLabels[detail.stage] ?? detail.stage} · ${formatIntent(detail.intent)} · ${formatDate(
        detail.created_at,
      )}`
    : "查看聯絡資料、Lead 欄位及 Activity 跟進紀錄。";

  return (
    <AdminShell title="CRM" description="集中處理買樓、租樓及業主估價 leads。">
      <AdminToolbar
        filters={
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
                className="h-11 pl-9 lg:h-9"
                placeholder="搜尋客戶、電話、放盤"
                aria-label="搜尋 leads"
              />
            </div>

            <Select value={filters.stage} onValueChange={(value) => setFilter("stage", value)}>
              <SelectTrigger className="h-11 w-[8.5rem] lg:h-9" aria-label="階段">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部階段</SelectItem>
                {stageOptions.map((stage) => (
                  <SelectItem key={stage.value} value={stage.value}>
                    {stage.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.intent} onValueChange={(value) => setFilter("intent", value)}>
              <SelectTrigger className="h-11 w-[8rem] lg:h-9" aria-label="意圖">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部意圖</SelectItem>
                {intentOptions.map((intent) => (
                  <SelectItem key={intent} value={intent}>
                    {formatIntent(intent)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.source} onValueChange={(value) => setFilter("source", value)}>
              <SelectTrigger className="h-11 w-[8rem] lg:h-9" aria-label="來源">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部來源</SelectItem>
                {sourceOptions.map((source) => (
                  <SelectItem key={source} value={source}>
                    {formatSource(source)}
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

            <Select
              value={filters.optIn}
              onValueChange={(value) => setFilter("optIn", value as OptInFilter)}
            >
              <SelectTrigger className="h-11 w-[9rem] lg:h-9" aria-label="WhatsApp opt-in">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部 WhatsApp</SelectItem>
                <SelectItem value="yes">已 Opt-in</SelectItem>
                <SelectItem value="no">未 Opt-in</SelectItem>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 lg:h-9"
              onClick={() => setFilters(defaultFilters)}
            >
              <RotateCcw className="h-4 w-4" />
              重設
            </Button>
          </>
        }
        actions={
          <>
            <Button asChild size="sm" className="h-11 lg:h-9">
              <Link to="/admin/leads/command-center">前往 Command Center</Link>
            </Button>
            {/* `listAdminLeads` is capped at LIMIT 100 server-side and every
                filter here runs client-side over that slice, so a bare
                "{n} Leads" read as a total and made filtering look like it had
                deleted older leads. Say what the number actually is, and admit
                the cap when we are sitting on it. */}
            <Badge variant="secondary" className="h-11 rounded-md px-3 lg:h-9">
              顯示 {filteredRows.length} 筆
              {(rows?.length ?? 0) >= LEAD_ROW_LIMIT ? `（最近 ${LEAD_ROW_LIMIT} 筆內）` : ""}
            </Badge>
          </>
        }
      />

      {error ? <AdminError message={error} /> : null}
      {loadingRows && !rows ? <Skeleton className="h-72 w-full" /> : null}
      {rows && filteredRows.length === 0 ? (
        <AdminEmptyState
          title={rows.length === 0 ? "未有 Leads" : "已載入的 Leads 中沒有符合條件的項目"}
          description={
            rows.length === 0
              ? "新的網站查詢會在這裡出現。"
              : rows.length >= LEAD_ROW_LIMIT
                ? `篩選只涵蓋最近更新的 ${LEAD_ROW_LIMIT} 筆 Lead，較舊的未有載入。請調整條件，或改用搜尋。`
                : "調整篩選條件再查看。"
          }
          action={
            rows.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setFilters(defaultFilters)}>
                <RotateCcw className="h-4 w-4" />
                清除篩選
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {filteredRows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[920px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28%]">客戶</TableHead>
                    <TableHead>意圖</TableHead>
                    <TableHead>來源</TableHead>
                    <TableHead>相關放盤</TableHead>
                    <TableHead className="text-right">預算</TableHead>
                    <TableHead>階段</TableHead>
                    <TableHead>WhatsApp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((lead) => (
                    <LeadRow key={lead.id} lead={lead} onOpen={openLead} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <AdminDetailPanel
        open={panelOpen}
        title={panelTitle}
        description={panelDescription}
        onOpenChange={(open) => (open ? handlePanelOpenChange(true) : requestPanelClose())}
        footer={
          detail && draft ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={isMutating || draft.stage === "closed_lost"}
                onClick={() => requestMarkStage("closed_lost", "失敗")}
              >
                <XCircle className="h-4 w-4" />
                標記失敗
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isMutating || draft.stage === "closed_won"}
                onClick={() => requestMarkStage("closed_won", "成交")}
              >
                <Trophy className="h-4 w-4" />
                標記成交
              </Button>
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
        {detail && draft ? (
          <LeadDetailEditor
            lead={detail}
            draft={draft}
            agents={agents}
            noteBody={noteBody}
            noteError={noteError}
            aiProfile={aiProfile}
            aiLoading={aiLoading}
            aiMutatingTagId={aiMutatingTagId}
            disabled={isMutating}
            onDraftChange={updateDraft}
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
      </AdminDetailPanel>
      {unsavedLeadDialog}
      {leadRouteLeaveGuard}
      <AdminConfirmDialog
        open={pendingStageAction !== null}
        title={`標記為${pendingStageAction?.label ?? ""}`}
        description="此 Lead 有其他未儲存的修改（預算、負責代理、備註或意圖），會一併儲存。確定要繼續嗎？"
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

function LeadRow({ lead, onOpen }: { lead: AdminLeadRow; onOpen: (id: string) => void }) {
  // `role="button"` on the whole `<tr>` used to replace its cell semantics, so a
  // screen reader announced only "開啟 X 詳情, button" and never the 意向/來源/
  // 預算/階段/opt-in cells. A real focusable control inside the Lead cell keeps
  // every column reachable by keyboard while still announcing per-column.
  return (
    <TableRow className="hover:bg-muted/40">
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
      <TableCell>
        {lead.opt_in_whatsapp ? (
          <Badge variant="secondary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Opt-in
          </Badge>
        ) : (
          <Badge variant="outline">未 Opt-in</Badge>
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
  aiMutatingTagId,
  disabled,
  noteSaving,
  onDraftChange,
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
  aiMutatingTagId: string | null;
  disabled: boolean;
  noteSaving: boolean;
  onDraftChange: <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) => void;
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
                <Badge variant="secondary">已 Opt-in</Badge>
              ) : (
                <Badge variant="outline">未 Opt-in</Badge>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Lead 欄位</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="階段">
            <AdminStatusSelect
              ariaLabel="Lead 階段"
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
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agentLabel(agent)}
                    {agent.active ? "" : "（停用）"}
                  </SelectItem>
                ))}
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

          <Field label="備註">
            <Textarea
              value={draft.note}
              rows={3}
              disabled={disabled}
              onChange={(event) => onDraftChange("note", event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" />
              AI Profile
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
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Score {aiProfile.profile.lead_score}</Badge>
              {aiProfile.profile.urgency ? (
                <Badge variant="outline">{formatAiUrgency(aiProfile.profile.urgency)}</Badge>
              ) : null}
              {aiProfile.profile.timeline ? (
                <Badge variant="outline">{formatAiTimeline(aiProfile.profile.timeline)}</Badge>
              ) : null}
            </div>
            {aiProfile.profile.summary ? (
              <p className="whitespace-pre-wrap">{aiProfile.profile.summary}</p>
            ) : null}
            {aiProfile.profile.next_best_action ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
                {aiProfile.profile.next_best_action}
              </p>
            ) : null}
          </div>
        ) : !aiLoading ? (
          <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            未有 AI profile
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
                      {formatAiTagStatus(tag.status)} · {Math.round(tag.confidence * 100)}%
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
                      disabled={disabled || aiMutatingTagId === tag.id}
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

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Activity / 跟進紀錄</h3>
          <Badge variant="outline">{lead.activities.length}</Badge>
        </div>

        <div className="mt-4 grid gap-3">
          <Textarea
            ref={noteInputRef}
            aria-label="新增跟進 note"
            aria-invalid={Boolean(noteError)}
            aria-describedby={noteError ? "note-error" : undefined}
            value={noteBody}
            rows={3}
            disabled={disabled}
            placeholder="新增內部跟進 note"
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
            {noteSaving ? "新增中…" : "新增跟進"}
          </Button>
        </div>

        <div className="mt-5 space-y-3">
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

function filterLeads(rows: AdminLeadRow[], filters: LeadFilters) {
  const query = filters.query.trim().toLowerCase();

  return rows.filter((lead) => {
    if (filters.stage !== "all" && lead.stage !== filters.stage) return false;
    if (filters.intent !== "all" && lead.intent !== filters.intent) return false;
    if (filters.source !== "all" && lead.source !== filters.source) return false;
    if (filters.optIn === "yes" && lead.opt_in_whatsapp !== true) return false;
    if (filters.optIn === "no" && lead.opt_in_whatsapp === true) return false;

    if (filters.agent_id !== "all") {
      if (filters.agent_id === "unassigned") {
        if (lead.assigned_agent_id !== null) return false;
      } else if (lead.assigned_agent_id !== filters.agent_id) {
        return false;
      }
    }

    if (!query) return true;

    return [
      lead.name,
      lead.phone,
      lead.email,
      lead.intent,
      lead.source,
      lead.note,
      lead.listing_no,
      lead.property_title,
      stageLabels[lead.stage],
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
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

function draftToInput(id: string, draft: LeadDraft): AdminLeadUpdateInput {
  return {
    id,
    stage: draft.stage,
    intent: draft.intent.trim() || "buyer",
    budget_min: draft.budget_min,
    budget_max: draft.budget_max,
    preferred_estates: parsePreferredEstates(draft.preferred_estates),
    assigned_agent_id: draft.assigned_agent_id,
    note: draft.note.trim() || null,
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
    note: "Note",
    call: "電話",
    viewing: "睇樓",
    follow_up: "跟進",
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
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
