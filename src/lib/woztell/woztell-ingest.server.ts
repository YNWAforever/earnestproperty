import "@tanstack/react-start/server-only";

import { normalizeAdminPhone } from "@/lib/neon/admin-workflow";
import { queryRows, stringOrEmpty } from "@/lib/neon/db.server";

import { isOptOutText } from "./woztell.server";
import type { NormalizedWoztellEvent } from "./woztell.server";

/**
 * Persisting one normalized WOZTELL event: find-or-create the contact, thread
 * the conversation, insert the message.
 *
 * This lived inline in api.woztell.webhook.ts until a second caller appeared.
 * The backfill (scripts/woztell/backfill-history.mjs, via
 * woztell-history.server.ts) has to write EXACTLY the same rows the webhook
 * writes -- same contact matching, same threading key, same dedupe -- or the
 * two paths produce two different views of the same conversation and the admin
 * inbox shows duplicates. Copying 120 lines of upsert SQL into a second file
 * would have guaranteed that drift the first time either side was touched.
 */

export type IngestOutcome = {
  /** Null when the event carried no member id and no phone -- see below. */
  contactId: string | null;
  conversationId: string | null;
  /** False when ON CONFLICT swallowed the insert (we already had this message). */
  messageInserted: boolean;
  skipped: "no-identity" | null;
};

