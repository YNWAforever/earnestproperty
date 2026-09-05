import {
  getJobHandler,
  isRetryableJobError,
  parseRegisteredJobPayload,
} from "./job-handlers.server.ts";

type JobRow = {
  id: string;
  job_type: string;
  payload_version: number;
  payload: unknown;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt_count: number;
  max_attempts: number;
  run_after: unknown;
  lease_owner: string | null;
  lease_expires_at: unknown;
  last_error_code: string | null;
  last_error_summary: string | null;
  idempotency_key: string;
  actor_staff_id: string | null;
  created_at: unknown;
  updated_at: unknown;
};

function validationError(message: string) {
  return Object.assign(new Error(message), { code: "VALIDATION_ERROR" });
}

function cleanWorkerId(workerId: string) {
  const value = workerId.trim().slice(0, 120);
  if (!value) throw validationError("Worker ID is required.");
  return value;
}

function cleanIdempotencyKey(value: string) {
  const key = value.trim().slice(0, 200);
  if (!key) throw validationError("Idempotency key is required.");
  return key;
}

export async function enqueueJob(input: {
  jobType: string;
  payloadVersion: number;
  payload: unknown;
  idempotencyKey: string;
  actorStaffId?: string | null;
  maxAttempts?: number;
  runAfter?: Date;
}) {
  const parsed = parseRegisteredJobPayload(input.jobType, input.payloadVersion, input.payload);
  const { queryRows } = await import("../neon/db.server.ts");
  const rows = await queryRows<JobRow>(
    `INSERT INTO ops_jobs
      (job_type, payload_version, payload, status, max_attempts, run_after,
       idempotency_key, actor_staff_id)
     VALUES ($1, $2, $3::jsonb, 'queued', $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING *`,
    [
      input.jobType,
      input.payloadVersion,
      JSON.stringify(parsed.payload),
      Math.min(Math.max(Math.trunc(input.maxAttempts ?? 5), 1), 100),
      (input.runAfter ?? new Date()).toISOString(),
      cleanIdempotencyKey(input.idempotencyKey),
      input.actorStaffId ?? null,
    ],
  );
  return rows[0];
}

export async function claimJobs(input: {
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}) {
  const { queryRows } = await import("../neon/db.server.ts");
  const workerId = cleanWorkerId(input.workerId);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10), 1), 100);
  const leaseSeconds = Math.min(Math.max(Math.trunc(input.leaseSeconds ?? 60), 5), 3_600);
  return queryRows<JobRow>(
    `WITH candidates AS (
       SELECT id
       FROM ops_jobs
       WHERE status = 'queued' AND run_after <= now()
       ORDER BY run_after, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE ops_jobs AS job
     SET status = 'running',
         attempt_count = attempt_count + 1,
         lease_owner = $2,
         lease_expires_at = now() + ($3::integer * interval '1 second'),
         updated_at = now()
     FROM candidates
     WHERE job.id = candidates.id
     RETURNING job.*`,
    [limit, workerId, leaseSeconds],
  );
}
export async function renewJobLease(input: {
  jobId: string;
  workerId: string;
  leaseSeconds: number;
}) {
  const { queryRows } = await import("../neon/db.server.ts");
  const leaseSeconds = Math.min(Math.max(Math.trunc(input.leaseSeconds), 5), 3_600);
  const rows = await queryRows<JobRow>(
    `UPDATE ops_jobs
     SET lease_expires_at = now() + ($3::integer * interval '1 second')
     WHERE id = $1::uuid
       AND status = 'running'
       AND lease_owner = $2
       AND lease_expires_at >= now()
     RETURNING *`,
    [input.jobId, cleanWorkerId(input.workerId), leaseSeconds],
  );
  return rows[0] ?? null;
}

function ownershipLostError() {
  return Object.assign(new Error("The job lease is no longer owned by this worker."), {
    code: "JOB_OWNERSHIP_LOST",
  });
}

