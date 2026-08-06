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
import { Eye, Plus, RefreshCw, Save, Send, Users, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
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
import { useDirtyCloseGuard } from "@/hooks/use-unsaved-changes-guard";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import { describeTemplateParameters } from "@/lib/woztell/template-preview";
import {
  cancelAdminCampaign,
  fetchAdminBlastOptions,
  fetchAdminCampaigns,
  previewAdminAudience,
  sendAdminCampaignQueue,
  saveAdminAudience,
  saveAdminCampaign,
} from "@/lib/neon/admin-data";
import type {
  AdminAudienceInput,
  AdminAudiencePreview,
  AdminBlastOptions,
  AdminCampaignInput,
  AdminCampaignRow,
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
};

// `draft` is deliberately excluded, mirroring canPrepareAdminCampaignQueue --
// the page promises 「審核後排程發送」, so a draft must be moved to 待審核 before it
// can reach a customer. Keeping the two in sync matters: if the client allowed
// draft the server would reject it with a raw INVALID_CAMPAIGN_STATUS.
const queueableStatuses = new Set(["review", "scheduled"]);
const cancellableStatuses = new Set(["draft", "review", "scheduled", "queued", "sending"]);

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
  const { user } = useNeonAuth();
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
  // Stamped with the fetch time: Queue must never be enabled by a count the
  // operator saw minutes ago, because the server materialises a fresh audience
  // at send time.
  const [rowPreviews, setRowPreviews] = useState<Record<string, StampedPreview>>({});
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const [pendingCancel, setPendingCancel] = useState<AdminCampaignRow | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [savedAudienceDraft, setSavedAudienceDraft] = useState<AdminAudienceInput | null>(null);
  // Staleness is derived from Date.now() at render, so without a tick a preview
  // would keep looking fresh until some other state change happened to
  // re-render the table -- and 發送 would stay enabled on an expired count.
  const [, setStaleTick] = useState(0);
  const previewRequestRef = useRef(0);
  const hasRowPreviews = Object.keys(rowPreviews).length > 0;

  const refreshAdminData = useCallback(
    async (settings: { clearRowPreviews?: boolean } = {}) => {
      if (!user) return;
      setLoading(true);
      try {
        const [campaignRows, blastOptions] = await Promise.all([
          fetchAdminCampaigns(),
          fetchAdminBlastOptions(),
        ]);
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
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [user],
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
      setPreviewLoading(false);
      return;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreview(null);
    setPreviewLoading(true);

    const timeout = window.setTimeout(
      () => {
        previewAdminAudience({ data: activePreview.data })
          .then((data) => {
            if (requestId === previewRequestRef.current) {
              setPreview(data as AdminAudiencePreview);
            }
          })
          .catch((err) => {
            if (requestId === previewRequestRef.current) {
              toast.error(errorText(err));
              setPreview(null);
            }
          })
          .finally(() => {
            if (requestId === previewRequestRef.current) setPreviewLoading(false);
          });
      },
      activePreview.debounce ? 300 : 0,
    );

    return () => window.clearTimeout(timeout);
  }, [activePreview, user]);

  function openCampaignDialog() {
    const template =
      options?.templates.find((item) => item.status.startsWith("active")) ?? options?.templates[0];
    const audienceId = selectedPreviewAudienceId || options?.audiences[0]?.id || null;
    setSavedCampaignDraft(null);
    setCampaignDraft({
      name: "",
      template_id: template?.id ?? null,
      audience_id: audienceId,
      status: "draft",
      scheduled_at: null,
    });
  }

  function closeCampaignDialog() {
    setCampaignDraft(null);
    setSavedCampaignDraft(null);
  }

  async function handleSaveAudience(event: FormEvent<HTMLFormElement>) {
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
      const result = (await saveAdminAudience({ data: payload })) as MutationResult;
      assertNoServerError(result);
      setSavedAudienceDraft(payload);
      if (result.id) setSelectedPreviewAudienceId(result.id);
      await refreshAdminData({ clearRowPreviews: true });
      setAudienceDraft(null);
      setSavedAudienceDraft(null);
      toast.success("收件群組已儲存");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignDraft) return;
    if (!campaignDraft.name.trim() || !campaignDraft.template_id || !campaignDraft.audience_id) {
      toast.error("請填寫 campaign 名稱、範本及收件群組");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...campaignDraft,
        name: campaignDraft.name.trim(),
        scheduled_at: nullIfBlank(campaignDraft.scheduled_at ?? ""),
      };
      const result = (await saveAdminCampaign({ data: payload })) as MutationResult;
      assertNoServerError(result);
      const id = result.id || campaignDraft.id;
      const savedDraft = { ...payload, id };
      setCampaignDraft(savedDraft);
      setSavedCampaignDraft(savedDraft);
      await refreshAdminData({ clearRowPreviews: true });
      toast.success(id ? "Campaign 已儲存" : "Campaign 已新增");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function handlePreviewCampaignAudience(campaign: AdminCampaignRow) {
    if (!campaign.audience_id) {
      toast.error("此 campaign 未設定收件群組");
      return;
    }

    const action = `preview:${campaign.id}`;
    setMutatingAction(action);
    try {
      const data = (await previewAdminAudience({
        data: { audience_id: campaign.audience_id },
      })) as AdminAudiencePreview;
      setRowPreviews((current) => ({
        ...current,
        [campaign.id]: { preview: data, checkedAt: Date.now() },
      }));
      setSelectedPreviewAudienceId(campaign.audience_id);
      setPreview(data);
      toast.success("收件人預覽已更新");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  /** Opens the send confirmation. Nothing is dispatched here -- this is the
   * interstitial that used to be missing entirely, so a mis-click on Queue sent
   * thousands of irreversible WhatsApp messages. */
  function requestSendCampaign(campaign: AdminCampaignRow, eligible: number) {
    if (eligible <= 0) {
      toast.error("沒有合資格收件人");
      return;
    }
    const template = options?.templates.find((item) => item.id === campaign.template_id) ?? null;
    setConfirmError(null);
    setPendingSend({
      campaignId: campaign.id,
      campaignName: campaign.name,
      templateLabel: template
        ? `${template.element_name}（${template.language_code}）`
        : (campaign.element_name ?? "未設定範本"),
      audienceLabel: campaign.audience_name ?? "未設定收件群組",
      eligible,
      template,
    });
  }

  async function handleConfirmSend() {
    if (!pendingSend) return;
    const action = `queue:${pendingSend.campaignId}`;
    setMutatingAction(action);
    setConfirmError(null);
    try {
      const result = (await sendAdminCampaignQueue({
        data: { id: pendingSend.campaignId },
      })) as MutationResult & {
        materialization?: Partial<AdminAudiencePreview>;
      };
      assertNoServerError(result);

      await refreshAdminData({ clearRowPreviews: true });
      setCampaignDraft(null);
      setPendingSend(null);
      toast.success(
        `已發送給 ${result.materialization?.eligible ?? pendingSend.eligible} 位合資格收件人`,
      );
    } catch (err) {
      // Kept inside the dialog rather than behind it: the operator needs the
      // reason next to the action they just authorised.
      setConfirmError(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  async function handleConfirmCancel() {
    if (!pendingCancel) return;
    const campaignId = pendingCancel.id;
    const action = `cancel:${campaignId}`;
    setMutatingAction(action);
    setConfirmError(null);
    try {
      const result = (await cancelAdminCampaign({ data: { id: campaignId } })) as MutationResult;
      assertNoServerError(result);
      await refreshAdminData({ clearRowPreviews: true });
      if (campaignDraft?.id === campaignId) closeCampaignDialog();
      setPendingCancel(null);
      toast.success("Campaign 已取消");
    } catch (err) {
      setConfirmError(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  const campaignRows = rows ?? [];
  const canSubmitCampaign =
    Boolean(campaignDraft?.id) && isQueueableStatus(campaignDraft?.status ?? "");
  const hasUnsavedCampaignChanges = Boolean(
    campaignDraft &&
    (!savedCampaignDraft ||
      campaignDraftSignature(campaignDraft) !== campaignDraftSignature(savedCampaignDraft)),
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

  const queueBlockReason = hasUnsavedCampaignChanges
    ? "請先儲存變更才可發送"
    : campaignDraft && !isQueueableStatus(campaignDraft.status)
      ? "草稿不可直接發送，請先將狀態改為「待審核」"
      : null;
  const canQueueDraft =
    canSubmitCampaign && !hasUnsavedCampaignChanges && (preview?.eligible ?? 0) > 0;

  function requestSendCampaignDraft() {
    if (!campaignDraft?.id) return;
    const row = campaignRows.find((item) => item.id === campaignDraft.id);
    if (!row) {
      toast.error("找不到此 campaign，請重新整理後再試");
      return;
    }
    requestSendCampaign(row, preview?.eligible ?? 0);
  }

  return (
    <AdminShell title="WhatsApp 群發" description="只用已審批範本、只發給已同意接收的客戶。">
      {error ? <AdminError message={error} /> : null}

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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign 一覽</CardTitle>
            <CardDescription>WhatsApp 範本群發及送達狀況。</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {campaignRows.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>範本</TableHead>
                      <TableHead>收件群組</TableHead>
                      <TableHead>收件人預覽</TableHead>
                      <TableHead>送達狀況</TableHead>
                      <TableHead>預定時間</TableHead>
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
                        isQueueableStatus(campaign.status) &&
                        !!stamped &&
                        !previewStale &&
                        eligible > 0 &&
                        !mutatingAction;
                      const cancelEnabled =
                        cancellableStatuses.has(campaign.status) && !mutatingAction;

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
                          <TableCell className="min-w-36">
                            {formatDate(campaign.scheduled_at)}
                          </TableCell>
                          <TableCell>
                            <CampaignStatusBadge status={campaign.status} />
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
                                onClick={() => requestSendCampaign(campaign, eligible)}
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

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">收件人預覽</CardTitle>
            <CardDescription>{activePreview?.label ?? "未選擇收件群組"}</CardDescription>
          </CardHeader>
          <CardContent>
            <PreviewSummary preview={preview} loading={previewLoading} />
          </CardContent>
        </Card>
      </div>

      <CampaignDialog
        campaign={campaignDraft}
        options={options}
        preview={preview}
        previewLoading={previewLoading}
        saving={saving}
        mutating={!!mutatingAction}
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
        preview={preview}
        previewLoading={previewLoading}
        saving={saving}
        onChange={setAudienceDraft}
        onClose={requestCloseAudienceDialog}
        onSubmit={handleSaveAudience}
      />

      {campaignCloseGuard}
      {audienceCloseGuard}

      <AdminConfirmDialog
        open={!!pendingSend}
        title="確認發送 WhatsApp 群發？"
        description="訊息一經發送即無法收回。請先核對範本與收件人數目。"
        confirmLabel={`確認發送給 ${pendingSend?.eligible ?? 0} 人`}
        confirmVariant="destructive"
        isPending={mutatingAction?.startsWith("queue:") ?? false}
        error={confirmError}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSend(null);
            setConfirmError(null);
          }
        }}
        onConfirm={() => void handleConfirmSend()}
      >
        {pendingSend ? <SendConfirmationDetails send={pendingSend} /> : null}
      </AdminConfirmDialog>

      <AdminConfirmDialog
        open={!!pendingCancel}
        title="取消整個 Campaign？"
        description="尚未發出的收件人會被中止，已發出的訊息無法收回。此操作無法復原。"
        confirmLabel="確認取消 Campaign"
        confirmVariant="destructive"
        isPending={mutatingAction?.startsWith("cancel:") ?? false}
        error={confirmError}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCancel(null);
            setConfirmError(null);
          }
        }}
        onConfirm={() => void handleConfirmCancel()}
      >
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
    </AdminShell>
  );
}

function CampaignDialog({
  campaign,
  options,
  preview,
  previewLoading,
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
  options: AdminBlastOptions | null;
  preview: AdminAudiencePreview | null;
  previewLoading: boolean;
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
                        {audience.name}
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
                    <SelectItem value="scheduled">已排期</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {/* Labelled 「僅作記錄」 because nothing delivers on it: the cron in
                  api.admin.jobs.send-queue.ts only picks up campaigns already in
                  queued/sending, so scheduled_at is never read by any delivery
                  path. Staff previously set a date here and reasonably expected
                  the blast to go out then. Implementing real scheduling means
                  enabling unattended sending, which is the owner's call. */}
              <div>
                <TextField
                  label="預定發送時間（僅作記錄）"
                  type="datetime-local"
                  value={campaign.scheduled_at ?? ""}
                  onChange={(value) => onChange({ ...campaign, scheduled_at: nullIfBlank(value) })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  系統不會自動發送。到時仍需人手按「發送…」。
                </p>
              </div>
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
              <PreviewSummary preview={preview} loading={previewLoading} />
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
  preview,
  previewLoading,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  audience: AdminAudienceInput | null;
  preview: AdminAudiencePreview | null;
  previewLoading: boolean;
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
              <TextField
                label="屋苑 slug"
                value={audience.filters.estate ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: { ...audience.filters, estate: undefinedIfBlank(value) },
                  })
                }
              />
              <TextField
                label="負責代理 ID"
                value={audience.filters.assigned_agent_id ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: {
                      ...audience.filters,
                      assigned_agent_id: undefinedIfBlank(value),
                    },
                  })
                }
              />
            </div>

            <div className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">收件人預覽</h3>
                <Badge variant={(preview?.optedOut ?? 0) > 0 ? "outline" : "secondary"}>
                  {preview?.optedOut ?? 0} 已拒收
                </Badge>
              </div>
              <PreviewSummary preview={preview} loading={previewLoading} />
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
}: {
  preview: AdminAudiencePreview | null;
  loading: boolean;
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

  if (!preview) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        未選擇收件群組
      </div>
    );
  }

  const items = [
    { label: "總數", value: preview.total },
    { label: "合資格", value: preview.eligible },
    { label: "已拒收", value: preview.optedOut },
    { label: "沒有電話", value: preview.missingPhone },
    { label: "未同意接收", value: preview.notOptedIn },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">{item.label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-normal">{item.value}</div>
        </div>
      ))}
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
  const pending = campaign.pending ?? 0;

  if (!campaign.recipients) {
    return <span className="text-sm text-muted-foreground">未發送</span>;
  }

  return (
    <div className="space-y-1 text-sm tabular-nums">
      <div>已發送 {sent}</div>
      {failed > 0 ? <div className="font-semibold text-destructive">失敗 {failed}</div> : null}
      {blocked > 0 ? <div className="text-muted-foreground">封鎖 {blocked}</div> : null}
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

      <p className="mt-3 text-xs text-muted-foreground">
        已審批的訊息全文由 WhatsApp／Woztell 保存，本系統沒有副本。發送前請在 Woztell
        後台核對訊息內容。
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
        <ConfirmRow label="合資格收件人" value={`${send.eligible} 人`} emphasis />
      </dl>
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

function CampaignStatusBadge({ status }: { status: string }) {
  const variant =
    status === "failed" || status === "cancelled"
      ? "destructive"
      : status === "queued" || status === "sending"
        ? "default"
        : status === "completed"
          ? "secondary"
          : "outline";

  return <Badge variant={variant}>{campaignStatusLabels[status] ?? status}</Badge>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
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

function campaignDraftSignature(campaign: AdminCampaignInput) {
  return JSON.stringify({
    id: campaign.id ?? "",
    name: campaign.name,
    template_id: campaign.template_id ?? "",
    audience_id: campaign.audience_id ?? "",
    status: campaign.status,
    scheduled_at: campaign.scheduled_at ?? "",
  });
}

function normalizeAudienceFilters(filters: AdminAudienceInput["filters"]) {
  return {
    intent: undefinedIfBlank(filters.intent ?? ""),
    source: undefinedIfBlank(filters.source ?? ""),
    estate: undefinedIfBlank(filters.estate ?? ""),
    assigned_agent_id: undefinedIfBlank(filters.assigned_agent_id ?? ""),
  };
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

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
