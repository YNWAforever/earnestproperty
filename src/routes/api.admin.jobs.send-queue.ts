import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { queryRows } from "@/lib/neon/db.server";
import {
  isBlastRecipientAllowed,
  sendWoztellResponse,
  woztellEnabled,
} from "@/lib/woztell/woztell.server";

export const Route = createFileRoute("/api/admin/jobs/send-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET;
        const actual = request.headers.get("authorization");
        if (!expected || actual !== `Bearer ${expected}`) {
          return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
        }
        if (!woztellEnabled()) {
          return Response.json({ ok: true, sent: 0, skipped: "Woztell disabled" });
        }

        const recipients = await queryRows(
          `
          SELECT
            r.id,
            c.normalized_phone,
            c.opt_in_whatsapp,
            c.opted_out_whatsapp,
            t.element_name,
            t.language_code
          FROM whatsapp_campaign_recipients r
          INNER JOIN whatsapp_campaigns campaign ON campaign.id = r.campaign_id
          INNER JOIN whatsapp_templates t ON t.id = campaign.template_id
          INNER JOIN crm_contacts c ON c.id = r.contact_id
          WHERE r.status = 'queued'
            AND campaign.status IN ('queued', 'sending')
          ORDER BY r.queued_at ASC NULLS FIRST, r.id ASC
          LIMIT 20
          `,
        );

        let sent = 0;
        for (const recipient of recipients) {
          if (
            !isBlastRecipientAllowed({
              optedIn: recipient.opt_in_whatsapp === true,
              optedOut: recipient.opted_out_whatsapp === true,
            })
          ) {
            await queryRows(
              "UPDATE whatsapp_campaign_recipients SET status = 'blocked', error = 'Recipient not opted in' WHERE id = $1",
              [recipient.id],
            );
            continue;
          }

          const result = await sendWoztellResponse({
            recipientId: String(recipient.normalized_phone),
            response: [
              {
                type: "TEMPLATE",
                elementName: recipient.element_name,
                languageCode: recipient.language_code || "zh_HK",
              },
            ],
          });

          await queryRows(
            "UPDATE whatsapp_campaign_recipients SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END, error = $2 WHERE id = $3",
            [result.ok ? "sent" : "failed", result.ok ? null : result.error, recipient.id],
          );
          if (result.ok) sent += 1;
        }

        return Response.json({ ok: true, sent, checked: recipients.length });
      },
    },
  },
});
