import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { requireStaffAccess } from "@/lib/neon/auth.server";
import { queryRows } from "@/lib/neon/db.server";
import { sendWoztellResponse } from "@/lib/woztell/woztell.server";

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

        if (!body?.recipientId || !body.text?.trim()) {
          return Response.json(
            { ok: false, error: "recipientId and text are required" },
            { status: 400 },
          );
        }

        const result = await sendWoztellResponse({
          recipientId: body.recipientId,
          response: [{ type: "TEXT", text: body.text.trim() }],
        });

        await queryRows(
          `
          INSERT INTO whatsapp_messages (
            conversation_id, direction, message_type, text, sent_by, status, payload
          )
          VALUES ($1, 'outbound', 'TEXT', $2, $3, $4, $5::jsonb)
          `,
          [
            body.conversationId ?? null,
            body.text.trim(),
            staff.staffId,
            result.ok ? "sent" : "failed",
            JSON.stringify(result),
          ],
        );

        return Response.json(result.ok ? { ok: true } : result, { status: result.ok ? 200 : 503 });
      },
    },
  },
});