function startLeaseHeartbeat(input: { jobId: string; workerId: string; leaseSeconds: number }) {
  let stopped = false;
  let ownershipLost = false;
  let pending = Promise.resolve();
  const renew = async () => {
    if (stopped || ownershipLost) return;
    const renewed = await renewJobLease(input);
    if (!renewed) ownershipLost = true;
  };
  const queueRenew = () => {
    pending = pending.then(renew).catch(() => {
      ownershipLost = true;
    });
  };
  const intervalMs = Math.max(1_000, Math.floor((input.leaseSeconds * 1_000) / 3));
  const timer = setInterval(queueRenew, intervalMs);

  return {
    async checkpoint() {
      await pending;
      if (stopped || ownershipLost) throw ownershipLostError();
      const renewed = await renewJobLease(input);
      if (!renewed) {
        ownershipLost = true;
        throw ownershipLostError();
      }
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
      return !ownershipLost;
    },
  };
}

export async function completeJob(input: { jobId: string; workerId: string }) {
  const { queryRows } = await import("../neon/db.server.ts");
  const rows = await queryRows<JobRow>(
    `WITH completed AS (
       UPDATE ops_jobs
       SET status = 'succeeded',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = NULL,
           last_error_summary = NULL,
           updated_at = now()
       WHERE id = $1::uuid
         AND status = 'running'
         AND lease_owner = $2
         AND lease_expires_at >= now()
       RETURNING *
     ), attempt AS (
       INSERT INTO ops_job_attempts
         (job_id, attempt_number, worker_id, outcome, started_at, finished_at)
       SELECT id, attempt_count, $2, 'succeeded', updated_at, now()
       FROM completed
       ON CONFLICT (job_id, attempt_number) DO NOTHING
       RETURNING id
     )
     SELECT * FROM completed`,
    [input.jobId, cleanWorkerId(input.workerId)],
  );
  return rows[0] ?? null;
}

export async function failJob(input: {
  jobId: string;
  workerId: string;
  retryable: boolean;
  errorCode: string;
  errorSummary: string;
}) {
  const { queryRows } = await import("../neon/db.server.ts");
  const rows = await queryRows<JobRow>(
    `WITH failed AS (
       UPDATE ops_jobs
       SET status = CASE
             WHEN $3::boolean AND attempt_count < max_attempts THEN 'queued'
             ELSE 'failed'
           END,
           run_after = CASE
             WHEN $3::boolean AND attempt_count < max_attempts
               THEN now() + (LEAST(power(2, LEAST(attempt_count, 30)), 900)::integer * interval '1 second')
             ELSE run_after
           END,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = $4,
           last_error_summary = $5,
           updated_at = now()
       WHERE id = $1::uuid
         AND status = 'running'
         AND lease_owner = $2
         AND lease_expires_at >= now()
       RETURNING *
     ), attempt AS (
       INSERT INTO ops_job_attempts
         (job_id, attempt_number, worker_id, outcome, error_code, error_summary, finished_at)
       SELECT id, attempt_count, $2, 'failed', $4, $5, now()
       FROM failed
       ON CONFLICT (job_id, attempt_number) DO NOTHING
       RETURNING id
     )
     SELECT * FROM failed`,
    [
      input.jobId,
      cleanWorkerId(input.workerId),
      input.retryable,
      input.errorCode.trim().slice(0, 100) || "JOB_HANDLER_FAILED",
      input.errorSummary.trim().slice(0, 500) || "The job handler could not be completed.",
    ],
  );
  return rows[0] ?? null;
}

type JobCommandAudit = { actorStaffId: string; requestId: string };

