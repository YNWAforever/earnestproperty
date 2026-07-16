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

export const canRetryOperationsJob = (status: JobStatus) => status === "failed";

export const canCancelOperationsJob = (status: JobStatus) =>
  status === "queued" || status === "running" || status === "failed";

export const mergeOperationsJobRows = (
  current: JobListItem[],
  incoming: JobListItem[],
  append: boolean,
) => (append ? [...current, ...incoming] : incoming);

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
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

function operationsErrorMessage(error: unknown) {
  if (error instanceof OperationsClientError) {
    return error.requestId ? `${error.message} Request ID: ${error.requestId}` : error.message;
  }
  return error instanceof Error ? error.message : "Unable to load jobs.";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
  const [pendingCommand, setPendingCommand] = useState<JobCommand | null>(null);
  const requestSequence = useRef(0);
  const previousPulse = useRef(pulse);

  const loadJobs = useCallback(
    async ({ append = false, cursor }: { append?: boolean; cursor?: string } = {}) => {
      if (!active || !capabilities.jobsRead) return;
      const request = ++requestSequence.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchOperationsJobs({
          status: status === "all" ? undefined : status,
          jobType: jobType || undefined,
          cursor,
          limit: 25,
        });
        if (request !== requestSequence.current) return;
        setRows((current) => mergeOperationsJobRows(current, result.data.rows, append));
        setNextCursor(result.data.nextCursor);
      } catch (reason) {
        if (request === requestSequence.current) setError(operationsErrorMessage(reason));
      } finally {
        if (request === requestSequence.current) setLoading(false);
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
    void loadJobs();
  }, [active, loadJobs, pendingCommand, pulse]);

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
      toast.success(current.action === "retry" ? "Job queued for retry." : "Job cancelled.");
      await onMutationComplete();
      await loadJobs();
    } catch (reason) {
      setCommand(null);
      if (reason instanceof OperationsClientError && reason.status === 409) {
        await loadJobs();
        setError("工作狀態已更新");
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
            <span className="text-muted-foreground">Status</span>
            <Select value={status} onValueChange={changeStatus} disabled={loading}>
              <SelectTrigger aria-label="Filter jobs by status" className="w-full sm:w-44">
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
            <span className="text-muted-foreground">Job type</span>
            <Input
              value={jobTypeDraft}
              onChange={(event) => setJobTypeDraft(event.target.value)}
              placeholder="Filter by job type"
              disabled={loading}
            />
          </label>
          <Button type="submit" variant="secondary" disabled={loading}>
            Apply filters
          </Button>
        </form>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Refresh jobs"
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
            <TooltipContent>Refresh jobs</TooltipContent>
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
            <TableHead>Job</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Run after</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
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
                <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
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
                            aria-label={`Retry job ${job.id}`}
                            disabled={pendingCommand !== null}
                            onClick={() => setCommand({ action: "retry", job })}
                          >
                            <RotateCcw className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Retry job</TooltipContent>
                      </Tooltip>
                    ) : null}
                    {capabilities.jobsCancel && canCancelOperationsJob(job.status) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Cancel job ${job.id}`}
                            disabled={pendingCommand !== null}
                            onClick={() => setCommand({ action: "cancel", job })}
                          >
                            <XCircle className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Cancel job</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </TooltipProvider>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && !loading ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No jobs found.
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
            onClick={() => void loadJobs({ append: true, cursor: nextCursor })}
          >
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}

      <AdminConfirmDialog
        open={command !== null}
        title={command?.action === "retry" ? "Retry job?" : "Cancel job?"}
        description={
          command ? `${command.job.jobType} (${command.job.id})` : "Confirm this job command."
        }
        confirmLabel={command?.action === "retry" ? "Retry" : "Cancel job"}
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
