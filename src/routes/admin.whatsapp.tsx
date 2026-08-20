import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Clock3, History, MessageCircle, RefreshCw, Send } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  clearContactWhatsappOptOut,
  fetchAdminAgents,
  fetchAdminConversation,
  fetchAdminConversationAiAssist,
  fetchAdminConversations,
  fetchAdminWhatsappTemplates,
  fetchAdminWoztellStatus,
  runAdminWoztellBackfill,
  sendAdminConversationReply,
  sendAdminConversationTemplate,
  updateAdminConversation,
} from "@/lib/neon/admin-data";
import { canReplyToConversation, conversationAttention } from "@/lib/neon/admin-workflow";
import { describeTemplateParameters } from "@/lib/woztell/template-preview";
import type {
  AdminAgentRow,
  AdminConversationAiAssist,
  AdminConversationDetail,
  AdminConversationMessageRow,
  AdminConversationRow,
  AdminWhatsappTemplateRow,
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
  // Not a stored status -- derived from who spoke last. Listed first because it
  // is the only entry that answers "what do I have to do now".
  { value: "awaiting", label: "待回覆" },
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
  MISSING_WOZTELL_MEMBER_ID: "此客戶尚未連接 WhatsApp 帳戶，請聯絡技術支援。",
  TEMPLATE_NOT_FOUND: "找不到此範本，可能已被停用，請重新整理後再試。",
  MESSAGE_CREATE_FAILED: "訊息未能建立，請再試一次。",
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
  const [templates, setTemplates] = useState<AdminWhatsappTemplateRow[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [woztellEnabled, setWoztellEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminConversationDetail | null>(null);
  const [aiAssist, setAiAssist] = useState<AdminConversationAiAssist | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  // Drafts are held per conversation. A single shared string meant clicking
  // another conversation to check a flat number silently destroyed a half-typed
  // reply, with no warning and no undo, under a 24-hour reply clock.
  //
  // Persisted to sessionStorage rather than guarded with useRouteLeaveGuard:
  // selecting a conversation is a same-route navigate, so treating a draft as
  // "dirty" would pop 尚未儲存 on every single conversation click. Persistence
  // gives the agent their text back after a reload or a trip to another admin
  // page, with no prompt at all. sessionStorage (not local) so the draft dies
  // with the tab rather than lingering on a shared office machine.
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  // Load this user's drafts once their identity is known, and re-load if the
  // signed-in user changes -- never carry one agent's drafts into another's
  // session.
  const staffUserId = user?.id ?? null;
  useEffect(() => {
    setReplyDrafts(readStoredReplyDrafts(staffUserId));
  }, [staffUserId]);

  useEffect(() => {
    writeStoredReplyDrafts(replyDrafts, staffUserId);
  }, [replyDrafts, staffUserId]);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  // Clearing an opt-out re-enables marketing messages to a real person, so it
  // is confirmed and reason-tagged rather than a bare button.
  const [clearOptOutOpen, setClearOptOutOpen] = useState(false);
  const [clearOptOutReason, setClearOptOutReason] = useState("");
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
    async (id: string, options: { background?: boolean } = {}) => {
      const requestId = aiAssistRequestRef.current + 1;
      aiAssistRequestRef.current = requestId;
      // A background refresh must leave the current card on screen. The 30s poll
      // called this unconditionally, so the AI assist panel blanked to a
      // skeleton every tick while an agent was reading it.
      if (!options.background) {
        setAiAssist(null);
        // Without this, a pending fetch and an outright failure both rendered the
        // same 「未有 AI assist。」, so staff could not tell "wait" from "broken".
        setAiAssistLoading(true);
      }

      try {
        const assist = await fetchAdminConversationAiAssist({ data: { conversationId: id } });
        if (requestId !== aiAssistRequestRef.current || !canApplyConversationDetail(id)) return;
        setAiAssist(assist as AdminConversationAiAssist);
      } catch {
        if (requestId !== aiAssistRequestRef.current || !canApplyConversationDetail(id)) return;
        // Keep the last good card rather than blanking it on a transient poll error.
        if (!options.background) setAiAssist(null);
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
        loadConversationAiAssist(id, { background: options.background });
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

    // Not fatal if this fails or comes back empty -- TemplateSendPanel already
    // has its own "no templates configured" state, so a failed fetch just
    // falls back to that same message instead of blocking the inbox.
    fetchAdminWhatsappTemplates()
      .then((data) => {
        if (!cancelled) setTemplates(data as AdminWhatsappTemplateRow[]);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
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

      // Claim the list request slot before refetching. This fetch ran outside
      // listRequestRef entirely, so a 30s background poll started earlier could
      // resolve afterwards and overwrite the freshly-saved row with its stale
      // copy -- the agent's status or assignment change silently reverted on
      // screen while the database held the new value.
      // Claiming the slot also means owning the loading flag: refreshConversations
      // sets loadingRows(true) and only clears it when its own request id is
      // still current, so bumping the ref from outside left an in-flight refresh
      // unable to clear it -- the inbox sat in its skeleton state with 重新整理
      // disabled until a full reload.
      const listRequestId = listRequestRef.current + 1;
      listRequestRef.current = listRequestId;
      setLoadingRows(true);
      let refreshedRows: AdminConversationRow[] = [];
      try {
        refreshedRows = (await fetchAdminConversations()) as AdminConversationRow[];
        if (listRequestId === listRequestRef.current) {
          setRows(refreshedRows);
          setListUpdatedAt(Date.now());
        }
      } finally {
        if (listRequestId === listRequestRef.current) setLoadingRows(false);
      }
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

  async function confirmClearOptOut() {
    const contactId = detail?.contact_id;
    const targetId = detail?.id;
    if (!contactId || !targetId) {
      toast.error("此對話未連結客戶記錄");
      return;
    }

    const reason = clearOptOutReason.trim();
    if (!reason) {
      toast.error("請填寫解除原因");
      return;
    }

    setMutatingAction("optout");
    try {
      const result = (await clearContactWhatsappOptOut({
        data: { contactId, reason },
      })) as { ok: boolean; error?: string };

      if (!result.ok) {
        toast.error(
          result.error === "NOT_OPTED_OUT" ? "此客戶並未拒收 WhatsApp" : "解除失敗，請重試",
        );
        return;
      }

      setClearOptOutOpen(false);
      setClearOptOutReason("");
      const refreshed = await loadConversationDetail(targetId);
      if (refreshed && canApplyConversationDetail(targetId)) toast.success("已解除拒收狀態");
    } catch (err) {
      toast.error(errorText(err));
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

  // Deliberately does not call replyAvailability -- an approved template is
  // exactly the WhatsApp-compliant way to message a customer once the 24-hour
  // window (which replyAvailability guards) has closed, so gating this on the
  // same check would defeat the point of offering it.
  async function sendTemplate(templateId: string) {
    if (!detail || detail.id !== selectedIdRef.current) {
      toast.error("請先選擇對話");
      return;
    }

    const targetId = detail.id;
    setMutatingAction("template");
    setReplyError(null);
    try {
      const result = await sendAdminConversationTemplate({
        data: { conversationId: targetId, templateId },
      });
      assertNoMutationError(result);
      await refreshConversations();
      if (!canApplyConversationDetail(targetId)) return;

      const refreshed = await loadConversationDetail(targetId);
      if (refreshed && canApplyConversationDetail(targetId)) toast.success("範本已送出");
    } catch (err) {
      if (!canApplyConversationDetail(targetId)) return;
      const message = formatReplyError(errorText(err));
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
      if (inboxStatus === "awaiting") {
        if (
          !conversationAttention({
            lastDirection: row.last_direction,
            lastInboundAt: row.last_inbound_at,
          }).awaitingReply
        ) {
          return false;
        }
      } else if (inboxStatus !== "all" && row.status !== inboxStatus) {
        return false;
      }
      if (!needle) return true;
      return [row.name, row.phone, row.last_text].some((value) =>
        (value ?? "").toLowerCase().includes(needle),
      );
    });
  }, [inboxQuery, inboxStatus, rows]);
  const hasInboxFilters = inboxQuery.trim() !== "" || inboxStatus !== "all";

  // Counted over every loaded conversation rather than the filtered view: this
  // is the number staff use to decide what to look at, so it must not change
  // when they narrow the list to look at something else.
  const awaitingCount = useMemo(
    () =>
      (rows ?? []).filter(
        (row) =>
          conversationAttention({
            lastDirection: row.last_direction,
            lastInboundAt: row.last_inbound_at,
          }).awaitingReply,
      ).length,
    [rows],
  );

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

  /**
   * Pull history that predates the webhook into the inbox.
   *
   * Loops here rather than asking the server for everything at once: one run is
   * capped so it finishes inside the platform's function timeout and hands back
   * a cursor, so draining a long history is the client's job. Bounded at 20
   * calls (up to ~20,000 messages) so a runaway cursor cannot spin forever --
   * if that bound is hit the toast says so and the button can simply be pressed
   * again, since every run is idempotent.
   */
  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    const toastId = toast.loading("正在從 Woztell 匯入歷史訊息…");

    // Walk one direction to exhaustion. Returns `failed` instead of throwing so
    // the caller can decide whether a zero-row result is worth a second attempt.
    const drain = async (mode: "forward" | "backward") => {
      let cursor: string | null = null;
      let imported = 0;
      let duplicates = 0;
      let scanned = 0;

      for (let call = 0; call < 20; call += 1) {
        const result = await runAdminWoztellBackfill({
          data: { maxPages: 10, after: cursor, mode },
        });

        if (!result.ok) return { failed: result, imported, duplicates, scanned, done: true };

        imported += result.ingested ?? 0;
        duplicates += result.duplicates ?? 0;
        scanned += result.rows ?? 0;
        cursor = result.nextCursor ?? null;

        if (result.reachedEnd || !cursor) {
          return { failed: null, imported, duplicates, scanned, done: true };
        }

        toast.loading(`已處理 ${scanned} 則訊息…`, { id: toastId });
      }

      return { failed: null, imported, duplicates, scanned, done: false };
    };

    try {
      let outcome = await drain("forward");

      // Woztell documents forward pagination (first/after) but their own shipped
      // n8n node only ever uses the backward form (last/before), and the default
      // sort order is undocumented with no sortBy argument to pin it. So a
      // zero-row forward result is genuinely ambiguous: it means either "no
      // history" or "this server ignores the direction we asked for". Retrying
      // the other way turns that ambiguity into an answer, instead of reporting
      // an empty inbox that may not be empty. Costs one wasted call in the
      // genuinely-empty case, which is the cheap side of the trade.
      if (!outcome.failed && outcome.scanned === 0) {
        toast.loading("改用反向讀取重試…", { id: toastId });
        outcome = await drain("backward");
      }

      if (outcome.failed) {
        // The 503 carries a hint naming the exact env var and scope to set;
        // dropping it would leave an admin with "匯入失敗" and nowhere to go.
        const { error, hint } = outcome.failed;
        toast.error(hint ? `${error} — ${hint}` : (error ?? "匯入失敗"), {
          id: toastId,
          duration: 12_000,
        });
        return;
      }

      if (!outcome.done) {
        toast.info(
          `已匯入 ${outcome.imported} 則訊息，仍有更多記錄 — 可再次按「匯入歷史訊息」繼續`,
          { id: toastId, duration: 10_000 },
        );
      } else {
        toast.success(
          outcome.scanned === 0
            ? "Woztell 沒有回傳任何訊息記錄"
            : `匯入完成：新增 ${outcome.imported} 則，已存在 ${outcome.duplicates} 則`,
          { id: toastId },
        );
      }

      await refreshConversations();
    } catch (err) {
      toast.error(errorText(err), { id: toastId });
    } finally {
      setBackfilling(false);
    }
  }, [refreshConversations]);

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
            {/* History import. Deliberately not automatic: it reaches out to
                Woztell and writes to crm_contacts, so it stays an explicit,
                admin-initiated action rather than something a page load does. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 lg:h-9"
              disabled={backfilling}
              onClick={() => void runBackfill()}
              title="匯入 Woztell 上早於本系統的歷史對話"
            >
              <History className={backfilling ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {backfilling ? "匯入中…" : "匯入歷史訊息"}
            </Button>
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
              awaitingCount={awaitingCount}
              showingAwaitingOnly={inboxStatus === "awaiting"}
              onShowAwaiting={() => setWhatsappSearch({ status: "awaiting" })}
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
              templates={templates}
              templatesLoading={templatesLoading}
              disabled={isMutating}
              savingConversation={mutatingAction === "conversation"}
              sendingReply={mutatingAction === "reply"}
              sendingTemplate={mutatingAction === "template"}
              onReplyBodyChange={setReplyBody}
              onSendReply={sendReply}
              onSendTemplate={sendTemplate}
              onRequestClearOptOut={() => setClearOptOutOpen(true)}
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
          templates={templates}
          templatesLoading={templatesLoading}
          disabled={isMutating}
          savingConversation={mutatingAction === "conversation"}
          sendingReply={mutatingAction === "reply"}
          sendingTemplate={mutatingAction === "template"}
          onReplyBodyChange={setReplyBody}
          onSendReply={sendReply}
          onSendTemplate={sendTemplate}
          onRequestClearOptOut={() => setClearOptOutOpen(true)}
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

      <AdminConfirmDialog
        open={clearOptOutOpen}
        title="解除拒收狀態？"
        description="解除後，此客戶會重新收到 WhatsApp 回覆及群發訊息。請只在確認客戶並非有意拒收時使用。"
        confirmLabel="確認解除"
        confirmVariant="destructive"
        isPending={mutatingAction === "optout"}
        onOpenChange={(open) => {
          if (mutatingAction === "optout") return;
          setClearOptOutOpen(open);
          if (!open) setClearOptOutReason("");
        }}
        onConfirm={() => void confirmClearOptOut()}
      >
        <div className="space-y-3 text-sm">
          <dl className="grid gap-1 rounded-md border bg-muted/40 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">客戶</dt>
              <dd className="font-medium">{detail?.name ?? "WhatsApp 客戶"}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">電話</dt>
              <dd className="tabular-nums">{detail?.phone ?? "未有電話"}</dd>
            </div>
          </dl>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="clear-optout-reason">
              解除原因
            </label>
            <Textarea
              id="clear-optout-reason"
              value={clearOptOutReason}
              onChange={(event) => setClearOptOutReason(event.target.value)}
              placeholder="例如：客戶來電確認只想取消睇樓，並非拒收訊息"
              rows={3}
              maxLength={500}
            />
            {/* Recorded in ops_audit_logs so a re-enabled contact is always
                traceable to a person and a stated reason. */}
            <p className="text-xs text-muted-foreground">原因會記錄在審計記錄中。</p>
          </div>
        </div>
      </AdminConfirmDialog>
    </AdminShell>
  );
}

const INBOX_ROW_LIMIT = 100;

function ConversationList({
  rows,
  totalLoaded,
  awaitingCount,
  showingAwaitingOnly,
  onShowAwaiting,
  hasFilters,
  onClearFilters,
  selectedId,
  loading,
  onOpen,
}: {
  rows: AdminConversationRow[] | null;
  totalLoaded: number;
  awaitingCount: number;
  showingAwaitingOnly: boolean;
  onShowAwaiting: () => void;
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
      {/* The one number staff need before anything else: how many people are
          waiting on us. It doubles as the control that narrows the list to
          them, because reading a count you then have to hunt through is barely
          better than not having it. Hidden once that filter is already on --
          at that point every visible row is one of these. */}
      {awaitingCount > 0 && !showingAwaitingOnly ? (
        <button
          type="button"
          onClick={onShowAwaiting}
          className="flex w-full items-center gap-2 bg-amber-100 px-4 py-2.5 text-left text-sm font-semibold text-amber-950 transition hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-950/80"
        >
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{awaitingCount} 個對話待回覆</span>
          <span className="ml-auto text-xs font-medium underline">只看待回覆</span>
        </button>
      ) : null}
      {/* The inbox silently capped at 100 with no count anywhere, so a busy day
          looked identical to a quiet one and older conversations simply did not
          exist as far as the UI was concerned. */}
      <p className="px-4 py-2 text-xs text-muted-foreground">
        顯示 {rows.length} 個對話
        {hasFilters ? `（已載入 ${totalLoaded} 個）` : ""}
        {totalLoaded >= INBOX_ROW_LIMIT ? `，收件匣上限為最近 ${INBOX_ROW_LIMIT} 個` : ""}
      </p>
      {rows.map((conversation) => {
        const attention = conversationAttention({
          lastDirection: conversation.last_direction,
          lastInboundAt: conversation.last_inbound_at,
        });
        const waited = formatDuration(attention.waitedMs);
        return (
          <button
            key={conversation.id}
            type="button"
            className={[
              "grid w-full gap-2 border-l-2 px-4 py-3 text-left transition hover:bg-muted/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              // The accent bar is the thing that makes a queue scannable at a
              // glance -- badges alone all sit at different x positions once
              // names wrap, so the eye has to read each row to find the ones
              // that need work.
              attention.awaitingReply
                ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
                : "border-l-transparent",
              selectedId === conversation.id ? "bg-muted/70" : "",
            ].join(" ")}
            aria-current={selectedId === conversation.id ? "true" : undefined}
            onClick={() => onOpen(conversation.id)}
          >
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-2">
                {attention.awaitingReply ? (
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500"
                    aria-hidden="true"
                  />
                ) : null}
                <span className="min-w-0">
                  <span
                    className={[
                      "block truncate text-sm",
                      attention.awaitingReply ? "font-bold" : "font-semibold",
                    ].join(" ")}
                  >
                    {conversation.name ?? "WhatsApp 客戶"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {conversation.phone ?? "未有電話"}
                  </span>
                </span>
              </span>
              <StatusBadge status={conversation.status} />
            </span>

            <span
              className={[
                "line-clamp-2 text-sm",
                attention.awaitingReply ? "text-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {/* last_text is only ever the TEXT of the latest message. A
                  photo/voice/sticker message leaves it null too, which used to
                  render as "未有訊息內容" (no message at all) -- indistinguishable
                  from a conversation with nothing to see, so a real unread
                  message could read as an empty row in a busy queue. Mirrors
                  the same fallback MessageTimeline already uses for a message
                  with no text. */}
              {conversation.last_text ??
                (conversation.last_message_at ? "（非文字訊息）" : "未有訊息內容")}
            </span>

            <span className="flex flex-wrap items-center gap-2">
              {attention.awaitingReply ? (
                <Badge className="border-transparent bg-amber-500 text-amber-950 hover:bg-amber-500">
                  待回覆{waited ? ` · 已等 ${waited}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline">{formatDirection(conversation.last_direction)}</Badge>
              )}

              {/* Only worth showing while someone is actually waiting: on a
                  conversation we already answered, the window is not a task. */}
              {attention.awaitingReply && attention.windowState === "expired" ? (
                <Badge variant="outline" className="border-destructive/40 text-destructive">
                  已過 24 小時回覆窗口
                </Badge>
              ) : null}
              {attention.awaitingReply && attention.windowState === "closing" ? (
                <Badge variant="destructive">
                  回覆窗口剩 {formatDuration(attention.windowRemainingMs)}
                </Badge>
              ) : null}

              {conversation.opted_out_whatsapp ? <Badge variant="destructive">已拒收</Badge> : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatDate(conversation.last_message_at)}
              </span>
            </span>
          </button>
        );
      })}
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
  templates,
  templatesLoading,
  disabled,
  savingConversation,
  sendingReply,
  sendingTemplate,
  onReplyBodyChange,
  onSendReply,
  onSendTemplate,
  onStatusChange,
  onAgentChange,
  onRequestClearOptOut,
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
  templates: AdminWhatsappTemplateRow[];
  templatesLoading: boolean;
  disabled: boolean;
  savingConversation: boolean;
  sendingReply: boolean;
  sendingTemplate: boolean;
  onReplyBodyChange: (value: string) => void;
  onSendReply: () => void;
  onSendTemplate: (templateId: string) => Promise<void>;
  onStatusChange: (status: string) => void;
  onAgentChange: (assignedAgentId: string | null) => void;
  onRequestClearOptOut: () => void;
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
  // Only the window-closed case routes to a template: the other block reasons
  // (integration disabled, opted out, no Woztell member id) would fail a
  // template send for the exact same underlying reason, so offering the
  // picker there would just be a second dead end instead of one.
  const showTemplateSend = availability.code === "OUTSIDE_24_HOUR_WINDOW";

  return (
    <div className="flex min-h-[32rem] flex-col">
      {/* Plain divs, not <header>/<footer>: nested inside AdminShell's own
          <header> and the outer site <header>/<footer>, the semantic tags
          produced three "banner" and two "contentinfo" landmarks on one page,
          which a screen reader's landmark navigation cannot disambiguate. */}
      <div className="border-b p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{detail.name ?? "WhatsApp 客戶"}</h2>
              <StatusBadge status={detail.status} />
              {detail.opted_out_whatsapp ? <Badge variant="destructive">已拒收</Badge> : null}
              {/* An opt-out used to be a one-way door: the inbound webhook only
                  ever OR-ed the flag true, so a customer mis-read as opting out
                  (「我想取消今日睇樓約會」) was blocked from replies and campaigns
                  forever. admin/manager can undo it; the server re-checks. */}
              {detail.opted_out_whatsapp && detail.can_clear_opt_out && detail.contact_id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onRequestClearOptOut}
                  disabled={disabled}
                >
                  解除拒收
                </Button>
              ) : null}
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
      </div>

      <MessageTimeline messages={detail.messages} />

      <div className="border-t p-4">
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
        <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          回覆只可在客戶最後一次來訊後 24 小時內發送。
          {windowRemaining ? <span className="block">{windowRemaining}</span> : null}
          {availability.reason ? (
            <span className="block font-medium text-destructive">{availability.reason}</span>
          ) : null}
        </div>
        {showTemplateSend ? (
          <TemplateSendPanel
            key={detail.id}
            templates={templates}
            loading={templatesLoading}
            disabled={disabled}
            sending={sendingTemplate}
            onSend={onSendTemplate}
          />
        ) : null}
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
      </div>
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

/**
 * Offered in place of the free-text composer once the 24-hour window has
 * closed. Backed by the same whatsapp_templates rows the 推廣活動 campaign
 * picker uses (fetchAdminWhatsappTemplates), so a template only appears here
 * once it is genuinely approved and configured -- no more pointing an agent at
 * a template name that does not exist anywhere in the system.
 */
function TemplateSendPanel({
  templates,
  loading,
  disabled,
  sending,
  onSend,
}: {
  templates: AdminWhatsappTemplateRow[];
  loading: boolean;
  disabled: boolean;
  sending: boolean;
  onSend: (templateId: string) => Promise<void>;
}) {
  const [templateId, setTemplateId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const selected = templates.find((template) => template.id === templateId) ?? null;

  if (loading) {
    return (
      <div className="mb-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        正在載入已審批範本…
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="mb-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        目前未有已審批範本，請聯絡技術支援新增範本，或改用其他方式聯絡客戶。
      </div>
    );
  }

  const parameters = selected ? describeTemplateParameters(selected.components) : [];

  return (
    <div className="mb-3 grid gap-2 rounded-md border p-3">
      <p className="text-xs font-medium">傳送已審批範本</p>
      <Select value={templateId} onValueChange={setTemplateId} disabled={disabled || sending}>
        <SelectTrigger aria-label="選擇範本">
          <SelectValue placeholder="選擇範本" />
        </SelectTrigger>
        <SelectContent>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.element_name}（{template.language_code}）
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* No approved body text to preview (see template-preview.ts) -- this is
          every value the system will substitute into it, which is the closest
          staff can get to knowing what the customer will actually receive. */}
      {selected && parameters.length > 0 ? (
        <dl className="grid gap-1 text-xs text-muted-foreground">
          {parameters.map((line) => (
            <p key={line.label}>
              {line.label}：{line.value}
            </p>
          ))}
        </dl>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!selected || disabled || sending}
        onClick={() => setConfirmOpen(true)}
      >
        <Send className="h-4 w-4" />
        {sending ? "傳送中…" : "傳送範本"}
      </Button>
      <AdminConfirmDialog
        open={confirmOpen}
        title="確認傳送範本？"
        description={
          selected
            ? `將向客戶傳送已審批範本「${selected.element_name}」。範本一經傳送即無法收回。`
            : "將向客戶傳送已審批範本。範本一經傳送即無法收回。"
        }
        confirmLabel="傳送"
        isPending={sending}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          if (!selected) return;
          void (async () => {
            await onSend(selected.id);
            setConfirmOpen(false);
          })();
        }}
      />
    </div>
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

// Delegates to canReplyToConversation -- the same guard /api/admin/woztell/send
// enforces server-side -- instead of re-deriving the same checks with their own
// reason strings. The duplication used to let the two drift: this pre-flight
// copy leaked the raw env-var name and the raw Woztell field name straight
// into the reply footer, while the real send path already had a proper
// Chinese label for the same failure in replyErrorLabels above.
function replyAvailability(
  detail: AdminConversationDetail,
  woztellEnabled: boolean | null,
): { reason: string | null; code: string | null } {
  if (woztellEnabled === null) {
    return { reason: "正在確認 WhatsApp 發送狀態…", code: "LOADING" };
  }
  if (!detail.woztell_member_id) {
    return {
      reason: replyErrorLabels.MISSING_WOZTELL_MEMBER_ID,
      code: "MISSING_WOZTELL_MEMBER_ID",
    };
  }
  const guard = canReplyToConversation({
    woztellEnabled,
    optedOut: detail.opted_out_whatsapp === true,
    lastInboundAt: detail.last_inbound_at,
  });
  if (!guard.ok) return { reason: formatReplyError(guard.reason), code: guard.reason };
  return { reason: null, code: null };
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

/**
 * Coarse, glanceable durations -- "3 小時", not "3 小時 12 分鐘". This is read
 * while scanning a queue, where the extra precision costs reading time and
 * changes no decision.
 */
function formatDuration(ms: number | null) {
  if (ms === null) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "少於 1 分鐘";
  if (minutes < 60) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  return `${Math.floor(hours / 24)} 日`;
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

const REPLY_DRAFT_STORAGE_PREFIX = "earnest:whatsapp:reply-drafts";

/**
 * Drafts are namespaced per authenticated user. sessionStorage is shared by
 * every page in the tab, so a single unnamespaced key meant that on a shared
 * office machine the next person to sign in was shown -- and could send -- the
 * previous agent's half-written reply to a customer.
 */
function replyDraftStorageKey(userId: string | null | undefined) {
  return userId ? `${REPLY_DRAFT_STORAGE_PREFIX}:${userId}` : null;
}

/**
 * Reply drafts survive reload and navigation away from the inbox. Reads are
 * defensive: sessionStorage throws in private-mode Safari and the stored JSON
 * can be anything a previous version wrote, and a corrupt draft cache must
 * never stop the inbox from rendering.
 */
function readStoredReplyDrafts(userId: string | null | undefined): Record<string, string> {
  if (typeof window === "undefined") return {};
  const key = replyDraftStorageKey(userId);
  if (!key) return {};
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => [key, value as string]),
    );
  } catch {
    return {};
  }
}

function writeStoredReplyDrafts(drafts: Record<string, string>, userId: string | null | undefined) {
  if (typeof window === "undefined") return;
  const key = replyDraftStorageKey(userId);
  if (!key) return;
  try {
    // Drop sent/empty drafts so the key does not grow without bound.
    const kept = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value.trim()));
    if (Object.keys(kept).length === 0) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify(kept));
  } catch {
    // Quota or private-mode failure: the draft simply is not persisted.
  }
}
