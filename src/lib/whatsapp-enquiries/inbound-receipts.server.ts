import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { deriveInboundIdentity, eventForReceiptProjection } from "./inbound-identity.ts";
import { queryRows } from "../neon/db.server.ts";
import {
  RECEIPT_CLAIM_SET_SQL,
  RECEIPT_DUE_AT_SQL,
  RECEIPT_ELIGIBLE_SQL,
  RECEIPT_INFLIGHT_GRACE_SQL,
  RECEIPT_MAX_ATTEMPTS,
  RECEIPT_RETRYABLE_SQL,
} from "./receipt-retry-policy.ts";
import type {
  InboundReceiptProblem,
  InboundReceiptProblemKind,
} from "../admin/operations/operations-types.ts";
import type { StaffAccess } from "../neon/auth.server.ts";
import type {
  ReceiptProjectionState,
  ReceiptResult,
  ReceiptRow,
  VerifiedReceiptInput,
} from "./no-link.types.ts";

export type ReceiptQuery = (
  statement: string,
  params?: unknown[],
) => Promise<Record<string, unknown>[]>;
export type ReceiptPorts = { query?: ReceiptQuery; wake?: () => void };

function minimalEvent(event: VerifiedReceiptInput["event"]) {
  const outer = event.payload;
  const wrapped =
    outer.messageEvent &&
    typeof outer.messageEvent === "object" &&
    !Array.isArray(outer.messageEvent)
      ? (outer.messageEvent as Record<string, unknown>)
      : outer;
  const rawTimestamp = wrapped.timestamp ?? outer.timestamp;
  return {
    ...event,
    payload: {
      type: typeof outer.type === "string" ? outer.type : event.messageType,
      eventType: typeof outer.eventType === "string" ? outer.eventType : undefined,
      messageId: event.legacyExternalMessageId === null ? event.externalMessageId : undefined,
      member: event.woztellMemberId,
      channel: event.channelId,
      app: event.appId,
      timestamp:
        typeof rawTimestamp === "string" || typeof rawTimestamp === "number"
          ? rawTimestamp
          : undefined,
      from: event.fromPhone,
      to: event.toPhone,
      memberExtra: event.memberName ? { name: event.memberName } : undefined,
      data: { text: event.text },
    },
  };
}

