import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Clock3, MessageCircle, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { AdminDetailPanel } from "@/components/admin/AdminDetailPanel";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminStatusSelect } from "@/components/admin/AdminStatusSelect";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const messageStatusLabels: Record<string, string> = {
  received: "已接收",
  sending: "傳送中",
  sent: "已送出",
  failed: "送出失敗",
};

const replyErrorLabels: Record<string, string> = {
  WOZTELL_DISABLED: "WOZTELL_ENABLED 未啟用",
  CONTACT_OPTED_OUT: "客戶已 Opt-out WhatsApp",
  OUTSIDE_24_HOUR_WINDOW: "超過 24 小時回覆窗口",
  CONVERSATION_NOT_FOUND: "找不到 WhatsApp 對話",
  MISSING_WOZTELL_MEMBER_ID: "缺少 Woztell member ID",
};

export const Route = createFileRoute("/admin/whatsapp")({
  head: () => ({
    meta: [{ title: "WhatsApp Inbox｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminWhatsapp,
});

function AdminWhatsapp() {
  const { user } = useNeonAuth();
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
  const [replyBody, setReplyBody] = useState("");
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
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

      try {
        const assist = await fetchAdminConversationAiAssist({ data: { conversationId: id } });
        if (requestId !== aiAssistRequestRef.current || !canApplyConversationDetail(id)) return;
        setAiAssist(assist as AdminConversationAiAssist);
      } catch {
        if (requestId !== aiAssistRequestRef.current || !canApplyConversationDetail(id)) return;
        setAiAssist(null);
      }
    },
    [canApplyConversationDetail],
  );

  const loadConversationDetail = useCallback(
    async (id: string, options: { resetReply?: boolean } = {}) => {
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setDetailLoading(true);
      setDetailError(null);

      try {
        const data = await fetchAdminConversation({ data: { id } });
        if (requestId !== detailRequestRef.current || !canApplyConversationDetail(id)) return null;
        if (!data) throw new Error("找不到 WhatsApp 對話");

        const conversation = data as AdminConversationDetail;
        setDetail(conversation);
        loadConversationAiAssist(id);
        if (options.resetReply) setReplyBody("");
        return conversation;
      } catch (err) {
        if (requestId !== detailRequestRef.current || !canApplyConversationDetail(id)) return null;

        const message = errorText(err);
        setDetail(null);
        setDetailError(message);
        toast.error(message);
        return null;
      } finally {
        if (requestId === detailRequestRef.current && canApplyConversationDetail(id)) {
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

  function openConversation(id: string) {
    if (selectedIdRef.current !== id) {
      selectedIdRef.current = id;
      clearConversationDetail(true);
      setSelectedId(id);
    }
    if (!isDesktop) setPanelOpen(true);
  }

  function clearConversationDetail(loading = false) {
    detailRequestRef.current += 1;
    aiAssistRequestRef.current += 1;
    setDetail(null);
    setAiAssist(null);
    setDetailError(null);
    setDetailLoading(loading);
    setReplyBody("");
    setMutatingAction(null);
  }

  function clearSelectedConversation() {
    selectedIdRef.current = null;
    setSelectedId(null);
    clearConversationDetail();
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
      await refreshConversations();
      if (!canApplyConversationDetail(targetId)) return;

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
    try {
      const result = await sendAdminConversationReply({
        data: {
          conversationId: targetId,
          text,
        },
      });
      assertNoMutationError(result);
      setReplyBody("");
      await refreshConversations();
      if (!canApplyConversationDetail(targetId)) return;

      const refreshed = await loadConversationDetail(targetId);
      if (refreshed && canApplyConversationDetail(targetId)) toast.success("回覆已送出");
    } catch (err) {
      if (canApplyConversationDetail(targetId)) toast.error(formatReplyError(errorText(err)));
    } finally {
      if (canApplyConversationDetail(targetId)) setMutatingAction(null);
    }
  }

  const isMutating = mutatingAction !== null;
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
            <Badge variant="outline" className="h-9 gap-1.5 px-3">
              <Clock3 className="h-3.5 w-3.5" />
              24 小時回覆窗口
            </Badge>
            <Badge
              variant={
                woztellEnabled ? "secondary" : woztellEnabled === false ? "destructive" : "outline"
              }
              className="h-9 px-3"
            >
              WOZTELL_ENABLED:{" "}
              {woztellEnabled === null ? "檢查中" : woztellEnabled ? "true" : "false"}
            </Badge>
          </>
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={loadingRows}
            onClick={refreshConversations}
          >
            <RefreshCw className="h-4 w-4" />
            重新整理
          </Button>
        }
      />

      {error ? <AdminError message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <Card>
          <CardContent className="p-0">
            <ConversationList
              rows={rows}
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

function ConversationList({
  rows,
  selectedId,
  loading,
  onOpen,
}: {
  rows: AdminConversationRow[] | null;
  selectedId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  if (!rows && loading) return <Skeleton className="h-72 w-full rounded-none" />;
  if (!rows || rows.length === 0) {
    return (
      <div className="p-4">
        <AdminEmptyState
          title="未有 WhatsApp 對話"
          description="Woztell webhook 收到客戶訊息後會在這裡建立對話。"
        />
      </div>
    );
  }

  return (
    <div className="divide-y">
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
              <Badge variant="destructive">Opt-out</Badge>
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

  return (
    <div className="flex min-h-[32rem] flex-col">
      <header className="border-b p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold">{detail.name ?? "WhatsApp 客戶"}</h2>
              <StatusBadge status={detail.status} />
              {detail.opted_out_whatsapp ? <Badge variant="destructive">Opt-out</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{detail.phone ?? "未有電話"}</p>
          </div>
          <div className="text-sm text-muted-foreground">
            最後 inbound：{formatDate(detail.last_inbound_at)}
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
        <AiAssistPanel aiAssist={aiAssist} onUseReply={onReplyBodyChange} />
        <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          回覆只可在客戶最後 inbound 後 24 小時內發送，且 WOZTELL_ENABLED 必須為 true。
          {availability.reason ? (
            <span className="block font-medium">{availability.reason}</span>
          ) : null}
        </div>
        <div className="grid gap-3">
          <Textarea
            aria-label="WhatsApp 回覆"
            rows={4}
            value={replyBody}
            disabled={disabled || Boolean(availability.reason)}
            placeholder="輸入回覆內容"
            onChange={(event) => onReplyBodyChange(event.target.value)}
          />
          <Button type="button" disabled={!canSendReply || sendingReply} onClick={onSendReply}>
            <Send className="h-4 w-4" />
            {sendingReply ? "回覆中…" : "回覆"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function AiAssistPanel({
  aiAssist,
  onUseReply,
}: {
  aiAssist: AdminConversationAiAssist | null;
  onUseReply: (value: string) => void;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="space-y-2 p-4">
        <p className="font-medium">AI Assist</p>
        {aiAssist ? (
          <>
            <p className="text-sm">{aiAssist.summary}</p>
            <p className="text-xs text-muted-foreground">
              Intent: {aiAssist.detectedIntent ?? "unknown"} · Urgency:{" "}
              {aiAssist.urgency ?? "normal"}
            </p>
            {aiAssist.handoffNote ? (
              <p className="text-xs text-muted-foreground">{aiAssist.handoffNote}</p>
            ) : null}
            {aiAssist.suggestedReply ? (
              <Button
                onClick={() => onUseReply(aiAssist.suggestedReply ?? "")}
                type="button"
                variant="outline"
              >
                Use suggested reply
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">未有 AI assist。</p>
        )}
      </CardContent>
    </Card>
  );
}

function MessageTimeline({ messages }: { messages: AdminConversationMessageRow[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {messages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          未有訊息紀錄
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: AdminConversationMessageRow }) {
  const outbound = message.direction === "outbound";
  const statusClass =
    message.status === "failed" ? "font-semibold" : message.status === "sending" ? "italic" : "";
  return (
    <article className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[86%] rounded-lg border px-3 py-2 text-sm shadow-sm",
          outbound ? "bg-primary text-primary-foreground" : "bg-background",
        ].join(" ")}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs opacity-80">
          <MessageCircle className="h-3.5 w-3.5" />
          <span>{formatDirection(message.direction)}</span>
          <span>{formatDate(message.created_at)}</span>
          <span className={statusClass}>{messageStatusLabel(message.status)}</span>
        </div>
        <p className="whitespace-pre-wrap break-words">{message.text ?? "（非文字訊息）"}</p>
        {message.error ? <p className="mt-2 text-xs opacity-90">{message.error}</p> : null}
      </div>
    </article>
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
