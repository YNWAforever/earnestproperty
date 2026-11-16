export type CanarySendPlan =
  | { allowed: true; phone: string }
  | { allowed: false; reason: "CANARY_DISABLED" | "CANARY_PHONE_INVALID" };

export const CANARY_JOB_TYPE: string;

/** Effect plan for the one-off operator delivery canary; the destination comes only from env. */
export function canarySendPlan(env?: Record<string, string | undefined>): CanarySendPlan;

/** Audit metadata keeps only the country code and last four digits. */
export function maskCanaryPhone(phone: string | null | undefined): string;
