import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Clock3, MessageCircle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  fetchAdminAgents,
  fetchAdminConversation,
  fetchAdminConversationAiAssist,
  fetchAdminConversations,
  fetchAdminWoztellStatus,
  sendAdminConversationReply,
  updateAdminConversation,
} from "@/lib/neon/admin-data";
import type {
  AdminAgentRow,
  AdminConversationAiAssist,
  AdminConversationDetail,
  AdminConversationMessageRow,
  AdminConversationRow,
} from "@/lib/neon/admin-data.types";

const conversationStatusOptions = [
  { value: "open", label: "開啟" },
  { value: "pending", label: "待跟進" },
  { value: "closed", label: "已關閉" },
];

const statusLabels: Record<string, string> = {
  open: "開啟",
  pending: "待跟進",
  closed: "已關閉",
};

const inboxStatusFilterOptions = [
  { value: "all", label: "所有狀態" },
  { value: "open", label: "開啟" },
  { value: "pending", label: "待跟進" },
  { value: "closed", label: "已關閉" },
];

const messageStatusLabels: Record<string, string> = {
  received: "已接收",
  sending: "傳送中",
  sent: "已送出",
  failed: "送出失敗",
};

const replyErrorLabels: Record<string, string> = {
  WOZTELL_DISABLED: "WhatsApp 發送目前暫停，請聯絡技術支援。",
  CONTACT_OPTED_OUT: "客戶已拒收 WhatsApp 訊息。",
  OUTSIDE_24_HOUR_WINDOW: "超過 24 小時回覆窗口",
  CONVERSATION_NOT_FOUND: "找不到 WhatsApp 對話",
  MISSING_WOZTELL_MEMBER_ID: "缺少 Woztell member ID",
};

// The open conversation and the inbox filters live in the URL, so a chat is
// shareable, survives reload, and can be linked to directly -- Command Center's
// 開啟 WhatsApp 對話 previously dropped the id and left the agent hunting through
// an unfiltered list. Only non-default values are written, so a plain
// /admin/whatsapp stays clean.
function parseWhatsappSearch(search: Record<string, unknown>) {
  const result: { conversation?: string; q?: string; status?: string } = {};
  if (typeof search.conversation === "string" && search.conversation.trim()) {
    result.conversation = search.conversation;
  }
  if (typeof search.q === "string" && search.q.trim()) result.q = search.q;
  if (typeof search.status === "string" && search.status !== "all") result.status = search.status;
  return result;
}

