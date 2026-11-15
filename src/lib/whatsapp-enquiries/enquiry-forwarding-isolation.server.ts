import "@tanstack/react-start/server-only";
import type { NormalizedWoztellEvent } from "../woztell/woztell.server.ts";
import { queryRows } from "../neon/db.server.ts";
import { classifyWoztellEvent } from "./event-classification.ts";
import { forwardingPhone } from "./enquiry-forwarding-policy.mjs";
import { forwardingSchemaAvailable } from "./enquiry-forwarding-coverage.server.ts";

/** Signed provider events only. Phone recipients can have opaque WOZTELL member IDs. */
export async function inspectForwardingStaffScope(
  event: NormalizedWoztellEvent,
  replyTo: string | null,
  query: typeof queryRows,
) {
  if (!(await forwardingSchemaAvailable(query)) || !event.channelId || !event.woztellMemberId)
    return { matched: false, correlatedId: null as string | null };
  const classification = classifyWoztellEvent(event.payload);
  const phones = [
    ...new Set(
      [event.fromPhone, event.toPhone, event.woztellMemberId]
        .map(forwardingPhone)
        .filter((p): p is string => !!p),
    ),
  ];
  const external = event.legacyExternalMessageId === null ? event.externalMessageId : null;
  const [correlated] = await query(
    `SELECT t.id FROM staff_notification_attempts t
     WHERE t.transport='staff_whatsapp' AND t.routing_snapshot->>'purpose'='enquiry_forward'
       AND t.channel_id_snapshot=$1 AND t.provider_operation_id IS NOT NULL AND t.provider_operation_id IN ($3,$4)
       AND (t.destination_reference_snapshot=$2 OR
         (t.routing_snapshot->>'destinationType'='recipient_id' AND
           ($5::boolean OR t.routing_snapshot->>'recipientPhone'=ANY($6::text[]))))
       AND t.dispatch_state IN ('dispatching','unknown','accepted','delivered') LIMIT 1`,
    [
      event.channelId,
      event.woztellMemberId,
      external,
      replyTo,
      classification.kind === "delivery_receipt",
      phones,
    ],
  );
  if (correlated) return { matched: true, correlatedId: String(correlated.id) };
  // Pausing delivery does not turn an already verified colleague into a customer.
  const [registered] = await query(
    `SELECT id FROM enquiry_notification_recipients r WHERE r.channel_id=$1
       AND r.retired_at IS NULL AND r.permission_granted AND r.verified_at IS NOT NULL
       AND (r.phone=ANY($2::text[]) OR (r.destination_type='member_id' AND r.destination_reference=$3)) LIMIT 1`,
    [event.channelId, phones, event.woztellMemberId],
  );
  return { matched: !!registered, correlatedId: null };
}
