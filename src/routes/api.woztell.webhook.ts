import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { normalizeAdminPhone } from "@/lib/neon/admin-workflow";
import { queryRows, stringOrEmpty } from "@/lib/neon/db.server";
import {
  isOptOutText,
  normalizeWoztellEvent,
  verifyWoztellSignature,
  woztellConfig,
} from "@/lib/woztell/woztell.server";

export const Route = createFileRoute("/api/woztell/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const config = woztellConfig();
        const valid = verifyWoztellSignature(
          Buffer.from(raw),
          request.headers.get("x-woztell-signature"),
          config.channelSecret,
        );

        if (!valid) {
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(raw || "{}") as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
        }
        const event = normalizeWoztellEvent(payload);
        const phone = event.direction === "inbound" ? event.fromPhone : event.toPhone;
        const normalizedPhone = normalizeAdminPhone(phone);
        const memberId = event.woztellMemberId;

        // The Woztell member id is the stable identity for a conversation. Without
        // it (and without a phone) we cannot reliably thread the event, so skip it.
        if (!memberId && !normalizedPhone) {
          console.warn(
            "[woztell] skipping event with no member id and no phone; cannot thread reliably",
          );
          return Response.json({ ok: true, skipped: "no-identity" });
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
          const updated = await queryRows<{ id: string }>(
            `
            UPDATE crm_contacts SET
              name = COALESCE($2, name),
              phone = COALESCE(phone, $3),
              normalized_phone = COALESCE(normalized_phone, $4),
              whatsapp_member_id = COALESCE(whatsapp_member_id, $5),
              opt_in_whatsapp = opt_in_whatsapp OR $6,
              opted_out_whatsapp = opted_out_whatsapp OR $7,
              last_inbound_at = COALESCE($8, last_inbound_at),
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
            const updated = await queryRows<{ id: string }>(
              `
              UPDATE whatsapp_conversations SET
                contact_id = $2,
                channel_id = COALESCE(channel_id, $3),
                last_message_at = $4,
                last_inbound_at = COALESCE($5, last_inbound_at),
                updated_at = now()
              WHERE id = $1
              RETURNING id
              `,
              [
                existingConversations[0].id,
                contactId,
                event.channelId,
                event.timestamp,
                lastInboundAt,
              ],
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

        await queryRows(
          `
          INSERT INTO whatsapp_messages (
            conversation_id, contact_id, direction, message_type, text,
            external_message_id, woztell_member_id, channel_id, payload, status, created_at
          )
          VALUES ($1, $2, $3::whatsapp_message_direction, $4, $5, $6, $7, $8, $9::jsonb, 'received', $10)
          ON CONFLICT (external_message_id) DO NOTHING
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

        return Response.json({ ok: true });
      },
    },
  },
});
