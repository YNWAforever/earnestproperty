import { wakeAfterCommit } from "../control-plane/job-wake.server.ts";
import "@tanstack/react-start/server-only";
import { normalizeAdminPhone } from "../neon/admin-workflow.ts";
import { PHONE_LOCK_PREFIX, phoneMatchSql, phoneSpellingTiebreakSql } from "../phone.js";
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
  /** FX-12 / C-04: stored with no contact in a 「身分待核對」 conversation. */
  identityReview: boolean;
};

// FX-08 opt-out evidence, applied by the normal path and, for a conflicted STOP, by the
// review path to every matched contact (alias c, opt_out o).
const OPT_OUT_ASSIGNMENTS = `opted_out_whatsapp=c.opted_out_whatsapp OR o.new_opt_out,
        opted_out_at=CASE WHEN o.new_opt_out AND (NOT c.opted_out_whatsapp OR c.opted_out_at IS NULL OR $6::timestamptz>c.opted_out_at) THEN $6::timestamptz ELSE c.opted_out_at END,
        opted_out_message_id=CASE WHEN o.new_opt_out AND (NOT c.opted_out_whatsapp OR c.opted_out_at IS NULL OR $6::timestamptz>c.opted_out_at) THEN $12 ELSE c.opted_out_message_id END,
        opted_out_text=CASE WHEN o.new_opt_out AND (NOT c.opted_out_whatsapp OR c.opted_out_at IS NULL OR $6::timestamptz>c.opted_out_at) THEN left($11::text,500) ELSE c.opted_out_text END,
        opted_out_source=CASE WHEN o.new_opt_out AND (NOT c.opted_out_whatsapp OR c.opted_out_at IS NULL OR $6::timestamptz>c.opted_out_at) THEN 'customer_message' ELSE c.opted_out_source END,
        -- A new opt-out starts a new episode: earlier clear markers are reset (audit keeps history).
        opted_out_cleared_at=CASE WHEN o.new_opt_out AND NOT c.opted_out_whatsapp THEN NULL ELSE c.opted_out_cleared_at END,
        opted_out_cleared_by=CASE WHEN o.new_opt_out AND NOT c.opted_out_whatsapp THEN NULL ELSE c.opted_out_cleared_by END`;

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
        identityReview: false,
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
      identityReview: false,
    };
  }
  if (!classification.direction)
    return {
      contactId: null,
      conversationId: null,
      messageInserted: false,
      skipped: "unsupported-event",
      identityReview: false,
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
      identityReview: false,
    };
  const keys = [
    normalizedPhone ? `${PHONE_LOCK_PREFIX}${normalizedPhone}` : null,
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
      SELECT * FROM crm_contacts WHERE ${phoneMatchSql("normalized_phone", "$1")}
        OR whatsapp_member_id=$2
    ), conv AS (
      -- FX-12 / C-04: the member's conversation, the same row updated_conversation picks.
      SELECT id,contact_id FROM whatsapp_conversations
      WHERE $2::text IS NOT NULL AND woztell_member_id=$2 AND (channel_id=$7 OR channel_id IS NULL)
      ORDER BY (channel_id=$7) DESC NULLS LAST LIMIT 1
    ), staff_linked AS (
      -- A manager linked this conversation to a contact: that link is authoritative for
      -- the member, and no identity field is filled from the message.
      SELECT conv.contact_id AS id FROM conv
      WHERE conv.contact_id IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contact_identity_reviews r
        WHERE r.conversation_id=conv.id AND r.status='linked')
    ), valid AS (
      SELECT * FROM crm_contacts WHERE id=(SELECT id FROM staff_linked)
      UNION ALL
      (SELECT * FROM matched
      WHERE (normalized_phone IS NULL OR $1::text IS NULL
        OR ${phoneMatchSql("normalized_phone", "$1")})
        AND (whatsapp_member_id IS NULL OR $2::text IS NULL OR whatsapp_member_id=$2)
        AND NOT EXISTS(SELECT 1 FROM staff_linked)
      ORDER BY (whatsapp_member_id=$2) DESC NULLS LAST,
        (normalized_phone=$1) DESC NULLS LAST,
        ${phoneSpellingTiebreakSql("normalized_phone", "$1")}, id
      LIMIT 1)
    ), fill_collision AS (
      -- Filling a blank phone or member would hit another contact's UNIQUE value (C-04 b).
      SELECT 1 FROM valid v WHERE NOT EXISTS(SELECT 1 FROM staff_linked) AND (
        (v.normalized_phone IS NULL AND $1::text IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contacts o
          WHERE o.id<>v.id AND ${phoneMatchSql("o.normalized_phone", "$1")}))
        OR (v.whatsapp_member_id IS NULL AND $2::text IS NOT NULL AND EXISTS(SELECT 1 FROM crm_contacts o
          WHERE o.id<>v.id AND o.whatsapp_member_id=$2)))
    ), conv_conflict AS (
      -- The member's conversation belongs to a contact this message does not resolve to
      -- (C-04 c), including when it resolves to no existing contact at all.
      SELECT 1 FROM conv WHERE conv.contact_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM valid v WHERE v.id=conv.contact_id)
    ), review AS (
      -- 「身分待核對」: store the message with no contact in the member's conversation.
      SELECT ($2::text IS NOT NULL AND NOT EXISTS(SELECT 1 FROM staff_linked) AND (
        EXISTS(SELECT 1 FROM crm_contact_identity_reviews r JOIN conv ON r.conversation_id=conv.id
          WHERE r.reason='whatsapp_identity_conflict' AND r.status='open')
        OR (EXISTS(SELECT 1 FROM matched) AND NOT EXISTS(SELECT 1 FROM valid))
        OR EXISTS(SELECT 1 FROM fill_collision) OR EXISTS(SELECT 1 FROM conv_conflict))) AS yes
    ), opt_out AS (
      -- FX-08: $5 is true only for a live inbound D4 message. It is applied unless THIS
      -- message was already applied as an opt-out (its id is the recorded evidence, which
      -- a manager clear keeps), so a redelivery never re-sets a cleared opt-out, while a
      -- history-imported copy of the same message never swallows the live opt-out.
      -- A bare pre-digest legacy key is only ever stored by pre-FX-08 code, which always
      -- applied the opt-out, so a match there also counts as already applied.
      SELECT ($5::boolean
        AND NOT EXISTS(SELECT 1 FROM crm_contacts WHERE opted_out_message_id=$12)
        AND NOT ($14::text IS NOT NULL AND EXISTS(SELECT 1 FROM whatsapp_messages
          WHERE external_message_id=$14 AND text IS NOT DISTINCT FROM $11::text
            AND channel_id=$7 AND woztell_member_id=$2 AND direction::text='inbound'))) AS new_opt_out
    ), updated_contact AS (
      UPDATE crm_contacts c SET name=COALESCE(c.name,$3),whatsapp_profile_name=CASE WHEN $16::boolean AND $9::text='inbound' AND $6::timestamptz>=COALESCE(c.last_inbound_at,'-infinity'::timestamptz) THEN COALESCE($3,c.whatsapp_profile_name) ELSE COALESCE(c.whatsapp_profile_name,$3) END,
        -- A staff-linked conversation never fills an identity field from the message.
        phone=CASE WHEN EXISTS(SELECT 1 FROM staff_linked) THEN c.phone ELSE COALESCE(c.phone,$4) END,
        normalized_phone=CASE WHEN EXISTS(SELECT 1 FROM staff_linked) THEN c.normalized_phone ELSE COALESCE(c.normalized_phone,$1) END,
        whatsapp_member_id=CASE WHEN EXISTS(SELECT 1 FROM staff_linked) THEN c.whatsapp_member_id ELSE COALESCE(c.whatsapp_member_id,$2) END,
        ${OPT_OUT_ASSIGNMENTS},
        last_inbound_at=GREATEST(c.last_inbound_at,$6::timestamptz),updated_at=now()
      FROM valid v, opt_out o, review rv WHERE c.id=v.id AND NOT rv.yes RETURNING c.id
    ), review_opt_out AS (
      -- Owner decision (Open question 2): a STOP in a conflicted message opts out every
      -- contact it matched, with the same FX-08 evidence. Nothing else is written.
      -- After a manager link the same holds: another matched contact can still hold this
      -- member (or the phone) and be sent a campaign through it, so it is opted out too.
      -- The linked contact itself is written by updated_contact (one write per row).
      UPDATE crm_contacts c SET ${OPT_OUT_ASSIGNMENTS},updated_at=now()
      FROM opt_out o, review rv
      WHERE c.id IN (SELECT id FROM matched) AND o.new_opt_out
        AND (rv.yes OR (EXISTS(SELECT 1 FROM staff_linked)
          AND c.id IS DISTINCT FROM (SELECT id FROM staff_linked)))
      RETURNING c.id
    ), new_contact AS (
      INSERT INTO crm_contacts(name,phone,normalized_phone,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp,last_inbound_at,
        opted_out_at,opted_out_message_id,opted_out_text,opted_out_source,whatsapp_profile_name)
      SELECT $3,$4,$1,$2,'whatsapp',false,o.new_opt_out,$6::timestamptz,
        CASE WHEN o.new_opt_out THEN $6::timestamptz END,CASE WHEN o.new_opt_out THEN $12 END,
        CASE WHEN o.new_opt_out THEN left($11::text,500) END,CASE WHEN o.new_opt_out THEN 'customer_message' END,$3
      FROM opt_out o WHERE NOT EXISTS(SELECT 1 FROM matched) AND NOT (SELECT yes FROM review)
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
    ), review_conversation AS (
      UPDATE whatsapp_conversations wc SET channel_id=COALESCE(wc.channel_id,$7),
        last_message_at=GREATEST(wc.last_message_at,$8::timestamptz),
        last_inbound_at=GREATEST(wc.last_inbound_at,$6::timestamptz),updated_at=now()
      FROM conv, review rv WHERE rv.yes AND wc.id=conv.id RETURNING wc.id
    ), review_new_conversation AS (
      INSERT INTO whatsapp_conversations(contact_id,woztell_member_id,channel_id,last_message_at,last_inbound_at)
      SELECT NULL,$2,$7,$8::timestamptz,$6::timestamptz FROM review rv
      WHERE rv.yes AND NOT EXISTS(SELECT 1 FROM conv) ON CONFLICT DO NOTHING RETURNING id
    ), conversation AS (SELECT id FROM updated_conversation UNION ALL SELECT id FROM new_conversation
      UNION ALL SELECT id FROM review_conversation UNION ALL SELECT id FROM review_new_conversation),
    message AS (
      -- In review the message is stored with no contact, so FX-09 opens no lead and the
      -- enquiry pipeline (which needs a contact) creates no event, job or auto-reply.
      INSERT INTO whatsapp_messages(conversation_id,contact_id,direction,message_type,text,external_message_id,woztell_member_id,channel_id,payload,status,created_at)
      SELECT (SELECT id FROM conversation),c.id,$9::whatsapp_message_direction,$10,$11,$12,$2,$7,$13::jsonb,
        CASE WHEN $9='outbound' THEN 'accepted' ELSE 'received' END,$8::timestamptz
      FROM (SELECT id FROM contact UNION ALL SELECT NULL::uuid FROM review rv WHERE rv.yes) c
      WHERE ($2::text IS NULL OR EXISTS(SELECT 1 FROM conversation))
        AND ($14::text IS NULL OR NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE external_message_id=$14 AND text IS NOT DISTINCT FROM $11::text AND channel_id=$7 AND woztell_member_id=$2 AND direction::text=$9::text))
      ON CONFLICT (external_message_id) DO NOTHING RETURNING id
    ), review_row_bump AS (
      -- One open review per conversation. A redelivery inserts no message and counts nothing.
      UPDATE crm_contact_identity_reviews r SET updated_at=now(),
        evidence=r.evidence || jsonb_build_object(
          'messageCount',COALESCE((r.evidence->>'messageCount')::int,0)
            + CASE WHEN EXISTS(SELECT 1 FROM message) THEN 1 ELSE 0 END,
          'lastMessageAt',GREATEST((r.evidence->>'lastMessageAt')::timestamptz,$8::timestamptz),
          'optOutApplied',COALESCE((r.evidence->>'optOutApplied')::boolean,false)
            OR EXISTS(SELECT 1 FROM review_opt_out),
          -- A live D4 STOP arrived here, even if it matched no contact: Task 4 applies it on link.
          'stopReceived',COALESCE((r.evidence->>'stopReceived')::boolean,false) OR $5::boolean)
      FROM conv, review rv
      WHERE rv.yes AND r.conversation_id=conv.id AND r.reason='whatsapp_identity_conflict'
        AND r.status='open' AND (EXISTS(SELECT 1 FROM message) OR EXISTS(SELECT 1 FROM review_opt_out))
      RETURNING r.id
    ), review_row_new AS (
      -- contact_a is the member owner and contact_b the phone owner, or for a conversation
      -- owned by another contact, its owner and the contact the message resolved to.
      -- The evidence never holds a phone or a member id.
      INSERT INTO crm_contact_identity_reviews(reason,contact_a,contact_b,conversation_id,evidence)
      SELECT 'whatsapp_identity_conflict',
        CASE WHEN EXISTS(SELECT 1 FROM conv_conflict) THEN (SELECT contact_id FROM conv)
          ELSE (SELECT id FROM matched WHERE whatsapp_member_id=$2 LIMIT 1) END,
        CASE WHEN EXISTS(SELECT 1 FROM conv_conflict) THEN (SELECT id FROM valid LIMIT 1)
          ELSE (SELECT id FROM matched WHERE ${phoneMatchSql("normalized_phone", "$1")}
            AND id IS DISTINCT FROM (SELECT id FROM matched WHERE whatsapp_member_id=$2 LIMIT 1)
            ORDER BY (normalized_phone=$1) DESC, id LIMIT 1) END,
        (SELECT id FROM conversation LIMIT 1),
        jsonb_build_object('kind',CASE WHEN EXISTS(SELECT 1 FROM conv_conflict) THEN 'conversation_owner'
                                       WHEN EXISTS(SELECT 1 FROM fill_collision) THEN 'fill_collision'
                                       ELSE 'member_phone_mismatch' END,
          'messageCount',1,'lastMessageAt',$8::timestamptz,
          'optOutApplied',EXISTS(SELECT 1 FROM review_opt_out),'stopReceived',$5::boolean)
      FROM review rv WHERE rv.yes AND EXISTS(SELECT 1 FROM message)
        AND NOT EXISTS(SELECT 1 FROM crm_contact_identity_reviews r JOIN conv ON r.conversation_id=conv.id
          WHERE r.reason='whatsapp_identity_conflict' AND r.status='open')
      ON CONFLICT (conversation_id) WHERE reason='whatsapp_identity_conflict' AND status='open' DO NOTHING
      RETURNING id
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
    ) SELECT (SELECT id FROM contact LIMIT 1) AS contact_id,(SELECT id FROM conversation LIMIT 1) AS conversation_id,
      EXISTS(SELECT 1 FROM message) AS inserted,(SELECT yes FROM review) AS identity_review`,
      params: [
        normalizedPhone,
        memberId,
        event.memberName,
        phone,
        // FX-08 / D4: only a live inbound message can opt a contact out; history never does.
        origin === "live_webhook" && event.direction === "inbound" && isOptOutText(event.text),
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
    | {
        contact_id: string | null;
        conversation_id: string | null;
        inserted: boolean;
        identity_review: boolean | null;
      }
    | undefined;
  // The statement always returns one row, and a conflicted message is stored in review,
  // so this is an impossible state kept as a tripwire (C-04).
  const identityReview = row?.identity_review === true;
  if (!row || (memberId && !row.conversation_id) || (!row.contact_id && !identityReview))
    throw Object.assign(new Error("WOZTELL_IDENTITY_CONFLICT"), {
      code: "WOZTELL_IDENTITY_CONFLICT",
    });
  // An id only: never the phone, member id or text.
  if (identityReview) console.warn("WA_IDENTITY_REVIEW", { conversationId: row.conversation_id });
  const queuedJob = workflowStatements.length
    ? (results[keys.length + workflowStatements.length]?.[0] as { status?: string } | undefined)
    : undefined;
  if (queuedJob?.status === "queued") (options.wake ?? (() => wakeAfterCommit("service")))();
  return {
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    messageInserted: row.inserted,
    skipped: null,
    identityReview,
  };
}
