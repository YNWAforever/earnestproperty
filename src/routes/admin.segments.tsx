import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Brain, RefreshCw, Save, Users } from "lucide-react";
import { toast } from "sonner";

import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
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
  const [name, setName] = useState("深井買家 WhatsApp Segment");
  const [status, setStatus] = useState<AdminCrmSegmentRow["status"]>("active");
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [previewState, setPreviewState] = useState<AdminCrmSegmentPreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [materializing, setMaterializing] = useState(false);
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

  const previewSummary = useMemo(() => {
    if (!preview) return "No preview";
    return `${preview.eligible}/${preview.total} eligible`;
  }, [preview]);

  function selectSegment(segmentId: string) {
    if (segmentId === "new") {
      setSelectedSegmentId("");
      setName("深井買家 WhatsApp Segment");
      setStatus("active");
      setPrompt(defaultPrompt);
      clearPreviewState();
      return;
    }
    const segment = segments?.find((item) => item.id === segmentId);
    setSelectedSegmentId(segmentId);
    if (!segment) return;
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
      toast.error("請先選擇並儲存 segment");
      return;
    }

    setMaterializing(true);
    try {
      const result = (await materializeAdminCrmSegment({
        data: { segmentId: selectedSegmentId },
      })) as SegmentMutationResult;
      await refreshSegments();
      toast.success(`Materialized ${result.materialized ?? 0} contacts`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setMaterializing(false);
    }
  }

  return (
    <AdminShell
      title="AI Segments"
      description="CRM audience builder for reviewed WhatsApp blasts."
    >
      {error ? <AdminError message={error} /> : null}

      <AdminToolbar
        filters={
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(220px,340px)_auto]">
            <Select value={selectedSegmentId || "new"} onValueChange={selectSegment}>
              <SelectTrigger aria-label="Saved segment">
                <SelectValue placeholder="Saved segment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New segment</SelectItem>
                {segments?.map((segment) => (
                  <SelectItem key={segment.id} value={segment.id}>
                    {segment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={refreshSegments} disabled={loading}>
              <RefreshCw className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        }
        actions={
          <>
            <Button type="button" variant="outline" onClick={runPreview} disabled={previewLoading}>
              <Brain />
              Preview
            </Button>
            <Button type="button" onClick={saveSegment} disabled={!canSaveSegment || saving}>
              <Save />
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={materializeSegment}
              disabled={!canMaterializeSegment || materializing}
            >
              <Users />
              Materialize
            </Button>
          </>
        }
      />

      {!segments && loading ? <Skeleton className="h-72 w-full" /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Segment builder</CardTitle>
            <CardDescription>
              Prompt, preview, save, then materialize before campaign use.
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
                    <p className="text-xs text-muted-foreground">Top 200 CRM lead matches</p>
                  </div>
                  <EligibilityBadge status="eligible" label={`${preview.eligible} eligible`} />
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Contact</TableHead>
                        <TableHead>Eligibility</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.contacts.slice(0, 20).map((contact) => (
                        <TableRow key={`${contact.contact_id}:${contact.lead_id ?? "contact"}`}>
                          <TableCell className="min-w-44">
                            <div className="font-medium">{contact.name ?? "Unnamed"}</div>
                            <div className="text-xs text-muted-foreground">
                              {contact.phone ?? "No phone"}
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
                        {segment.eligible_members}/{segment.members} eligible
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
    </AdminShell>
  );
}

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
      eligible: "Eligible",
      missing_phone: "Missing phone",
      not_opted_in: "Not opted in",
      opted_out: "Opted out",
      blocked: "Blocked",
    }[status] ||
      status);
  return <Badge variant={variant}>{text}</Badge>;
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Action failed";
}