export async function storeInboundReceipt(
  input: VerifiedReceiptInput,
  ports: ReceiptPorts = {},
): Promise<ReceiptResult> {
  if (
    !input.tenantKey ||
    !input.appId ||
    !input.channelId ||
    input.event.channelId !== input.channelId ||
    input.event.appId !== input.appId ||
    !/^[0-9a-f]{64}$/i.test(input.bodyDigest) ||
    !Number.isFinite(input.receivedAt.getTime())
  ) {
    throw new Error("WA_RECEIPT_VERIFIED_SCOPE_REQUIRED");
  }
  const query = ports.query ?? queryRows;
  const id = randomUUID();
  const providerMessageId =
    input.event.legacyExternalMessageId === null ? input.event.externalMessageId : null;
  const identity = deriveInboundIdentity({
    tenantKey: input.tenantKey,
    provider: "woztell",
    appId: input.appId,
    channelId: input.channelId,
    eventKind: input.eventKind,
    providerEventId: input.providerEventId,
    providerMessageId,
    providerStatus: input.event.messageType,
    providerOccurredAt: input.providerOccurredAt,
    payloadDigest: input.bodyDigest,
  });
  const rows = await query(
    `INSERT INTO whatsapp_inbound_receipts
      (id,tenant_key,provider,app_id,channel_id,member_id,event_kind,origin,
       provider_message_id,identity_key,similarity_key,normalized_event,body_digest,
       capture_mode,activation_id,effects_eligible,provider_occurred_at,received_at,
       projection_state,attempt_count)
     VALUES ($1,$2,'woztell',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,
             $13,$14::uuid,$15,$16::timestamptz,$17::timestamptz,'pending',1)
     ON CONFLICT (tenant_key,app_id,channel_id,identity_key)
       WHERE identity_key IS NOT NULL
     DO UPDATE SET delivery_count=whatsapp_inbound_receipts.delivery_count+1,updated_at=now()
     RETURNING id,projection_state,delivery_count`,
    [
      id,
      input.tenantKey,
      input.appId,
      input.channelId,
      input.event.woztellMemberId,
      input.eventKind,
      input.origin,
      providerMessageId,
      identity.scopedProviderKey,
      identity.similarityKey,
      JSON.stringify(minimalEvent(input.event)),
      input.bodyDigest.toLowerCase(),
      input.capture.mode,
      input.capture.activationId,
      input.capture.effectsEligible,
      input.providerOccurredAt,
      input.receivedAt.toISOString(),
    ],
  );
  if (!rows[0]?.id) throw new Error("WA_RECEIPT_STORE_NO_READBACK");
  return {
    receiptId: String(rows[0].id),
    identityKey: identity.scopedProviderKey,
    disposition:
      identity.certainty === "ambiguous"
        ? "identity_ambiguous"
        : Number(rows[0].delivery_count) > 1
          ? "duplicate"
          : "new",
    projectionState: rows[0].projection_state as ReceiptProjectionState,
  };
}
export async function markInboundReceipt(
  receiptId: string,
  state: ReceiptProjectionState,
  reason: string | null = null,
  ports: ReceiptPorts = {},
): Promise<void> {
  if (!["pending", "projected", "blocked_schema", "failed"].includes(state))
    throw new Error("WA_RECEIPT_STATE_INVALID");
  const query = ports.query ?? queryRows;
  await query(
    `UPDATE whatsapp_inbound_receipts
     SET projection_state=$2, block_reason=$3, lease_until=NULL,
         projected_at=CASE WHEN $2='projected' THEN now() ELSE projected_at END,
         updated_at=now()
     WHERE id=$1::uuid`,
    [receiptId, state, reason],
  );
}

export type ReceiptProject = (
  event: VerifiedReceiptInput["event"],
  mode: "off" | "observe",
) => Promise<unknown>;

/** Projects one receipt that the caller has already claimed (leased and counted). */
export async function projectClaimedReceipt(
  row: ReceiptRow,
  ports: { query: ReceiptQuery; project: ReceiptProject },
): Promise<"projected" | "failed" | "blocked_schema" | "review"> {
  const { query, project } = ports;
  // Historical recovery never restores active effects or a former activation.
  if (row.origin !== "live_webhook" || row.event_kind !== "customer_message") {
    await markInboundReceipt(row.id, "failed", "REVIEW_REQUIRED", { query });
    return "review";
  }
  const event =
    typeof row.normalized_event === "string"
      ? (JSON.parse(row.normalized_event) as VerifiedReceiptInput["event"])
      : row.normalized_event;
  try {
    await project(
      eventForReceiptProjection(event, row.id, row.event_kind, row.identity_key),
      row.capture_mode === "off" ? "off" : "observe",
    );
    await markInboundReceipt(row.id, "projected", null, { query });
    return "projected";
  } catch (error) {
    const missingSchema = error instanceof Error && error.message === "WA_ENQUIRY_SCHEMA_REQUIRED";
    await markInboundReceipt(
      row.id,
      missingSchema ? "blocked_schema" : "failed",
      missingSchema ? "WA_ENQUIRY_SCHEMA_REQUIRED" : "PROJECTION_FAILED",
      { query },
    );
    return missingSchema ? "blocked_schema" : "failed";
  }
}

const defaultReceiptProject: ReceiptProject = async (event, mode) => {
  const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
  await ingestWoztellEvent(event, "live_webhook", undefined, { signedEvent: true, mode });
};

