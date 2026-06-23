import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, Plus, RefreshCw, Save, Send, Users, XCircle } from "lucide-react";
import { toast } from "sonner";

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
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  cancelAdminCampaign,
  fetchAdminBlastOptions,
  fetchAdminCampaigns,
  materializeCampaignRecipients,
  previewAdminAudience,
  queueAdminCampaign,
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

const queueableStatuses = new Set(["draft", "review", "scheduled"]);
const cancellableStatuses = new Set(["draft", "review", "scheduled", "queued", "sending"]);

const campaignStatusLabels: Record<string, string> = {
  draft: "Draft",
  review: "Review",
  scheduled: "Scheduled",
  queued: "Queued",
  sending: "Sending",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const intentOptions = [
  { value: "any", label: "Any intent" },
  { value: "buyer", label: "Buyer" },
  { value: "tenant", label: "Tenant" },
  { value: "seller", label: "Seller" },
  { value: "landlord", label: "Landlord" },
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
  const [rowPreviews, setRowPreviews] = useState<Record<string, AdminAudiencePreview>>({});
  const previewRequestRef = useRef(0);

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
        label: "Draft audience filters",
        debounce: true,
      };
    }
    if (campaignDraft?.audience_id) {
      const audienceName = audienceLabel(options, campaignDraft.audience_id);
      return {
        data: { audience_id: campaignDraft.audience_id },
        label: audienceName ? `Campaign audience: ${audienceName}` : "Campaign audience",
        debounce: false,
      };
    }
    if (selectedPreviewAudienceId) {
      const audienceName = audienceLabel(options, selectedPreviewAudienceId);
      return {
        data: { audience_id: selectedPreviewAudienceId },
        label: audienceName ? `Audience: ${audienceName}` : "Audience preview",
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
      toast.error("請填寫 audience 名稱");
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
      if (result.id) setSelectedPreviewAudienceId(result.id);
      await refreshAdminData({ clearRowPreviews: true });
      setAudienceDraft(null);
      toast.success("Audience 已儲存");
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
      toast.error("請填寫 campaign 名稱、template 及 audience");
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
      toast.error("此 campaign 未有 audience");
      return;
    }

    const action = `preview:${campaign.id}`;
    setMutatingAction(action);
    try {
      const data = (await previewAdminAudience({
        data: { audience_id: campaign.audience_id },
      })) as AdminAudiencePreview;
      setRowPreviews((current) => ({ ...current, [campaign.id]: data }));
      setSelectedPreviewAudienceId(campaign.audience_id);
      setPreview(data);
      toast.success("Preview 已更新");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  async function handleQueueCampaign(campaignId: string, eligibleCount: number) {
    if (eligibleCount <= 0) {
      toast.error("沒有合資格收件人");
      return;
    }

    const action = `queue:${campaignId}`;
    setMutatingAction(action);
    try {
      const materialization = (await materializeCampaignRecipients({
        data: { campaign_id: campaignId },
      })) as MutationResult & Partial<AdminAudiencePreview>;
      assertNoServerError(materialization);

      const result = (await queueAdminCampaign({ data: { id: campaignId } })) as MutationResult;
      assertNoServerError(result);

      await refreshAdminData({ clearRowPreviews: true });
      setCampaignDraft(null);
      toast.success(`已排隊 ${materialization.eligible ?? eligibleCount} 位合資格收件人`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMutatingAction(null);
    }
  }

  async function handleCancelCampaign(campaignId: string) {
    const action = `cancel:${campaignId}`;
    setMutatingAction(action);
    try {
      const result = (await cancelAdminCampaign({ data: { id: campaignId } })) as MutationResult;
      assertNoServerError(result);
      await refreshAdminData({ clearRowPreviews: true });
      if (campaignDraft?.id === campaignId) closeCampaignDialog();
      toast.success("Campaign 已取消");
    } catch (err) {
      toast.error(errorText(err));
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
  const queueBlockReason = hasUnsavedCampaignChanges ? "Save changes before queueing" : null;
  const canQueueDraft =
    canSubmitCampaign && !hasUnsavedCampaignChanges && (preview?.eligible ?? 0) > 0;

  return (
    <AdminShell title="WhatsApp 群發" description="Template-only、opt-in-only、審核後排程發送。">
      {error ? <AdminError message={error} /> : null}

      <AdminToolbar
        filters={
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(220px,320px)_auto]">
            <Select
              value={selectedPreviewAudienceId || "none"}
              onValueChange={(value) => setSelectedPreviewAudienceId(value === "none" ? "" : value)}
              disabled={!options?.audiences.length}
            >
              <SelectTrigger aria-label="選擇 audience preview">
                <SelectValue placeholder="Audience preview" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No audience</SelectItem>
                {options?.audiences.map((audience) => (
                  <SelectItem key={audience.id} value={audience.id}>
                    {audience.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              onClick={() => refreshAdminData()}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAudienceDraft({ name: "", description: null, filters: {} })}
            >
              <Users />
              New audience
            </Button>
            <Button type="button" onClick={openCampaignDialog}>
              <Plus />
              New campaign
            </Button>
          </>
        }
      />

      {!rows && loading ? <Skeleton className="h-72 w-full" /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign list</CardTitle>
            <CardDescription>WhatsApp template blasts and delivery status.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {campaignRows.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead>Audience</TableHead>
                      <TableHead>Preview</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaignRows.map((campaign) => {
                      const campaignPreview = rowPreviews[campaign.id];
                      const queueEnabled =
                        isQueueableStatus(campaign.status) &&
                        (campaignPreview?.eligible ?? 0) > 0 &&
                        !mutatingAction;
                      const cancelEnabled =
                        cancellableStatuses.has(campaign.status) && !mutatingAction;

                      return (
                        <TableRow key={campaign.id}>
                          <TableCell className="min-w-48 font-medium">
                            <div>{campaign.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {campaign.recipients ?? 0} materialized
                            </div>
                          </TableCell>
                          <TableCell className="min-w-44">
                            {campaign.element_name
                              ? `${campaign.element_name} (${campaign.language_code})`
                              : "—"}
                          </TableCell>
                          <TableCell className="min-w-36">
                            {campaign.audience_name ?? "—"}
                          </TableCell>
                          <TableCell className="min-w-40">
                            {campaignPreview ? (
                              <span className="text-sm">
                                {campaignPreview.eligible} 合資格 / {campaignPreview.optedOut}{" "}
                                Opt-out
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">Not checked</span>
                            )}
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
                                onClick={() => handlePreviewCampaignAudience(campaign)}
                                disabled={!campaign.audience_id || !!mutatingAction}
                              >
                                <Eye />
                                Preview
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  handleQueueCampaign(campaign.id, campaignPreview?.eligible ?? 0)
                                }
                                disabled={!queueEnabled}
                              >
                                <Send />
                                Queue
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleCancelCampaign(campaign.id)}
                                disabled={!cancelEnabled}
                              >
                                <XCircle />
                                Cancel
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
                  title="No campaigns"
                  description="Create a WhatsApp template campaign before queueing recipients."
                  action={
                    <Button type="button" onClick={openCampaignDialog}>
                      <Plus />
                      New campaign
                    </Button>
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Audience preview</CardTitle>
            <CardDescription>{activePreview?.label ?? "No audience selected"}</CardDescription>
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
        onClose={closeCampaignDialog}
        onSubmit={handleSaveCampaign}
        onQueue={() => {
          if (!campaignDraft?.id) return;
          handleQueueCampaign(campaignDraft.id, preview?.eligible ?? 0);
        }}
        onCancel={() => {
          if (campaignDraft?.id) handleCancelCampaign(campaignDraft.id);
        }}
      />

      <AudienceDialog
        audience={audienceDraft}
        preview={preview}
        previewLoading={previewLoading}
        saving={saving}
        onChange={setAudienceDraft}
        onClose={() => setAudienceDraft(null)}
        onSubmit={handleSaveAudience}
      />
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
          <DialogTitle>{campaign?.id ? "Campaign" : "New campaign"}</DialogTitle>
          <DialogDescription>Template, audience, schedule, and status.</DialogDescription>
        </DialogHeader>
        {campaign ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Name"
                value={campaign.name}
                onChange={(value) => onChange({ ...campaign, name: value })}
                required
              />
              <Field label="Template">
                <Select
                  value={campaign.template_id ?? "none"}
                  onValueChange={(value) =>
                    onChange({ ...campaign, template_id: value === "none" ? null : value })
                  }
                >
                  <SelectTrigger aria-label="Campaign template">
                    <SelectValue placeholder="Template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template</SelectItem>
                    {options?.templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.element_name} ({template.language_code}) · {template.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Audience">
                <Select
                  value={campaign.audience_id ?? "none"}
                  onValueChange={(value) =>
                    onChange({ ...campaign, audience_id: value === "none" ? null : value })
                  }
                >
                  <SelectTrigger aria-label="Campaign audience">
                    <SelectValue placeholder="Audience" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No audience</SelectItem>
                    {options?.audiences.map((audience) => (
                      <SelectItem key={audience.id} value={audience.id}>
                        {audience.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={campaign.status}
                  onValueChange={(value) =>
                    onChange({ ...campaign, status: value as AdminCampaignInput["status"] })
                  }
                >
                  <SelectTrigger aria-label="Campaign status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <TextField
                label="Schedule"
                type="datetime-local"
                value={campaign.scheduled_at ?? ""}
                onChange={(value) => onChange({ ...campaign, scheduled_at: nullIfBlank(value) })}
              />
            </div>

            <div className="rounded-md border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Preview</h3>
                  <p className="text-xs text-muted-foreground">
                    Queue unlocks only when 合資格 is greater than 0.
                  </p>
                </div>
                <Badge variant={(preview?.eligible ?? 0) > 0 ? "default" : "outline"}>
                  {preview?.eligible ?? 0} 合資格
                </Badge>
              </div>
              <PreviewSummary preview={preview} loading={previewLoading} />
            </div>

            <DialogFooter className="gap-2">
              {queueBlockReason ? (
                <p className="text-sm text-muted-foreground sm:mr-auto">{queueBlockReason}</p>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              {campaign.id ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={!canCancel || saving || mutating}
                >
                  <XCircle />
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={saving || mutating}>
                <Save />
                Save
              </Button>
              <Button type="button" onClick={onQueue} disabled={!canQueue || saving || mutating}>
                <Send />
                Queue
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
          <DialogTitle>Audience editor</DialogTitle>
          <DialogDescription>Name, description, and contact filters.</DialogDescription>
        </DialogHeader>
        {audience ? (
          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                label="Name"
                value={audience.name}
                onChange={(value) => onChange({ ...audience, name: value })}
                required
              />
              <TextField
                label="Description"
                value={audience.description ?? ""}
                onChange={(value) => onChange({ ...audience, description: nullIfBlank(value) })}
              />
              <Field label="Intent">
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
                    <SelectValue placeholder="Intent" />
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
                label="Source"
                value={audience.filters.source ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: { ...audience.filters, source: undefinedIfBlank(value) },
                  })
                }
              />
              <TextField
                label="Estate slug"
                value={audience.filters.estate ?? ""}
                onChange={(value) =>
                  onChange({
                    ...audience,
                    filters: { ...audience.filters, estate: undefinedIfBlank(value) },
                  })
                }
              />
              <TextField
                label="Assigned agent ID"
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
                <h3 className="text-sm font-medium">Preview</h3>
                <Badge variant={(preview?.optedOut ?? 0) > 0 ? "outline" : "secondary"}>
                  {preview?.optedOut ?? 0} Opt-out
                </Badge>
              </div>
              <PreviewSummary preview={preview} loading={previewLoading} />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="submit" disabled={saving}>
                <Save />
                Save audience
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
        No preview selected
      </div>
    );
  }

  const items = [
    { label: "Total", value: preview.total },
    { label: "合資格", value: preview.eligible },
    { label: "Opt-out", value: preview.optedOut },
    { label: "Missing phone", value: preview.missingPhone },
    { label: "Not opted-in", value: preview.notOptedIn },
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
