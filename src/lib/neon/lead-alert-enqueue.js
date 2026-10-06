/**
 * The one place the staff lead-alert job type is spelled (FX-05b).
 *
 * Plain JS with no `server-only` import, so the intake SQL modules and the job
 * registry share it. The lead-insert CTE fragment below is
 * imported by live intake only; backfill and import code must never import it.
 */
export const LEAD_ALERT_JOB_TYPE = "lead.staff.alert";
/** Turns a lost-lease dispatch into `unknown`; never resends. */
export const LEAD_ALERT_RECONCILE_JOB_TYPE = "lead.staff.alert.reconcile";

/**
 * CTE that queues exactly one alert job per lead inserted by `leadCte`, in the
 * same statement. `ON CONFLICT` keeps a retry from queueing a second job.
 * Live website intake only; backfill and import paths must never use this.
 */
export function leadAlertEnqueueCte(leadCte) {
  if (typeof leadCte !== "string" || !/^[a-z_]+$/.test(leadCte)) {
    throw new Error("leadAlertEnqueueCte needs a plain lowercase CTE name.");
  }
  return `lead_alert AS (
      INSERT INTO ops_jobs (job_type, payload_version, payload, status, max_attempts, run_after, idempotency_key)
      SELECT '${LEAD_ALERT_JOB_TYPE}', 1, jsonb_build_object('leadId', id::text), 'queued', 3, now(), 'lead-alert:'||id
      FROM ${leadCte}
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    )`;
}
