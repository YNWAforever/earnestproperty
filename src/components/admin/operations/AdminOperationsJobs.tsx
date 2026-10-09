import { useWorkspaceCurrent } from "@/hooks/use-workspace-current";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { adminErrorMessage } from "@/components/admin/admin-error-text";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminTechnicalDetails } from "@/components/admin/AdminTechnicalDetails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  JOB_RETRY_RESEND_WARNING,
  jobTypeOptions,
  isDeliveryJobType,
  jobCommandDescription,
  jobFailureReason,
  jobTypeLabel,
} from "@/lib/admin/job-labels";
import type { OperationsCapabilities } from "@/lib/control-plane/capabilities";

import {
  canCancelOperationsJob,
  canRetryOperationsJob,
  mergeOperationsJobRows,
  shouldRefreshOperationsJobs,
  type JobRowMergeMode,
} from "./operations-jobs-utils";

type JobCommand = { action: "retry" | "cancel"; job: JobListItem };

/** FX-17a G-09: the list opens on 失敗; 所有狀態 is one click away. */
export const DEFAULT_JOB_STATUS: "all" | JobStatus = "failed";

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
  return adminErrorMessage(error, "未能載入背景工作。");
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

/** Retrying a delivery job runs its handler again, which can send the WhatsApp message again. */
export function JobCommandWarning({ command }: { command: JobCommand }) {
  if (command.action !== "retry" || !isDeliveryJobType(command.job.jobType)) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      {JOB_RETRY_RESEND_WARNING}
    </p>
  );
}

