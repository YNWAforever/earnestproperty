import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffAccess } from "@/lib/neon/auth.server";
import { queryRows, stringOrNull } from "@/lib/neon/db.server";
import { canReplyToConversation } from "@/lib/neon/admin-workflow";
import { sendWoztellResponse, woztellEnabled } from "@/lib/woztell/woztell.server";

type SendConversationRow = {
  id: unknown;
  contact_id: unknown;
  woztell_member_id: unknown;
  channel_id: unknown;
  last_inbound_at: unknown;
  opted_out_whatsapp: unknown;
};

type WoztellSendResult = Awaited<ReturnType<typeof sendWoztellResponse>>;

export const Route = createFileRoute("/api/admin/woztell/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
        const body = (await request.json().catch(() => null)) as {
          recipientId?: string;
          text?: string;
          conversationId?: string;
        } | null;
        const conversationId = body?.conversationId?.trim();
        const recipientId = body?.recipientId?.trim();
        const text = body?.text?.trim();

        if (!conversationId || !recipientId || !text) {
          return Response.json(
            { ok: false, error: "conversationId, recipientId and text are required" },
            { status: 400 },
          );
        }

        const conversationRows = await queryRows<SendConversationRow>(
          `
          SELECT
            wc.id,
            wc.contact_id,
            wc.woztell_member_id,
            wc.channel_id,
            wc.last_inbound_at,
            c.opted_out_whatsapp
          FROM whatsapp_conversations wc
          LEFT JOIN crm_contacts c ON c.id = wc.contact_id
          WHERE wc.id = $1
          LIMIT 1
          `,
          [conversationId],
        );
        const conversation = conversationRows[0];
        if (!conversation) {
          return Response.json({ ok: false, error: "CONVERSATION_NOT_FOUND" }, { status: 400 });
        }

        const conversationRecipientId = stringOrNull(conversation.woztell_member_id)?.trim();
        if (!conversationRecipientId) {
          return Response.json({ ok: false, error: "MISSING_WOZTELL_MEMBER_ID" }, { status: 400 });
        }
        if (recipientId !== conversationRecipientId) {
          return Response.json({ ok: false, error: "RECIPIENT_MISMATCH" }, { status: 400 });
        }

        const replyGuard = canReplyToConversation({
          woztellEnabled: woztellEnabled(),
          optedOut: conversation.opted_out_whatsapp === true,
          lastInboundAt: stringOrNull(conversation.last_inbound_at),
        });
        if (!replyGuard.ok) {
          return Response.json({ ok: false, error: replyGuard.reason }, { status: 400 });
        }

        let result: WoztellSendResult;
        try {
          result = await sendWoztellResponse({
            recipientId: conversationRecipientId,
            response: [{ type: "TEXT", text }],
          });
        } catch (sendError) {
          result = { ok: false, error: errorMessage(sendError) };
        }

        await queryRows(
          `
          INSERT INTO whatsapp_messages (
            conversation_id, contact_id, direction, message_type, text, sent_by,
            status, payload, error, woztell_member_id, channel_id
          )
          VALUES ($1, $2, 'outbound', 'TEXT', $3, $4, $5, $6::jsonb, $7, $8, $9)
          `,
          [
            conversationId,
            stringOrNull(conversation.contact_id),
            text,
            staff.staffId,
            result.ok ? "sent" : "failed",
            JSON.stringify({ ...result, requestedRecipientId: recipientId }),
            result.ok ? null : result.error,
            conversationRecipientId,
            stringOrNull(conversation.channel_id),
          ],
        );

        await queryRows(
          "UPDATE whatsapp_conversations SET last_message_at = now(), updated_at = now() WHERE id = $1",
          [conversationId],
        );

        return Response.json(result.ok ? { ok: true } : result, { status: result.ok ? 200 : 503 });
      },
    },
  },
});

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