export async function retryJob(jobId: string, audit?: JobCommandAudit) {
  const { queryRows } = await import("../neon/db.server.ts");
  const rows = await queryRows<JobRow>(
    `WITH retried AS (
       UPDATE ops_jobs
       SET status = 'queued',
           max_attempts = attempt_count + 1,
           run_after = now(),
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = NULL,
           last_error_summary = NULL,
           updated_at = now()
       WHERE id = $1::uuid AND status IN ('failed', 'cancelled')
       RETURNING *
     ), audit AS (
       INSERT INTO ops_audit_logs
         (actor_staff_id, permission, action, resource_type, resource_id, outcome, request_id, metadata)
       SELECT $2::uuid, 'system.jobs.retry', 'job.retry', 'job', id::text, 'success', $3::uuid,
              jsonb_build_object('jobId', id::text, 'status', status)
       FROM retried
       WHERE $2::uuid IS NOT NULL
       RETURNING id
     )
     SELECT * FROM retried`,
    [jobId, audit?.actorStaffId ?? null, audit?.requestId ?? null],
  );
  return rows[0] ?? null;
}

export async function cancelJob(input: {
  jobId: string;
  workerId?: string;
  audit?: JobCommandAudit;
}) {
  const { queryRows } = await import("../neon/db.server.ts");
  const workerId = cleanWorkerId(input.workerId ?? "manual-control-plane");
  const rows = await queryRows<JobRow>(
    `WITH candidate AS (
       SELECT id, status AS previous_status, attempt_count, lease_owner
       FROM ops_jobs
       WHERE id = $1::uuid AND status IN ('queued', 'running', 'failed')
       FOR UPDATE
     ), cancelled AS (
       UPDATE ops_jobs AS job
       SET status = 'cancelled',
           lease_owner = NULL,
           lease_expires_at = NULL,
           updated_at = now()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.*, candidate.previous_status, candidate.lease_owner AS previous_worker
     ), attempt AS (
       INSERT INTO ops_job_attempts
         (job_id, attempt_number, worker_id, outcome, finished_at)
       SELECT id, attempt_count, COALESCE(previous_worker, $2), 'cancelled', now()
       FROM cancelled
       WHERE previous_status = 'running' AND attempt_count > 0
       ON CONFLICT (job_id, attempt_number) DO NOTHING
       RETURNING id
     ), audit AS (
       INSERT INTO ops_audit_logs
         (actor_staff_id, permission, action, resource_type, resource_id, outcome, request_id, metadata)
       SELECT $3::uuid, 'system.jobs.cancel', 'job.cancel', 'job', id::text, 'success', $4::uuid,
              jsonb_build_object('jobId', id::text, 'status', status)
       FROM cancelled
       WHERE $3::uuid IS NOT NULL
       RETURNING id
     )
     SELECT id, job_type, payload_version, payload, status, attempt_count, max_attempts,
            run_after, lease_owner, lease_expires_at, last_error_code, last_error_summary,
            idempotency_key, actor_staff_id, created_at, updated_at
     FROM cancelled`,
    [input.jobId, workerId, input.audit?.actorStaffId ?? null, input.audit?.requestId ?? null],
  );
  return rows[0] ?? null;
}

