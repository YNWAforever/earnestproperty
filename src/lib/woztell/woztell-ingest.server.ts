import "@tanstack/react-start/server-only";
import { normalizeAdminPhone } from "../neon/admin-workflow.ts";
import { isOptOutText, outboundWoztellEvidence } from "./woztell.server.ts";
import type { NormalizedWoztellEvent } from "./woztell.server.ts";

export type IngestOutcome = {
  contactId: string | null;
  conversationId: string | null;
  messageInserted: boolean;
  skipped: "no-identity" | null;
};

/** Contact, thread and message commit together. Shared identity locks precede a fresh SQL snapshot. */
export async function ingestWoztellEvent(
  event: NormalizedWoztellEvent,
  injectedTransaction?: typeof import("../neon/db.server.ts").transactionRows,
): Promise<IngestOutcome> {
  const transactionRows =
    injectedTransaction ?? (await import("../neon/db.server.ts")).transactionRows;
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
  const results = await transactionRows([
    ...keys.map((key) => ({
      statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      params: [key],
    })),
    {
      statement: `WITH matched AS (
      SELECT * FROM crm_contacts WHERE normalized_phone=$1 OR whatsapp_member_id=$2
    ), valid AS (
      SELECT * FROM matched WHERE (SELECT count(*) FROM matched)=1
      AND (normalized_phone IS NULL OR $1::text IS NULL OR normalized_phone=$1)
      AND (whatsapp_member_id IS NULL OR $2::text IS NULL OR whatsapp_member_id=$2)
    ), updated_contact AS (
      UPDATE crm_contacts c SET name=COALESCE($3,c.name),phone=COALESCE(c.phone,$4),
        normalized_phone=COALESCE(c.normalized_phone,$1),whatsapp_member_id=COALESCE(c.whatsapp_member_id,$2),
        opted_out_whatsapp=c.opted_out_whatsapp OR $5,last_inbound_at=GREATEST(c.last_inbound_at,$6::timestamptz),updated_at=now()
      FROM valid v WHERE c.id=v.id RETURNING c.id
    ), new_contact AS (
      INSERT INTO crm_contacts(name,phone,normalized_phone,whatsapp_member_id,source,opt_in_whatsapp,opted_out_whatsapp,last_inbound_at)
      SELECT $3,$4,$1,$2,'whatsapp',false,$5,$6::timestamptz WHERE NOT EXISTS(SELECT 1 FROM matched)
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
        AND ($14::text IS NULL OR NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE external_message_id=$14 AND text IS NOT DISTINCT FROM $11::text))
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
      ],
    },
  ]);
  const row = results.at(-1)?.[0] as
    | { contact_id: string; conversation_id: string | null; inserted: boolean }
    | undefined;
  if (!row || (memberId && !row.conversation_id))
    throw Object.assign(new Error("WOZTELL_IDENTITY_CONFLICT"), {
      code: "WOZTELL_IDENTITY_CONFLICT",
    });
  return {
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    messageInserted: row.inserted,
    skipped: null,
  };
}
