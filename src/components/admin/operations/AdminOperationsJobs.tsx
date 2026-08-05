import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  cancelOperationsJob,
  fetchOperationsJobs,
  OperationsClientError,
  retryOperationsJob,
} from "@/lib/admin/operations/operations-client";
import type { JobListItem, JobStatus } from "@/lib/admin/operations/operations-types";
import type { OperationsCapabilities } from "@/lib/control-plane/capabilities";

export const canRetryOperationsJob = (status: JobStatus) =>
  status === "failed" || status === "cancelled";

export const canCancelOperationsJob = (status: JobStatus) =>
  status === "queued" || status === "running" || status === "failed";

export type JobRowMergeMode = "replace" | "append" | "refresh";

export const mergeOperationsJobRows = (
  current: JobListItem[],
  incoming: JobListItem[],
  mode: JobRowMergeMode,
): JobListItem[] => {
  if (mode === "append") return [...current, ...incoming];
  if (mode === "replace") return incoming;

  // "refresh" is the 30s background tick, which can only ever fetch page 1.
  // Replacing outright discarded every extra page the operator had loaded --
  // click Load more to 100 rows and the list snapped back to 25 half a minute
  // later, mid-read. Instead, update rows already held in place and prepend
  // only genuinely new ones, so deeper pages survive the tick.
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const known = new Set(current.map((row) => row.id));
  return [
    ...incoming.filter((row) => !known.has(row.id)),
    ...current.map((row) => incomingById.get(row.id) ?? row),
  ];
};

export const shouldRefreshOperationsJobs = ({
  active,
  jobsRead,
  pending,
  previousPulse,
  pulse,
}: {
  active: boolean;
  jobsRead: boolean;
  pending: boolean;
  previousPulse: number;
  pulse: number;
}) => active && jobsRead && !pending && pulse !== previousPulse;

type JobCommand = { action: "retry" | "cancel"; job: JobListItem };

const statusOptions: Array<{ value: "all" | JobStatus; label: string }> = [
  { value: "all", label: "所有狀態" },
  { value: "queued", label: "等候中" },
  { value: "running", label: "執行中" },
  { value: "succeeded", label: "成功" },
  { value: "failed", label: "失敗" },
  { value: "cancelled", label: "已取消" },
];

