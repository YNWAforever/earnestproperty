import { useWorkspaceCurrent } from "@/hooks/use-workspace-current";
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchOperationsReceipts,
  OperationsClientError,
  retryOperationsReceipt,
} from "@/lib/admin/operations/operations-client";
import type { InboundReceiptProblem } from "@/lib/admin/operations/operations-types";
import type { OperationsCapabilities } from "@/lib/control-plane/capabilities";

import {
  canShowReceiptRetry,
  RECEIPT_CONFLICT_MESSAGE,
  RECEIPT_KIND_LABELS,
  RECEIPT_NEEDS_ROUTING_HELP,
  receiptBadgeVariant,
  receiptConversationHref,
  receiptReasonLabel,
  receiptReference,
  receiptRetryErrorMessage,
  receiptRetryToast,
  shouldRefreshOperationsReceipts,
} from "./operations-receipts-utils";

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Presentational table. No message body, phone number or member id ever reaches it. */
export function ReceiptsTable({
  rows,
  jobsRetry,
  busy,
  emptyMessage,
  onRetry,
}: {
  rows: InboundReceiptProblem[];
  jobsRetry: boolean;
  busy: boolean;
  emptyMessage: string;
  onRetry: (row: InboundReceiptProblem) => void;
}) {
  return (
    <Table className="min-w-[46rem]">
      <TableHeader>
        <TableRow>
          <TableHead>收到時間</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead>嘗試次數</TableHead>
          <TableHead>下次重試</TableHead>
          <TableHead>原因</TableHead>
          <TableHead>對話</TableHead>
          <TableHead className="w-24 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const href = receiptConversationHref(row.conversationId);
          return (
            <TableRow key={row.id} data-receipt-kind={row.kind}>
              <TableCell>
                <p>{formatDate(row.receivedAt)}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {receiptReference(row.id)}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant={receiptBadgeVariant(row.kind)}>
                  {RECEIPT_KIND_LABELS[row.kind]}
                </Badge>
                {row.kind === "needs_routing" ? (
                  <p className="mt-1 max-w-72 text-xs text-muted-foreground">
                    {RECEIPT_NEEDS_ROUTING_HELP}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="tabular-nums">{row.attemptCount}</TableCell>
              <TableCell>{row.nextRetryAt ? formatDate(row.nextRetryAt) : "—"}</TableCell>
              <TableCell>{receiptReasonLabel(row.blockReason)}</TableCell>
              <TableCell>
                {href ? (
                  <a className="text-primary underline underline-offset-2" href={href}>
                    開啟對話
                  </a>
                ) : (
                  <span className="text-muted-foreground">未有對話</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-end">
                  {canShowReceiptRetry(row, jobsRetry) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`重試收件 ${receiptReference(row.id)}`}
                      disabled={busy}
                      onClick={() => onRetry(row)}
                    >
                      <RotateCcw className="size-4" />
                      重試
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
        {!rows.length ? (
          <TableRow>
            <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

export function AdminOperationsReceipts({
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
  const [rows, setRows] = useState<InboundReceiptProblem[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<InboundReceiptProblem | null>(null);
  const [pending, setPending] = useState(false);
  const requestSequence = useRef(0);
  const previousPulse = useRef(pulse);

  const load = useCallback(async () => {
    if (!active || !capabilities.jobsRead || !isCurrent()) return;
    const request = ++requestSequence.current;
    try {
      const result = await fetchOperationsReceipts(isCurrent);
      if (request !== requestSequence.current || !isCurrent()) return;
      setRows(result.data.rows);
      setLoadError(null);
      setHasLoadedOnce(true);
    } catch {
      if (request === requestSequence.current && isCurrent()) {
        setLoadError("未能載入來訊收件。");
        setHasLoadedOnce(true);
      }
    }
  }, [active, capabilities.jobsRead, isCurrent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const priorPulse = previousPulse.current;
    previousPulse.current = pulse;
    if (
      !shouldRefreshOperationsReceipts({
        active,
        jobsRead: capabilities.jobsRead,
        pending,
        previousPulse: priorPulse,
        pulse,
      })
    )
      return;
    void load();
  }, [active, capabilities.jobsRead, load, pending, pulse]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  const runRetry = async () => {
    if (!candidate || pending || !isCurrent()) return;
    const current = candidate;
    // A read that started before this command cannot confirm its outcome.
    requestSequence.current += 1;
    setPending(true);
    try {
      const result = await retryOperationsReceipt(current.id, isCurrent);
      if (!isCurrent()) return;
      setCandidate(null);
      const outcome = receiptRetryToast(result.data.projectionState);
      if (outcome.kind === "success") toast.success(outcome.message);
      else toast.error(outcome.message);
      await onMutationComplete();
      if (!isCurrent()) return;
      await load();
    } catch (reason) {
      if (!isCurrent()) return;
      setCandidate(null);
      if (reason instanceof OperationsClientError && reason.status === 409) {
        toast.error(RECEIPT_CONFLICT_MESSAGE);
      } else {
        toast.error(
          receiptRetryErrorMessage(
            reason instanceof OperationsClientError ? reason.requestId : null,
          ),
        );
      }
      await load();
    } finally {
      if (isCurrent()) setPending(false);
    }
  };

  if (!capabilities.jobsRead) return null;

  return (
    <section aria-labelledby="operations-receipts-title" className="space-y-3 border-t pt-6">
      <div className="space-y-1">
        <h2 id="operations-receipts-title" className="text-base font-semibold">
          WhatsApp 來訊收件
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          未能寫入收件匣的客戶來訊。系統會自動重試；重試只會補錄訊息，不會回覆客戶，亦不會通知或分派同事。
        </p>
      </div>
      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : null}
      <ReceiptsTable
        rows={rows}
        jobsRetry={capabilities.jobsRetry}
        busy={pending}
        emptyMessage={hasLoadedOnce ? "沒有需要處理的來訊收件。" : "載入中…"}
        onRetry={setCandidate}
      />
      <AdminConfirmDialog
        open={candidate !== null}
        title="重試這則來訊？"
        description="系統會再嘗試把這則訊息寫入收件匣（只作記錄）。不會回覆客戶，亦不會通知或分派同事。"
        confirmLabel="重試"
        isPending={pending}
        onOpenChange={(open) => {
          if (!open) setCandidate(null);
        }}
        onConfirm={() => void runRetry()}
      />
    </section>
  );
}
