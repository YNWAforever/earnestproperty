export const LEAD_ALERT_JOB_TYPE: "lead.staff.alert";
export const LEAD_ALERT_RECONCILE_JOB_TYPE: "lead.staff.alert.reconcile";
/** Live intake only; backfill and import code must never import this. */
export function leadAlertEnqueueCte(leadCte: string): string;
