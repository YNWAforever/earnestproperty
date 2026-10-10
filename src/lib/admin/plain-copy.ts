/**
 * FX-17a G-11: plain zh-HK for the values the WhatsApp admin screens used to print raw
 * (ISO timestamps, `website`, `unknown`, delivery states). Labels come from the glossary;
 * dates go through the one existing Hong Kong formatter.
 */
import { formatHkDateTime } from "@/lib/format";
import { ASSIGNMENT_STATE_LABELS, PLACEMENT_SOURCE_LABELS } from "@/lib/admin/glossary";

/** Approved wording for a message WhatsApp accepted but has not confirmed as delivered. */
export const HANDED_TO_WHATSAPP = "已交 WhatsApp 發送（未確認送達）";
export const HANDED_TO_WHATSAPP_NOTICE = "已交 WhatsApp 發送，尚未確認送達或已讀。";

/** A staff test notification's state. Existing zh-HK wording, with the approved acceptance text. */
export const TEST_ATTEMPT_STATE_LABELS: Record<string, string> = {
  queued: "等待傳送",
  dispatching: "傳送中（未確認）",
  accepted: HANDED_TO_WHATSAPP,
  unknown: "結果不明，請核對；不會自動重發",
  failed: "送出失敗",
  blocked: "已阻擋",
};

/** Whether staff can receive assignments from a link's requested colleague. */
export const LINK_READINESS_LABELS: Record<string, string> = {
  ready: "已就緒",
  blocked: ASSIGNMENT_STATE_LABELS.blocked,
  unknown: "未有數據",
};

/** A date and time in Hong Kong, or `empty` when the value is missing or not a date. */
export function hkTime(value: string | null | undefined, empty: string): string {
  return formatHkDateTime(value) ?? empty;
}

export function placementSourceText(source: string | null | undefined): string {
  if (!source) return PLACEMENT_SOURCE_LABELS.unknown;
  return PLACEMENT_SOURCE_LABELS[source] ?? PLACEMENT_SOURCE_LABELS.other;
}

export function assignmentStateText(state: string | null | undefined, empty: string): string {
  if (!state) return empty;
  return ASSIGNMENT_STATE_LABELS[state] ?? "狀態待核實";
}

/** A count that may be unknown: a number, or the approved no-data text. */
export function countText(count: number | null | undefined): string {
  return typeof count === "number" ? String(count) : "未有數據";
}

export function testAttemptStateText(state: string): string {
  return TEST_ATTEMPT_STATE_LABELS[state] ?? "狀態待核實";
}

export function linkReadinessText(readiness: string): string {
  return LINK_READINESS_LABELS[readiness] ?? "未有數據";
}

function dueText(value: unknown): string {
  const formatted = typeof value === "string" ? formatHkDateTime(value) : null;
  return formatted ? `期限 ${formatted}` : "期限未設定";
}

export function enquiryQueueRowText(r: Record<string, unknown>): string {
  return [
    String(r.public_listing_no ?? "一般查詢"),
    r.confirmed ? "已確認分派" : "未確認分派",
    r.association_review
      ? "需要核實"
      : assignmentStateText(r.assignment_state as string | null | undefined, "待人手回覆"),
    dueText(r.response_due_at),
  ].join(" · ");
}
