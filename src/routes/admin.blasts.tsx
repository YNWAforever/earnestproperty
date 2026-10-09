import { ADMIN_ERROR_CODES, adminErrorMessage } from "@/components/admin/admin-error-text";
import { useStaffWorkspaceIdentity, useStaffWorkspaceCurrent } from "@/hooks/use-staff-workspace";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CircleCheck,
  Eye,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { serverErrorStatus } from "@/components/admin/team/admin-team-route-utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useDirtyCloseGuard, useRouteLeaveGuard } from "@/hooks/use-unsaved-changes-guard";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { describeTemplateParameters } from "@/lib/woztell/template-preview";
import { campaignSavePayload, isCampaignDraftDirty } from "@/lib/admin/blast-review";
import {
  cancelAdminCampaign,
  fetchAdminBlastOptions,
  fetchAdminCampaigns,
  fetchCampaignRetryPreview,
  fetchCampaignSendPreview,
  finishCampaignWithoutSending,
  previewAdminAudience,
  requeueFailedCampaignRecipients,
  sendAdminCampaignQueue,
  deleteAdminAudience,
  saveAdminAudience,
  saveAdminCampaign,
} from "@/lib/neon/admin-data";
import type {
  AdminAudienceInput,
  AdminAudiencePreview,
  AdminBlastOptions,
  AdminCampaignFinishResult,
  AdminCampaignInput,
  AdminCampaignRequeueResult,
  AdminCampaignRetryPreview,
  AdminCampaignRow,
  AdminCampaignSendPreview,
} from "@/lib/neon/admin-data.types";

type PreviewInput = { audience_id?: string; filters?: AdminAudienceInput["filters"] };
type PreviewContext = { data: PreviewInput; label: string; debounce: boolean };
type MutationResult = {
  ok?: boolean;
  id?: string;
  error?: string;
};
type StampedPreview = { preview: AdminAudiencePreview; checkedAt: number };
/** Everything the send confirmation needs, captured at the moment the operator
 * asked to send so the dialog cannot describe one campaign while queueing
 * another. */
type PendingSend = {
  campaignId: string;
  campaignName: string;
  templateLabel: string;
  audienceLabel: string;
  eligible: number;
  template: AdminBlastOptions["templates"][number] | null;
  checkedAt: number;
  /** FX-10b: some recipient may already have been reached, so this send only
   * reaches the rows still waiting, never new audience matches. */
  deliveryStarted: boolean;
  sent: number;
};

// `draft` is deliberately excluded, mirroring canPrepareAdminCampaignQueue --
// the page promises 「審核後排程發送」, so a draft must be moved to 待審核 before it
// can reach a customer. Keeping the two in sync matters: if the client allowed
// draft the server would reject it with a raw INVALID_CAMPAIGN_STATUS.
const queueableStatuses = new Set(["review", "scheduled"]);
const cancellableStatuses = new Set(["draft", "review", "scheduled", "queued", "sending"]);
// Mirrors requeueFailedCampaignRecipients' status rule; the server re-checks it.
const retryableStatuses = new Set(["failed", "completed", "review"]);

// An audience preview older than this is treated as unusable for sending. The
// server re-materialises recipients at queue time, so a stale count on screen
// has no relation to who actually receives the blast.
const PREVIEW_FRESHNESS_MS = 60_000;

const campaignStatusLabels: Record<string, string> = {
  draft: "草稿",
  review: "待審核",
  scheduled: "已排期",
  queued: "已排隊",
  sending: "發送中",
  completed: "已完成",
  failed: "失敗",
  cancelled: "已取消",
};

const RETRY_PREVIEW_ERROR = "未能讀取重新發送資料，請稍後再試。";
const SEND_PREVIEW_ERROR = "未能讀取尚待發送人數，請稍後再試。";
/** A lost or unreadable re-queue response: the outcome is unknown, never success. */
const RETRY_OUTCOME_UNKNOWN =
  "重新排入結果未明：未能確認伺服器是否已處理。請先按「重新讀取最新數字」核對，才決定是否再試；重新排入本身不會發送訊息。";
const LIST_MAY_BE_STALE = "Campaign 列表未能更新，畫面上的數字可能已過時，請按「重新整理」。";
const READBACK_BLOCKS_RETRY = "請先核對上一個加入佇列或取消操作的結果，才可重新排入。";
/** A lost or unreadable finish response. Finishing sends nothing and a repeat is harmless. */
const FINISH_OUTCOME_UNKNOWN =
  "結束結果未明：未能確認伺服器是否已處理。已重新讀取列表，請核對 Campaign 狀態；結束操作不會發出任何訊息。";

/** Retry exclusion reasons from fetchCampaignRetryPreview. Counts only: the
 * preview carries no phone or member id, and none is ever shown. */
const retryExclusionLabels: Record<
  AdminCampaignRetryPreview["exclusions"][number]["reason"],
  string
> = {
  OPTED_OUT: "已拒收或身份未核實（不會重發）",
  DUPLICATE_PHONE: "同一電話已有記錄（不會重發）",
  CONTACT_CHANGED_SINCE_ATTEMPT: "聯絡資料在上次發送後曾更改（不會重發）",
};

const intentOptions = [
  { value: "any", label: "任何意向" },
  { value: "buyer", label: "買家" },
  { value: "tenant", label: "租客" },
  { value: "seller", label: "業主放售" },
  { value: "landlord", label: "業主放租" },
];