function operationsErrorMessage(error: unknown) {
  if (error instanceof OperationsClientError) {
    return error.requestId ? `${error.message}（支援參考編號：${error.requestId}）` : error.message;
  }
  return error instanceof Error ? error.message : "未能載入背景工作。";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function jobStatusLabel(status: JobStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function statusVariant(status: JobStatus) {
  if (status === "failed") return "destructive" as const;
  if (status === "succeeded") return "default" as const;
  return "secondary" as const;
}

export function AdminOperationsJobs({
  capabilities,
  active,
  pulse,
  onMutationComplete,
}: {
  capabilities: OperationsCapabilities;
  active: boolean;
  pulse: number;
  onMutationComplete: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<"all" | JobStatus>("all");
  const [jobTypeDraft, setJobTypeDraft] = useState("");
  const [jobType, setJobType] = useState("");
  const [rows, setRows] = useState<JobListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<JobCommand | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<JobCommand | null>(null);
  const requestSequence = useRef(0);
  const previousPulse = useRef(pulse);

  const loadJobs = useCallback(
    async ({
      mode = "replace",
      cursor,
      background = false,
    }: { mode?: JobRowMergeMode; cursor?: string; background?: boolean } = {}) => {
      if (!active || !capabilities.jobsRead) return;
      const request = ++requestSequence.current;
      // A background tick must not set `loading`: the filter controls are
      // disabled on it, so a 30s poll interrupted typing mid-word.
      if (!background) setLoading(true);
      setError(null);
      try {
        const result = await fetchOperationsJobs({
          status: status === "all" ? undefined : status,
          jobType: jobType || undefined,
          cursor,
          limit: 25,
        });
        if (request !== requestSequence.current) return;
        setRows((current) => mergeOperationsJobRows(current, result.data.rows, mode));
        // A refresh only knows about page 1, so it must not clobber the cursor
        // the operator has already paged past.
        if (mode !== "refresh") setNextCursor(result.data.nextCursor);
        setHasLoadedOnce(true);
      } catch (reason) {
        if (request === requestSequence.current) setError(operationsErrorMessage(reason));
      } finally {
        if (request === requestSequence.current && !background) setLoading(false);
      }
    },
    [active, capabilities.jobsRead, jobType, status],
  );

  useEffect(() => {
    if (!active || !capabilities.jobsRead) return;
    void loadJobs();
  }, [active, capabilities.jobsRead, loadJobs]);

  useEffect(() => {
    const priorPulse = previousPulse.current;
    previousPulse.current = pulse;
    if (
      !shouldRefreshOperationsJobs({
        active,
        jobsRead: capabilities.jobsRead,
        pending: pendingCommand !== null,
        previousPulse: priorPulse,
        pulse,
      })
    )
      return;
    void loadJobs({ mode: "refresh", background: true });
  }, [active, capabilities.jobsRead, loadJobs, pendingCommand, pulse]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  const applyJobType = (event: FormEvent) => {
    event.preventDefault();
    setRows([]);
    setNextCursor(null);
    setJobType(jobTypeDraft.trim());
  };

  const hasJobFilters = status !== "all" || jobType !== "";

  const clearJobFilters = () => {
    setRows([]);
    setNextCursor(null);
    setJobTypeDraft("");
    setJobType("");
    setStatus("all");
  };

  const changeStatus = (value: string) => {
    setRows([]);
    setNextCursor(null);
    setStatus(value as "all" | JobStatus);
  };

  const runCommand = async () => {
    if (!command || pendingCommand) return;
    const current = command;
    setPendingCommand(current);
    try {
      if (current.action === "retry") await retryOperationsJob(current.job.id);
      else await cancelOperationsJob(current.job.id);
      setCommand(null);
      toast.success(current.action === "retry" ? "已重新排隊執行此工作。" : "已取消此工作。");
      await onMutationComplete();
      await loadJobs();
    } catch (reason) {
      setCommand(null);
      if (reason instanceof OperationsClientError && reason.status === 409) {
        // Previously this closed the dialog and set only a quiet status line, so
        // a rejected command looked exactly like a successful one.
        await loadJobs();
        toast.error("此工作的狀態已改變，指令未有執行。已重新載入最新狀態。");
        setError("此工作的狀態已改變，指令未有執行。");
      } else {
        toast.error(operationsErrorMessage(reason));
      }
    } finally {
      setPendingCommand(null);
    }
  };

  if (!capabilities.jobsRead) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <form onSubmit={applyJobType} className="flex flex-1 flex-wrap items-end gap-2">
          <label className="grid min-w-44 gap-1 text-sm">
            <span className="text-muted-foreground">狀態</span>
            <Select value={status} onValueChange={changeStatus}>
              <SelectTrigger aria-label="按狀態篩選背景工作" className="w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid min-w-52 flex-1 gap-1 text-sm">
            <span className="text-muted-foreground">工作類型</span>
            <Input
              value={jobTypeDraft}
              onChange={(event) => setJobTypeDraft(event.target.value)}
              placeholder="輸入工作類型篩選"
              aria-label="按工作類型篩選"
            />
          </label>
          {/* Filter controls are no longer disabled on `loading`: that flag was
              also set by the 30s background poll, so typing was interrupted
              mid-word. Background ticks now leave `loading` untouched. */}
          <Button type="submit" variant="secondary">
            套用篩選
          </Button>
        </form>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="重新載入背景工作"
                disabled={loading || pendingCommand !== null}
                onClick={() => void loadJobs()}
              >
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>重新載入背景工作</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>工作</TableHead>
            <TableHead>狀態</TableHead>
            <TableHead>嘗試次數</TableHead>
            <TableHead>排定執行</TableHead>
            <TableHead>更新時間</TableHead>
            <TableHead className="w-24 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <p className="font-medium">{job.jobType}</p>
                <p
                  className="max-w-56 truncate font-mono text-xs text-muted-foreground"
                  title={job.id}
                >
                  {job.id}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">
                {job.attemptCount} / {job.maxAttempts}
              </TableCell>
              <TableCell>{formatDate(job.runAfter)}</TableCell>
              <TableCell>{formatDate(job.updatedAt)}</TableCell>
              <TableCell>
                <TooltipProvider>
                  <div className="flex justify-end gap-1">
                    {capabilities.jobsRetry && canRetryOperationsJob(job.status) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`重試工作 ${job.id}`}
                            disabled={pendingCommand !== null}
                            onClick={() => setCommand({ action: "retry", job })}
                          >
                            <RotateCcw className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>重試此工作</TooltipContent>
                      </Tooltip>
                    ) : null}
                    {capabilities.jobsCancel && canCancelOperationsJob(job.status) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`取消工作 ${job.id}`}
                            disabled={pendingCommand !== null}
                            onClick={() => setCommand({ action: "cancel", job })}
                          >
                            <XCircle className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>取消此工作</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </TooltipProvider>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {loading || !hasLoadedOnce ? (
                  "載入中…"
                ) : hasJobFilters ? (
                  <span className="inline-flex flex-wrap items-center justify-center gap-2">
                    沒有符合目前篩選的工作。
                    <Button type="button" variant="outline" size="sm" onClick={clearJobFilters}>
                      清除篩選
                    </Button>
                  </span>
                ) : (
                  "目前沒有背景工作。"
                )}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {nextCursor ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void loadJobs({ mode: "append", cursor: nextCursor })}
          >
            {loading ? "載入中…" : "載入更多"}
          </Button>
        </div>
      ) : null}

      <AdminConfirmDialog
        open={command !== null}
        title={command?.action === "retry" ? "確認重試此工作？" : "確認取消此工作？"}
        description={command ? `${command.job.jobType}（${command.job.id}）` : "請確認此工作指令。"}
        confirmLabel={command?.action === "retry" ? "重試" : "取消工作"}
        confirmVariant={command?.action === "cancel" ? "destructive" : "default"}
        isPending={pendingCommand !== null}
        onOpenChange={(open) => {
          if (!open) setCommand(null);
        }}
        onConfirm={() => void runCommand()}
      />
    </div>
  );
}
