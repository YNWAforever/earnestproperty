import "@tanstack/react-start/server-only";
import { extractReferences } from "./links.ts";
import { classifyWoztellEvent } from "./event-classification.ts";
import { createHash } from "node:crypto";
import type { NormalizedWoztellEvent } from "../woztell/woztell.server.ts";
import { transactionRows } from "../neon/db.server.ts";
function atPath(value: unknown, path: string) {
  let v = value;
  for (const key of path.split(".")) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    v = (v as Record<string, unknown>)[key];
  }
  return typeof v === "string" ? v : null;
}
/** Called only after signed webhook scope verification, before any customer lead/contact write. */
export async function isolateSignedStaffEvent(
  event: NormalizedWoztellEvent,
  transaction = transactionRows,
) {
  const query = async (statement: string, params: unknown[] = []) =>
    (await transaction([{ statement, params }]))[0];
  const [schema] = await query(
    "SELECT to_regclass('staff_notification_internal_events') IS NOT NULL AS available",
  );
  if (!schema?.available || !event.channelId || !event.woztellMemberId) return false;
  const path = process.env.EP_WA_STAFF_REPLY_CONTEXT_PATH;
  const replyTo =
    process.env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF && path
      ? atPath(event.payload, path)
      : null;
  const external = event.legacyExternalMessageId === null ? event.externalMessageId : null;
  const [correlated] = await query(
    `SELECT t.id FROM staff_notification_attempts t JOIN staff_notification_endpoints ep ON ep.id=t.endpoint_id WHERE t.transport='staff_whatsapp' AND t.channel_id_snapshot=$1 AND t.destination_reference_snapshot=$2 AND t.provider_operation_id IS NOT NULL AND t.provider_operation_id IN ($3,$4) LIMIT 1`,
    [event.channelId, event.woztellMemberId, external, replyTo],
  );
  const classification = classifyWoztellEvent(event.payload);
  if (!correlated) {
    const reference = extractReferences(event.text ?? "");
    if (
      classification.direction === "inbound" &&
      !reference.invalid &&
      reference.references.length === 1
    ) {
      const hash = createHash("sha256").update(reference.references[0]).digest("hex");
      const [customerReference] = await query(
        "SELECT o.id FROM whatsapp_link_opens o JOIN whatsapp_tracking_link_versions v ON v.link_id=o.link_id AND v.version=o.link_version WHERE o.reference_hash=$1 AND o.channel_id=$2 AND v.enabled AND v.property_id IS NOT NULL AND v.placement_verified_at IS NOT NULL",
        [hash, event.channelId],
      );
      if (customerReference) return false;
    }
    // Explicit reply to this employee's CUSTOMER context remains a customer message.
    if (replyTo) {
      const [customer] = await query(
        "SELECT id FROM whatsapp_messages WHERE channel_id=$1 AND woztell_member_id=$2 AND external_message_id=$3 AND direction='outbound'",
        [event.channelId, event.woztellMemberId, replyTo],
      );
      if (customer) return false;
    }
    const [ambiguous] = await query(
      `SELECT t.id FROM staff_notification_attempts t WHERE t.transport='staff_whatsapp' AND t.channel_id_snapshot=$1 AND t.destination_reference_snapshot=$2 AND t.dispatch_state IN ('dispatching','unknown','accepted','delivered') LIMIT 1`,
      [event.channelId, event.woztellMemberId],
    );
    if (!ambiguous) return false;
  }
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        event.appId,
        event.channelId,
        event.woztellMemberId,
        event.externalMessageId,
        event.messageType,
      ]),
    )
    .digest("hex");
  await transaction([
    ...(correlated &&
    classification.direction === "inbound" &&
    classification.timing === "fresh" &&
    classification.occurredAt
      ? [
          {
            statement:
              "UPDATE staff_notification_endpoints ep SET last_inbound_at=GREATEST(ep.last_inbound_at,$2::timestamptz),updated_at=now() FROM staff_notification_attempts t WHERE t.id=$1::uuid AND $2::timestamptz<=now() AND ep.id=t.endpoint_id AND ep.version=t.endpoint_version AND ep.destination_reference=t.destination_reference_snapshot AND ep.channel_id=t.channel_id_snapshot AND ep.enabled AND ep.permission_granted AND ep.retired_at IS NULL",
            params: [correlated.id, classification.occurredAt],
          },
        ]
      : []),
    {
      statement: `INSERT INTO staff_notification_internal_events(external_event_key,notification_attempt_id,channel_id,member_id,association_state,event_kind,protected_payload) VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(external_event_key) DO NOTHING`,
      params: [
        key,
        correlated?.id ?? null,
        event.channelId,
        event.woztellMemberId,
        correlated ? "correlated" : "review",
        event.messageType,
        JSON.stringify(event.payload),
      ],
    },
    ...(correlated && ["DELIVERED", "READ"].includes(event.messageType.toUpperCase())
      ? [
          {
            statement:
              event.messageType.toUpperCase() === "READ"
                ? "UPDATE staff_notification_attempts SET dispatch_state='delivered',evidence_kind='provider_delivered',provider_read_at=$2::timestamptz,provider_read_source=$3,updated_at=now() WHERE id=$1::uuid AND provider_read_at IS NULL AND dispatch_state IN ('dispatching','unknown','accepted','delivered')"
                : "UPDATE staff_notification_attempts SET dispatch_state='delivered',evidence_kind='provider_delivered',provider_delivered_at=$2::timestamptz,provider_delivery_source=$3,updated_at=now() WHERE id=$1::uuid AND provider_delivered_at IS NULL AND dispatch_state IN ('dispatching','unknown','accepted','delivered')",
            params: [
              correlated.id,
              classification.occurredAt ?? new Date().toISOString(),
              classification.occurredAt
                ? "signed_webhook_event_time"
                : "signed_webhook_received_time",
            ],
          },
        ]
      : []),
  ]);
  return true;
}