export async function recoverPendingInboundReceipts(
  ports: ReceiptPorts & {
    project?: ReceiptProject;
    limit?: number;
  } = {},
) {
  const query = ports.query ?? queryRows;
  const limit = Math.max(1, Math.min(ports.limit ?? 20, 20));
  const rows = (await query(
    `WITH claimed AS (
       SELECT id FROM whatsapp_inbound_receipts
       WHERE ${RECEIPT_RETRYABLE_SQL("whatsapp_inbound_receipts")}
       ORDER BY received_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE whatsapp_inbound_receipts r
     SET ${RECEIPT_CLAIM_SET_SQL}
     FROM claimed WHERE r.id=claimed.id
     RETURNING r.id,r.identity_key,r.normalized_event,r.event_kind,r.capture_mode,r.origin`,
    [limit],
  )) as ReceiptRow[];
  const project = ports.project ?? defaultReceiptProject;
  const counts = { projected: 0, blocked: 0, review: 0 };
  for (const row of rows) {
    const outcome = await projectClaimedReceipt(row, { query, project });
    if (outcome === "projected") counts.projected++;
    else if (outcome === "review") counts.review++;
    else counts.blocked++;
  }
  return counts;
}

type Actor = Pick<StaffAccess, "staffId" | "roles">;

export type { InboundReceiptProblem, InboundReceiptProblemKind };

const PROBLEM_KINDS: InboundReceiptProblemKind[] = [
  "retry_scheduled",
  "retry_exhausted",
  "review_required",
  "needs_routing",
];

// One classification for rows and counts. C-09 ("needs_routing") is a receipt that
// was captured while auto-assignment was active but replayed as observe, so nobody
// was routed or notified. $1 = days a C-09 row stays listed.
const PROBLEM_KIND_SQL = `
  CASE
    WHEN r.capture_mode='active' AND r.projection_state='projected' AND r.attempt_count>1
         AND r.received_at > now() - make_interval(days => $1::int) THEN 'needs_routing'
    WHEN r.block_reason='REVIEW_REQUIRED' THEN 'review_required'
    WHEN r.projection_state IN ('pending','blocked_schema','failed')
         AND r.attempt_count>=${RECEIPT_MAX_ATTEMPTS} THEN 'retry_exhausted'
    WHEN ${RECEIPT_ELIGIBLE_SQL("r")} THEN 'retry_scheduled'
  END`;

/** Receipts that need attention. Never selects the member id, phone, text or event body. */
export async function listInboundReceiptProblems(
  _actor: Actor,
  options: { limit?: number; sinceDays?: number; query?: ReceiptQuery } = {},
): Promise<{
  rows: InboundReceiptProblem[];
  counts: Record<InboundReceiptProblemKind, number>;
}> {
  const query = options.query ?? queryRows;
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100));
  const sinceDays = Math.max(1, Math.min(Math.trunc(options.sinceDays ?? 30), 365));
  const classified = `SELECT r.*, ${PROBLEM_KIND_SQL} AS problem_kind
     FROM whatsapp_inbound_receipts r
     WHERE r.projection_state IN ('pending','blocked_schema','failed')
        OR r.block_reason='REVIEW_REQUIRED'
        OR (r.capture_mode='active' AND r.projection_state='projected' AND r.attempt_count>1)`;
  // One query: the per-kind totals are a window count taken before LIMIT, so no second scan.
  const rows = await query(
    `WITH classified AS (${classified})
     SELECT c.id, c.problem_kind AS kind, c.projection_state, c.capture_mode, c.attempt_count,
            c.block_reason, c.received_at,
            CASE WHEN c.problem_kind='retry_scheduled' THEN ${RECEIPT_DUE_AT_SQL("c")} END AS next_retry_at,
            w.id AS conversation_id,
            (c.problem_kind IN ('retry_scheduled','retry_exhausted')
               AND c.origin='live_webhook' AND c.event_kind='customer_message'
               AND (c.lease_until IS NULL OR c.lease_until <= now())
               AND ${RECEIPT_INFLIGHT_GRACE_SQL("c")}) AS can_retry,
            (count(*) OVER (PARTITION BY c.problem_kind))::int AS kind_total
     FROM classified c
     LEFT JOIN whatsapp_conversations w
       ON w.channel_id=c.channel_id AND w.woztell_member_id=c.member_id
     WHERE c.problem_kind IS NOT NULL
     ORDER BY c.received_at DESC, c.id
     LIMIT $2`,
    [sinceDays, limit],
  );
  const counts = Object.fromEntries(PROBLEM_KINDS.map((kind) => [kind, 0])) as Record<
    InboundReceiptProblemKind,
    number
  >;
  for (const row of rows) counts[row.kind as InboundReceiptProblemKind] = Number(row.kind_total);
  const iso = (value: unknown) =>
    value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
  return {
    rows: rows.map((row) => ({
      id: String(row.id),
      kind: row.kind as InboundReceiptProblemKind,
      projectionState: row.projection_state as InboundReceiptProblem["projectionState"],
      captureMode: row.capture_mode as InboundReceiptProblem["captureMode"],
      attemptCount: Number(row.attempt_count),
      blockReason: (row.block_reason as string | null) ?? null,
      receivedAt: iso(row.received_at) as string,
      nextRetryAt: iso(row.next_retry_at),
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      canRetry: row.can_retry === true,
    })),
    counts,
  };
}

