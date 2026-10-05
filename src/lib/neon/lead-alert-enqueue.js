/**
 * The one place the staff lead-alert job type is spelled (FX-05b).
 *
 * Plain JS with no `server-only` import, so the intake SQL modules and the job
 * registry share it. Task 4 adds the lead-insert CTE fragment to this file;
 * backfill and import code must never import it.
 */
export const LEAD_ALERT_JOB_TYPE = "lead.staff.alert";
