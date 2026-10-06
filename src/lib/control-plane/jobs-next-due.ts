import {
  RECEIPT_DUE_AT_SQL,
  RECEIPT_ELIGIBLE_SQL,
} from "../whatsapp-enquiries/receipt-retry-policy.ts";

type JobLane = "service" | "general";
type DueRow = { due_at: unknown };
type DueQuery = (sql: string, params: unknown[]) => Promise<DueRow[]>;

/** Called only while draining an active lane; it never polls Neon while idle. */
export async function getNextJobDueAt(input: {
  lane: JobLane;
  capabilities?: string[];
  query: DueQuery;
}): Promise<string | null> {
  const jobsDue = `SELECT min(CASE WHEN status='queued' THEN run_after ELSE lease_expires_at END) AS due_at
     FROM ops_jobs
     WHERE status IN ('queued','running')
       AND CASE WHEN $1='service' THEN (job_type || '@' || payload_version::text)=ANY($2::text[])
         ELSE NOT ((job_type LIKE 'woztell.enquiry.%'
           AND NOT(job_type='woztell.enquiry.process' AND payload_version=1))
           OR (job_type='woztell.reply.deliver' AND payload_version=2)) END`;
  // Only the service lane recovers receipts, so only it waits for them. A receipt is
  // due exactly when the recovery claim would take it, so the alarm never re-arms
  // for a row recovery refuses (capped, REVIEW_REQUIRED, leased or backing off).
  const statement =
    input.lane === "service"
      ? `SELECT least((${jobsDue}),
         (SELECT min(${RECEIPT_DUE_AT_SQL("r")}) FROM whatsapp_inbound_receipts r
          WHERE ${RECEIPT_ELIGIBLE_SQL("r")})) AS due_at`
      : jobsDue;
  const rows = await input.query(statement, [input.lane, input.capabilities ?? []]);
  const value = rows[0]?.due_at;
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_NEXT_JOB_DUE_AT");
  return date.toISOString();
}
