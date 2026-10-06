import type { WhatsappConsentPreset } from "@/components/admin/WhatsappConsentDialog";

// FX-08 inbox safety helpers. Plain functions and copy (no components), so fast refresh keeps
// working for the component files and the rules are unit-testable without rendering.

/** The consent dialog preset for a near-miss confirmation: one click on 確認並儲存 saves. */
export function nearMissConsentPreset(messageId: string): WhatsappConsentPreset {
  return {
    optedIn: false,
    evidenceSource: "customer_opt_out",
    evidenceRef: "near-miss:" + messageId,
  };
}

/** Toast after a manager records the outcome of an unconfirmed send. Never claims an unlock it did not make. */
export function resolveUnknownSuccessNotice(lockReleased: boolean) {
  return lockReleased
    ? "已記錄核對結果，對話已解鎖。系統沒有重新傳送；如需再發，請自行輸入新訊息。"
    : "已記錄核對結果。對話仍有其他未確認傳送，暫時未能解鎖。";
}

export const MANAGER_RESOLVED_READBACK_NOTICE = "經理已核對此傳送；沒有重送。";

export type OutboundReadbackOutcome =
  | "sent_or_queued"
  | "not_completed"
  | "manager_resolved"
  | "pending";

/**
 * How the sender's tab reads back a send it has journalled. Every outcome except `pending` is
 * final, so the tab clears its journal and unlocks. A manager's resolution (FX-08) is final too:
 * without it the sender's tab would stay locked after the conversation was released.
 */
export function outboundReadbackOutcome(state: string): OutboundReadbackOutcome {
  if (state === "queued" || state === "accepted") return "sent_or_queued";
  if (state === "failed" || state === "cancelled") return "not_completed";
  if (state === "resolved_sent" || state === "resolved_not_sent") return "manager_resolved";
  return "pending";
}