export function JobsTable({
  rows,
  capabilities,
  busy,
  emptyContent,
  onCommand,
}: {
  rows: JobListItem[];
  capabilities: OperationsCapabilities;
  busy: boolean;
  emptyContent: ReactNode;
  onCommand: (command: JobCommand) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>工作</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead>原因</TableHead>
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
              <p className="font-medium">{jobTypeLabel(job.jobType)}</p>
              <AdminTechnicalDetails
                rows={
                  capabilities.diagnosticsRead
                    ? [
                        { label: "工作類型代碼", value: job.jobType },
                        { label: "工作編號", value: job.id },
                        { label: "錯誤代碼", value: job.errorCode ?? "-" },
                      ]
                    : null
                }
              />
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
            </TableCell>
            <TableCell className="max-w-64 text-sm">
              {jobFailureReason(job.errorCode, job.status) ?? "-"}
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
                          disabled={busy}
                          onClick={() => onCommand({ action: "retry", job })}
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
                          disabled={busy}
                          onClick={() => onCommand({ action: "cancel", job })}
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
            <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
              {emptyContent}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

export function AdminOperationsJobs({
  capabilities,
  active,
  pulse,
  onMutationComplete,
  isWorkspaceCurrent,
}: {
  capabilities: OperationsCapabilities;
  active: boolean;
  pulse: number;
  onMutationComplete: () => void | Promise<void>;
  isWorkspaceCurrent?: () => boolean;
}) {
  const isCurrent = useWorkspaceCurrent(isWorkspaceCurrent);
  const [status, setStatus] = useState<"all" | JobStatus>(DEFAULT_JOB_STATUS);
  const [jobType, setJobType] = useState("");
  const [rows, setRows] = useState<JobListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<JobCommand | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<JobCommand | null>(null);
  const requestSequence = useRef(0);
  const unconfirmedJob = useRef<string | null>(null);
  const readbackInFlight = useRef(false);
  const [readbackRequired, setReadbackRequired] = useState(false);
  const previousPulse = useRef(pulse);

  const loadJobs = useCallback(
    async ({
      mode = "replace",
      cursor,
      background = false,
    }: { mode?: JobRowMergeMode; cursor?: string; background?: boolean } = {}) => {
      if (!active || !capabilities.jobsRead || !isCurrent()) return;
      const request = ++requestSequence.current;
      // A background tick must not set `loading`, so a 30s refresh does not flash the
      // loading state over the list.
      if (!background) setLoading(true);
      setError(null);
      try {
        const result = await fetchOperationsJobs(
          {
            status: status === "all" ? undefined : status,
            jobType: jobType || undefined,
            cursor,
            limit: 25,
          },
          isCurrent,
        );
        if (request !== requestSequence.current || !isCurrent()) return;
        if (unconfirmedJob.current) {
          let seen = result.data.rows.some((job) => job.id === unconfirmedJob.current);
          // The list now opens on 失敗, so a retry that did go through leaves the job out of it,
          // and an old job can be far past the first page. Read the locked job by id, once at a
          // time (a 30s refresh does not stack a second request on one still in flight).
          if (!seen && !readbackInFlight.current) {
            readbackInFlight.current = true;
            try {
              const byId = await fetchOperationsJobs({ ids: [unconfirmedJob.current] }, isCurrent);
              if (request !== requestSequence.current || !isCurrent()) return;
              seen = byId.data.rows.some((job) => job.id === unconfirmedJob.current);
            } finally {
              readbackInFlight.current = false;
            }
          }
          if (seen) {
            unconfirmedJob.current = null;
            setReadbackRequired(false);
          }
        }
        setRows((current) => mergeOperationsJobRows(current, result.data.rows, mode));
        // A refresh only knows about page 1, so it must not clobber the cursor
        // the operator has already paged past.
        if (mode !== "refresh") setNextCursor(result.data.nextCursor);
        setHasLoadedOnce(true);
      } catch (reason) {
        if (request === requestSequence.current && isCurrent())
          setError(operationsErrorMessage(reason));
      } finally {
        if (request === requestSequence.current && isCurrent() && !background) setLoading(false);
      }
    },
    [active, capabilities.jobsRead, jobType, status, isCurrent],
  );

  useEffect(() => {
    if (!active || !capabilities.jobsRead || !isCurrent()) return;
    void loadJobs();
  }, [active, capabilities.jobsRead, loadJobs, isCurrent]);

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

  const changeJobType = (value: string) => {
    setRows([]);
    setNextCursor(null);
    setJobType(value === "all" ? "" : value);
  };

  const hasJobFilters = status !== "all" || jobType !== "";

  const clearJobFilters = () => {
    setRows([]);
    setNextCursor(null);
    setJobType("");
    setStatus("all");
  };

  const changeStatus = (value: string) => {
    setRows([]);
    setNextCursor(null);
    setStatus(value as "all" | JobStatus);
  };

  const runCommand = async () => {
    if (!command || pendingCommand || readbackRequired || !isCurrent()) return;
    const current = command;
    // A read started before this command cannot confirm its eventual outcome.
    requestSequence.current += 1;
    setLoading(false);
    setError(null);
    setPendingCommand(current);
    try {
      if (current.action === "retry") await retryOperationsJob(current.job.id, isCurrent);
      else await cancelOperationsJob(current.job.id, isCurrent);
      if (!isCurrent()) return;
      setCommand(null);
      toast.success(current.action === "retry" ? "已重新排隊執行此工作。" : "已取消此工作。");
      await onMutationComplete();
      if (!isCurrent()) return;
      await loadJobs();
    } catch (reason) {
      if (!isCurrent()) return;
      setCommand(null);
      if (reason instanceof OperationsClientError && reason.status === 409) {
        // Previously this closed the dialog and set only a quiet status line, so
        // a rejected command looked exactly like a successful one.
        await loadJobs();
        if (!isCurrent()) return;
        toast.error("此工作的狀態已改變，指令未有執行。已重新載入最新狀態。");
        setError("此工作的狀態已改變，指令未有執行。");
      } else {
        const definiteRejection =
          reason instanceof OperationsClientError && [400, 401, 403, 404].includes(reason.status);
        if (!definiteRejection) {
          unconfirmedJob.current = current.job.id;
          setReadbackRequired(true);
        }
        const message = operationsErrorMessage(reason);
        setError(definiteRejection ? message : `${message} 請先重新載入原工作並核對，勿直接重試。`);
        toast.error(message);
      }
    } finally {
      if (isCurrent()) setPendingCommand(null);
    }
  };

  if (!capabilities.jobsRead) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div className="flex flex-1 flex-wrap items-end gap-2">
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
          {/* Filter controls are not disabled on `loading`: that flag was also set by the
              30s background poll. Background ticks leave `loading` untouched. */}
          <label className="grid min-w-52 gap-1 text-sm">
            <span className="text-muted-foreground">工作類型</span>
            <Select value={jobType || "all"} onValueChange={changeJobType}>
              <SelectTrigger aria-label="按工作類型篩選" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {jobTypeOptions().map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
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
      {readbackRequired ? (
        <p role="status" className="text-sm text-amber-800">
          指令結果未明。重新載入原工作前，暫停提交其他工作指令。
        </p>
      ) : null}

      <JobsTable
        rows={rows}
        capabilities={capabilities}
        busy={pendingCommand !== null || readbackRequired}
        onCommand={setCommand}
        emptyContent={
          loading || !hasLoadedOnce ? (
            "載入中…"
          ) : hasJobFilters ? (
            <span className="inline-flex flex-wrap items-center justify-center gap-2">
              {status === "failed" && jobType === ""
                ? "目前沒有失敗的背景工作。"
                : "沒有符合目前篩選的工作。"}
              <Button type="button" variant="outline" size="sm" onClick={clearJobFilters}>
                清除篩選
              </Button>
            </span>
          ) : (
            "目前沒有背景工作。"
          )
        }
      />

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
        description={command ? jobCommandDescription(command.job) : "請確認此工作指令。"}
        confirmLabel={command?.action === "retry" ? "重試" : "取消工作"}
        confirmVariant={command?.action === "cancel" ? "destructive" : "default"}
        isPending={pendingCommand !== null}
        disabled={readbackRequired}
        onOpenChange={(open) => {
          if (!open) setCommand(null);
        }}
        onConfirm={() => void runCommand()}
      >
        {command ? <JobCommandWarning command={command} /> : null}
      </AdminConfirmDialog>
    </div>
  );
}
