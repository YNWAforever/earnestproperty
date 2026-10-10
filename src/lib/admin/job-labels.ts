/**
 * FX-17a G-09: zh-HK names and failure reasons for background jobs. Client-safe: the jobs API
 * sends a fixed `errorCode`, never free text, and this table is the only place it becomes copy.
 * A test reads the job registry source so a new job type or stored code cannot ship unlabelled.
 */
import type { JobStatus } from "@/lib/admin/operations/operations-types";

export const JOB_TYPE_LABELS: Record<string, string> = {
  "ai.knowledge.rebuild": "重建 AI 知識庫",
  "ai.knowledge.repair": "更新 AI 知識庫",
  "woztell.campaign.deliver": "推廣活動發送",
  "woztell.reply.deliver": "WhatsApp 回覆發送",
  "woztell.history.import": "WhatsApp 對話紀錄匯入",
  "woztell.enquiry.process": "WhatsApp 查詢處理",
  "woztell.enquiry.service": "WhatsApp 查詢服務跟進",
  "woztell.enquiry.assign": "WhatsApp 查詢指派",
  "woztell.enquiry.sla.check": "回覆期限檢查",
  "woztell.enquiry.staff.notify": "同事接手通知",
  "woztell.enquiry.staff.notify.reconcile": "同事通知結果核對",
  "woztell.enquiry.staff.ack.check": "同事接手確認檢查",
  "woztell.enquiry.staff.test": "同事通知測試",
  "lead.staff.alert": "新客戶查詢通知",
  "lead.staff.alert.reconcile": "新客戶查詢通知核對",
};

export const UNKNOWN_JOB_TYPE_LABEL = "其他工作";

export function jobTypeLabel(jobType: string): string {
  return Object.hasOwn(JOB_TYPE_LABELS, jobType)
    ? JOB_TYPE_LABELS[jobType]
    : UNKNOWN_JOB_TYPE_LABEL;
}

const EXTERNAL_TIMEOUT = "外部服務沒有及時回應。";
const OWNERSHIP_LOST = "工作已由另一個處理程序接手。";
const SCHEMA_MISSING = "資料庫未更新到所需版本。";

export const JOB_FAILURE_REASONS: Record<string, string> = {
  JOB_HANDLER_FAILED: "處理時出錯，原因未分類。",
  LEASE_EXPIRED: "處理時間過長，工作中斷。",
  JOB_DEFERRED: "等候另一項發送完成後再處理。",
  VALIDATION_ERROR: "工作資料不完整，無法處理。",
  WOZTELL_PROVIDER_TIMEOUT: "WhatsApp 服務沒有及時回應。",
  WOZTELL_PROVIDER_UNAVAILABLE: "WhatsApp 服務暫時無法使用。",
  WOZTELL_CONFIGURATION_UNAVAILABLE: "WhatsApp 發送設定未完成。",
  WOZTELL_DELIVERY_INCOMPLETE: "部分訊息未完成發送。",
  WOZTELL_CAMPAIGN_PAUSED: "推廣活動已暫停，請到推廣活動恢復。",
  WOZTELL_PROVIDER_REJECTED: "WhatsApp 服務拒絕了發送要求。",
  WOZTELL_DELIVERY_UNKNOWN: "發送結果不明，請先核對再重試。",
  INTEGRATION_TIMEOUT: EXTERNAL_TIMEOUT,
  OPENCODE_GO_TIMEOUT: EXTERNAL_TIMEOUT,
  JOB_OWNERSHIP_LOST: OWNERSHIP_LOST,
  JOB_LEASE_REQUIRED: OWNERSHIP_LOST,
  PERMISSION_DENIED: "執行此工作的帳戶沒有權限。",
  SCHEMA_RELATION_MISSING: SCHEMA_MISSING,
  SCHEMA_COLUMN_MISSING: SCHEMA_MISSING,
};

export const JOB_FAILED_NO_CODE_REASON = "失敗，未有記錄原因。";
export const JOB_UNKNOWN_CODE_REASON = "處理失敗（未分類原因）。";

/**
 * The reason to show for a job, or null when there is nothing to explain. A failed job always
 * has a reason; a job waiting to retry shows the code its last attempt stored.
 */
export function jobFailureReason(
  code: string | null | undefined,
  status: JobStatus,
): string | null {
  if (code) {
    if (status === "succeeded" || status === "cancelled") return null;
    return Object.hasOwn(JOB_FAILURE_REASONS, code)
      ? JOB_FAILURE_REASONS[code]
      : JOB_UNKNOWN_CODE_REASON;
  }
  return status === "failed" ? JOB_FAILED_NO_CODE_REASON : null;
}

/**
 * Job types whose handler can send a WhatsApp message, so a retry may send it again. The test in
 * job-labels.test.ts reads the registry and fails when a registered type is in neither list.
 * `woztell.enquiry.staff.test` is included because it sends a test WhatsApp to a colleague.
 */
export const DELIVERY_JOB_TYPES: readonly string[] = [
  "woztell.campaign.deliver",
  "woztell.reply.deliver",
  "lead.staff.alert",
  "woztell.enquiry.staff.notify",
  "woztell.enquiry.staff.test",
];

/** Registered types that never send a message (reconcile and check jobs only read or record). */
export const NON_DELIVERY_JOB_TYPES: readonly string[] = [
  "ai.knowledge.rebuild",
  "ai.knowledge.repair",
  "woztell.history.import",
  "woztell.enquiry.process",
  "woztell.enquiry.service",
  "woztell.enquiry.assign",
  "woztell.enquiry.sla.check",
  "woztell.enquiry.staff.notify.reconcile",
  "woztell.enquiry.staff.ack.check",
  "lead.staff.alert.reconcile",
];

export const JOB_RETRY_RESEND_WARNING =
  "重試可能會再次發送 WhatsApp 訊息。請先核對客戶或同事是否已收到，才重試。";

export function isDeliveryJobType(jobType: string): boolean {
  return DELIVERY_JOB_TYPES.includes(jobType);
}

/** Retry/cancel confirmation text: 「{工作類型}：{原因}」, never the UUID. */
export function jobCommandDescription(job: {
  jobType: string;
  status: JobStatus;
  errorCode: string | null;
}): string {
  const reason = jobFailureReason(job.errorCode, job.status);
  return reason ? `${jobTypeLabel(job.jobType)}：${reason}` : jobTypeLabel(job.jobType);
}

export function jobTypeOptions(): Array<{ value: string; label: string }> {
  return [
    { value: "all", label: "所有類型" },
    ...Object.entries(JOB_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  ];
}
