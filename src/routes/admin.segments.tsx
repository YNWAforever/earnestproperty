import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Brain, RefreshCw, Save, Users } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { AdminToolbar } from "@/components/admin/AdminToolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useNeonAuth } from "@/hooks/use-neon-auth";
import {
  fetchAdminCrmSegments,
  materializeAdminCrmSegment,
  previewAdminCrmSegment,
  saveAdminCrmSegment,
} from "@/lib/neon/admin-data";
import type { AdminCrmSegmentPreview, AdminCrmSegmentRow } from "@/lib/neon/admin-data.types";

type SegmentMutationResult = {
  materialized?: number;
  eligible?: number;
};

type AdminCrmSegmentPreviewState = {
  result: AdminCrmSegmentPreview;
  prompt: string;
  segmentId: string;
};

const defaultPrompt = "深井買家，預算 800-1000 萬，最近 90 日查詢，有 WhatsApp opt-in";
// Extracted so the unsaved-edits check can compare against the seed rather
// than against "non-empty" -- both fields ship pre-filled, so a pristine
// editor looked dirty and the FIRST dropdown selection always warned about
// discarding work that did not exist.
const defaultSegmentName = "深井買家 WhatsApp Segment";

export const Route = createFileRoute("/admin/segments")({
  head: () => ({
    meta: [{ title: "Segments｜Earnest Admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminSegments,
});

function AdminSegments() {
  const { user } = useNeonAuth();
  const [segments, setSegments] = useState<AdminCrmSegmentRow[] | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [name, setName] = useState(defaultSegmentName);
  const [status, setStatus] = useState<AdminCrmSegmentRow["status"]>("active");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [previewState, setPreviewState] = useState<AdminCrmSegmentPreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [materializeOpen, setMaterializeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const editorContextRef = useRef({ prompt: defaultPrompt, segmentId: "" });

  const clearPreviewState = useCallback(() => {
    previewRequestRef.current += 1;
    setPreviewLoading(false);
    setPreviewState(null);
  }, []);

  const refreshSegments = useCallback(
    async (preferredSegmentId?: string) => {
      if (!user) return;
      setLoading(true);
      try {
        const rows = (await fetchAdminCrmSegments()) as AdminCrmSegmentRow[];
        const preferredSegment = preferredSegmentId
          ? rows.find((segment) => segment.id === preferredSegmentId)
          : null;
        setSegments(rows);
        setSelectedSegmentId((current) => {
          if (preferredSegment) return preferredSegment.id;
          if (current && rows.some((segment) => segment.id === current)) return current;
          return "";
        });
        if (preferredSegment) {
          setName(preferredSegment.name);
          setStatus(preferredSegment.status);
          setPrompt(preferredSegment.natural_language_prompt);
          clearPreviewState();
        }
        setError(null);
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    },
    [clearPreviewState, user],
  );

  useEffect(() => {
    refreshSegments();
  }, [refreshSegments]);

  useEffect(() => {
    editorContextRef.current = { prompt: prompt.trim(), segmentId: selectedSegmentId };
  }, [prompt, selectedSegmentId]);

  const selectedSegment = useMemo(
    () => segments?.find((segment) => segment.id === selectedSegmentId) ?? null,
    [segments, selectedSegmentId],
  );

  const preview = previewState?.result ?? null;
  const hasCurrentPreview =
    previewState?.prompt === prompt.trim() && previewState.segmentId === selectedSegmentId;
  const selectedSegmentPromptMatches = selectedSegment?.natural_language_prompt === prompt.trim();
  const canSaveSegment = Boolean(
    name.trim() && prompt.trim() && (hasCurrentPreview || selectedSegmentPromptMatches),
  );
  const canMaterializeSegment = Boolean(selectedSegmentId && selectedSegmentPromptMatches);
  // True when the editor holds edits that loading another segment would discard.
  const hasUnsavedSegmentEdits = Boolean(
    selectedSegment
      ? selectedSegment.natural_language_prompt !== prompt.trim() ||
          selectedSegment.name !== name.trim()
      : prompt.trim() !== defaultPrompt || name.trim() !== defaultSegmentName,
  );

  const previewSummary = useMemo(() => {
    if (!preview) return "No preview";
    return `${preview.total} 位符合條件，其中 ${preview.eligible} 位可接收訊息`;
  }, [preview]);

  function selectSegment(segmentId: string) {
    // Gate EVERY path that overwrites the editor, including 新增 segment --
    // which resets name/status/prompt just as destructively as loading another
    // segment, but sat above the confirm and so discarded unsaved work silently.
    if (
      hasUnsavedSegmentEdits &&
      !window.confirm("你尚未儲存目前的分群描述，切換後會遺失。確定要切換嗎？")
    ) {
      return;
    }

    if (segmentId === "new") {
      setSelectedSegmentId("");
      setName(defaultSegmentName);
      setStatus("active");
      setPrompt(defaultPrompt);
      clearPreviewState();
      return;
    }
    const segment = segments?.find((item) => item.id === segmentId);
    if (!segment) {
      setSelectedSegmentId(segmentId);
      return;
    }
    setSelectedSegmentId(segmentId);
    setName(segment.name);
    setStatus(segment.status);
    setPrompt(segment.natural_language_prompt);
    clearPreviewState();
  }

  function isCurrentPreview(requestId: number, previewPrompt: string, previewSegmentId: string) {
    const current = editorContextRef.current;
    return (
      requestId === previewRequestRef.current &&
      current.prompt === previewPrompt &&
      current.segmentId === previewSegmentId
    );
  }

  async function runPreview() {
    const previewPrompt = prompt.trim();
    const previewSegmentId = selectedSegmentId;
    if (!previewPrompt) {
      toast.error("請輸入 segment prompt");
      return;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewState(null);
    setPreviewLoading(true);
    try {
      const result = (await previewAdminCrmSegment({
        data: { prompt: previewPrompt },
      })) as AdminCrmSegmentPreview;
      if (!isCurrentPreview(requestId, previewPrompt, previewSegmentId)) return;
      setPreviewState({
        result,
        prompt: previewPrompt,
        segmentId: previewSegmentId,
      });
      toast.success("Segment preview ready");
    } catch (err) {
      if (requestId === previewRequestRef.current) toast.error(errorText(err));
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  }

  async function saveSegment() {
    if (!name.trim()) {
      toast.error("請填寫 segment 名稱");
      return;
    }
    if (!prompt.trim()) {
      toast.error("請輸入 segment prompt");
      return;
    }

    const trimmedPrompt = prompt.trim();
    const currentPreview = hasCurrentPreview ? previewState?.result : null;
    const filters =
      currentPreview?.filters ??
      (selectedSegment?.natural_language_prompt === trimmedPrompt
        ? selectedSegment.structured_filters
        : null);
    if (!filters) {
      toast.error("請先 preview segment");
      return;
    }

    setSaving(true);
    try {
      const id = await saveAdminCrmSegment({
        data: {
          id: selectedSegmentId || undefined,
          name: name.trim(),
          description: null,
          natural_language_prompt: trimmedPrompt,
          structured_filters: filters,
          status,
        },
      });
      setSelectedSegmentId(String(id));
      await refreshSegments(String(id));
      toast.success("Segment 已儲存");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function materializeSegment() {
    if (!canMaterializeSegment) {
      toast.error("請先選擇並儲存客戶分群");
      return;
    }

    setMaterializing(true);
    try {
      const result = (await materializeAdminCrmSegment({
        data: { segmentId: selectedSegmentId },
      })) as SegmentMutationResult;
      await refreshSegments();
      setMaterializeOpen(false);
      // The old copy counted every contact enrolled, including those who cannot
      // be messaged, so a segment reported far more reach than it had.
      toast.success(
        `已建立名單：${result.materialized ?? 0} 位客戶` +
          (typeof result.eligible === "number" ? `，其中 ${result.eligible} 位合資格接收訊息` : ""),
      );
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMaterializing(false);
    }
  }

  return (
    <AdminShell
      title="AI 客戶分群"
      description="用自然語言描述條件，建立可供 WhatsApp 群發使用的客戶名單。"
    >
      {error ? <AdminError message={error} /> : null}

      <AdminToolbar
        filters={
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(220px,340px)_auto]">
            <Select value={selectedSegmentId || "new"} onValueChange={selectSegment}>
              <SelectTrigger aria-label="已儲存的客戶分群">
                <SelectValue placeholder="選擇已儲存的分群" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">新增分群</SelectItem>
                {segments?.map((segment) => (
                  <SelectItem key={segment.id} value={segment.id}>
                    {segment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline" // refreshSegments takes an optional preferredSegmentId; passed
              // directly, React hands it the MouseEvent as that argument.
              onClick={() => void refreshSegments()}
              disabled={loading}
            >
              <RefreshCw className={loading ? "animate-spin" : ""} />
              重新整理
            </Button>
          </div>
        }
        actions={
          <>
            <Button type="button" variant="outline" onClick={runPreview} disabled={previewLoading}>
              <Brain />
              預覽
            </Button>
            <Button type="button" onClick={saveSegment} disabled={!canSaveSegment || saving}>
              <Save />
              儲存
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMaterializeOpen(true)}
              disabled={!canMaterializeSegment || materializing}
            >
              <Users />
              建立名單…
            </Button>
          </>
        }
      />

      {!segments && loading ? <Skeleton className="h-72 w-full" /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">分群條件</CardTitle>
            <CardDescription>
              先描述條件、預覽結果、儲存，再建立名單供 campaign 使用。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <Label htmlFor="segment-name">Name</Label>
                <Input
                  id="segment-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label="Segment name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="segment-status">Status</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as AdminCrmSegmentRow["status"])}
                >
                  <SelectTrigger id="segment-status" aria-label="Segment status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="segment-prompt">Prompt</Label>
              <Textarea
                id="segment-prompt"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  clearPreviewState();
                }}
                aria-label="Segment prompt"
                rows={4}
              />
            </div>

            {preview ? (
              <div className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{previewSummary}</p>
                    <p className="text-xs text-muted-foreground">
                      最多顯示 20 行，名單上限為 200 位客戶
                    </p>
                  </div>
                  <EligibilityBadge status="eligible" label={`${preview.eligible} 位合資格`} />
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>客戶</TableHead>
                        <TableHead>可否接收</TableHead>
                        <TableHead>原因</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.contacts.slice(0, 20).map((contact) => (
                        <TableRow key={`${contact.contact_id}:${contact.lead_id ?? "contact"}`}>
                          <TableCell className="min-w-44">
                            <div className="font-medium">{contact.name ?? "未有姓名"}</div>
                            <div className="text-xs text-muted-foreground">
                              {contact.phone ?? "未有電話"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <EligibilityBadge status={contact.eligibility_status} />
                          </TableCell>
                          <TableCell className="min-w-56 text-sm text-muted-foreground">
                            {contact.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <AdminEmptyState
                title="No segment preview"
                description="Enter an audience prompt and preview matched contacts."
              />
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Saved segments</CardTitle>
            <CardDescription>{segments?.length ?? 0} CRM segments</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {segments?.length ? (
              segments.map((segment) => (
                <button
                  key={segment.id}
                  type="button"
                  className="w-full rounded-md border p-3 text-left transition hover:bg-accent"
                  onClick={() => selectSegment(segment.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{segment.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {segment.members} 位客戶，其中 {segment.eligible_members} 位合資格
                      </p>
                    </div>
                    <Badge variant={segment.status === "active" ? "default" : "secondary"}>
                      {segment.status}
                    </Badge>
                  </div>
                </button>
              ))
            ) : (
              <AdminEmptyState
                title="No saved segments"
                description="Save a previewed segment before materializing an audience."
              />
            )}
          </CardContent>
        </Card>
      </div>
      {/* Materialize destroys and rewrites the segment's membership for up to
          50,000 contacts, and the resulting list is what a WhatsApp blast sends
          to -- it fired on one unconfirmed click. The confirm also surfaces the
          parsed filters, because an unrecognised prompt yields an empty filter
          set that quietly matches the entire CRM. */}
      <AdminConfirmDialog
        open={materializeOpen}
        title="確認建立客戶名單？"
        description="這會重新產生此分群的客戶名單，覆蓋原有內容。名單會用於 WhatsApp 群發。"
        confirmLabel="確認建立名單"
        confirmVariant="destructive"
        isPending={materializing}
        onOpenChange={(open) => {
          if (!materializing) setMaterializeOpen(open);
        }}
        onConfirm={() => void materializeSegment()}
      >
        <div className="space-y-3 text-sm">
          <dl className="grid gap-1 rounded-md border bg-muted/40 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">分群名稱</dt>
              <dd className="font-medium">{name || "未命名"}</dd>
            </div>
            {preview ? (
              <>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">符合條件</dt>
                  <dd className="tabular-nums">{preview.total} 位</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">可接收訊息</dt>
                  <dd className="font-semibold tabular-nums">{preview.eligible} 位</dd>
                </div>
              </>
            ) : null}
          </dl>
          <SegmentFilterSummary filters={preview?.filters} />
        </div>
      </AdminConfirmDialog>
    </AdminShell>
  );
}

/** The prompt is parsed by regex server-side and the resulting filters were
 * never shown. An unrecognised prompt such as 「屯門上車客，30 歲以下」 produces an
 * empty filter object, which matches the entire CRM -- and the panel reported
 * that as a healthy-looking "183/200 eligible". */
function SegmentFilterSummary({ filters }: { filters?: Record<string, unknown> | null }) {
  const entries = Object.entries(filters ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );

  if (!entries.length) {
    return (
      <p
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      >
        未能從描述中辨識任何篩選條件，此名單將會包含<strong>所有客戶</strong>。
        請修改描述後重新預覽，或確認你確實想向全部客戶發送。
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">已辨識的篩選條件</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {entries.map(([key, value]) => (
          <li key={key} className="rounded-md border bg-background px-2 py-1 text-xs">
            {SEGMENT_FILTER_LABELS[key] ?? key}：{String(value)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const SEGMENT_FILTER_LABELS: Record<string, string> = {
  intent: "意向",
  district: "地區",
  estate: "屋苑",
  source: "來源",
  stage: "階段",
  budget_min: "預算下限",
  budget_max: "預算上限",
  assigned_agent_id: "負責代理",
};

function EligibilityBadge({
  status,
  label,
}: {
  status: AdminCrmSegmentPreview["contacts"][number]["eligibility_status"];
  label?: string;
}) {
  const variant = status === "eligible" ? "default" : "secondary";
  const text =
    label ??
    ({
      eligible: "可接收",
      missing_phone: "沒有電話",
      not_opted_in: "未同意接收",
      opted_out: "已拒收",
      blocked: "已封鎖",
    }[status] ||
      status);
  return <Badge variant={variant}>{text}</Badge>;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Action failed";
}