export async function recoverExpiredLeases() {
  const { queryRows, transactionRows } = await import("../neon/db.server.ts");

  // Discover without taking job locks. Campaign dispatch/cancellation lock the campaign first.
  // Recheck job ownership in a fresh statement after obtaining that same campaign lock.
  const terminalCandidates = await queryRows<JobRow & { previous_worker: string | null }>(
    `/* terminal_campaign_candidates */
     SELECT j.*, COALESCE(j.lease_owner, a.worker_id) AS previous_worker
     FROM ops_jobs j LEFT JOIN ops_job_attempts a ON a.job_id=j.id AND a.attempt_number=j.attempt_count
     WHERE j.job_type='woztell.campaign.deliver' AND j.attempt_count >= j.max_attempts
       AND ((j.status='running' AND j.lease_expires_at < clock_timestamp()) OR
         (j.status='failed' AND j.last_error_code='LEASE_EXPIRED' AND a.error_code='LEASE_EXPIRED'
           AND EXISTS(SELECT 1 FROM whatsapp_campaign_recipients r WHERE r.status='sending'
             AND r.claim_job_id=j.id AND r.claim_worker_id=a.worker_id AND r.claim_attempt=j.attempt_count)))
     ORDER BY j.id LIMIT 100`,
  );
  const terminalRecovered: JobRow[] = [];
  for (const candidate of terminalCandidates) {
    const params = [candidate.id, candidate.previous_worker, candidate.attempt_count];
    const results = await transactionRows([
      {
        statement: `SELECT c.id FROM whatsapp_campaigns c JOIN ops_jobs j
          ON c.id::text=j.payload->>'campaignId' WHERE j.id=$1::uuid FOR UPDATE OF c`,
        params: [candidate.id],
      },
      {
        statement: `WITH candidate AS (
          SELECT j.id, $2::text AS previous_worker FROM ops_jobs j
          WHERE j.id=$1::uuid AND j.job_type='woztell.campaign.deliver'
            AND j.attempt_count = $3 AND j.attempt_count >= j.max_attempts
            AND ((j.status='running' AND j.lease_owner=$2 AND j.lease_expires_at < clock_timestamp())
              OR (j.status='failed' AND j.last_error_code='LEASE_EXPIRED' AND EXISTS (
                SELECT 1 FROM ops_job_attempts a WHERE a.job_id=j.id AND a.attempt_number=$3
                  AND a.worker_id=$2 AND a.error_code='LEASE_EXPIRED')))
          FOR UPDATE OF j
        ), recovered AS (
          UPDATE ops_jobs j SET status='failed', lease_owner=NULL, lease_expires_at=NULL,
            last_error_code='LEASE_EXPIRED', last_error_summary='The worker lease expired before completion.', updated_at=now()
          FROM candidate WHERE j.id=candidate.id RETURNING j.*,candidate.previous_worker
        ), recipients AS (
          UPDATE whatsapp_campaign_recipients r
          SET status=CASE WHEN r.dispatch_started_at IS NULL AND c.status='cancelled' THEN 'cancelled' ELSE 'failed' END,
            error=CASE WHEN r.dispatch_started_at IS NOT NULL THEN 'WOZTELL_DELIVERY_UNKNOWN'
              WHEN c.status='cancelled' THEN 'WOZTELL_CAMPAIGN_CANCELLED'
              ELSE 'WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED' END
          FROM recovered, whatsapp_campaigns c
          WHERE r.campaign_id=c.id AND c.id::text=recovered.payload->>'campaignId'
            AND r.status='sending' AND r.claim_job_id = recovered.id
            AND r.claim_worker_id = recovered.previous_worker AND r.claim_attempt = recovered.attempt_count
            AND (r.dispatch_started_at IS NULL OR (r.dispatch_job_id=recovered.id
              AND r.dispatch_worker_id=recovered.previous_worker AND r.dispatch_attempt=recovered.attempt_count))
          RETURNING r.id,r.campaign_id,r.status,r.error,r.dispatch_started_at,recovered.id AS job_id,recovered.attempt_count
        ), recipient_audit AS (
          INSERT INTO audit_logs(action,subject_type,subject_id,metadata)
          SELECT 'campaign.lease_recovered','campaign_recipient',id,
            jsonb_build_object('campaignId',campaign_id,'jobId',job_id,'attempt',attempt_count,
              'status',status,'error',error,'reserved',dispatch_started_at IS NOT NULL)
          FROM recipients RETURNING id
        ), attempt AS (
          INSERT INTO ops_job_attempts(job_id,attempt_number,worker_id,outcome,error_code,error_summary,finished_at)
          SELECT id,attempt_count,COALESCE(previous_worker,'expired-worker'),'failed','LEASE_EXPIRED',
            'The worker lease expired before completion.',now() FROM recovered
          ON CONFLICT(job_id,attempt_number) DO NOTHING RETURNING id
        ) SELECT * FROM recovered`,
        params,
      },
      {
        // Read counts only after the recipient writes. Do not overwrite cancellation or
        // another queued/live job's campaign. No handler/provider dispatch is invoked.
        statement: `UPDATE whatsapp_campaigns c SET status='failed',updated_at=now()
          FROM ops_jobs j WHERE j.id=$1::uuid AND c.id::text=j.payload->>'campaignId'
            AND j.status='failed' AND j.last_error_code='LEASE_EXPIRED' AND j.attempt_count=$3
            AND c.status IN ('queued','sending')
            AND EXISTS(SELECT 1 FROM ops_job_attempts a WHERE a.job_id=j.id AND a.attempt_number=$3
              AND a.worker_id=$2 AND a.error_code='LEASE_EXPIRED')
            AND NOT EXISTS(SELECT 1 FROM ops_jobs other WHERE other.id<>j.id
              AND other.job_type='woztell.campaign.deliver' AND other.payload->>'campaignId'=c.id::text
              AND (other.status='queued' OR (other.status='running' AND other.lease_expires_at>clock_timestamp())))
            AND NOT EXISTS(SELECT 1 FROM whatsapp_campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sending')
          RETURNING c.id`,
        params,
      },
    ]);
    terminalRecovered.push(...(results[1] as JobRow[]));
  }
  const recovered = await queryRows<JobRow>(
    `WITH expired AS (
       SELECT id, lease_owner
       FROM ops_jobs
       WHERE status = 'running' AND lease_expires_at < now()
         AND NOT (job_type='woztell.campaign.deliver' AND attempt_count >= max_attempts)
       FOR UPDATE SKIP LOCKED
     ), recovered AS (
       UPDATE ops_jobs AS job
       SET status = CASE WHEN attempt_count < max_attempts THEN 'queued' ELSE 'failed' END,
           run_after = CASE WHEN attempt_count < max_attempts THEN now() ELSE run_after END,
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error_code = 'LEASE_EXPIRED',
           last_error_summary = 'The worker lease expired before completion.',
           updated_at = now()
       FROM expired
       WHERE job.id = expired.id
       RETURNING job.*, expired.lease_owner AS previous_worker
     ), attempt AS (
       INSERT INTO ops_job_attempts
         (job_id, attempt_number, worker_id, outcome, error_code, error_summary, finished_at)
       SELECT id, attempt_count, COALESCE(previous_worker, 'expired-worker'), 'failed',
              'LEASE_EXPIRED', 'The worker lease expired before completion.', now()
       FROM recovered
       ON CONFLICT (job_id, attempt_number) DO NOTHING
       RETURNING id
     )
     SELECT id, job_type, payload_version, payload, status, attempt_count, max_attempts,
            run_after, lease_owner, lease_expires_at, last_error_code, last_error_summary,
            idempotency_key, actor_staff_id, created_at, updated_at
     FROM recovered`,
  );
  return [...terminalRecovered, ...recovered];
}

