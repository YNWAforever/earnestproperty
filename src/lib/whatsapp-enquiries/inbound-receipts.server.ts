import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { deriveInboundIdentity, eventForReceiptProjection } from "./inbound-identity.ts";
import { queryRows } from "../neon/db.server.ts";
import { RECEIPT_RETRYABLE_SQL } from "./receipt-retry-policy.ts";
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
     SET lease_until=now()+interval '60 seconds',attempt_count=r.attempt_count+1,updated_at=now()
     FROM claimed WHERE r.id=claimed.id
     RETURNING r.id,r.identity_key,r.normalized_event,r.event_kind,r.capture_mode,r.origin`,
    [limit],
  )) as ReceiptRow[];
  const project: ReceiptProject =
    ports.project ??
    (async (event, mode) => {
      const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
      await ingestWoztellEvent(event, "live_webhook", undefined, { signedEvent: true, mode });
    });
  const counts = { projected: 0, blocked: 0, review: 0 };
  for (const row of rows) {
    const outcome = await projectClaimedReceipt(row, { query, project });
    if (outcome === "projected") counts.projected++;
    else if (outcome === "review") counts.review++;
    else counts.blocked++;
  }
  return counts;
}