/**
 * Manual, observe-only retry for admin|manager (403 Response otherwise). One statement
 * takes the same 60 s lease recovery takes (it skips the backoff and the attempt cap,
 * never the lease or the eligible states) and writes the audit row, so a retry that
 * happens is always audited. Projection then reuses projectClaimedReceipt, which
 * only ever runs `off` or `observe`: no reply, no notification, no assignment.
 * Returns null when the receipt is not retryable or is already leased.
 */
export async function retryInboundReceipt(
  receiptId: string,
  actor: Actor,
  context: { requestId: string },
  ports: ReceiptPorts & { project?: ReceiptProject } = {},
): Promise<{
  receiptId: string;
  projectionState: "projected" | "failed" | "blocked_schema";
} | null> {
  if (!actor.roles.some((role) => role === "admin" || role === "manager")) {
    throw new Response("Forbidden", { status: 403 });
  }
  const query = ports.query ?? queryRows;
  const claimed = (await query(
    `WITH target AS (
       SELECT id FROM whatsapp_inbound_receipts
       WHERE id=$1::uuid
         AND projection_state IN ('pending','blocked_schema','failed')
         AND block_reason IS DISTINCT FROM 'REVIEW_REQUIRED'
         AND origin='live_webhook' AND event_kind='customer_message'
         AND (lease_until IS NULL OR lease_until <= now())
         AND ${RECEIPT_INFLIGHT_GRACE_SQL("whatsapp_inbound_receipts")}
       FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE whatsapp_inbound_receipts r
       SET ${RECEIPT_CLAIM_SET_SQL}
       FROM target WHERE r.id=target.id
       RETURNING r.id,r.identity_key,r.normalized_event,r.event_kind,r.capture_mode,r.origin,
                 r.projection_state AS previous_state,r.attempt_count
     ), audit AS (
       INSERT INTO ops_audit_logs
         (actor_staff_id, permission, action, resource_type, resource_id, outcome, request_id, metadata)
       SELECT $2::uuid, 'system.jobs.retry', 'whatsapp.receipt.retry', 'whatsapp_inbound_receipt',
              id::text, 'success', $3::uuid,
              jsonb_build_object('receiptId', id::text, 'previousState', previous_state,
                                 'attemptCount', attempt_count)
       FROM claimed
       RETURNING id
     )
     SELECT * FROM claimed`,
    [receiptId, actor.staffId, context.requestId],
  )) as ReceiptRow[];
  if (!claimed[0]) return null;
  const outcome = await projectClaimedReceipt(claimed[0], {
    query,
    project: ports.project ?? defaultReceiptProject,
  });
  if (outcome === "review") return null;
  return { receiptId, projectionState: outcome };
}
