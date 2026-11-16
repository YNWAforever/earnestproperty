import { notificationPhone } from "./enquiry-routing.mjs";

/**
 * One-off operator delivery canary: prove the company WhatsApp channel can deliver the exact
 * configured staff alert template to a single owner-nominated number before any staff alert is
 * enabled. The effect stays off unless EP_WA_CANARY_ENABLED is exactly "true", and the phone is
 * never accepted from a job payload, HTTP input or the database — only from that server-only env
 * value, so a queued job can never be pointed at another number.
 */
export const CANARY_JOB_TYPE = "woztell.enquiry.canary.send";

export function canarySendPlan(env = {}) {
  if (env.EP_WA_CANARY_ENABLED !== "true") return { allowed: false, reason: "CANARY_DISABLED" };
  const phone = notificationPhone(env.EP_WA_CANARY_PHONE);
  if (!phone) return { allowed: false, reason: "CANARY_PHONE_INVALID" };
  return { allowed: true, phone };
}

/** Audit metadata never needs the full destination; keep it masked. */
export function maskCanaryPhone(phone) {
  return typeof phone === "string" && /^852\d{8}$/.test(phone)
    ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
    : "****";
}