export async function ingestWoztellEvent(event: NormalizedWoztellEvent): Promise<IngestOutcome> {
  const phone = event.direction === "inbound" ? event.fromPhone : event.toPhone;
  const normalizedPhone = normalizeAdminPhone(phone);
  const memberId = event.woztellMemberId;

  // The Woztell member id is the stable identity for a conversation. Without
  // it (and without a phone) we cannot reliably thread the event, so skip it.
  if (!memberId && !normalizedPhone) {
    console.warn("[woztell] skipping event with no member id and no phone; cannot thread reliably");
    return {
      contactId: null,
      conversationId: null,
      messageInserted: false,
      skipped: "no-identity",
    };
  }

  const isInbound = event.direction === "inbound";
  const lastInboundAt = isInbound ? event.timestamp : null;
  const optIn = isInbound;
  const optedOut = isInbound && isOptOutText(event.text);

  // Find an existing contact by phone OR by member id, then INSERT/UPDATE by
  // primary id. NULLs are distinct in Postgres, so relying solely on
  // ON CONFLICT (normalized_phone) would create a fresh row for every
  // member-id-keyed event that lacks a phone.
  const existingContacts = await queryRows<{ id: string }>(
    `
    SELECT id FROM crm_contacts
    WHERE (normalized_phone IS NOT NULL AND normalized_phone = $1)
       OR (whatsapp_member_id IS NOT NULL AND whatsapp_member_id = $2)
    ORDER BY (whatsapp_member_id = $2) DESC, (normalized_phone = $1) DESC
    LIMIT 1
    `,
    [normalizedPhone, memberId],
  );

  let contactId: string;
  if (existingContacts[0]?.id) {
    // GREATEST rather than COALESCE on last_inbound_at: COALESCE takes the new
    // value whenever it is non-null, which is fine for a live webhook arriving
    // in order but WRONG for a backfill, where replaying a message from March
    // would drag a contact's "last heard from" back three months. See the note
    // on NULL handling at the conversations update below.
    const updated = await queryRows<{ id: string }>(
      `
      UPDATE crm_contacts SET
        name = COALESCE($2, name),
        phone = COALESCE(phone, $3),
        normalized_phone = COALESCE(normalized_phone, $4),
        whatsapp_member_id = COALESCE(whatsapp_member_id, $5),
        opt_in_whatsapp = opt_in_whatsapp OR $6,
        opted_out_whatsapp = opted_out_whatsapp OR $7,
        last_inbound_at = GREATEST(last_inbound_at, $8),
        updated_at = now()
      WHERE id = $1
      RETURNING id
      `,
      [
        existingContacts[0].id,
        event.memberName,
        phone,
        normalizedPhone,
        memberId,
        optIn,
        optedOut,
        lastInboundAt,
      ],
    );
    contactId = stringOrEmpty(updated[0]?.id);
  } else {
    const inserted = await queryRows<{ id: string }>(
      `
      INSERT INTO crm_contacts (
        name, phone, normalized_phone, whatsapp_member_id, source,
        opt_in_whatsapp, opted_out_whatsapp, last_inbound_at
      )
      VALUES ($1, $2, $3, $4, 'whatsapp', $5, $6, $7)
      RETURNING id
      `,
      [event.memberName, phone, normalizedPhone, memberId, optIn, optedOut, lastInboundAt],
    );
    contactId = stringOrEmpty(inserted[0]?.id);
  }

  // Thread the conversation by member id. Skip when absent (channel_id alone
  // is not a reliable key, and NULL member ids are distinct under the unique
  // constraint, so ON CONFLICT would spawn a new row per message).
  let conversationId: string | null = null;
  if (memberId) {
    const existingConversations = await queryRows<{ id: string }>(
      `SELECT id FROM whatsapp_conversations
       WHERE woztell_member_id = $1 AND (channel_id = $2 OR channel_id IS NULL)
       ORDER BY (channel_id = $2) DESC
       LIMIT 1`,
      [memberId, event.channelId],
    );
    if (existingConversations[0]?.id) {
      // Same GREATEST reasoning as above, and it matters more here for two
      // reasons: the inbox sorts on last_message_at, so a backfill using plain
      // assignment would shuffle every active conversation to the bottom of the
      // list as it replayed old history; and wc.last_inbound_at is what gates
      // the 24-hour free-form reply window in api.admin.woztell.send.ts and
      // admin.whatsapp.tsx, so moving it backwards closes the window and blocks
      // staff from replying to a live customer.
      //
      // Both depend on Postgres ignoring NULLs in GREATEST -- an EXPLICIT
      // deviation from the SQL standard, under which any NULL argument makes the
      // whole result NULL (MySQL and Oracle behave that way). $5 is NULL on
      // every outbound event, so under standard semantics this would BLANK
      // last_inbound_at rather than leave it alone, closing the reply window on
      // every conversation the moment staff replied to it. Do not "fix" this
      // into a COALESCE-wrapped form on instinct.
      // https://www.postgresql.org/docs/current/functions-conditional.html
      const updated = await queryRows<{ id: string }>(
        `
        UPDATE whatsapp_conversations SET
          contact_id = $2,
          channel_id = COALESCE(channel_id, $3),
          last_message_at = GREATEST(last_message_at, $4),
          last_inbound_at = GREATEST(last_inbound_at, $5),
          updated_at = now()
        WHERE id = $1
        RETURNING id
        `,
        [existingConversations[0].id, contactId, event.channelId, event.timestamp, lastInboundAt],
      );
      conversationId = updated[0]?.id ? stringOrEmpty(updated[0].id) : null;
    } else {
      const inserted = await queryRows<{ id: string }>(
        `
        INSERT INTO whatsapp_conversations (
          contact_id, woztell_member_id, channel_id, last_message_at, last_inbound_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [contactId, memberId, event.channelId, event.timestamp, lastInboundAt],
      );
      conversationId = inserted[0]?.id ? stringOrEmpty(inserted[0].id) : null;
    }
  } else {
    console.warn(
      "[woztell] event has no member id; storing message without a threaded conversation",
    );
  }

  // external_message_id is UNIQUE, so ON CONFLICT DO NOTHING is what makes the
  // backfill safe to re-run and safe to overlap with the live webhook: whichever
  // path sees a message first wins, the other is a no-op. RETURNING id is empty
  // on conflict, which is how we count "already had it" without a second query.
  const insertedMessages = await queryRows<{ id: string }>(
    `
    INSERT INTO whatsapp_messages (
      conversation_id, contact_id, direction, message_type, text,
      external_message_id, woztell_member_id, channel_id, payload, status, created_at
    )
    VALUES ($1, $2, $3::whatsapp_message_direction, $4, $5, $6, $7, $8, $9::jsonb, 'received', $10)
    ON CONFLICT (external_message_id) DO NOTHING
    RETURNING id
    `,
    [
      conversationId,
      contactId,
      event.direction,
      event.messageType,
      event.text,
      event.externalMessageId,
      event.woztellMemberId,
      event.channelId,
      JSON.stringify(event.payload),
      event.timestamp,
    ],
  );

  return {
    contactId,
    conversationId,
    messageInserted: insertedMessages.length > 0,
    skipped: null,
  };
}
