import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { agentScope } from "@/lib/neon/admin-data.server";
import { requireStaffAccess } from "@/lib/neon/auth.server";
import { queryRows, stringOrNull } from "@/lib/neon/db.server";
import { sendWoztellResponse, woztellEnabled } from "@/lib/woztell/woztell.server";

type SendConversationRow = {
  id: unknown;
  contact_id: unknown;
  woztell_member_id: unknown;
  channel_id: unknown;
  opted_out_whatsapp: unknown;
};

type TemplateRow = {
  element_name: unknown;
  language_code: unknown;
  components: unknown;
};

type WoztellSendResult = Awaited<ReturnType<typeof sendWoztellResponse>>;

export const Route = createFileRoute("/api/admin/woztell/send-template")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const staff = await requireStaffAccess(request, ["admin", "manager", "agent"]);
        const body = (await request.json().catch(() => null)) as {
          conversationId?: string;
          templateId?: string;
        } | null;
        const conversationId = body?.conversationId?.trim();
        const templateId = body?.templateId?.trim();

        if (!conversationId || !templateId) {
          return Response.json(
            { ok: false, error: "conversationId and templateId are required" },
            { status: 400 },
          );
        }

        if (!woztellEnabled()) {
          return Response.json({ ok: false, error: "WOZTELL_DISABLED" }, { status: 400 });
        }

        // Same scoping as /api/admin/woztell/send: an agent-role token may only
        // template-message a conversation assigned to them. NULL scope means
        // admin/manager, who see everything.
        const scope = agentScope(staff);
        const conversationRows = await queryRows<SendConversationRow>(
          `
          SELECT
            wc.id,
            wc.contact_id,
            wc.woztell_member_id,
            wc.channel_id,
            c.opted_out_whatsapp
          FROM whatsapp_conversations wc
          LEFT JOIN crm_contacts c ON c.id = wc.contact_id
          WHERE wc.id = $1
            AND ($2::uuid IS NULL OR wc.assigned_agent_id = $2::uuid)
          LIMIT 1
          `,
          [conversationId, scope],
        );
        const conversation = conversationRows[0];
        if (!conversation) {
          // Same collapsed response as /api/admin/woztell/send: distinguishing
          // "no such conversation" from "not yours" would let an agent
          // enumerate which conversation ids exist.
          return Response.json({ ok: false, error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
        }
        if (conversation.opted_out_whatsapp === true) {
          return Response.json({ ok: false, error: "CONTACT_OPTED_OUT" }, { status: 400 });
        }

        const memberId = stringOrNull(conversation.woztell_member_id)?.trim();
        if (!memberId) {
          return Response.json({ ok: false, error: "MISSING_WOZTELL_MEMBER_ID" }, { status: 400 });
        }

        // Templates are the only WhatsApp Business-initiated message type
        // allowed once the 24-hour window has closed, so unlike
        // /api/admin/woztell/send this path deliberately does not check
        // canReplyToConversation's window -- that guard exists to block
        // free-text sends, not template sends, which are what the window
        // closing is supposed to route staff towards.
        const templateRows = await queryRows<TemplateRow>(
          `SELECT element_name, language_code, components
           FROM whatsapp_templates
           WHERE id = $1 AND status LIKE 'active%'
           LIMIT 1`,
          [templateId],
        );
        const template = templateRows[0];
        const elementName = template ? stringOrNull(template.element_name) : null;
        if (!template || !elementName) {
          return Response.json({ ok: false, error: "TEMPLATE_NOT_FOUND" }, { status: 404 });
        }
        const languageCode = stringOrNull(template.language_code) || "zh_HK";
        const components = Array.isArray(template.components) ? template.components : [];

        // The approved body text lives with Woztell and is never mirrored
        // locally (see template-preview.ts), so the timeline records which
        // template was sent rather than its content.
        const pendingRows = await queryRows<{ id: unknown }>(
          `
          INSERT INTO whatsapp_messages (
            conversation_id, contact_id, direction, message_type, text, sent_by,
            status, payload, error, woztell_member_id, channel_id
          )
          VALUES ($1, $2, 'outbound', 'TEMPLATE', $3, $4, 'sending', $5::jsonb, NULL, $6, $7)
          RETURNING id
          `,
          [
            conversationId,
            stringOrNull(conversation.contact_id),
            `已傳送範本：${elementName}`,
            staff.staffId,
            JSON.stringify({ state: "sending", elementName, languageCode }),
            memberId,
            stringOrNull(conversation.channel_id),
          ],
        );
        const messageId = stringOrNull(pendingRows[0]?.id);
        if (!messageId) {
          return Response.json({ ok: false, error: "MESSAGE_CREATE_FAILED" }, { status: 500 });
        }

        let result: WoztellSendResult;
        try {
          result = await sendWoztellResponse({
            memberId,
            response: [
              {
                type: "TEMPLATE",
                elementName,
                languageCode,
                ...(components.length > 0 ? { components } : {}),
              },
            ],
          });
        } catch (sendError) {
          result = { ok: false, error: errorMessage(sendError) };
        }

        await queryRows(
          `
          UPDATE whatsapp_messages
          SET status = $2, payload = $3::jsonb, error = $4
          WHERE id = $1
          `,
          [
            messageId,
            result.ok ? "sent" : "failed",
            JSON.stringify(result),
            result.ok ? null : result.error,
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
