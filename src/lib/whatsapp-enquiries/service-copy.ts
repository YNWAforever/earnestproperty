import type { ServicePolicy } from "./service-policy.ts";
export type ServicePurpose = "after_hours_ack" | "survey" | "survey_thanks" | "manager_ack";
export const SERVICE_COPY = {
  survey:
    "多謝選用晉誠地產，距離您發送樓盤查詢已有一段時間，\n請問您滿意我們的服務或需要進一步協助嗎?\n1.滿意\n2.需要進一步協助",
  survey_thanks: "多謝您滿意我們的服務，希望能繼續為閣下服務",
  manager_ack: "我們的分行經理會盡快與您聯絡提供進一步協助",
} as const;
export function renderServiceCopy(purpose: ServicePurpose, policy: ServicePolicy): string {
  if (policy.status !== "approved" || !policy.approvedBy || !policy.copyVersion)
    throw new Error("SERVICE_COPY_UNAPPROVED");
  if (purpose === "after_hours_ack") {
    if (!policy.copy.afterHours?.trim()) throw new Error("AFTER_HOURS_COPY_UNAPPROVED");
    return policy.copy.afterHours;
  }
  if (!Object.hasOwn(SERVICE_COPY, purpose)) throw new Error("SERVICE_PURPOSE_INVALID");
  return SERVICE_COPY[purpose];
}