type JobListCursor = { createdAt: string; id: string };

function encodeJobCursor(cursor: JobListCursor) {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Cursors are opaque to the client but arrive as user input. Validating with
 * Date.parse accepted anything JS could parse -- including
 * "Tue Aug 11 2026 10:00:00 GMT+0800 (...)" -- and forwarded it raw into
 * $N::timestamptz, where Postgres rejects it and the route answers 500 instead
 * of the VALIDATION_ERROR/400 it intends. Match exactly what the encoder now
 * emits (microsecond, Z-suffixed).
 */
const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function decodeJobCursor(value: string | undefined): JobListCursor | null {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor");
    const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid cursor");
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== "string" ||
      !CURSOR_TIMESTAMP_PATTERN.test(String(cursor.createdAt)) ||
      typeof cursor.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id)
    ) {
      throw new Error("Invalid cursor");
    }
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    throw validationError("The job cursor is invalid.");
  }
}

function isoDate(value: unknown) {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

export async function getJobSummary() {
  const { queryRows } = await import("../neon/db.server.ts");
  const [countRows, attentionRows] = await Promise.all([
    queryRows(`SELECT
      count(*) FILTER (WHERE status = 'queued')::int AS queued,
      count(*) FILTER (WHERE status = 'running')::int AS running,
      count(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
      count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
      FROM ops_jobs`),
    queryRows(`SELECT id::text AS id, job_type, status, attempt_count, max_attempts,
        lease_expires_at, last_error_code, updated_at
      FROM ops_jobs
      WHERE status = 'failed'
         OR (status = 'running' AND lease_expires_at < now())
      ORDER BY updated_at DESC, id DESC
      LIMIT 5`),
  ]);
  const counts = countRows[0] ?? {};
  return {
    counts: {
      queued: Number(counts.queued ?? 0),
      running: Number(counts.running ?? 0),
      succeeded: Number(counts.succeeded ?? 0),
      failed: Number(counts.failed ?? 0),
      cancelled: Number(counts.cancelled ?? 0),
    },
    attention: attentionRows.map((row) => ({
      id: String(row.id),
      jobType: String(row.job_type),
      status: String(row.status),
      attemptCount: Number(row.attempt_count),
      maxAttempts: Number(row.max_attempts),
      leaseExpiresAt: row.lease_expires_at == null ? null : isoDate(row.lease_expires_at),
      errorCode: row.last_error_code == null ? null : String(row.last_error_code),
      updatedAt: isoDate(row.updated_at),
    })),
  };
}

export async function listJobs(
  input: {
    status?: JobRow["status"];
    jobType?: string;
    cursor?: string;
    limit?: number;
  } = {},
) {
  const { queryRows } = await import("../neon/db.server.ts");
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 100);
  const cursor = decodeJobCursor(input.cursor);
  const rows = await queryRows(
    `SELECT id::text AS id, job_type, payload_version, status, attempt_count, max_attempts,
            run_after, lease_expires_at, last_error_code, created_at, updated_at,
            -- Full-precision keyset cursor. created_at is timestamptz
            -- (microseconds) but isoDate() truncates to milliseconds, and
            -- feeding that back into (created_at, id) < (...) silently skipped
            -- every job whose timestamp fell between the truncated and true
            -- value. US = microseconds.
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor
     FROM ops_jobs
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR job_type = $2)
       AND (
         $3::timestamptz IS NULL
         OR (created_at, id) < ($3::timestamptz, $4::uuid)
       )
     ORDER BY created_at DESC, id DESC
     LIMIT $5`,
    [
      input.status ?? null,
      input.jobType?.trim().slice(0, 100) || null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const page = rows.slice(0, limit);
  const pageRows = page.map((row) => ({
    id: String(row.id),
    jobType: String(row.job_type),
    payloadVersion: Number(row.payload_version),
    status: String(row.status),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    runAfter: isoDate(row.run_after),
    leaseExpiresAt: row.lease_expires_at == null ? null : isoDate(row.lease_expires_at),
    errorCode: row.last_error_code == null ? null : String(row.last_error_code),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }));
  // Cursor comes from the microsecond-precision column, not the truncated
  // createdAt used for display.
  const lastRaw = page.at(-1);
  return {
    rows: pageRows,
    nextCursor:
      rows.length > limit && lastRaw
        ? encodeJobCursor({
            createdAt: String(lastRaw.created_at_cursor),
            id: String(lastRaw.id),
          })
        : null,
  };
}

function safeJobErrorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return /^[A-Z][A-Z0-9_]{0,99}$/.test(code) ? code : "JOB_HANDLER_FAILED";
}

/**
 * Upper bound on how many jobs one runClaimedJobs invocation will execute.
 * Every claimed job runs inline, so this batch must complete within the
 * serverless function's timeout; the lease + SKIP LOCKED claim means anything
 * left over is simply picked up by the next tick.
 */
const MAX_JOBS_PER_RUN = 5;

/**
 * Wall-clock budget for one runClaimedJobs invocation. Checked BETWEEN jobs, so
 * a single long handler still runs to completion (its own heartbeat keeps the
 * lease alive); this only stops the loop from starting another one it cannot
 * finish inside the serverless timeout.
 */
const RUN_BUDGET_MS = 45_000;

export async function runClaimedJobs(input: {
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
}) {
  await recoverExpiredLeases();
  // Drain more than one job per invocation -- forcing limit:1 meant a backlog
  // shrank by one per tick while the response still reported claimed:1, so the
  // queue looked healthy while it fell further behind.
  //
  // Claimed ONE AT A TIME rather than as a batch. claimJobs stamps a single
  // shared lease_expires_at across every row it returns, but jobs execute
  // serially here: a batch of 5 with a 60s lease running behind a
  // woztell.campaign.deliver (which is designed to occupy an entire run) leaves
  // jobs 2..N with an expired lease before they even start. renewJobLease,
  // failJob and completeJob all require `lease_expires_at >= now()`, so those
  // jobs could neither run, fail, nor complete: they stayed status='running'
  // with a dead lease, were counted as `cancelled`, and recoverExpiredLeases
  // re-queued them with the attempt already burned -- flipping them to 'failed'
  // permanently after max_attempts without the handler ever succeeding. Worse,
  // a handler that does not checkpoint ran to completion, failed completeJob on
  // the dead lease, and was then re-queued and executed AGAIN, which for
  // campaign delivery means duplicate billable WhatsApp sends.
  //
  // Claiming per iteration gives every job a full lease window starting when it
  // is about to run, and the wall-clock budget stops the batch before the
  // serverless timeout instead of relying on a job count.
  const requested = Math.trunc(input.limit ?? 1);
  const maxJobs = Math.min(
    Math.max(Number.isFinite(requested) ? requested : 1, 1),
    MAX_JOBS_PER_RUN,
  );
  const counts = { claimed: 0, succeeded: 0, retried: 0, failed: 0, cancelled: 0 };
  const leaseSeconds = Math.min(Math.max(Math.trunc(input.leaseSeconds ?? 60), 5), 3_600);
  const startedAt = Date.now();

  for (let index = 0; index < maxJobs; index += 1) {
    // Anything still queued is picked up by the next tick; the lease + SKIP
    // LOCKED claim makes stopping early safe.
    if (index > 0 && Date.now() - startedAt >= RUN_BUDGET_MS) break;

    const [job] = await claimJobs({ ...input, limit: 1 });
    if (!job) break;
    counts.claimed += 1;

    const heartbeat = startLeaseHeartbeat({
      jobId: job.id,
      workerId: input.workerId,
      leaseSeconds,
    });
    try {
      const registered = parseRegisteredJobPayload(job.job_type, job.payload_version, job.payload);
      await registered.handler.run(registered.payload, {
        jobId: job.id,
        attempt: job.attempt_count,
        workerId: input.workerId,
        checkpoint: heartbeat.checkpoint,
      });
      const leaseOwned = await heartbeat.stop();
      if (!leaseOwned) {
        throw ownershipLostError();
      }
      const completed = await completeJob({ jobId: job.id, workerId: input.workerId });
      if (completed) counts.succeeded += 1;
      else counts.cancelled += 1;
    } catch (error) {
      await heartbeat.stop();
      if (error && typeof error === "object" && "code" in error && error.code === "JOB_DEFERRED") {
        const { queryRows } = await import("../neon/db.server.ts");
        const deferred = await queryRows(
          `UPDATE ops_jobs SET status='queued', run_after=now()+interval '60 seconds',
             attempt_count=GREATEST(attempt_count-1,0), lease_owner=NULL, lease_expires_at=NULL,
             last_error_code='JOB_DEFERRED', last_error_summary='Waiting for another live delivery lease.', updated_at=now()
           WHERE id=$1::uuid AND status='running' AND lease_owner=$2 AND lease_expires_at>=now()
           RETURNING id`,
          [job.id, input.workerId],
        );
        if (deferred[0]) counts.retried += 1;
        else counts.cancelled += 1;
        continue;
      }
      const failed = await failJob({
        jobId: job.id,
        workerId: input.workerId,
        retryable: isRetryableJobError(error),
        errorCode: safeJobErrorCode(error),
        errorSummary: "The job handler could not be completed.",
      });
      if (!failed) counts.cancelled += 1;
      else if (failed.status === "queued") counts.retried += 1;
      else counts.failed += 1;
    }
  }
  return counts;
}

export function hasRegisteredJobHandler(jobType: string, payloadVersion: number) {
  return getJobHandler(jobType, payloadVersion) !== null;
}
