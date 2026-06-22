import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

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

        const payload = JSON.parse(raw || "{}") as Record<string, unknown>;
        const event = normalizeWoztellEvent(payload);
        const phone = event.direction === "inbound" ? event.fromPhone : event.toPhone;
        const normalizedPhone = phone?.replace(/\D/g, "") ?? null;

        const contacts = await queryRows(
          `
          INSERT INTO crm_contacts (
            name, phone, normalized_phone, whatsapp_member_id, source,
            opt_in_whatsapp, opted_out_whatsapp, last_inbound_at
          )
          VALUES ($1, $2, $3, $4, 'whatsapp', true, $5, $6)
          ON CONFLICT (normalized_phone) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, crm_contacts.name),
            whatsapp_member_id = COALESCE(EXCLUDED.whatsapp_member_id, crm_contacts.whatsapp_member_id),
            opt_in_whatsapp = true,
            opted_out_whatsapp = crm_contacts.opted_out_whatsapp OR EXCLUDED.opted_out_whatsapp,
            last_inbound_at = COALESCE(EXCLUDED.last_inbound_at, crm_contacts.last_inbound_at),
            updated_at = now()
          RETURNING id
          `,
          [
            event.memberName,
            phone,
            normalizedPhone,
            event.woztellMemberId,
            isOptOutText(event.text),
            event.direction === "inbound" ? event.timestamp : null,
          ],
        );
        const contactId = stringOrEmpty(contacts[0]?.id);

        const conversations = await queryRows(
          `
          INSERT INTO whatsapp_conversations (
            contact_id, woztell_member_id, channel_id, last_message_at, last_inbound_at
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (channel_id, woztell_member_id) DO UPDATE SET
            contact_id = EXCLUDED.contact_id,
            last_message_at = EXCLUDED.last_message_at,
            last_inbound_at = COALESCE(EXCLUDED.last_inbound_at, whatsapp_conversations.last_inbound_at),
            updated_at = now()
          RETURNING id
          `,
          [
            contactId,
            event.woztellMemberId,
            event.channelId,
            event.timestamp,
            event.direction === "inbound" ? event.timestamp : null,
          ],
        );

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
            conversations[0]?.id,
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
