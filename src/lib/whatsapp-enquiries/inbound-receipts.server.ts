import "@tanstack/react-start/server-only";

import { createHash, randomUUID } from "node:crypto";
import { queryRows } from "../neon/db.server.ts";
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
  const similarityKey = createHash("sha256")
    .update(
      JSON.stringify([
        input.tenantKey,
        input.appId,
        input.channelId,
        input.event.woztellMemberId,
        input.eventKind,
        input.event.text,
        input.event.timestamp,
      ]),
    )
    .digest("hex");
  const rows = await query(
    `INSERT INTO whatsapp_inbound_receipts
      (id,tenant_key,provider,app_id,channel_id,member_id,event_kind,origin,
       provider_message_id,identity_key,similarity_key,normalized_event,body_digest,
       capture_mode,activation_id,effects_eligible,provider_occurred_at,received_at,
       projection_state,attempt_count)
     VALUES ($1,$2,'woztell',$3,$4,$5,$6,$7,$8,NULL,$9,$10::jsonb,$11,
             $12,$13::uuid,$14,$15::timestamptz,$16::timestamptz,'pending',1)
     RETURNING id`,
    [
      id,
      input.tenantKey,
      input.appId,
      input.channelId,
      input.event.woztellMemberId,
      input.eventKind,
      input.origin,
      input.event.legacyExternalMessageId === null ? input.event.externalMessageId : null,
      similarityKey,
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
  return { receiptId: String(rows[0].id), disposition: "new", projectionState: "pending" };
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

export async function recoverPendingInboundReceipts(
  ports: ReceiptPorts & {
    project?: (event: VerifiedReceiptInput["event"], mode: "off" | "observe") => Promise<unknown>;
    limit?: number;
  } = {},
) {
  const query = ports.query ?? queryRows;
  const limit = Math.max(1, Math.min(ports.limit ?? 20, 20));
  const rows = (await query(
    `WITH claimed AS (
       SELECT id FROM whatsapp_inbound_receipts
       WHERE projection_state IN ('pending','blocked_schema','failed')
         AND (lease_until IS NULL OR lease_until < now())
         AND attempt_count < 20 AND block_reason IS DISTINCT FROM 'REVIEW_REQUIRED'
       ORDER BY received_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE whatsapp_inbound_receipts r
     SET lease_until=now()+interval '60 seconds',attempt_count=r.attempt_count+1,updated_at=now()
     FROM claimed WHERE r.id=claimed.id
     RETURNING r.id,r.normalized_event,r.event_kind,r.capture_mode,r.origin`,
    [limit],
  )) as ReceiptRow[];
  const project =
    ports.project ??
    (async (event: VerifiedReceiptInput["event"], mode: "off" | "observe") => {
      const { ingestWoztellEvent } = await import("../woztell/woztell-ingest.server.ts");
      await ingestWoztellEvent(event, "live_webhook", undefined, { signedEvent: true, mode });
    });
  const counts = { projected: 0, blocked: 0, review: 0 };
  for (const row of rows) {
    // Historical recovery never restores active effects or a former activation.
    if (row.origin !== "live_webhook" || row.event_kind !== "customer_message") {
      await markInboundReceipt(row.id, "failed", "REVIEW_REQUIRED", { query });
      counts.review++;
      continue;
    }
    const event =
      typeof row.normalized_event === "string"
        ? (JSON.parse(row.normalized_event) as VerifiedReceiptInput["event"])
        : row.normalized_event;
    try {
      await project(event, row.capture_mode === "off" ? "off" : "observe");
      await markInboundReceipt(row.id, "projected", null, { query });
      counts.projected++;
    } catch (error) {
      const missingSchema =
        error instanceof Error && error.message === "WA_ENQUIRY_SCHEMA_REQUIRED";
      await markInboundReceipt(
        row.id,
        missingSchema ? "blocked_schema" : "failed",
        missingSchema ? "WA_ENQUIRY_SCHEMA_REQUIRED" : "PROJECTION_FAILED",
        { query },
      );
      counts.blocked++;
    }
  }
  return counts;
}