export const Route = createFileRoute("/admin/whatsapp")({
  validateSearch: parseWhatsappSearch,
  head: () => ({
    meta: [{ title: "WhatsApp Inbox｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminWhatsapp,
});

function AdminWhatsapp() {
  const { user } = useNeonAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const isDesktop = useDesktopBreakpoint();
  const [rows, setRows] = useState<AdminConversationRow[] | null>(null);
  const [agents, setAgents] = useState<AdminAgentRow[]>([]);
  const [woztellEnabled, setWoztellEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminConversationDetail | null>(null);
  const [aiAssist, setAiAssist] = useState<AdminConversationAiAssist | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Drafts are held per conversation. A single shared string meant clicking
  // another conversation to check a flat number silently destroyed a half-typed
  // reply, with no warning and no undo, under a 24-hour reply clock.
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [listUpdatedAt, setListUpdatedAt] = useState<number | null>(null);
  const [aiAssistLoading, setAiAssistLoading] = useState(false);
  const inboxQuery = search.q ?? "";
  const inboxStatus = search.status ?? "all";
  const [queryDraft, setQueryDraft] = useState(inboxQuery);

  const setWhatsappSearch = useCallback(
    (next: { conversation?: string; q?: string; status?: string }, replace = true) => {
      void navigate({
        search: (current) => ({ ...current, ...next }),
        replace,
        resetScroll: false,
      });
    },
    [navigate],
  );

  useEffect(() => {
    setQueryDraft(inboxQuery);
  }, [inboxQuery]);

  // Debounced: bound directly to the router, a Chinese IME loses characters
  // typed faster than the navigation commits.
  useEffect(() => {
    if (queryDraft === inboxQuery) return;
    const timer = window.setTimeout(
      () => setWhatsappSearch({ q: queryDraft.trim() || undefined }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [inboxQuery, queryDraft, setWhatsappSearch]);
  const [replyError, setReplyError] = useState<string | null>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const aiAssistRequestRef = useRef(0);
  const selectedIdRef = useRef<string | null>(null);

  const selectedRow = useMemo(
    () => rows?.find((conversation) => conversation.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const canApplyConversationDetail = useCallback((id: string) => {
    return selectedIdRef.current === id;
  }, []);

  const refreshConversations = useCallback(async () => {
    if (!user) return;

    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setLoadingRows(true);
    try {
      const data = await fetchAdminConversations();
      if (requestId !== listRequestRef.current) return;
      setRows(data as AdminConversationRow[]);
      setListUpdatedAt(Date.now());
      setError(null);
    } catch (err) {
      if (requestId !== listRequestRef.current) return;
      setError(errorText(err));
    } finally {
      if (requestId === listRequestRef.current) setLoadingRows(false);
    }
  }, [user]);

  const loadConversationAiAssist = useCallback(
    async (id: string) => {
      const requestId = aiAssistRequestRef.current + 1;
      aiAssistRequestRef.current = requestId;
      setAiAssist(null);
      // Without this, a pending fetch and an outright failure both rendered the
      // same 「未有 AI assist。」, so staff could not tell "wait" from "broken".
      setAiAssistLoading(true);

      try {
        const assist = await fetchAdminConversationAiAssist({ data: { conversationId: id } });
        if (requestId !== aiAssistRequestRef.current || !canApplyConversationDetail(id)) return;
        setAiAssist(assist as AdminConversationAiAssist);
      } catch {
        if (requestId !== aiAssistRequestRef.current || !canApplyConversationDetail(id)) return;
        setAiAssist(null);
      } finally {
        if (requestId === aiAssistRequestRef.current && canApplyConversationDetail(id)) {
          setAiAssistLoading(false);
        }
      }
    },
    [canApplyConversationDetail],
  );

  const loadConversationDetail = useCallback(
    async (
      id: string,
      options: { resetReply?: boolean; background?: boolean; silent?: boolean } = {},
    ) => {
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      // A background poll must not flip the pane into its loading state or wipe
      // the visible thread -- the agent may be mid-sentence in the composer.
      if (!options.background) {
        setDetailLoading(true);
        setDetailError(null);
      }

      try {
        const data = await fetchAdminConversation({ data: { id } });
        if (requestId !== detailRequestRef.current || !canApplyConversationDetail(id)) return null;
        if (!data) throw new Error("找不到 WhatsApp 對話");

        const conversation = data as AdminConversationDetail;
        setDetail(conversation);
        setDetailError(null);
        loadConversationAiAssist(id);
        if (options.resetReply) {
          setReplyDrafts((current) => ({ ...current, [id]: "" }));
        }
        return conversation;
      } catch (err) {
        if (requestId !== detailRequestRef.current || !canApplyConversationDetail(id)) return null;
        // A failed background poll must not blank a thread the agent is reading.
        if (options.background) return null;

        const message = errorText(err);
        setDetail(null);
        setDetailError(message);
        if (!options.silent) toast.error(message);
        return null;
      } finally {
        if (
          !options.background &&
          requestId === detailRequestRef.current &&
          canApplyConversationDetail(id)
        ) {
          setDetailLoading(false);
        }
      }
    },
    [canApplyConversationDetail, loadConversationAiAssist],
  );

  useEffect(() => {
    if (!user) return;
    refreshConversations();
  }, [refreshConversations, user]);

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

    fetchAdminWoztellStatus()
      .then((data) => {
        if (!cancelled) setWoztellEnabled(Boolean(data?.woztellEnabled));
      })
      .catch((err) => {
        if (!cancelled) {
          setWoztellEnabled(null);
          setError(errorText(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    loadConversationDetail(selectedId, { resetReply: true });
  }, [loadConversationDetail, selectedId]);

  useEffect(() => {
    if (isDesktop) setPanelOpen(false);
  }, [isDesktop]);

  // Opens a `?conversation=` arriving from the URL -- a shared link, a reload,
  // or Command Center's 開啟 WhatsApp 對話.
  useEffect(() => {
    const requested = search.conversation;
    if (!requested || requested === selectedIdRef.current) return;
    selectedIdRef.current = requested;
    setSelectedId(requested);
    if (!isDesktop) setPanelOpen(true);
  }, [isDesktop, search.conversation]);

  // The inbox never auto-refreshed and an open conversation was never refetched
  // at all: new customer messages simply never appeared while an agent read the
  // thread, and 重新整理 only updated the left-hand list. On a page whose entire
  // premise is a 24-hour reply window, that gap is the whole product.
  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshConversations();
      const openId = selectedIdRef.current;
      if (openId) void loadConversationDetail(openId, { background: true });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadConversationDetail, refreshConversations, user]);

  function openConversation(id: string) {
    if (selectedIdRef.current !== id) {
      selectedIdRef.current = id;
      clearConversationDetail(true);
      setSelectedId(id);
      setWhatsappSearch({ conversation: id });
    }
    if (!isDesktop) setPanelOpen(true);
  }

  function clearConversationDetail(loading = false) {
    detailRequestRef.current += 1;
    aiAssistRequestRef.current += 1;
    setDetail(null);
    setAiAssist(null);
    setAiAssistLoading(false);
    setDetailError(null);
    setDetailLoading(loading);
    setReplyError(null);
    setMutatingAction(null);
    // replyDrafts is deliberately untouched -- switching away and back must
    // restore what the agent had typed.
  }

  function clearSelectedConversation() {
    selectedIdRef.current = null;
    setSelectedId(null);
    clearConversationDetail();
    setWhatsappSearch({ conversation: undefined });
  }

  function handlePanelOpenChange(open: boolean) {
    setPanelOpen(open);
    if (!open && !isDesktop) clearSelectedConversation();
  }

  async function saveConversationUpdate(input: {
    status: string;
    assigned_agent_id: string | null;
  }) {
    if (!detail || detail.id !== selectedIdRef.current) return;

    const targetId = detail.id;
    setMutatingAction("conversation");
    try {
      const result = await updateAdminConversation({
        data: {
          id: targetId,
          status: input.status,
          assigned_agent_id: input.assigned_agent_id,
        },
      });
      assertNoMutationError(result);
      const refreshedRows = (await fetchAdminConversations()) as AdminConversationRow[];
      setRows(refreshedRows);
      setListUpdatedAt(Date.now());
      if (!canApplyConversationDetail(targetId)) return;

      // Handing a conversation to another agent moves it out of this inbox, so
      // the follow-up detail read 404s. That used to run through the error path
      // and answer a successful handoff with a red 「找不到 WhatsApp 對話」 and a
      // blank pane, so the agent reassigned again or escalated to support.
      if (!refreshedRows.some((row) => row.id === targetId)) {
        toast.success("對話已轉交，並已移出你的收件匣");
        clearSelectedConversation();
        return;
      }

      const refreshed = await loadConversationDetail(targetId);
      if (refreshed && canApplyConversationDetail(targetId)) toast.success("對話已更新");
    } catch (err) {
      if (canApplyConversationDetail(targetId)) toast.error(errorText(err));
    } finally {
      if (canApplyConversationDetail(targetId)) setMutatingAction(null);
    }
  }

  async function sendReply() {
    if (!detail || detail.id !== selectedIdRef.current) {
      toast.error("請先選擇對話");
      return;
    }

    const availability = replyAvailability(detail, woztellEnabled);
    if (availability.reason) {
      toast.error(availability.reason);
      return;
    }

    const text = replyBody.trim();
    if (!text) {
      toast.error("請輸入回覆內容");
      return;
    }

    const targetId = detail.id;
    setMutatingAction("reply");
    setReplyError(null);
    try {
      const result = await sendAdminConversationReply({
        data: {
          conversationId: targetId,
          text,
        },
      });
      assertNoMutationError(result);
      setReplyDrafts((current) => ({ ...current, [targetId]: "" }));
      await refreshConversations();
      if (!canApplyConversationDetail(targetId)) return;

      const refreshed = await loadConversationDetail(targetId);
      if (refreshed && canApplyConversationDetail(targetId)) toast.success("回覆已送出");
    } catch (err) {
      if (!canApplyConversationDetail(targetId)) return;
      const message = formatReplyError(errorText(err));
      // The send is persisted as a failed message server-side, but the timeline
      // was never refetched on this path -- so the pane still showed the
      // pre-send state and a toast that vanished in ~4s was the only trace. The
      // draft is deliberately kept so the agent can retry without retyping.
      setReplyError(message);
      toast.error(message);
      await refreshConversations();
      await loadConversationDetail(targetId, { background: true });
    } finally {
      if (canApplyConversationDetail(targetId)) setMutatingAction(null);
    }
  }

  const isMutating = mutatingAction !== null;
  // The inbox had no search and no status filter at all -- the toolbar's filter
  // slot held two static badges -- so finding a conversation meant scrolling a
  // silently-capped list of 100.
  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const needle = inboxQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (inboxStatus !== "all" && row.status !== inboxStatus) return false;
      if (!needle) return true;
      return [row.name, row.phone, row.last_text].some((value) =>
        (value ?? "").toLowerCase().includes(needle),
      );
    });
  }, [inboxQuery, inboxStatus, rows]);
  const hasInboxFilters = inboxQuery.trim() !== "" || inboxStatus !== "all";

  const replyBody = selectedId ? (replyDrafts[selectedId] ?? "") : "";
  const setReplyBody = useCallback((value: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    setReplyDrafts((current) => ({ ...current, [id]: value }));
  }, []);
  const panelTitle = selectedRow?.name ?? detail?.name ?? selectedRow?.phone ?? "WhatsApp 對話";
  const panelDescription = selectedRow
    ? `${statusLabel(selectedRow.status)} · ${formatDate(selectedRow.last_message_at)}`
    : "查看訊息紀錄、更新負責代理並回覆客戶。";

  return (
    <AdminShell
      title="WhatsApp Inbox"
      description="集中處理 Woztell 收件匣、客服狀態及 24 小時服務窗口內的回覆。"
    >
      <AdminToolbar
        filters={
          <>
            <Input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="搜尋姓名、電話或訊息"
              aria-label="搜尋 WhatsApp 對話"
              className="h-11 w-full sm:w-56 lg:h-9"
            />
            <AdminStatusSelect
              ariaLabel="按對話狀態篩選"
              value={inboxStatus}
              options={inboxStatusFilterOptions}
              onChange={(value) =>
                setWhatsappSearch({ status: value === "all" ? undefined : value })
              }
            />
            <Badge variant="outline" className="h-11 gap-1.5 px-3 lg:h-9">
              <Clock3 className="h-3.5 w-3.5" />
              24 小時回覆窗口
            </Badge>
            {/* Staff-facing wording: this used to read "WOZTELL_ENABLED: false",
                which tells a non-technical agent neither what is wrong nor what
                to do. The variable name stays in the title for support. */}
            <Badge
              variant={
                woztellEnabled ? "secondary" : woztellEnabled === false ? "destructive" : "outline"
              }
              className="h-11 px-3 lg:h-9"
              title="WOZTELL_ENABLED"
            >
              WhatsApp 發送：
              {woztellEnabled === null
                ? "檢查中"
                : woztellEnabled
                  ? "可用"
                  : "暫停（請聯絡技術支援）"}
            </Badge>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {listUpdatedAt ? (
              <span className="text-xs text-muted-foreground">
                最後更新 {formatClock(listUpdatedAt)}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 lg:h-9"
              disabled={loadingRows}
              // Refreshing only the list left the open conversation frozen, so
              // an agent could stare at a stale thread and answer a question the
              // customer had already followed up on.
              onClick={() => {
                void refreshConversations();
                const openId = selectedIdRef.current;
                if (openId) void loadConversationDetail(openId, { background: true });
              }}
            >
              <RefreshCw className={loadingRows ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              重新整理
            </Button>
          </div>
        }
      />

      {error ? <AdminError message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <Card>
          <CardContent className="p-0">
            <ConversationList
              rows={filteredRows}
              totalLoaded={rows?.length ?? 0}
              hasFilters={hasInboxFilters}
              onClearFilters={() => {
                setQueryDraft("");
                setWhatsappSearch({ q: undefined, status: undefined });
              }}
              selectedId={selectedId}
              loading={loadingRows}
              onOpen={openConversation}
            />
          </CardContent>
        </Card>

        <Card className="hidden lg:block">
          <CardContent className="p-0">
            <ConversationWorkspace
              detail={detail}
              agents={agents}
              loading={detailLoading}
              error={detailError}
              replyBody={replyBody}
              aiAssistLoading={aiAssistLoading}
              replyError={replyError}
              aiAssist={aiAssist}
              woztellEnabled={woztellEnabled}
              disabled={isMutating}
              savingConversation={mutatingAction === "conversation"}
              sendingReply={mutatingAction === "reply"}
              onReplyBodyChange={setReplyBody}
              onSendReply={sendReply}
              onStatusChange={(status) =>
                detail
                  ? saveConversationUpdate({
                      status,
                      assigned_agent_id: detail.assigned_agent_id,
                    })
                  : undefined
              }
              onAgentChange={(assignedAgentId) =>
                detail
                  ? saveConversationUpdate({
                      status: detail.status,
                      assigned_agent_id: assignedAgentId,
                    })
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      <AdminDetailPanel
        open={!isDesktop && panelOpen}
        title={panelTitle}
        description={panelDescription}
        onOpenChange={handlePanelOpenChange}
      >
        <ConversationWorkspace
          detail={detail}
          agents={agents}
          loading={detailLoading}
          error={detailError}
          replyBody={replyBody}
          aiAssistLoading={aiAssistLoading}
          replyError={replyError}
          aiAssist={aiAssist}
          woztellEnabled={woztellEnabled}
          disabled={isMutating}
          savingConversation={mutatingAction === "conversation"}
          sendingReply={mutatingAction === "reply"}
          onReplyBodyChange={setReplyBody}
          onSendReply={sendReply}
          onStatusChange={(status) =>
            detail
              ? saveConversationUpdate({
                  status,
                  assigned_agent_id: detail.assigned_agent_id,
                })
              : undefined
          }
          onAgentChange={(assignedAgentId) =>
            detail
              ? saveConversationUpdate({
                  status: detail.status,
                  assigned_agent_id: assignedAgentId,
                })
              : undefined
          }
        />
      </AdminDetailPanel>
    </AdminShell>
  );
}

const INBOX_ROW_LIMIT = 100;

function ConversationList({
  rows,
  totalLoaded,
  hasFilters,
  onClearFilters,
  selectedId,
  loading,
  onOpen,
}: {
  rows: AdminConversationRow[] | null;
  totalLoaded: number;
  hasFilters: boolean;
  onClearFilters: () => void;
  selectedId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (!rows && loading) return <Skeleton className="h-72 w-full rounded-none" />;
  if (!rows || rows.length === 0) {
    return (
      <div className="p-4">
        <AdminEmptyState
          title={hasFilters ? "沒有符合條件的對話" : "未有 WhatsApp 對話"}
          description={
            hasFilters
              ? "請調整搜尋字詞或狀態篩選。留意收件匣只載入最近 100 個對話。"
              : "Woztell webhook 收到客戶訊息後會在這裡建立對話。"
          }
          action={
            hasFilters ? (
              <Button type="button" variant="outline" onClick={onClearFilters}>
                清除篩選
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="divide-y">
      {/* The inbox silently capped at 100 with no count anywhere, so a busy day
          looked identical to a quiet one and older conversations simply did not
          exist as far as the UI was concerned. */}
      <p className="px-4 py-2 text-xs text-muted-foreground">
        顯示 {rows.length} 個對話
        {hasFilters ? `（已載入 ${totalLoaded} 個）` : ""}
        {totalLoaded >= INBOX_ROW_LIMIT ? `，收件匣上限為最近 ${INBOX_ROW_LIMIT} 個` : ""}
      </p>
      {rows.map((conversation) => (
        <button
          key={conversation.id}
          type="button"
          className={[
            "grid w-full gap-2 px-4 py-3 text-left transition hover:bg-muted/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            selectedId === conversation.id ? "bg-muted/70" : "",
          ].join(" ")}
          aria-current={selectedId === conversation.id ? "true" : undefined}
          onClick={() => onOpen(conversation.id)}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {conversation.name ?? "WhatsApp 客戶"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {conversation.phone ?? "未有電話"}
              </span>
            </span>
            <StatusBadge status={conversation.status} />
          </span>

          <span className="line-clamp-2 text-sm text-muted-foreground">
            {conversation.last_text ?? "未有訊息內容"}
          </span>

          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{formatDirection(conversation.last_direction)}</Badge>
            {conversation.opted_out_whatsapp ? (
              <Badge variant="destructive">已拒收</Badge>
            ) : (
              <Badge variant="secondary">可聯絡</Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDate(conversation.last_message_at)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ConversationWorkspace({
  detail,
  agents,
  loading,
  error,
  replyBody,
  aiAssistLoading,
  replyError,
  aiAssist,
  woztellEnabled,
  disabled,
  savingConversation,
  sendingReply,
  onReplyBodyChange,
  onSendReply,
  onStatusChange,
  onAgentChange,
}: {
  detail: AdminConversationDetail | null;
  agents: AdminAgentRow[];
  loading: boolean;
  error: string | null;
  replyBody: string;
  aiAssistLoading: boolean;
  replyError: string | null;
  aiAssist: AdminConversationAiAssist | null;
  woztellEnabled: boolean | null;
  disabled: boolean;
  savingConversation: boolean;
  sendingReply: boolean;
  onReplyBodyChange: (value: string) => void;
  onSendReply: () => void;
  onStatusChange: (status: string) => void;
  onAgentChange: (assignedAgentId: string | null) => void;
}) {
  if (loading && !detail) return <Skeleton className="h-[32rem] w-full rounded-none" />;
  if (error)
    return (
      <div className="p-4">
        <AdminError message={error} />
      </div>
    );
  if (!detail) {
    return (
      <div className="p-4">
        <AdminEmptyState
          title="選擇 WhatsApp 對話"
          description="在左邊收件匣選擇客戶後，可查看訊息、更新狀態及回覆。"
        />
      </div>
    );
  }

  const availability = replyAvailability(detail, woztellEnabled);
  const canSendReply = !disabled && !availability.reason && Boolean(replyBody.trim());
  const windowRemaining = replyWindowRemaining(detail.last_inbound_at);

  return (
    <div className="flex min-h-[32rem] flex-col">
      <header className="border-b p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{detail.name ?? "WhatsApp 客戶"}</h2>
              <StatusBadge status={detail.status} />
              {detail.opted_out_whatsapp ? <Badge variant="destructive">已拒收</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{detail.phone ?? "未有電話"}</p>
          </div>
          <div className="text-sm text-muted-foreground">
            客戶最後來訊：{formatDate(detail.last_inbound_at)}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="對話狀態">
            <AdminStatusSelect
              ariaLabel="WhatsApp 對話狀態"
              value={detail.status}
              options={statusOptionsFor(detail.status)}
              disabled={disabled}
              onChange={onStatusChange}
            />
          </Field>
          <Field label="負責代理">
            <Select
              value={detail.assigned_agent_id ?? "none"}
              disabled={disabled}
              onValueChange={(value) => onAgentChange(value === "none" ? null : value)}
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
        </div>
        {savingConversation ? (
          <p className="mt-3 text-xs text-muted-foreground">正在儲存對話設定…</p>
        ) : null}
      </header>

      <MessageTimeline messages={detail.messages} />

      <footer className="border-t p-4">
        <AiAssistPanel
          aiAssist={aiAssist}
          loading={aiAssistLoading}
          onUseSuggestedReply={(value) => {
            if (replyBody.trim() && !window.confirm("將會覆蓋你已輸入的回覆內容，確定繼續？")) {
              return;
            }
            onReplyBodyChange(value);
          }}
        />
        <div
          className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          title="WOZTELL_ENABLED"
        >
          回覆只可在客戶最後一次來訊後 24 小時內發送。
          {windowRemaining ? <span className="block">{windowRemaining}</span> : null}
          {availability.reason ? (
            <span className="block font-medium text-destructive">{availability.reason}</span>
          ) : null}
        </div>
        {replyError ? (
          <p
            role="alert"
            className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {replyError}
          </p>
        ) : null}
        <div className="grid gap-3">
          <Textarea
            id="whatsapp-reply"
            aria-label="WhatsApp 回覆"
            rows={4}
            value={replyBody}
            // Only the send itself disables the composer. Disabling on any
            // in-flight mutation meant changing 負責代理 froze the textarea the
            // agent was typing in.
            disabled={sendingReply || Boolean(availability.reason)}
            maxLength={REPLY_MAX_LENGTH}
            aria-describedby="whatsapp-reply-count"
            placeholder="輸入回覆內容"
            onChange={(event) => onReplyBodyChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              id="whatsapp-reply-count"
              className={[
                "text-xs tabular-nums",
                replyBody.length >= REPLY_MAX_LENGTH ? "text-destructive" : "text-muted-foreground",
              ].join(" ")}
            >
              {replyBody.length} / {REPLY_MAX_LENGTH}
            </span>
            <Button type="button" disabled={!canSendReply || sendingReply} onClick={onSendReply}>
              <Send className="h-4 w-4" />
              {sendingReply ? "回覆中…" : "回覆"}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function AiAssistPanel({
  aiAssist,
  loading,
  onUseSuggestedReply,
}: {
  aiAssist: AdminConversationAiAssist | null;
  loading: boolean;
  onUseSuggestedReply: (value: string) => void;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="space-y-2 p-4">
        <p className="font-medium">AI 助手</p>
        {aiAssist ? (
          <>
            <p className="text-sm">{aiAssist.summary}</p>
            <p className="text-xs text-muted-foreground">
              意圖：{intentLabel(aiAssist.detectedIntent)} · 緊急程度：
              {urgencyLabel(aiAssist.urgency)}
            </p>
            {aiAssist.handoffNote ? (
              <p className="text-xs text-muted-foreground">{aiAssist.handoffNote}</p>
            ) : null}
            {aiAssist.suggestedReply ? (
              <Button
                // Confirms before replacing a draft: this used to overwrite
                // whatever the agent had already typed, with no undo.
                onClick={() => onUseSuggestedReply(aiAssist.suggestedReply ?? "")}
                type="button"
                variant="outline"
              >
                套用建議回覆
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading ? "正在產生 AI 建議…" : "此對話暫時未有 AI 建議。"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MessageTimeline({ messages }: { messages: AdminConversationMessageRow[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastId = messages.at(-1)?.id ?? null;

  // The pane opened at the top of the history, so on any conversation with more
  // than a screenful the agent had to scroll down to find the message they were
  // answering. Keyed on the newest id so a poll that adds a message also scrolls.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {messages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          未有訊息紀錄
        </div>
      ) : (
        <div className="space-y-3">
          {/* The server returns the most recent 100 messages and drops the rest
              silently, so a long-running conversation looked like it began
              mid-sentence. */}
          {messages.length >= MESSAGE_HISTORY_LIMIT ? (
            <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">
              只顯示最近 {MESSAGE_HISTORY_LIMIT} 則訊息，較早的紀錄未有載入。
            </p>
          ) : null}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={endRef} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: AdminConversationMessageRow }) {
  const outbound = message.direction === "outbound";
  const failed = message.status === "failed";

  // A failed send used to differ from a delivered one by `font-semibold` alone:
  // same bubble colour, same size, no icon. On the surface that decides whether
  // a customer was actually answered, that is invisible. It now gets the
  // destructive palette, an icon, and role="alert".
  return (
    <article className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        role={failed ? "alert" : undefined}
        className={[
          "max-w-[86%] rounded-lg border px-3 py-2 text-sm shadow-sm",
          failed
            ? "border-destructive bg-destructive/10 text-foreground"
            : outbound
              ? "bg-primary text-primary-foreground"
              : "bg-background",
        ].join(" ")}
      >
        {/* opacity-80 on primary composited to ~4.05:1, under the 4.5:1 floor,
            and this row is exactly where send status lives. */}
        <div
          className={[
            "mb-1 flex flex-wrap items-center gap-2 text-xs",
            failed
              ? "text-destructive"
              : outbound
                ? "text-primary-foreground"
                : "text-muted-foreground",
          ].join(" ")}
        >
          {failed ? (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{formatDirection(message.direction)}</span>
          <span>{formatDate(message.created_at)}</span>
          <span className={failed ? "font-semibold" : message.status === "sending" ? "italic" : ""}>
            {messageStatusLabel(message.status)}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words">{message.text ?? "（非文字訊息）"}</p>
        {message.error ? (
          <p
            className={[
              "mt-2 text-xs",
              failed ? "font-medium text-destructive" : "text-muted-foreground",
            ].join(" ")}
            title={message.error}
          >
            {providerErrorText(message.error)}
          </p>
        ) : null}
      </div>
    </article>
  );
}

// Provider failure codes reach the bubble verbatim. Staff cannot act on
// WOZTELL_DELIVERY_UNKNOWN; the raw code stays in `title` for support.
const PROVIDER_ERROR_LABELS: Record<string, string> = {
  WOZTELL_DELIVERY_UNKNOWN: "發送失敗（供應商未回覆結果），請稍後重試。",
  WOZTELL_CONFIGURATION_UNAVAILABLE: "WhatsApp 尚未設定完成，請聯絡技術支援。",
  WOZTELL_RECIPIENT_MISSING: "此客戶沒有可用的 WhatsApp 號碼。",
  CONTACT_OPTED_OUT: "客戶已拒收訊息。",
  OUTSIDE_24_HOUR_WINDOW: "已超過 24 小時回覆窗口。",
};

function providerErrorText(error: string) {
  return PROVIDER_ERROR_LABELS[error] ?? `發送失敗：${error}`;
}

const REPLY_MAX_LENGTH = 1000;
const MESSAGE_HISTORY_LIMIT = 100;

const AI_INTENT_LABELS: Record<string, string> = {
  buyer: "買家",
  tenant: "租客",
  seller: "業主放售",
  landlord: "業主放租",
  viewing: "睇樓",
  valuation: "估價",
  unknown: "未能判斷",
};

const AI_URGENCY_LABELS: Record<string, string> = {
  urgent: "緊急",
  high: "高",
  normal: "一般",
  low: "低",
};

function intentLabel(intent: string | null | undefined) {
  if (!intent) return "未能判斷";
  return AI_INTENT_LABELS[intent] ?? intent;
}

function urgencyLabel(urgency: string | null | undefined) {
  if (!urgency) return "一般";
  return AI_URGENCY_LABELS[urgency] ?? urgency;
}

/** How much of the 24-hour reply window is left. It was computed once at render
 * and never shown, so agents had no way to see the clock they were racing. */
function replyWindowRemaining(lastInboundAt: string | null) {
  if (!lastInboundAt) return null;
  const inbound = new Date(lastInboundAt).getTime();
  if (Number.isNaN(inbound)) return null;
  const remaining = inbound + 24 * 60 * 60 * 1000 - Date.now();
  if (remaining <= 0) return "回覆窗口已結束，只能使用已審批範本聯絡客戶。";
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  return `距離窗口結束尚餘 ${hours} 小時 ${minutes} 分鐘。`;
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat("zh-HK", { timeStyle: "short" }).format(new Date(timestamp));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "open" ? "default" : status === "closed" ? "outline" : "secondary"}>
      {statusLabel(status)}
    </Badge>
  );
}

function statusOptionsFor(status: string) {
  if (conversationStatusOptions.some((option) => option.value === status)) {
    return conversationStatusOptions;
  }
  return [{ value: status, label: statusLabel(status) }, ...conversationStatusOptions];
}

function replyAvailability(
  detail: AdminConversationDetail,
  woztellEnabled: boolean | null,
): { reason: string | null } {
  if (woztellEnabled === null) return { reason: "正在確認 WOZTELL_ENABLED" };
  if (!woztellEnabled) return { reason: "WOZTELL_ENABLED 未啟用" };
  if (detail.opted_out_whatsapp) return { reason: "客戶已 Opt-out WhatsApp" };
  if (!detail.woztell_member_id) return { reason: "缺少 Woztell member ID" };
  if (!isWithin24Hours(detail.last_inbound_at)) return { reason: "超過 24 小時回覆窗口" };
  return { reason: null };
}

function isWithin24Hours(value: string | null) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= 24 * 60 * 60 * 1000;
}

function useDesktopBreakpoint() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

function messageStatusLabel(status: string) {
  return messageStatusLabels[status] ?? status;
}

function formatDirection(direction: string | null) {
  if (direction === "inbound") return "客戶";
  if (direction === "outbound") return "客服";
  return "未有方向";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function agentLabel(agent: AdminAgentRow) {
  return agent.name ?? agent.email ?? "未命名代理";
}

function formatReplyError(value: string) {
  return replyErrorLabels[value] ?? value;
}

function assertNoMutationError(result: unknown) {
  if (!result || typeof result !== "object") return;
  const maybeError = (result as { error?: unknown }).error;
  if (maybeError) throw new Error(formatReplyError(String(maybeError)));
  if ((result as { ok?: unknown }).ok === false) throw new Error("操作失敗");
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
