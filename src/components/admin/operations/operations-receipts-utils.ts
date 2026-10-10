import { RECEIPT_MAX_ATTEMPTS } from "@/lib/whatsapp-enquiries/receipt-retry-policy";
import type {
  InboundReceiptProblem,
  InboundReceiptProblemKind,
} from "@/lib/admin/operations/operations-types";

/** Pure copy and rules behind the receipts panel.
 *
 * Kept out of AdminOperationsReceipts.tsx so that file exports only components
 * (react-refresh/only-export-components).
 */

export const RECEIPT_KIND_LABELS: Record<InboundReceiptProblemKind, string> = {
  retry_scheduled: "等候重試",
  retry_exhausted: "已停止自動重試",
  review_required: "需人工檢查",
  needs_routing: "需要分派",
};

export const RECEIPT_NEEDS_ROUTING_HELP =
  "此訊息在自動分派開啟時收到，但補錄時只作記錄，未有分派或通知同事。請開啟對話並手動分派。";

const RECEIPT_REASON_LABELS: Record<string, string> = {
  PROJECTION_FAILED: "寫入收件匣失敗",
  WA_ENQUIRY_SCHEMA_REQUIRED: "資料庫結構未就緒",
  REVIEW_REQUIRED: "非即時來訊，需人工檢查",
};

export const receiptReasonLabel = (blockReason: string | null) =>
  blockReason ? (RECEIPT_REASON_LABELS[blockReason] ?? blockReason) : "—";

/** The only reference staff see: the first 8 characters of the receipt id. */
export const receiptReference = (id: string) => id.slice(0, 8);

export const receiptConversationHref = (conversationId: string | null) =>
  conversationId ? `/admin/whatsapp?conversation=${encodeURIComponent(conversationId)}` : null;

export const receiptBadgeVariant = (kind: InboundReceiptProblemKind) =>
  kind === "needs_routing" || kind === "retry_exhausted"
    ? ("destructive" as const)
    : ("secondary" as const);

/** 重試 is shown only to staff who hold system.jobs.retry, and only for rows the server accepts. */
export const canShowReceiptRetry = (
  row: Pick<InboundReceiptProblem, "kind" | "canRetry">,
  jobsRetry: boolean,
) =>
  jobsRetry && row.canRetry && (row.kind === "retry_scheduled" || row.kind === "retry_exhausted");

/** Manual retries can push attempts past the automatic cap; show that as 20+ (display only). */
export const receiptAttemptsLabel = (row: Pick<InboundReceiptProblem, "kind" | "attemptCount">) =>
  row.kind === "retry_exhausted" && row.attemptCount > 20 ? "20+" : String(row.attemptCount);

/** `prior` is the row as staff saw it before retrying; that retry is itself one more attempt. */
export const receiptRetryToast = (
  projectionState: string,
  prior?: Pick<InboundReceiptProblem, "kind" | "attemptCount">,
) => {
  if (projectionState === "projected") {
    return { kind: "success" as const, message: "已補錄這則來訊。" };
  }
  const exhausted =
    prior !== undefined &&
    (prior.kind === "retry_exhausted" || prior.attemptCount + 1 >= RECEIPT_MAX_ATTEMPTS);
  return {
    kind: "error" as const,
    message: exhausted
      ? "重試未成功。已停止自動重試，請稍後再手動重試。"
      : "重試未成功，系統會稍後再自動重試。",
  };
};

export const RECEIPT_CONFLICT_MESSAGE = "此收件的狀態已改變，未有重試。已重新載入最新狀態。";

export const receiptRetryErrorMessage = (requestId: string | null) =>
  requestId ? `未能重試，請稍後再試。（參考編號：${requestId}）` : "未能重試，請稍後再試。";

export const shouldRefreshOperationsReceipts = ({
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