export const Route = createFileRoute("/admin/blasts")({
  head: () => ({
    meta: [{ title: "WhatsApp 群發｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminBlasts,
});

function AdminBlasts() {
  const identity = useStaffWorkspaceIdentity(["admin", "manager"]);
  if (!identity)
    return (
      <AdminShell title="WhatsApp 群發" description="核對收件範圍及推廣操作結果。">
        <AdminError message="尚未取得已核實的推廣管理權限。" />
      </AdminShell>
    );
  return <AdminBlastsWorkspace key={identity} identity={identity} />;
}

function AdminBlastsWorkspace({ identity }: { identity: string }) {
  const isWorkspaceCurrent = useStaffWorkspaceCurrent(identity);
  const { user } = useNeonAuth();
  const activeRef = useRef(true);
  const queueJournalKey = user ? `earnest-campaign-queue:${encodeURIComponent(user.id)}` : null;
  const cancelJournalKey = user ? `earnest-campaign-cancel:${encodeURIComponent(user.id)}` : null;
  const [cancelJournalReady, setCancelJournalReady] = useState(false);
  const [cancelJournalError, setCancelJournalError] = useState<string | null>(null);
  const cancellingRef = useRef(false);
  const cancelReadbackRef = useRef<string | null>(null);
  const [cancelNeedsReadback, setCancelNeedsReadback] = useState<string | null>(null);
  const [queueJournalReady, setQueueJournalReady] = useState(false);
  const [queueJournalError, setQueueJournalError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminCampaignRow[] | null>(null);
  const [options, setOptions] = useState<AdminBlastOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [campaignDraft, setCampaignDraft] = useState<AdminCampaignInput | null>(null);
  const [savedCampaignDraft, setSavedCampaignDraft] = useState<AdminCampaignInput | null>(null);
  const [audienceDraft, setAudienceDraft] = useState<AdminAudienceInput | null>(null);
  const [selectedPreviewAudienceId, setSelectedPreviewAudienceId] = useState("");
  const [preview, setPreview] = useState<AdminAudiencePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [previewCheckedAt, setPreviewCheckedAt] = useState(0);
  const [providerReviewed, setProviderReviewed] = useState(false);
  const sendingRef = useRef(false);
  const queueReadbackRef = useRef<string | null>(null);
  const [queueNeedsReadback, setQueueNeedsReadback] = useState<string | null>(null);
  // Stamped with the fetch time: Queue must never be enabled by a count the
  // operator saw minutes ago, because the server materialises a fresh audience
  // at send time.
  const [rowPreviews, setRowPreviews] = useState<Record<string, StampedPreview>>({});
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const [pendingCancel, setPendingCancel] = useState<AdminCampaignRow | null>(null);
  const [pendingRetry, setPendingRetry] = useState<AdminCampaignRow | null>(null);
  const [retryPreview, setRetryPreview] = useState<AdminCampaignRetryPreview | null>(null);
  const [retryPreviewError, setRetryPreviewError] = useState<string | null>(null);
  const [retryOutcomeUnknown, setRetryOutcomeUnknown] = useState(false);
  const retryingRef = useRef(false);
  const retryPreviewRequestRef = useRef(0);
  // FX-10b I2: finishing a 待審核 campaign that has nothing left to send.
  const [pendingFinish, setPendingFinish] = useState<AdminCampaignRow | null>(null);
  const [finishPreview, setFinishPreview] = useState<AdminCampaignSendPreview | null>(null);
  const [finishPreviewError, setFinishPreviewError] = useState<string | null>(null);
  const finishingRef = useRef(false);
  const finishPreviewRequestRef = useRef(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [savedAudienceDraft, setSavedAudienceDraft] = useState<AdminAudienceInput | null>(null);
  const [pendingAudienceDelete, setPendingAudienceDelete] = useState<
    AdminBlastOptions["audiences"][number] | null
  >(null);
  // Staleness is derived from Date.now() at render, so without a tick a preview
  // would keep looking fresh until some other state change happened to
  // re-render the table -- and 發送 would stay enabled on an expired count.
  const [, setStaleTick] = useState(0);
  const previewRequestRef = useRef(0);
  const hasRowPreviews = Object.keys(rowPreviews).length > 0;

  useEffect(() => {
    activeRef.current = true;
    if (queueJournalKey) {
      try {
        const raw = sessionStorage.getItem(queueJournalKey);
        if (raw) {
          const journal = JSON.parse(raw);
          if (
            journal?.version !== 1 ||
            typeof journal.campaignId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              journal.campaignId,
            )
          )
            throw Error("Invalid campaign queue journal");
          queueReadbackRef.current = journal.campaignId;
          setQueueNeedsReadback(journal.campaignId);
        }
        setQueueJournalReady(true);
      } catch {
        setQueueJournalError("未能讀取本機操作記錄，請聯絡支援核對；未有提交新的加入佇列要求。");
      }
    }
    if (cancelJournalKey) {
      try {
        const raw = sessionStorage.getItem(cancelJournalKey);
        if (raw) {
          const journal = JSON.parse(raw);
          if (
            journal?.version !== 1 ||
            typeof journal.campaignId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              journal.campaignId,
            )
          )
            throw Error("Invalid campaign cancellation journal");
          cancelReadbackRef.current = journal.campaignId;
          setCancelNeedsReadback(journal.campaignId);
        }
        setCancelJournalReady(true);
      } catch {
        setCancelJournalError(
          "未能讀取本機取消操作記錄，請聯絡支援核對；未有提交新的取消或加入佇列要求。",
        );
      }
    }
    return () => {
      activeRef.current = false;
    };
  }, [queueJournalKey, cancelJournalKey]);

  const refreshAdminData = useCallback(
    async (settings: { clearRowPreviews?: boolean } = {}) => {
      if (!user || !isWorkspaceCurrent()) return;
      setLoading(true);
      try {
        const [campaignRows, blastOptions] = await Promise.all([
          fetchAdminCampaigns(),
          fetchAdminBlastOptions(),
        ]);
        if (!isWorkspaceCurrent()) return null;
        setRows(campaignRows as AdminCampaignRow[]);
        setOptions(blastOptions as AdminBlastOptions);
        setSelectedPreviewAudienceId((current) => {
          if (current && blastOptions.audiences.some((audience) => audience.id === current)) {
            return current;
          }
          return blastOptions.audiences[0]?.id ?? "";
        });
        if (settings.clearRowPreviews) setRowPreviews({});
        setError(null);
        return campaignRows as AdminCampaignRow[];
      } catch (err) {
        setError(errorText(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [user, isWorkspaceCurrent],
  );

  const activePreview = useMemo<PreviewContext | null>(() => {
    if (audienceDraft) {
      return {
        data: { filters: audienceDraft.filters },
        label: "草稿群組篩選條件",
        debounce: true,
      };
    }
    if (campaignDraft?.audience_id) {
      const audienceName = audienceLabel(options, campaignDraft.audience_id);
      return {
        data: { audience_id: campaignDraft.audience_id },
        label: audienceName ? `Campaign 收件群組：${audienceName}` : "Campaign 收件群組",
        debounce: false,
      };
    }
    if (selectedPreviewAudienceId) {
      const audienceName = audienceLabel(options, selectedPreviewAudienceId);
      return {
        data: { audience_id: selectedPreviewAudienceId },
        label: audienceName ? `收件群組：${audienceName}` : "收件群組預覽",
        debounce: false,
      };
    }
    return null;
  }, [audienceDraft, campaignDraft?.audience_id, options, selectedPreviewAudienceId]);

  useEffect(() => {
    if (!user) return;
    refreshAdminData();
  }, [refreshAdminData, user]);

  useEffect(() => {
    if (!hasRowPreviews) return;
    const interval = window.setInterval(() => setStaleTick((tick) => tick + 1), 15_000);
    return () => window.clearInterval(interval);
  }, [hasRowPreviews]);

  useEffect(() => {
    if (!user || !activePreview) {
      previewRequestRef.current += 1;
      setPreview(null);
      setPreviewError(null);
      setPreviewCheckedAt(0);
      setPreviewLoading(false);
      return;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreview(null);
    setPreviewError(null);
    setPreviewCheckedAt(0);
    setPreviewLoading(true);

    const timeout = window.setTimeout(
      () => {
        previewAdminAudience({ data: activePreview.data }, isWorkspaceCurrent)
          .then((data) => {
            if (isWorkspaceCurrent() && requestId === previewRequestRef.current) {
              setPreview(data as AdminAudiencePreview);
              setPreviewCheckedAt(Date.now());
            }
          })
          .catch((err) => {
            if (isWorkspaceCurrent() && requestId === previewRequestRef.current) {
              setPreviewError(errorText(err));
              setPreview(null);
            }
          })
          .finally(() => {
            if (isWorkspaceCurrent() && requestId === previewRequestRef.current)
              setPreviewLoading(false);
          });
      },
      activePreview.debounce ? 300 : 0,
    );

    return () => window.clearTimeout(timeout);
  }, [activePreview, user, previewRetry, isWorkspaceCurrent]);

  function openCampaignDialog() {
    const template =
      options?.templates.find((item) => item.status.startsWith("active")) ?? options?.templates[0];
    const audienceId = selectedPreviewAudienceId || options?.audiences[0]?.id || null;
    const initialDraft: AdminCampaignInput = {
      name: "",
      template_id: template?.id ?? null,
      audience_id: audienceId,
      status: "draft",
      scheduled_at: null,
    };
    setSavedCampaignDraft(initialDraft);
    setCampaignDraft(initialDraft);
  }

  function closeCampaignDialog() {
    setCampaignDraft(null);
    setSavedCampaignDraft(null);
  }

  async function handleSaveAudience(event: FormEvent<HTMLFormElement>) {
    if (!isWorkspaceCurrent()) return;
    event.preventDefault();
    if (!audienceDraft) return;
    if (!audienceDraft.name.trim()) {
      toast.error("請填寫收件群組名稱");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...audienceDraft,
        name: audienceDraft.name.trim(),
        description: nullIfBlank(audienceDraft.description ?? ""),
        filters: normalizeAudienceFilters(audienceDraft.filters),
      };
      const result = (await saveAdminAudience(
        { data: payload },
        isWorkspaceCurrent,
      )) as MutationResult;
      if (!isWorkspaceCurrent()) return;
      assertNoServerError(result);
      setSavedAudienceDraft(payload);
      if (result.id) setSelectedPreviewAudienceId(result.id);
      await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      setAudienceDraft(null);
      setSavedAudienceDraft(null);
      toast.success("收件群組已儲存");
    } catch (err) {
      if (!isWorkspaceCurrent()) return;
      toast.error(errorText(err));
    } finally {
      if (isWorkspaceCurrent()) {
        setSaving(false);
      }
    }
  }

  async function handleSaveCampaign(event: FormEvent<HTMLFormElement>) {
    if (!isWorkspaceCurrent()) return;
    event.preventDefault();
    if (!campaignDraft) return;
    if (!campaignDraft.name.trim() || !campaignDraft.template_id || !campaignDraft.audience_id) {
      toast.error("請填寫 campaign 名稱、範本及收件群組");
      return;
    }

    setSaving(true);
    try {
      // scheduled_at goes back exactly as loaded (FX-17a D-13).
      const payload = campaignSavePayload(campaignDraft);
      // Whether this was a create or an update is decided BEFORE the request:
      // `id` afterwards is the saved row's id, which is always truthy, so the
      // 已新增 branch was unreachable and creating a campaign said 已儲存.
      const isUpdate = Boolean(campaignDraft.id);
      const result = (await saveAdminCampaign(
        { data: payload },
        isWorkspaceCurrent,
      )) as MutationResult;
      if (!isWorkspaceCurrent()) return;
      assertNoServerError(result);
      const id = result.id || campaignDraft.id;
      const savedDraft = { ...payload, id };
      setCampaignDraft(savedDraft);
      setSavedCampaignDraft(savedDraft);
      await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      toast.success(isUpdate ? "Campaign 已儲存" : "Campaign 已新增");
    } catch (err) {
      if (!isWorkspaceCurrent()) return;
      toast.error(staffErrorText(err, campaignErrorText(errorCode(err))));
    } finally {
      if (isWorkspaceCurrent()) {
        setSaving(false);
      }
    }
  }

  function openAudienceForEdit(audienceId: string) {
    const audience = options?.audiences.find((item) => item.id === audienceId);
    if (!audience) return;
    const draft: AdminAudienceInput = {
      id: audience.id,
      name: audience.name,
      description: audience.description,
      filters: audience.filters,
    };
    setSavedAudienceDraft(draft);
    setAudienceDraft(draft);
  }

  async function handleDeleteAudience() {
    if (!isWorkspaceCurrent()) return;
    if (!pendingAudienceDelete) return;
    const target = pendingAudienceDelete;
    setMutatingAction(`audience-delete:${target.id}`);
    setConfirmError(null);
    try {
      const result = (await deleteAdminAudience(
        { data: { id: target.id } },
        isWorkspaceCurrent,
      )) as {
        ok?: boolean;
        error?: string;
        campaigns?: string[];
        detachedCampaigns?: number;
      };
      if (!isWorkspaceCurrent()) return;
      if (!result.ok) {
        // AUDIENCE_IN_USE names the campaigns rather than failing vaguely: the
        // FK is ON DELETE SET NULL, so the operator needs to know exactly what
        // would have been silently stripped of its audience.
        if (result.error === "AUDIENCE_IN_USE") {
          setConfirmError(
            `此收件群組仍被以下 campaign 使用，請先更改或取消它們：${(result.campaigns ?? []).join("、")}`,
          );
          return;
        }
        setConfirmError(
          result.error === "NOT_FOUND"
            ? "此收件群組已被刪除，請重新整理。"
            : "刪除失敗，請稍後再試。",
        );
        return;
      }
      await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      setPendingAudienceDelete(null);
      toast.success(
        result.detachedCampaigns
          ? `收件群組已刪除，另有 ${result.detachedCampaigns} 個已完成的 campaign 不再連結此群組`
          : "收件群組已刪除",
      );
    } catch (err) {
      if (!isWorkspaceCurrent()) return;
      setConfirmError(errorText(err));
    } finally {
      if (isWorkspaceCurrent()) {
        setMutatingAction(null);
      }
    }
  }

  async function handlePreviewCampaignAudience(campaign: AdminCampaignRow) {
    if (!isWorkspaceCurrent()) return;
    if (!campaign.audience_id) {
      toast.error("此 campaign 未設定收件群組");
      return;
    }

    const action = `preview:${campaign.id}`;
    setMutatingAction(action);
    try {
      const data = (await previewAdminAudience(
        {
          data: { audience_id: campaign.audience_id },
        },
        isWorkspaceCurrent,
      )) as AdminAudiencePreview;
      if (!isWorkspaceCurrent()) return;
      setRowPreviews((current) => ({
        ...current,
        [campaign.id]: { preview: data, checkedAt: Date.now() },
      }));
      setSelectedPreviewAudienceId(campaign.audience_id);
      setPreview(data);
      toast.success("收件人預覽已更新");
    } catch (err) {
      if (!isWorkspaceCurrent()) return;
      setRowPreviews((current) => {
        const next = { ...current };
        delete next[campaign.id];
        return next;
      });
      toast.error(errorText(err));
    } finally {
      if (isWorkspaceCurrent()) {
        setMutatingAction(null);
      }
    }
  }

  /** Opens the send confirmation. Nothing is dispatched here -- this is the
   * interstitial that used to be missing entirely, so a mis-click on Queue sent
   * thousands of irreversible WhatsApp messages. */
  function requestSendCampaign(campaign: AdminCampaignRow, eligible: number, checkedAt: number) {
    void openSendConfirmation(campaign, eligible, checkedAt);
  }

  async function openSendConfirmation(
    campaign: AdminCampaignRow,
    eligible: number,
    checkedAt: number,
  ) {
    if (
      !queueJournalReady ||
      !cancelJournalReady ||
      cancelReadbackRef.current ||
      queueReadbackRef.current ||
      !isQueueableStatus(campaign.status)
    )
      return;
    if (eligible <= 0 || Date.now() - checkedAt > PREVIEW_FRESHNESS_MS) {
      toast.error("收件人預覽已過期或沒有合資格收件人，請重新預覽");
      return;
    }
    const template = options?.templates.find((item) => item.id === campaign.template_id) ?? null;
    if (!template || !template.status.startsWith("active")) {
      toast.error("範本未核准或無法讀取，請先核實");
      return;
    }
    // With delivery history the server adds nobody new, so the audience count
    // would promise people who will never be messaged. The server states the
    // exact number 發送… would dispatch now (waiting rows that still pass
    // delivery's consent, identity and one-row-per-phone checks).
    let reachable = eligible;
    let deliveryStarted = false;
    let stampedAt = checkedAt;
    if (campaign.delivery_started === true) {
      setMutatingAction(`send-preview:${campaign.id}`);
      try {
        const exact = (await fetchCampaignSendPreview(
          { data: { id: campaign.id } },
          isWorkspaceCurrent,
        )) as AdminCampaignSendPreview;
        if (!isWorkspaceCurrent()) return;
        if (!exact || exact.campaignId !== campaign.id) throw Error("Send preview mismatch");
        deliveryStarted = exact.deliveryStarted;
        if (exact.sendable !== null) {
          reachable = exact.sendable;
          stampedAt = Date.now();
        }
        // Nothing left to send: offer the finish action, not a dead-end toast.
        if (exact.finishable) {
          openFinish(campaign, exact);
          return;
        }
      } catch (err) {
        if (isWorkspaceCurrent()) toast.error(staffErrorText(err, SEND_PREVIEW_ERROR));
        return;
      } finally {
        if (isWorkspaceCurrent()) setMutatingAction(null);
      }
    }
    if (reachable <= 0) {
      toast.error("收件人預覽已過期或沒有合資格收件人，請重新預覽");
      return;
    }
    setProviderReviewed(false);
    setConfirmError(null);
    setPendingSend({
      campaignId: campaign.id,
      campaignName: campaign.name,
      templateLabel: template
        ? `${template.element_name}（${template.language_code}）`
        : (campaign.element_name ?? "未設定範本"),
      audienceLabel: campaign.audience_name ?? "未設定收件群組",
      eligible: reachable,
      template,
      checkedAt: stampedAt,
      deliveryStarted,
      sent: campaign.sent ?? 0,
    });
  }

  async function handleConfirmSend() {
    if (!pendingSend || !providerReviewed || sendingRef.current) return;
    if (!cancelJournalReady || cancelReadbackRef.current) return;
    if (queueReadbackRef.current) return;
    if (!queueJournalReady || !queueJournalKey) return;
    if (Date.now() - pendingSend.checkedAt > PREVIEW_FRESHNESS_MS) {
      setConfirmError("收件人預覽已過期，請關閉視窗並重新預覽");
      return;
    }
    // Persist the original campaign before submitting: reload or a lost response
    // must restore a read-only outcome check, not another queue request.
    try {
      const raw = JSON.stringify({ version: 1, campaignId: pendingSend.campaignId });
      sessionStorage.setItem(queueJournalKey, raw);
      if (sessionStorage.getItem(queueJournalKey) !== raw) throw Error("Journal not retained");
    } catch {
      setConfirmError("本機未能保留操作記錄，請檢查瀏覽器儲存或聯絡支援；未有提交加入佇列要求。");
      return;
    }
    sendingRef.current = true;
    const action = `queue:${pendingSend.campaignId}`;
    setMutatingAction(action);
    setConfirmError(null);
    try {
      const result = (await sendAdminCampaignQueue(
        {
          data: {
            id: pendingSend.campaignId,
            // With delivery history the server queues only this exact count.
            expectedCount: pendingSend.deliveryStarted ? pendingSend.eligible : null,
          },
        },
        isWorkspaceCurrent,
      )) as MutationResult & {
        materialization?: Partial<AdminAudiencePreview>;
        queuedRecipients?: number;
        sendable?: number;
      };
      if (!isWorkspaceCurrent()) return;
      if (result?.ok === false && result.error === "SEND_COUNT_CHANGED") {
        // Nothing was queued (a definite refusal, not an unknown outcome):
        // show the server's number before any new confirmation.
        sessionStorage.removeItem(queueJournalKey);
        const sendable = typeof result.sendable === "number" ? result.sendable : 0;
        await refreshAdminData({ clearRowPreviews: false });
        if (!isWorkspaceCurrent()) return;
        if (sendable <= 0) {
          setPendingSend(null);
          toast.error(campaignErrorText("SEND_COUNT_CHANGED"));
          return;
        }
        setPendingSend((current) =>
          current && current.campaignId === pendingSend.campaignId
            ? { ...current, eligible: sendable, checkedAt: Date.now() }
            : current,
        );
        setConfirmError(campaignErrorText("SEND_COUNT_CHANGED"));
        return;
      }
      assertNoServerError(result);
      if (!isWorkspaceCurrent()) return;

      await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      sessionStorage.removeItem(queueJournalKey);
      setCampaignDraft(null);
      setPendingSend(null);
      // The server's own count of what it queued; materialization.eligible is
      // the audience summary, not the send. No number is shown without it.
      toast.success(
        typeof result.queuedRecipients === "number"
          ? `已加入發送佇列：${result.queuedRecipients} 位合資格收件人。送達結果須另行核對。`
          : "已加入發送佇列。送達結果須另行核對。",
      );
    } catch (err) {
      // Kept inside the dialog rather than behind it: the operator needs the
      // reason next to the action they just authorised.
      if (!isWorkspaceCurrent()) return;
      queueReadbackRef.current = pendingSend.campaignId;
      setQueueNeedsReadback(pendingSend.campaignId);
      setRowPreviews({});
      setPreviewCheckedAt(0);
      setConfirmError(
        `加入佇列結果未能確認，請先讀回 Campaign 狀態。${knownCampaignErrorText(err)}`,
      );
    } finally {
      sendingRef.current = false;
      setMutatingAction(null);
    }
  }

  async function readCampaignQueueOutcome() {
    const campaignId = queueReadbackRef.current;
    if (!campaignId || sendingRef.current) return;
    sendingRef.current = true;
    setMutatingAction(`queue:${campaignId}`);
    setConfirmError(null);
    try {
      const current = await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      if (!current?.some((row) => row.id === campaignId)) {
        setConfirmError("未能讀回此 Campaign，或權限已變更。未有重送加入佇列要求。");
        return;
      }
      if (queueJournalKey) sessionStorage.removeItem(queueJournalKey);
      queueReadbackRef.current = null;
      setQueueNeedsReadback(null);
      setPendingSend(null);
      setProviderReviewed(false);
      setPreviewCheckedAt(0);
      toast.success("已讀回目前 Campaign 狀態。沒有重送；如需繼續，請重新預覽並確認。");
    } catch {
      if (isWorkspaceCurrent())
        setConfirmError("未能更新本機操作記錄，請聯絡支援；未有重送加入佇列要求。");
    } finally {
      sendingRef.current = false;
      setMutatingAction(null);
    }
  }

  function finishCancellationReadback(current: AdminCampaignRow[] | null | undefined) {
    const campaignId = cancelReadbackRef.current;
    if (
      !isWorkspaceCurrent() ||
      !campaignId ||
      !cancelJournalKey ||
      !current?.some((row) => row.id === campaignId && row.status === "cancelled")
    )
      return false;
    sessionStorage.removeItem(cancelJournalKey);
    cancelReadbackRef.current = null;
    setCancelNeedsReadback(null);
    setCampaignDraft((current) => (current?.id === campaignId ? null : current));
    setSavedCampaignDraft((current) => (current?.id === campaignId ? null : current));
    setPendingCancel(null);
    setConfirmError(null);
    toast.success("Campaign 已取消；已發出的訊息無法收回。");
    return true;
  }

  async function readCampaignCancellationOutcome() {
    if (!cancelReadbackRef.current || cancellingRef.current) return;
    cancellingRef.current = true;
    setMutatingAction(`cancel-read:${cancelReadbackRef.current}`);
    setConfirmError(null);
    try {
      const current = await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      if (!finishCancellationReadback(current))
        setConfirmError(
          "未能確認取消：原 Campaign 未讀回已取消狀態，或權限已變更。未有重試取消或加入佇列。",
        );
    } catch {
      if (isWorkspaceCurrent())
        setConfirmError("未能更新本機取消操作記錄，請聯絡支援；未有重試取消。");
    } finally {
      cancellingRef.current = false;
      if (isWorkspaceCurrent()) setMutatingAction(null);
    }
  }

  async function handleConfirmCancel() {
    if (
      !pendingCancel ||
      cancellingRef.current ||
      cancelReadbackRef.current ||
      !cancelJournalReady ||
      !cancelJournalKey
    )
      return;
    const campaignId = pendingCancel.id;
    try {
      const raw = JSON.stringify({ version: 1, campaignId });
      sessionStorage.setItem(cancelJournalKey, raw);
      if (sessionStorage.getItem(cancelJournalKey) !== raw) throw Error("Journal not retained");
    } catch {
      setConfirmError("本機未能保留取消操作記錄，請檢查瀏覽器儲存或聯絡支援；未有提交取消要求。");
      return;
    }
    cancellingRef.current = true;
    cancelReadbackRef.current = campaignId;
    setCancelNeedsReadback(campaignId);
    const action = `cancel:${campaignId}`;
    setMutatingAction(action);
    setConfirmError(null);
    try {
      const result = (await cancelAdminCampaign(
        { data: { id: campaignId } },
        isWorkspaceCurrent,
      )) as MutationResult;
      if (!isWorkspaceCurrent()) return;
      if (result.ok === false) {
        sessionStorage.removeItem(cancelJournalKey);
        cancelReadbackRef.current = null;
        setCancelNeedsReadback(null);
        assertNoServerError(result);
        return;
      }
      assertNoServerError(result);
      const current = await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      if (!finishCancellationReadback(current))
        setConfirmError("取消已確認，但未能讀回畫面。請先查回原 Campaign，不要重試取消。");
    } catch (err) {
      if (!isWorkspaceCurrent()) return;
      setConfirmError(
        cancelReadbackRef.current
          ? `取消結果未能確認，請先查回原 Campaign 狀態。${knownCampaignErrorText(err)}`
          : campaignErrorText(errorCode(err)),
      );
    } finally {
      cancellingRef.current = false;
      if (isWorkspaceCurrent()) setMutatingAction(null);
    }
  }

  /** Reads the retry preview for one campaign. Re-read on every open: the
   * counts move as deliveries finish, and the confirmation must state exactly
   * what the re-queue would move now, never a remembered number. */
  async function loadRetryPreview(campaign: AdminCampaignRow) {
    const requestId = retryPreviewRequestRef.current + 1;
    retryPreviewRequestRef.current = requestId;
    setRetryPreview(null);
    setRetryPreviewError(null);
    try {
      const data = (await fetchCampaignRetryPreview(
        { data: { id: campaign.id } },
        isWorkspaceCurrent,
      )) as AdminCampaignRetryPreview;
      if (!isWorkspaceCurrent() || requestId !== retryPreviewRequestRef.current) return false;
      if (!data || data.campaignId !== campaign.id) throw Error("Retry preview mismatch");
      setRetryPreview(data);
      return true;
    } catch (err) {
      if (!isWorkspaceCurrent() || requestId !== retryPreviewRequestRef.current) return false;
      setRetryPreviewError(staffErrorText(err, RETRY_PREVIEW_ERROR));
      return false;
    }
  }

  function openRetry(campaign: AdminCampaignRow) {
    if (!isWorkspaceCurrent() || retryingRef.current) return;
    setConfirmError(null);
    setRetryOutcomeUnknown(false);
    setPendingRetry(campaign);
    void loadRetryPreview(campaign);
  }

  function closeRetry() {
    retryPreviewRequestRef.current += 1;
    setPendingRetry(null);
    setRetryPreview(null);
    setRetryPreviewError(null);
    setRetryOutcomeUnknown(false);
    setConfirmError(null);
  }

  /** After an unknown outcome: read the list and the preview again, and only
   * then allow another confirmation. */
  async function reloadRetryState() {
    if (!pendingRetry || retryingRef.current) return;
    const campaign = pendingRetry;
    retryingRef.current = true;
    setMutatingAction(`retry-read:${campaign.id}`);
    try {
      const fresh = await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      const previewRead = await loadRetryPreview(campaign);
      if (!isWorkspaceCurrent()) return;
      if (fresh && previewRead) {
        setRetryOutcomeUnknown(false);
        setConfirmError(null);
      }
    } finally {
      retryingRef.current = false;
      if (isWorkspaceCurrent()) setMutatingAction(null);
    }
  }

  // Unlike queue and cancel there is deliberately no session journal here:
  // re-queue sends nothing (it only returns definitely-refused rows to the
  // queue and the campaign to 待審核, behind the 發送… approval), is idempotent
  // on the server, and refuses a count other than the one confirmed. A lost
  // response is resolved by re-reading the list and the preview, which the
  // dialog requires before another confirmation.
  async function handleConfirmRetry() {
    if (!pendingRetry || !retryPreview || retryPreview.retryable <= 0) return;
    if (retryingRef.current || retryOutcomeUnknown) return;
    retryingRef.current = true;
    const campaign = pendingRetry;
    const expectedCount = retryPreview.retryable;
    setMutatingAction(`retry:${campaign.id}`);
    setConfirmError(null);
    let result: AdminCampaignRequeueResult;
    try {
      result = (await requeueFailedCampaignRecipients(
        { data: { campaignId: campaign.id, expectedCount } },
        isWorkspaceCurrent,
      )) as AdminCampaignRequeueResult;
    } catch (err) {
      retryingRef.current = false;
      if (!isWorkspaceCurrent()) return;
      setMutatingAction(null);
      const status = serverErrorStatus(err);
      if (status === 401 || status === 403) {
        // A definite refusal: nothing was re-queued.
        setConfirmError(staffErrorText(err, RETRY_OUTCOME_UNKNOWN));
        return;
      }
      // The request may or may not have been processed. Never read as success;
      // confirmation stays closed until the latest numbers are read back.
      setRetryOutcomeUnknown(true);
      setConfirmError(RETRY_OUTCOME_UNKNOWN);
      return;
    }
    try {
      if (!isWorkspaceCurrent()) return;
      if (!result.ok) {
        // Re-read both so the dialog never keeps offering a stale count. For
        // RETRY_COUNT_CHANGED the new number is shown before any confirmation.
        setConfirmError(campaignErrorText(result.error));
        await refreshAdminData({ clearRowPreviews: true });
        if (isWorkspaceCurrent()) await loadRetryPreview(campaign);
        return;
      }
      const fresh = await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      closeRetry();
      const done = `已重新排入 ${result.requeued} 人。請預覽收件人後按「發送…」確認發送。`;
      // The re-queue succeeded either way; say so, but never imply the list
      // on screen is current when it could not be read back.
      if (fresh) toast.success(done);
      else toast.success(done, { description: LIST_MAY_BE_STALE });
    } finally {
      retryingRef.current = false;
      if (isWorkspaceCurrent()) setMutatingAction(null);
    }
  }

  async function loadFinishPreview(campaign: AdminCampaignRow) {
    const requestId = finishPreviewRequestRef.current + 1;
    finishPreviewRequestRef.current = requestId;
    setFinishPreview(null);
    setFinishPreviewError(null);
    try {
      const data = (await fetchCampaignSendPreview(
        { data: { id: campaign.id } },
        isWorkspaceCurrent,
      )) as AdminCampaignSendPreview;
      if (!isWorkspaceCurrent() || requestId !== finishPreviewRequestRef.current) return;
      if (!data || data.campaignId !== campaign.id) throw Error("Send preview mismatch");
      setFinishPreview(data);
      if (!data.finishable) setFinishPreviewError(campaignErrorText("CAMPAIGN_HAS_SENDABLE"));
    } catch (err) {
      if (!isWorkspaceCurrent() || requestId !== finishPreviewRequestRef.current) return;
      setFinishPreviewError(staffErrorText(err, SEND_PREVIEW_ERROR));
    }
  }

  /** Offered only when the server says nothing is left to send; the dialog
   * re-reads that before it allows a confirmation. */
  function openFinish(campaign: AdminCampaignRow, known?: AdminCampaignSendPreview) {
    if (!isWorkspaceCurrent() || finishingRef.current) return;
    setConfirmError(null);
    setPendingFinish(campaign);
    if (known && known.campaignId === campaign.id && known.finishable) {
      finishPreviewRequestRef.current += 1;
      setFinishPreview(known);
      setFinishPreviewError(null);
      return;
    }
    void loadFinishPreview(campaign);
  }

  function closeFinish() {
    finishPreviewRequestRef.current += 1;
    setPendingFinish(null);
    setFinishPreview(null);
    setFinishPreviewError(null);
    setConfirmError(null);
  }

  // Finishing sends nothing, enqueues nothing and is idempotent on the server,
  // so a lost response is resolved by re-reading the list, with no journal.
  async function handleConfirmFinish() {
    if (!pendingFinish || !finishPreview?.finishable || finishingRef.current) return;
    finishingRef.current = true;
    const campaign = pendingFinish;
    setMutatingAction(`finish:${campaign.id}`);
    setConfirmError(null);
    let result: AdminCampaignFinishResult;
    try {
      result = (await finishCampaignWithoutSending(
        { data: { campaignId: campaign.id } },
        isWorkspaceCurrent,
      )) as AdminCampaignFinishResult;
    } catch (err) {
      finishingRef.current = false;
      if (!isWorkspaceCurrent()) return;
      setMutatingAction(null);
      const status = serverErrorStatus(err);
      setConfirmError(
        status === 401 || status === 403
          ? staffErrorText(err, FINISH_OUTCOME_UNKNOWN)
          : FINISH_OUTCOME_UNKNOWN,
      );
      await refreshAdminData({ clearRowPreviews: true });
      return;
    }
    try {
      if (!isWorkspaceCurrent()) return;
      if (!result.ok) {
        setConfirmError(campaignErrorText(result.error));
        await refreshAdminData({ clearRowPreviews: true });
        if (isWorkspaceCurrent()) await loadFinishPreview(campaign);
        return;
      }
      const fresh = await refreshAdminData({ clearRowPreviews: true });
      if (!isWorkspaceCurrent()) return;
      closeFinish();
      const done = result.alreadyFinished
        ? "此 Campaign 早前已結束，未有再作更改。"
        : `已結束 Campaign，狀態為「${campaignStatusLabels[result.status] ?? result.status}」。未有發出任何訊息。`;
      if (fresh) toast.success(done);
      else toast.success(done, { description: LIST_MAY_BE_STALE });
    } finally {
      finishingRef.current = false;
      if (isWorkspaceCurrent()) setMutatingAction(null);
    }
  }

  const campaignRows = rows ?? [];
  const currentDraftRow = campaignRows.find((row) => row.id === campaignDraft?.id);
  const canSubmitCampaign =
    Boolean(campaignDraft?.id) && isQueueableStatus(currentDraftRow?.status ?? "");
  const hasUnsavedCampaignChanges = Boolean(
    campaignDraft && isCampaignDraftDirty(campaignDraft, savedCampaignDraft),
  );
  // hasUnsavedCampaignChanges was computed purely to gate the send button; both
  // dialogs still threw the draft away on 關閉, Esc or an overlay click.
  const { requestClose: requestCloseCampaignDialog, dialog: campaignCloseGuard } =
    useDirtyCloseGuard({
      isDirty: hasUnsavedCampaignChanges,
      onClose: closeCampaignDialog,
      description: "你為此 campaign 輸入的資料尚未儲存，關閉後會遺失。確定要關閉嗎？",
    });

  const hasUnsavedAudienceChanges = Boolean(
    audienceDraft &&
    JSON.stringify(audienceDraft) !== JSON.stringify(savedAudienceDraft ?? audienceDraft),
  );
  const { requestClose: requestCloseAudienceDialog, dialog: audienceCloseGuard } =
    useDirtyCloseGuard({
      isDirty: hasUnsavedAudienceChanges,
      onClose: () => {
        setAudienceDraft(null);
        setSavedAudienceDraft(null);
      },
      description: "你為此收件群組輸入的資料尚未儲存，關閉後會遺失。確定要關閉嗎？",
    });

  // Leaving the page (nav link, back, tab close) drops the same drafts the two close
  // guards above protect; the dialogs themselves never touch the router.
  const { dialog: leaveGuardDialog } = useRouteLeaveGuard(
    hasUnsavedCampaignChanges || hasUnsavedAudienceChanges,
  );

  const queueBlockReason = !cancelJournalReady
    ? (cancelJournalError ?? "正在讀取取消操作記錄")
    : cancelNeedsReadback
      ? "請先核對原 Campaign 取消結果"
      : hasUnsavedCampaignChanges
        ? "請先儲存變更才可發送"
        : campaignDraft?.id && !isQueueableStatus(currentDraftRow?.status ?? "")
          ? "目前 Campaign 狀態不能加入發送佇列"
          : campaignDraft && !isQueueableStatus(campaignDraft.status)
            ? "草稿不可直接發送，請先將狀態改為「待審核」"
            : null;
  const canQueueDraft =
    queueJournalReady &&
    cancelJournalReady &&
    !cancelNeedsReadback &&
    canSubmitCampaign &&
    !hasUnsavedCampaignChanges &&
    !queueNeedsReadback &&
    !previewError &&
    Date.now() - previewCheckedAt <= PREVIEW_FRESHNESS_MS &&
    (preview?.eligible ?? 0) > 0;

  function requestSendCampaignDraft() {
    if (!campaignDraft?.id) return;
    const row = campaignRows.find((item) => item.id === campaignDraft.id);
    if (!row) {
      toast.error("找不到此 campaign，請重新整理後再試");
      return;
    }
    requestSendCampaign(row, preview?.eligible ?? 0, previewCheckedAt);
  }

  return (
    <AdminShell
      title="推廣活動"
      description="WhatsApp 群發：只用已審批範本、只發給已同意接收的客戶。"
    >
      {error ? <AdminError message={error} /> : null}
      {queueJournalError ? <AdminError message={queueJournalError} /> : null}
      {cancelJournalError ? <AdminError message={cancelJournalError} /> : null}
      {queueNeedsReadback && !pendingSend ? (
        <div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
          <p>加入佇列結果未能確認。請先讀回 Campaign 狀態；未有重送。</p>
          {confirmError ? <p>{confirmError}</p> : null}
          <Button
            type="button"
            variant="outline"
            disabled={!!mutatingAction}
            onClick={() => void readCampaignQueueOutcome()}
          >
            重新載入 Campaign 狀態
          </Button>
        </div>
      ) : null}

      {cancelNeedsReadback ? (
        <div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
          <p>取消結果待核對。請先查回原 Campaign 狀態；未有重試取消，已發出的訊息無法收回。</p>
          {confirmError ? <p>{confirmError}</p> : null}
          <Button
            type="button"
            variant="outline"
            disabled={!!mutatingAction}
            onClick={() => void readCampaignCancellationOutcome()}
          >
            查回原 Campaign 取消狀態
          </Button>
        </div>
      ) : null}

      <AdminToolbar
        filters={
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(220px,320px)_auto]">
            <div className="space-y-1">
              <Select
                value={selectedPreviewAudienceId || "none"}
                onValueChange={(value) =>
                  setSelectedPreviewAudienceId(value === "none" ? "" : value)
                }
                disabled={!options?.audiences.length}
              >
                <SelectTrigger aria-label="選擇收件群組預覽">
                  <SelectValue placeholder="收件群組預覽" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未選擇群組</SelectItem>
                  {options?.audiences.map((audience) => (
                    <SelectItem key={audience.id} value={audience.id}>
                      {audience.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Link
                to="/admin/segments"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                建立 AI 客戶分群
              </Link>
            </div>
            <Button
              type="button"
              variant="outline"
              // clearRowPreviews: without it the per-row 合資格 counts survived a
              // refresh, so Preview → Refresh → 發送 could fire against a
              // different audience than the number on screen described.
              onClick={() => refreshAdminData({ clearRowPreviews: true })}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              重新整理
            </Button>
          </div>
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const blank = { name: "", description: null, filters: {} };
                setSavedAudienceDraft(blank);
                setAudienceDraft(blank);
              }}
            >
              <Users />
              新增收件群組
            </Button>
            <Button type="button" onClick={openCampaignDialog}>
              <Plus />
              新增 Campaign
            </Button>
          </>
        }
      />

      {!rows && loading ? <Skeleton className="h-72 w-full" /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign 一覽</CardTitle>
            <CardDescription>WhatsApp 範本群發及送達狀況。</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* `rows` is null until the first load answers: rendering the
                「未有 Campaign」 empty state off `campaignRows.length` alone
                painted it under the loading skeleton on every visit. */}
            {!rows ? null : campaignRows.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>範本</TableHead>
                      <TableHead>收件群組</TableHead>
                      <TableHead>收件人預覽</TableHead>
                      <TableHead>送達狀況</TableHead>
                      <TableHead>狀態</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignRows.map((campaign) => {
                      const stamped = rowPreviews[campaign.id];
                      const previewStale = stamped
                        ? Date.now() - stamped.checkedAt > PREVIEW_FRESHNESS_MS
                        : false;
                      const eligible = stamped?.preview.eligible ?? 0;
                      // A stale count must not gate a send: the server
                      // re-materialises the audience at queue time, so an old
                      // number describes an audience that may no longer exist.
                      const queueEnabled =
                        queueJournalReady &&
                        cancelJournalReady &&
                        !cancelNeedsReadback &&
                        isQueueableStatus(campaign.status) &&
                        !!stamped &&
                        !previewStale &&
                        eligible > 0 &&
                        !queueNeedsReadback &&
                        !mutatingAction;
                      const cancelEnabled =
                        cancelJournalReady &&
                        !cancelNeedsReadback &&
                        cancellableStatuses.has(campaign.status) &&
                        !mutatingAction;
                      // FX-10b I2: only when the server says nothing is left to send.
                      const finishEnabled =
                        campaign.finishable === true
                          ? !mutatingAction && !queueNeedsReadback && !cancelNeedsReadback
                          : null;
                      // null: no retry action for this row at all.
                      const retryEnabled =
                        (campaign.retryable_failed ?? 0) > 0 &&
                        retryableStatuses.has(campaign.status)
                          ? !mutatingAction && !queueNeedsReadback && !cancelNeedsReadback
                          : null;

                      return (
                        <TableRow key={campaign.id}>
                          <TableCell className="min-w-48 font-medium">
                            <div>{campaign.name}</div>
                            <div className="text-xs tabular-nums text-muted-foreground">
                              已建立收件人 {campaign.recipients ?? 0}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-44">
                            {campaign.element_name
                              ? `${campaign.element_name}（${campaign.language_code}）`
                              : "—"}
                          </TableCell>
                          <TableCell className="min-w-36">
                            {campaign.audience_name ?? "—"}
                          </TableCell>
                          <TableCell className="min-w-44">
                            {stamped ? (
                              <div className="text-sm">
                                <span className="tabular-nums">
                                  {stamped.preview.eligible} 合資格 / {stamped.preview.optedOut}{" "}
                                  已拒收
                                </span>
                                {previewStale ? (
                                  <div className="text-xs text-destructive">已過期，請重新預覽</div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">未檢查</span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-40">
                            <CampaignDeliveryCell campaign={campaign} />
                          </TableCell>
                          <TableCell>
                            <CampaignStatusBadge
                              status={campaign.status}
                              paused={campaign.paused}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex min-w-80 flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 lg:h-9"
                                onClick={() => handlePreviewCampaignAudience(campaign)}
                                disabled={!campaign.audience_id || !!mutatingAction}
                              >
                                <Eye />
                                預覽收件人
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="h-11 lg:h-9"
                                onClick={() =>
                                  requestSendCampaign(campaign, eligible, stamped?.checkedAt ?? 0)
                                }
                                disabled={!queueEnabled}
                                title={
                                  isQueueableStatus(campaign.status)
                                    ? undefined
                                    : "草稿不可直接發送，請先將狀態改為「待審核」"
                                }
                              >
                                <Send />
                                發送…
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 lg:h-9"
                                onClick={() => {
                                  setConfirmError(null);
                                  setPendingCancel(campaign);
                                }}
                                disabled={!cancelEnabled}
                              >
                                <XCircle />
                                取消 Campaign
                              </Button>
                              {finishEnabled !== null ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-11 lg:h-9"
                                  onClick={() => openFinish(campaign)}
                                  disabled={!finishEnabled}
                                >
                                  <CircleCheck />
                                  結束 Campaign…
                                </Button>
                              ) : null}
                              {/* Managers and admins only: this whole workspace is gated
                                  on those roles and the server re-checks them. The list
                                  count is not consent-aware (Task 3 review M4); the
                                  dialog's preview gives the exact number re-queued. */}
                              {retryEnabled !== null ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-11 lg:h-9"
                                  onClick={() => openRetry(campaign)}
                                  disabled={!retryEnabled}
                                >
                                  <RotateCcw />
                                  重新發送失敗收件人（{campaign.retryable_failed}）
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-6">
                <AdminEmptyState
                  title="未有 Campaign"
                  description="先建立一個 WhatsApp 範本 campaign，才可以整理收件人並發送。"
                  action={
                    <Button type="button" onClick={openCampaignDialog}>
                      <Plus />
                      新增 Campaign
                    </Button>
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">收件人預覽</CardTitle>
              <CardDescription>{activePreview?.label ?? "未選擇收件群組"}</CardDescription>
            </CardHeader>
            <CardContent>
              <PreviewSummary
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRetry={() => setPreviewRetry((value) => value + 1)}
              />
            </CardContent>
          </Card>

          {/* Audiences could be created and then never touched again: no way to
              rename one, correct its filters, or remove a mistake. The server's
              save path has always handled an update via `id`; only the UI to
              reach it was missing. */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">收件群組</CardTitle>
              <CardDescription>編輯名稱、篩選條件，或刪除不再需要的群組。</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {options?.audiences.length ? (
                <ul className="divide-y">
                  {options.audiences.map((audience) => (
                    <li key={audience.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={audience.name}>
                          {audience.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          更新：{formatDate(audience.updated_at)} · 人數請按預覽核實
                        </p>
                        {audience.description ? (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={audience.description}
                          >
                            {audience.description}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 lg:h-9"
                        onClick={() => openAudienceForEdit(audience.id)}
                      >
                        編輯
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 lg:h-9"
                        disabled={!!mutatingAction}
                        onClick={() => {
                          setConfirmError(null);
                          setPendingAudienceDelete(audience);
                        }}
                      >
                        刪除
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-sm text-muted-foreground">
                  未有收件群組。按上方「新增收件群組」建立第一個。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CampaignDialog
        campaign={campaignDraft}
        allowScheduled={
          campaignDraft?.status === "scheduled" || savedCampaignDraft?.status === "scheduled"
        }
        options={options}
        preview={preview}
        previewLoading={previewLoading}
        previewError={previewError}
        onRetryPreview={() => setPreviewRetry((value) => value + 1)}
        saving={saving}
        mutating={!!mutatingAction || !cancelJournalReady || !!cancelNeedsReadback}
        canQueue={canQueueDraft}
        queueBlockReason={queueBlockReason}
        onChange={setCampaignDraft}
        onClose={requestCloseCampaignDialog}
        onSubmit={handleSaveCampaign}
        onQueue={requestSendCampaignDraft}
        onCancel={() => {
          const row = campaignRows.find((item) => item.id === campaignDraft?.id);
          if (!row) return;
          setConfirmError(null);
          setPendingCancel(row);
        }}
      />

      <AudienceDialog
        audience={audienceDraft}
        options={options}
        preview={preview}
        previewLoading={previewLoading}
        previewError={previewError}
        onRetryPreview={() => setPreviewRetry((value) => value + 1)}
        saving={saving}
        onChange={setAudienceDraft}
        onClose={requestCloseAudienceDialog}
        onSubmit={handleSaveAudience}
      />

      {campaignCloseGuard}
      {audienceCloseGuard}
      {leaveGuardDialog}

      <AdminConfirmDialog
        open={!!pendingSend}
        title="確認發送 WhatsApp 群發？"
        description="訊息一經發送即無法收回。請先核對範本與收件人數目。"
        confirmLabel={`確認發送給 ${pendingSend?.eligible ?? 0} 人`}
        confirmVariant="destructive"
        isPending={mutatingAction?.startsWith("queue:") ?? false}
        disabled={
          !providerReviewed ||
          !!queueNeedsReadback ||
          (pendingSend ? Date.now() - pendingSend.checkedAt > PREVIEW_FRESHNESS_MS : true)
        }
        error={confirmError}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSend(null);
            setProviderReviewed(false);
            setConfirmError(null);
          }
        }}
        onConfirm={() => void handleConfirmSend()}
      >
        {pendingSend ? (
          <>
            <SendConfirmationDetails send={pendingSend} />
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={providerReviewed}
                disabled={!!mutatingAction || !!queueNeedsReadback}
                onCheckedChange={(checked) => setProviderReviewed(checked === true)}
              />
              我已在 Woztell
              核對此範本的完整已批准內容、語言、媒體、按鈕及連結目的地，並確認收件人及排除人數。
            </label>
            {queueNeedsReadback ? (
              <Button
                type="button"
                variant="outline"
                disabled={!!mutatingAction}
                onClick={() => void readCampaignQueueOutcome()}
              >
                重新載入 Campaign 狀態
              </Button>
            ) : null}
          </>
        ) : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={!!pendingAudienceDelete}
        title="確認刪除收件群組？"
        description="已完成的 campaign 會失去此群組的連結。此操作無法復原。"
        confirmLabel="刪除收件群組"
        confirmVariant="destructive"
        isPending={mutatingAction?.startsWith("audience-delete:") ?? false}
        error={confirmError}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAudienceDelete(null);
            setConfirmError(null);
          }
        }}
        onConfirm={() => void handleDeleteAudience()}
      >
        {pendingAudienceDelete ? (
          <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <ConfirmRow label="群組名稱" value={pendingAudienceDelete.name} />
            {pendingAudienceDelete.description ? (
              <ConfirmRow label="說明" value={pendingAudienceDelete.description} />
            ) : null}
          </dl>
        ) : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={!!pendingCancel}
        title="取消整個 Campaign？"
        description="尚未發出的收件人會被中止，已發出的訊息無法收回。此操作無法復原。"
        confirmLabel="確認取消 Campaign"
        confirmVariant="destructive"
        disabled={!!cancelNeedsReadback}
        isPending={mutatingAction?.startsWith("cancel") ?? false}
        error={confirmError}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCancel(null);
            setConfirmError(null);
          }
        }}
        onConfirm={() => void handleConfirmCancel()}
      >
        {cancelNeedsReadback ? (
          <Button
            type="button"
            variant="outline"
            disabled={!!mutatingAction}
            onClick={() => void readCampaignCancellationOutcome()}
          >
            查回原 Campaign 取消狀態
          </Button>
        ) : null}
        {pendingCancel ? (
          <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <ConfirmRow label="Campaign" value={pendingCancel.name} />
            <ConfirmRow
              label="尚待發送"
              value={`${pendingCancel.pending ?? 0} 人`}
              emphasis={(pendingCancel.pending ?? 0) > 0}
            />
            <ConfirmRow label="已發送" value={`${pendingCancel.sent ?? 0} 人（無法收回）`} />
          </dl>
        ) : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={!!pendingRetry}
        title="重新發送失敗收件人？"
        description="只會重新排入確定未送出的收件人。Campaign 會回到「待審核」，要再按「發送…」確認後才會發出。"
        confirmLabel={`重新排入 ${retryPreview?.retryable ?? 0} 人`}
        disabled={
          !retryPreview ||
          !!retryPreviewError ||
          retryPreview.retryable <= 0 ||
          retryOutcomeUnknown ||
          !!queueNeedsReadback ||
          !!cancelNeedsReadback
        }
        isPending={mutatingAction?.startsWith("retry:") ?? false}
        error={retryPreviewError ?? confirmError}
        onOpenChange={(open) => {
          if (!open) closeRetry();
        }}
        onConfirm={() => void handleConfirmRetry()}
      >
        {pendingRetry ? (
          <RetryConfirmationDetails
            campaignName={pendingRetry.name}
            preview={retryPreview}
            loading={!retryPreview && !retryPreviewError}
          />
        ) : null}
        {queueNeedsReadback || cancelNeedsReadback ? (
          <p className="text-sm text-muted-foreground">{READBACK_BLOCKS_RETRY}</p>
        ) : null}
        {retryOutcomeUnknown ? (
          <Button
            type="button"
            variant="outline"
            disabled={!!mutatingAction}
            onClick={() => void reloadRetryState()}
          >
            重新讀取最新數字
          </Button>
        ) : null}
      </AdminConfirmDialog>
      <AdminConfirmDialog
        open={!!pendingFinish}
        title="結束 Campaign（沒有尚待發送收件人）"
        description="此 Campaign 已開始發送，但伺服器確認目前沒有可發送的收件人。結束後，仍在等候的收件人會標示為不發送，Campaign 會按實際結果顯示為「已完成」或「失敗」，不會標示為「已取消」。此操作不會發出任何訊息。"
        confirmLabel="結束 Campaign"
        disabled={
          !finishPreview?.finishable ||
          !!finishPreviewError ||
          !!queueNeedsReadback ||
          !!cancelNeedsReadback
        }
        isPending={mutatingAction?.startsWith("finish:") ?? false}
        error={finishPreviewError ?? confirmError}
        onOpenChange={(open) => {
          if (!open) closeFinish();
        }}
        onConfirm={() => void handleConfirmFinish()}
      >
        {pendingFinish ? (
          <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
            <ConfirmRow label="Campaign" value={pendingFinish.name} />
            <ConfirmRow label="已發送" value={`${pendingFinish.sent ?? 0} 人`} />
            <ConfirmRow label="仍在等候（不會發送）" value={`${pendingFinish.pending ?? 0} 人`} />
          </dl>
        ) : null}
        {pendingFinish && !finishPreview && !finishPreviewError ? (
          <p className="text-sm text-muted-foreground">正在核對尚待發送人數…</p>
        ) : null}
      </AdminConfirmDialog>
    </AdminShell>
  );
}

function CampaignDialog({
  campaign,
  allowScheduled,
  options,
  preview,
  previewLoading,
  previewError,
  onRetryPreview,
  saving,
  mutating,
  canQueue,
  queueBlockReason,
  onChange,
  onClose,
  onSubmit,
  onQueue,
  onCancel,
}: {
  campaign: AdminCampaignInput | null;
  /** Only a campaign that is (or was loaded as) 已排期 may keep that status. */
  allowScheduled: boolean;
  options: AdminBlastOptions | null;
  preview: AdminAudiencePreview | null;
  previewLoading: boolean;
  previewError: string | null;
  onRetryPreview: () => void;
  saving: boolean;
  mutating: boolean;
  canQueue: boolean;
  queueBlockReason: string | null;
  onChange: (campaign: AdminCampaignInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQueue: () => void;
  onCancel: () => void;
}) {
  const canCancel = Boolean(campaign?.id && cancellableStatuses.has(campaign.status));

  return (
    <Dialog open={!!campaign} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{campaign?.id ? "編輯 Campaign" : "新增 Campaign"}</DialogTitle>
          <DialogDescription>範本、收件群組、預定時間及狀態。</DialogDescription>
        </DialogHeader>
        {campaign ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Campaign 名稱"
                value={campaign.name}
                onChange={(value) => onChange({ ...campaign, name: value })}
                required
              />
              <Field label="範本">
                <Select
                  value={campaign.template_id ?? "none"}
                  onValueChange={(value) =>
                    onChange({ ...campaign, template_id: value === "none" ? null : value })
                  }
                >
                  <SelectTrigger aria-label="Campaign template">
                    <SelectValue placeholder="選擇範本" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選擇範本</SelectItem>
                    {options?.templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.element_name}（{template.language_code}）·{" "}
                        {templateStatusLabel(template.status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="收件群組">
                <Select
                  value={campaign.audience_id ?? "none"}
                  onValueChange={(value) =>
                    onChange({ ...campaign, audience_id: value === "none" ? null : value })
                  }
                >
                  <SelectTrigger aria-label="Campaign audience">
                    <SelectValue placeholder="選擇收件群組" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選擇收件群組</SelectItem>
                    {options?.audiences.map((audience) => (
                      <SelectItem key={audience.id} value={audience.id}>
                        {audience.name} · {audience.description || "未填用途"} · 更新{" "}
                        {formatDate(audience.updated_at)} · 人數待預覽
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="狀態">
                <Select
                  value={campaign.status}
                  onValueChange={(value) =>
                    onChange({ ...campaign, status: value as AdminCampaignInput["status"] })
                  }
                >
                  <SelectTrigger aria-label="Campaign status">
                    <SelectValue placeholder="選擇狀態" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿（不可發送）</SelectItem>
                    <SelectItem value="review">待審核</SelectItem>
                    {/* FX-17a D-13: nothing ever delivered on a schedule, so a
                        new campaign cannot pick 已排期. An existing 已排期 row
                        keeps it so the Select is never blank; it is sent, like
                        待審核, only through 發送…. */}
                    {allowScheduled ? <SelectItem value="scheduled">已排期</SelectItem> : null}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <TemplateDetails
              template={options?.templates.find((item) => item.id === campaign.template_id) ?? null}
            />

            <div className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">收件人預覽</h3>
                  <p className="text-xs text-muted-foreground">合資格人數大於 0 才可發送。</p>
                </div>
                <Badge variant={(preview?.eligible ?? 0) > 0 ? "default" : "outline"}>
                  {preview?.eligible ?? 0} 合資格
                </Badge>
              </div>
              <PreviewSummary
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRetry={onRetryPreview}
              />
            </div>

            <DialogFooter className="gap-2">
              {/* 取消整個 Campaign is pushed to the far left, away from 關閉: it used
                  to read "Cancel" and sit beside "Close", so the button that
                  kills a possibly mid-send campaign looked like the one that
                  dismisses the dialog. */}
              {campaign.id ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  onClick={onCancel}
                  disabled={!canCancel || saving || mutating}
                >
                  <XCircle />
                  取消整個 Campaign
                </Button>
              ) : null}
              {queueBlockReason ? (
                <p className="self-center text-sm text-muted-foreground">{queueBlockReason}</p>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                關閉
              </Button>
              <Button type="submit" disabled={saving || mutating}>
                <Save />
                儲存
              </Button>
              <Button type="button" onClick={onQueue} disabled={!canQueue || saving || mutating}>
                <Send />
                發送…
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AudienceDialog({
  audience,
  options,
  preview,
  previewLoading,
  previewError,
  onRetryPreview,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  audience: AdminAudienceInput | null;
  options: AdminBlastOptions | null;
  preview: AdminAudiencePreview | null;
  previewLoading: boolean;
  previewError: string | null;
  onRetryPreview: () => void;
  saving: boolean;
  onChange: (audience: AdminAudienceInput | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={!!audience} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>收件群組編輯</DialogTitle>
          <DialogDescription>名稱、說明及客戶篩選條件。</DialogDescription>
        </DialogHeader>
        {audience ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="群組名稱"
                value={audience.name}
                onChange={(value) => onChange({ ...audience, name: value })}
                required
              />
              <TextField
                label="說明"
                value={audience.description ?? ""}
                onChange={(value) => onChange({ ...audience, description: nullIfBlank(value) })}
              />
              <Field label="意向">
                <Select
                  value={audience.filters.intent ?? "any"}
                  onValueChange={(value) =>
                    onChange({
                      ...audience,
                      filters: {
                        ...audience.filters,
                        intent: value === "any" ? undefined : value,
                      },
                    })
                  }
                >
                  <SelectTrigger aria-label="Audience intent">
                    <SelectValue placeholder="選擇意向" />
                  </SelectTrigger>
                  <SelectContent>
                    {intentOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <TextField
                label="來源"
                value={audience.filters.source ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: { ...audience.filters, source: undefinedIfBlank(value) },
                  })
                }
              />
              <Field label="屋苑（可選多個）">
                <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                  {options?.estates.length ? (
                    options.estates.map((estate) => (
                      <label
                        key={estate.slug}
                        className="flex items-center gap-2 px-2 py-1 text-sm"
                      >
                        <Checkbox
                          checked={audience.filters.estates?.includes(estate.slug) ?? false}
                          onCheckedChange={(checked) => {
                            const selected = new Set(audience.filters.estates ?? []);
                            if (checked === true) selected.add(estate.slug);
                            else selected.delete(estate.slug);
                            onChange({
                              ...audience,
                              filters: {
                                ...audience.filters,
                                estates: selected.size ? [...selected] : undefined,
                              },
                            });
                          }}
                        />
                        {estate.name}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">沒有可選屋苑</p>
                  )}
                </div>
              </Field>
              <Field label="地區">
                <Select
                  value={audience.filters.district_slug ?? "any"}
                  onValueChange={(value) =>
                    onChange({
                      ...audience,
                      filters: {
                        ...audience.filters,
                        district_slug: value === "any" ? undefined : value,
                      },
                    })
                  }
                >
                  <SelectTrigger aria-label="Audience district">
                    <SelectValue placeholder="選擇地區" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">所有地區</SelectItem>
                    {options?.districts.map((district) => (
                      <SelectItem key={district.slug} value={district.slug}>
                        {district.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="負責同事">
                <Select
                  value={audience.filters.assigned_agent_id ?? "any"}
                  onValueChange={(value) =>
                    onChange({
                      ...audience,
                      filters: {
                        ...audience.filters,
                        assigned_agent_id: value === "any" ? undefined : value,
                      },
                    })
                  }
                >
                  <SelectTrigger aria-label="Audience agent">
                    <SelectValue placeholder="選擇同事" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">所有同事</SelectItem>
                    {options?.agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                        {agent.branch ? `（${agent.branch}）` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <TextField
                label="預算下限（HKD）"
                type="number"
                value={audience.filters.budget_min?.toString() ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: { ...audience.filters, budget_min: undefinedIfBlankNumber(value) },
                  })
                }
              />
              <TextField
                label="預算上限（HKD）"
                type="number"
                value={audience.filters.budget_max?.toString() ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: { ...audience.filters, budget_max: undefinedIfBlankNumber(value) },
                  })
                }
              />
              <TextField
                label="最近幾天內查詢"
                type="number"
                value={audience.filters.last_activity_days?.toString() ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: {
                      ...audience.filters,
                      last_activity_days: undefinedIfBlankNumber(value),
                    },
                  })
                }
              />
              <Field label="WhatsApp 同意接收">
                <label className="flex h-10 items-center gap-2 text-sm">
                  <Checkbox
                    checked={audience.filters.require_whatsapp_opt_in === true}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...audience,
                        filters: {
                          ...audience.filters,
                          require_whatsapp_opt_in: checked === true ? true : undefined,
                        },
                      })
                    }
                  />
                  只包含已同意接收 WhatsApp 的客戶
                </label>
              </Field>
            </div>

            <div className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">收件人預覽</h3>
                <Badge variant={(preview?.optedOut ?? 0) > 0 ? "outline" : "secondary"}>
                  {preview?.optedOut ?? 0} 已拒收
                </Badge>
              </div>
              <PreviewSummary
                preview={preview}
                loading={previewLoading}
                error={previewError}
                onRetry={onRetryPreview}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                關閉
              </Button>
              <Button type="submit" disabled={saving}>
                <Save />
                儲存收件群組
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewSummary({
  preview,
  loading,
  error,
  onRetry,
}: {
  preview: AdminAudiencePreview | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 p-4 text-sm text-destructive"
      >
        收件人預覽失敗：{error}
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="ml-2" onClick={onRetry}>
            重試
          </Button>
        ) : null}
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        未選擇收件群組
      </div>
    );
  }

  const items = [
    { label: "總數", value: preview.total },
    { label: "合資格（電話去重）", value: preview.eligible },
    { label: "不合資格（按收件人去重）", value: preview.uniqueExcluded },
    { label: "已拒收", value: preview.optedOut },
    { label: "沒有電話", value: preview.missingPhone },
    { label: "未同意接收", value: preview.notOptedIn },
    { label: "身分待核實", value: preview.identityUnsafe },
    { label: "重複電話", value: preview.duplicatePhone },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">排除原因可重疊；不合資格總數按收件人去重。</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {items.map((item) => (
          <div key={item.label} className="rounded-md border bg-background p-3">
            <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold tracking-normal">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Per-recipient outcome for one campaign. Before this, a blast where 800 of
 * 1000 sends failed rendered identically to a clean one -- the row showed only
 * the materialised total next to a Completed badge. */
function CampaignDeliveryCell({ campaign }: { campaign: AdminCampaignRow }) {
  const sent = campaign.sent ?? 0;
  const failed = campaign.failed ?? 0;
  const blocked = campaign.blocked ?? 0;
  // Paused rows are queued rows too; count them once, under their own label.
  const paused = campaign.paused ?? 0;
  const pending = Math.max(0, (campaign.pending ?? 0) - paused);

  if (!campaign.recipients) {
    return <span className="text-sm text-muted-foreground">未發送</span>;
  }

  return (
    <div className="space-y-1 text-sm tabular-nums">
      <div>已發送 {sent}</div>
      {(campaign.dispatching ?? 0) > 0 ? <div>已開始傳送 {campaign.dispatching}</div> : null}
      {(campaign.cancelled ?? 0) > 0 ? <div>已取消 {campaign.cancelled}</div> : null}
      {(campaign.unknown ?? 0) > 0 ? (
        <div className="font-semibold text-destructive">
          結果未明（請先核實，勿重發）{campaign.unknown}
        </div>
      ) : null}
      {failed > 0 ? <div className="font-semibold text-destructive">失敗 {failed}</div> : null}
      {blocked > 0 ? <div className="text-muted-foreground">封鎖 {blocked}</div> : null}
      {paused > 0 ? (
        <div className="font-semibold text-destructive">已暫停，未發送 {paused}</div>
      ) : null}
      {pending > 0 ? <div className="text-muted-foreground">待發送 {pending}</div> : null}
    </div>
  );
}

/** Everything this system knows about the selected template. The approved body
 * text is held by Woztell and never mirrored into this database, so it is named
 * as absent rather than quietly omitted -- staff were queueing blasts having
 * seen nothing but an element_name. */
function TemplateDetails({
  template,
}: {
  template: AdminBlastOptions["templates"][number] | null;
}) {
  if (!template) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        未選擇範本。
      </div>
    );
  }

  const parameters = describeTemplateParameters(template.components);

  return (
    <div className="rounded-md border p-4">
      <h3 className="text-sm font-medium">範本內容</h3>
      <dl className="mt-2 grid gap-1 text-sm">
        <ConfirmRow label="範本名稱" value={template.element_name} />
        <ConfirmRow label="語言" value={template.language_code} />
        <ConfirmRow label="分類" value={template.category || "—"} />
        <ConfirmRow
          label="審批狀態"
          value={templateStatusLabel(template.status)}
          emphasis={!template.status.startsWith("active")}
        />
        {template.description ? <ConfirmRow label="說明" value={template.description} /> : null}
      </dl>

      {parameters.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">將會填入的內容</p>
          <dl className="mt-1 grid gap-1 text-sm">
            {parameters.map((line, index) => (
              <ConfirmRow key={`${line.label}-${index}`} label={line.label} value={line.value} />
            ))}
          </dl>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">此範本沒有可變內容。</p>
      )}

      <p role="status" className="mt-3 rounded-md border border-amber-500/40 p-3 text-sm">
        preview_unavailable：本系統無法取得已批准範本全文及版本。請到 Woztell 核對內文、
        變數、媒體、按鈕和連結目的地；這裡顯示的只是發送參數，不代表範本預覽完成。
      </p>
    </div>
  );
}

function SendConfirmationDetails({ send }: { send: PendingSend }) {
  return (
    <div className="space-y-3">
      <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
        <ConfirmRow label="Campaign" value={send.campaignName} />
        <ConfirmRow label="範本" value={send.templateLabel} />
        <ConfirmRow label="收件群組" value={send.audienceLabel} />
        {send.deliveryStarted ? (
          <>
            <ConfirmRow label="已發送（不會重發）" value={`${send.sent} 人`} />
            <ConfirmRow label="尚待發送收件人" value={`${send.eligible} 人`} emphasis />
          </>
        ) : (
          <ConfirmRow label="合資格收件人" value={`${send.eligible} 人`} emphasis />
        )}
      </dl>
      {send.deliveryStarted ? (
        // role="status": informational, and kept apart from the dialog's error alert.
        <Alert role="status">
          <AlertDescription>
            此 Campaign 曾經發送。這次只會發送給尚待發送的收件人，不會加入新符合條件的客戶。
          </AlertDescription>
        </Alert>
      ) : null}
      <TemplateDetails template={send.template} />
    </div>
  );
}

function ConfirmRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={emphasis ? "font-semibold" : undefined}>{value}</dd>
    </div>
  );
}

/** What the retry confirmation promises: the exact re-queue count from the
 * preview, what a re-approval would then send, every exclusion as a count, and
 * the 結果未明 recipients by name only. No phone or member id is ever shown. */
function RetryConfirmationDetails({
  campaignName,
  preview,
  loading,
}: {
  campaignName: string;
  preview: AdminCampaignRetryPreview | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2" role="status" aria-busy="true">
        <span className="sr-only">載入中…</span>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    );
  }
  if (!preview) return null;
  const unlisted = Math.max(0, preview.unknownTotal - preview.unknown.length);

  return (
    <div className="space-y-3">
      <dl className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
        <ConfirmRow label="Campaign" value={campaignName} />
        <ConfirmRow label="將重新排入" value={`${preview.retryable} 人`} emphasis />
        {preview.alreadyQueued > 0 ? (
          <>
            <ConfirmRow label="已在佇列（暫停時未發送）" value={`${preview.alreadyQueued} 人`} />
            <ConfirmRow
              label="按「發送…」確認後最多發送"
              value={`${preview.retryable + preview.alreadyQueued} 人`}
              emphasis
            />
          </>
        ) : null}
        {preview.exclusions
          .filter((item) => item.count > 0)
          .map((item) => (
            <ConfirmRow
              key={item.reason}
              label={retryExclusionLabels[item.reason] ?? item.reason}
              value={`${item.count} 人`}
            />
          ))}
        {preview.unknownTotal > 0 ? (
          <ConfirmRow
            label="結果未明（請先核實，勿重發）"
            value={`${preview.unknownTotal} 人`}
            emphasis
          />
        ) : null}
      </dl>
      {preview.retryable <= 0 ? (
        <p className="text-sm text-muted-foreground">{ADMIN_ERROR_CODES.NOTHING_TO_RETRY}</p>
      ) : null}
      {preview.unknownTotal > 0 ? (
        <div className="rounded-md border border-destructive/30 p-3 text-sm">
          <p className="font-medium">以下收件人結果未明，不會重新發送：</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {preview.unknown.map((item) => (
              <li key={item.recipientId} className="break-words">
                {item.name ?? "（未有名稱）"}・開始傳送 {formatDate(item.dispatchedAt)}
              </li>
            ))}
          </ul>
          {unlisted > 0 ? (
            <p className="mt-2 text-muted-foreground">另有 {unlisted} 人未列出</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CampaignStatusBadge({ status, paused }: { status: string; paused?: number }) {
  // A paused campaign is held in 待審核 (no new status, no migration): staff
  // must see why it stopped and that it needs 發送… again.
  if (status === "review" && (paused ?? 0) > 0)
    return (
      <Badge variant="destructive" className="whitespace-nowrap">
        已暫停
      </Badge>
    );
  const variant =
    status === "failed" || status === "cancelled"
      ? "destructive"
      : status === "queued" || status === "sending"
        ? "default"
        : status === "completed"
          ? "secondary"
          : "outline";

  return (
    <Badge variant={variant} className="whitespace-nowrap">
      {campaignStatusLabels[status] ?? status}
    </Badge>
  );
}

// A wrapping <label> associates the text with the first form control inside
// it -- the previous `<Label>` sat beside the control with no htmlFor, so
// screen readers announced every dialog field as unlabelled.
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
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <Field label={label}>
      <Input
        type={type}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        required={required}
      />
    </Field>
  );
}

/** Mirrors the approval vocabulary used elsewhere; an unapproved template is
 * the most common reason a send is refused, so it must not read as a code. */
function templateStatusLabel(status: string) {
  if (status.startsWith("active")) return "已審批";
  if (status === "rejected") return "已拒絕";
  if (status === "pending") return "審批中";
  return status || "未知";
}

function isQueueableStatus(status: string) {
  return queueableStatuses.has(status);
}

function audienceLabel(options: AdminBlastOptions | null, id: string) {
  return options?.audiences.find((audience) => audience.id === id)?.name ?? null;
}

function normalizeAudienceFilters(filters: AdminAudienceInput["filters"]) {
  return {
    intent: undefinedIfBlank(filters.intent ?? ""),
    source: undefinedIfBlank(filters.source ?? ""),
    estates: filters.estates?.length ? filters.estates : undefined,
    district_slug: undefinedIfBlank(filters.district_slug ?? ""),
    assigned_agent_id: undefinedIfBlank(filters.assigned_agent_id ?? ""),
    budget_min: filters.budget_min,
    budget_max: filters.budget_max,
    last_activity_days: filters.last_activity_days,
    require_whatsapp_opt_in: filters.require_whatsapp_opt_in,
  };
}

function undefinedIfBlankNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nullIfBlank(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function undefinedIfBlank(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-HK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function assertNoServerError(result: unknown) {
  if (!result || typeof result !== "object") return;
  const payload = result as MutationResult;
  if (payload.ok === false) throw new Error(payload.error ?? "操作失敗");
  if (payload.error) throw new Error(payload.error);
}

/** Staff copy for a server code; never the raw code itself. */
function campaignErrorText(code: string) {
  if (code === "Not found") return "找不到此 campaign，請重新整理後再試";
  return ADMIN_ERROR_CODES[code] ?? "操作失敗，請重試。";
}

/** Staff copy for a known code inside an error, or "" so callers that add it
 * to an "outcome unknown" sentence never append a contradicting fallback. */
function knownCampaignErrorText(error: unknown) {
  const code = errorCode(error);
  return campaignErrorText(code) === "操作失敗，請重試。" ? "" : campaignErrorText(code);
}

/** 401 and 403 are definite refusals with their own copy (the wording used
 * on the CMS screen); anything else gets the caller's fallback. */
function staffErrorText(error: unknown, fallback: string) {
  const status = serverErrorStatus(error);
  if (status === 401) return "登入已過期，請重新登入後再試。";
  if (status === 403) return "你的角色沒有此操作的權限，請聯絡管理員或主管。";
  return fallback;
}

/** The raw server code, for the lookups below that key on it. */
function errorCode(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function errorText(error: unknown) {
  return adminErrorMessage(error);
}
