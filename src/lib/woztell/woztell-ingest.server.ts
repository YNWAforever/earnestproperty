import { wakeAfterCommit } from "../control-plane/job-wake.server.ts";
import "@tanstack/react-start/server-only";
import { normalizeAdminPhone } from "../neon/admin-workflow.ts";
import { isOptOutText, outboundWoztellEvidence } from "./woztell.server.ts";
import type { NormalizedWoztellEvent } from "./woztell.server.ts";

import { classifyWoztellEvent } from "../whatsapp-enquiries/event-classification.ts";
import { enquiryMode } from "../whatsapp-enquiries/contracts.ts";
import type { EventOrigin, EnquiryMode } from "../whatsapp-enquiries/contracts.ts";
import {
  buildLiveEventStatements,
  enquirySchemaAvailable,
} from "../whatsapp-enquiries/workflow.server.ts";

export type IngestOutcome = {
  contactId: string | null;
  conversationId: string | null;
  messageInserted: boolean;
  skipped: "no-identity" | "status-event" | "unsupported-event" | "staff-internal" | null;
};

/** Contact, thread and message commit together. Shared identity locks precede a fresh SQL snapshot. */
export async function ingestWoztellEvent(
  event: NormalizedWoztellEvent,
  origin: EventOrigin,
  injectedTransaction?: typeof import("../neon/db.server.ts").transactionRows,
  options: {
    signedEvent?: boolean;
    mode?: EnquiryMode;
    schemaAvailable?: () => Promise<boolean>;
    now?: Date;
    wake?: () => void;
  } = {},
): Promise<IngestOutcome> {
  if (origin !== "live_webhook" && origin !== "history_import")
    throw new Error("WA_EVENT_ORIGIN_REQUIRED");
  if (origin === "live_webhook" && options.signedEvent) {
    const { isolateSignedStaffEvent } =
      await import("../whatsapp-enquiries/staff-event-isolation.server.ts");
    if (await isolateSignedStaffEvent(event, injectedTransaction))
      return {
        contactId: null,
        conversationId: null,
        messageInserted: false,
        skipped: "staff-internal",
      };
  }
  const classification = classifyWoztellEvent(event.payload, { now: options.now });
  const observe = origin === "live_webhook" && (options.mode ?? enquiryMode()) !== "off";
  if (observe && !(await (options.schemaAvailable ?? enquirySchemaAvailable)()))
    throw new Error("WA_ENQUIRY_SCHEMA_REQUIRED");
  const transactionRows =
    injectedTransaction ?? (await import("../neon/db.server.ts")).transactionRows;
  const wrapped = event.payload.messageEvent;
  const source =
    wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
      ? (wrapped as Record<string, unknown>)
      : event.payload;
  const type = event.messageType.toUpperCase();
  const receipt = ["SENT", "DELIVERED", "READ", "FAILED", "DELETED"].includes(type)
    ? type.toLowerCase()
    : type === "UNKNOWN" && source.error
      ? "failed"
      : null;
  if (receipt) {
    // Reconcile an already dispatched staff intent only from a signed live,
    // identified delivery/read receipt. This records a provider fact; it never
    // queues, sends, activates a capture or promotes historical ingestion.
    const reconcileIntent =
      origin === "live_webhook" &&
      options.signedEvent === true &&
      ["delivered", "read"].includes(receipt) &&
      event.legacyExternalMessageId === null &&
      classification.occurredAt !== null &&
      classification.timing !== "future";
    await transactionRows([
      {
        statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        params: [`woztell-message:${event.externalMessageId}`],
      },
      {
        statement: `INSERT INTO whatsapp_delivery_events(id,external_message_id,channel_id,woztell_member_id,status,payload,occurred_at)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz) ON CONFLICT(id) DO NOTHING`,
        params: [
          JSON.stringify([
            event.externalMessageId,
            event.channelId,
            event.woztellMemberId,
            receipt,
            event.timestamp,
          ]),
          event.legacyExternalMessageId === null ? event.externalMessageId : null,
          event.channelId,
          event.woztellMemberId,
          receipt,
          JSON.stringify(event.payload),
          event.timestamp,
        ],
      },
      ...(reconcileIntent
        ? [
            {
              statement: `UPDATE whatsapp_outbound_intents i SET state='accepted',error=NULL,updated_at=now()
              FROM whatsapp_messages m JOIN whatsapp_conversations wc ON wc.id=m.conversation_id
              WHERE i.message_id=m.id AND i.conversation_id=wc.id
                AND i.actor_type='staff' AND i.actor_staff_id IS NOT NULL
                AND i.state IN ('dispatching','unknown') AND i.dispatch_started_at IS NOT NULL
                AND $4::timestamptz>=date_trunc('second',i.dispatch_started_at)
                AND i.external_message_id=$1 AND m.external_message_id=$1
                AND m.direction='outbound' AND m.channel_id=$2 AND m.woztell_member_id=$3
                AND wc.channel_id=$2 AND wc.woztell_member_id=$3`,
              params: [
                event.externalMessageId,
                event.channelId,
                event.woztellMemberId,
                classification.occurredAt,
              ],
            },
          ]
        : []),
      {
        statement: `UPDATE whatsapp_messages SET status=status WHERE external_message_id=$1 AND channel_id=$2 AND woztell_member_id=$3 AND direction='outbound'`,
        params: [
          event.legacyExternalMessageId === null ? event.externalMessageId : null,
          event.channelId,
          event.woztellMemberId,
        ],
      },
    ]);
    return {
      contactId: null,
      conversationId: null,
      messageInserted: false,
      skipped: "status-event",
    };
  }
  if (!classification.direction)
    return {
      contactId: null,
      conversationId: null,
      messageInserted: false,
      skipped: "unsupported-event",
    };
  event = { ...event, direction: classification.direction };
  if (observe && (!event.appId || !event.channelId || !event.woztellMemberId))
    throw new Error("WA_ENQUIRY_SCOPE_REQUIRED");
  const phone = event.direction === "inbound" ? event.fromPhone : event.toPhone;
  const normalizedPhone = normalizeAdminPhone(phone),
    memberId = event.woztellMemberId;
  if (!memberId && !normalizedPhone)
    return {
      contactId: null,
      conversationId: null,
      messageInserted: false,
      skipped: "no-identity",
    };
  const keys = [
    normalizedPhone ? `woztell-phone:${normalizedPhone}` : null,
    memberId ? `woztell-member:${memberId}` : null,
    `woztell-message:${event.externalMessageId}`,
  ]
    .filter((v): v is string => Boolean(v))
    .sort();
  const workflowStatements =
    observe && (classification.kind !== "unsupported" || classification.surveyCandidate)
      ? buildLiveEventStatements(event, options.now, options.mode ?? enquiryMode())
      : [];
  const results = await transactionRows([
    ...keys.map((key) => ({
      statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      params: [key],
    })),
    {
      statement: `WITH matched AS (
      SELECT * FROM crm_contacts WHERE normalized_phone=$1
        OR (length($1::text)=11 AND left($1::text,3)='852'
          AND normalized_phone=right($1::text,8)) OR whatsapp_member_id=$2
    ), valid AS (
      SELECT * FROM matched
      WHERE (normalized_phone IS NULL OR $1::text IS NULL OR normalized_phone=$1
        OR (length($1::text)=11 AND left($1::text,3)='852'
          AND normalized_phone=right($1::text,8)))
        AND (whatsapp_member_id IS NULL OR $2::text IS NULL OR whatsapp_member_id=$2)
      ORDER BY (whatsapp_member_id=$2) DESC NULLS LAST,
        (normalized_phone=$1) DESC NULLS LAST, id
      LIMIT 1
    ), updated_contact AS (
      UPDATE crm_contacts c SET name=COALESCE(c.name,$3),whatsapp_profile_name=CASE WHEN $16::boolean THEN COALESCE($3,c.whatsapp_profile_name) ELSE COALESCE(c.whatsapp_profile_name,$3) END,phone=COALESCE(c.phone,$4),
        normalized_phone=COALESCE(c.normalized_phone,$1),whatsapp_member_id=COALESCE(c.whatsapp_member_id,$2),
        opted_out_whatsapp=c.opted_out_whatsapp OR $5,last_inbound_at=GREATEST(c.last_inbound_at,$6::timestamptz),updated_at=now()
      FROM valid v WHERE c.id=v.id RETURNING c.id
    ), new_contact AS (
      INSERT INTO crm_contacts(name,phone,normalized_phone,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp,last_inbound_at,whatsapp_profile_name)
      SELECT $3,$4,$1,$2,'whatsapp',false,$5,$6::timestamptz,$3 WHERE NOT EXISTS(SELECT 1 FROM matched)
      ON CONFLICT DO NOTHING RETURNING id
    ), contact AS (SELECT id FROM updated_contact UNION ALL SELECT id FROM new_contact),
    updated_conversation AS (
      UPDATE whatsapp_conversations wc SET contact_id=c.id,channel_id=COALESCE(wc.channel_id,$7),
        last_message_at=GREATEST(wc.last_message_at,$8::timestamptz),last_inbound_at=GREATEST(wc.last_inbound_at,$6::timestamptz),updated_at=now()
      FROM contact c WHERE wc.woztell_member_id=$2 AND wc.id=(SELECT id FROM whatsapp_conversations WHERE woztell_member_id=$2 AND (channel_id=$7 OR channel_id IS NULL) ORDER BY (channel_id=$7) DESC NULLS LAST LIMIT 1)
        AND (wc.contact_id IS NULL OR wc.contact_id=c.id) RETURNING wc.id
    ), new_conversation AS (
      INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
      SELECT c.id,$2,$7,$8::timestamptz,$6::timestamptz FROM contact c
      WHERE $2::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM updated_conversation)
        AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE woztell_member_id=$2 AND channel_id IS NOT DISTINCT FROM $7)
      ON CONFLICT DO NOTHING RETURNING id
    ), conversation AS (SELECT id FROM updated_conversation UNION ALL SELECT id FROM new_conversation),
    message AS (
      INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,external_message_id,woztell_member_id,channel_id,payload,status,created_at)
      SELECT (SELECT id FROM conversation),c.id,$9::whatsapp_message_direction,$10,$11,$12,$2,$7,$13::jsonb,
        CASE WHEN $9='outbound' THEN 'accepted' ELSE 'received' END,$8::timestamptz FROM contact c
      WHERE ($2::text IS NULL OR EXISTS(SELECT 1 FROM conversation))
        AND ($14::text IS NULL OR NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE external_message_id=$14 AND text IS NOT DISTINCT FROM $11::text AND channel_id=$7 AND woztell_member_id=$2 AND direction::text=$9::text))
      ON CONFLICT (external_message_id) DO NOTHING RETURNING id
    ), verified_evidence AS (
      SELECT i.id FROM whatsapp_outbound_intents i
      JOIN whatsapp_messages m ON m.id=i.message_id
      JOIN conversation cv ON i.conversation_id=cv.id
      JOIN contact c ON c.id=m.contact_id
      WHERE $9='outbound' AND $14::text IS NULL AND jsonb_typeof($15::jsonb)='object'
        AND i.external_message_id=$12 AND m.external_message_id=$12
        AND m.direction='outbound' AND m.conversation_id=cv.id
        AND m.woztell_member_id=$2 AND m.channel_id=$7 AND m.message_type=$10
        AND i.state IN ('dispatching','unknown','accepted')
        AND ((i.kind='text' AND i.payload->>'text'=$11 AND m.text=$11)
          OR (i.kind='template' AND m.payload->'dispatchResponse'=$15::jsonb))
    ), accepted_intent AS (
      UPDATE whatsapp_outbound_intents i SET state='accepted',error=NULL,updated_at=now()
      FROM verified_evidence e WHERE i.id=e.id AND i.state IN ('dispatching','unknown','accepted') RETURNING i.message_id
    ), accepted_transcript AS (
      UPDATE whatsapp_messages m SET status='accepted',error=NULL
      FROM accepted_intent i WHERE m.id=i.message_id RETURNING m.id
    ) SELECT c.id AS contact_id,(SELECT id FROM conversation) AS conversation_id,EXISTS(SELECT 1 FROM message) AS inserted FROM contact c`,
      params: [
        normalizedPhone,
        memberId,
        event.memberName,
        phone,
        event.direction === "inbound" && isOptOutText(event.text),
        event.direction === "inbound" ? event.timestamp : null,
        event.channelId,
        event.timestamp,
        event.direction,
        event.messageType,
        event.text,
        event.externalMessageId,
        JSON.stringify(event.payload),
        event.legacyExternalMessageId,
        JSON.stringify(outboundWoztellEvidence(event)),
        origin === "live_webhook",
      ],
    },
    ...workflowStatements,
  ]);
  const row = results[keys.length]?.[0] as
    | { contact_id: string; conversation_id: string | null; inserted: boolean }
    | undefined;
  if (!row || (memberId && !row.conversation_id))
    throw Object.assign(new Error("WOZTELL_IDENTITY_CONFLICT"), {
      code: "WOZTELL_IDENTITY_CONFLICT",
    });
  const queuedJob = workflowStatements.length
    ? (results[keys.length + workflowStatements.length]?.[0] as { status?: string } | undefined)
    : undefined;
  if (queuedJob?.status === "queued") (options.wake ?? (() => wakeAfterCommit("service")))();
  return {
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    messageInserted: row.inserted,
    skipped: null,
  };
}
