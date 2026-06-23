import "@tanstack/react-start/server-only";

import { createFileRoute } from "@tanstack/react-router";

import { classifyCampaignDeliveryStatus } from "@/lib/neon/admin-workflow";
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
          return Response.json({
            ok: true,
            sent: 0,
            checked: 0,
            blocked: 0,
            failed: 0,
            skipped: "Woztell disabled",
          });
        }

        const recipients = await claimQueuedCampaignRecipients();

        let sent = 0;
        let blocked = 0;
        let failed = 0;
        const campaignIds = new Set<string>();

        try {
          for (const recipient of recipients) {
            campaignIds.add(String(recipient.campaign_id));

            if (
              !isBlastRecipientAllowed({
                optedIn: recipient.opt_in_whatsapp === true,
                optedOut: recipient.opted_out_whatsapp === true,
              })
            ) {
              await queryRows(
                "UPDATE whatsapp_campaign_recipients SET status = 'blocked', error = 'Recipient not opted in' WHERE id = $1 AND status = 'sending'",
                [recipient.id],
              );
              blocked += 1;
              continue;
            }

            const result = await sendCampaignRecipient(recipient);
            await queryRows(
              "UPDATE whatsapp_campaign_recipients SET status = $1, sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END, error = $2 WHERE id = $3 AND status = 'sending'",
              [result.ok ? "sent" : "failed", result.ok ? null : result.error, recipient.id],
            );
            if (result.ok) sent += 1;
            else failed += 1;
          }
        } finally {
          await refreshTouchedCampaignStatuses(Array.from(campaignIds));
        }

        return Response.json({ ok: true, sent, checked: recipients.length, blocked, failed });
      },
    },
  },
});

async function claimQueuedCampaignRecipients() {
  // queued_at doubles as the send lease timestamp; stale sending rows can be reclaimed.
  return queryRows<{
    id: string;
    campaign_id: string;
    normalized_phone: string | null;
    opt_in_whatsapp: boolean | null;
    opted_out_whatsapp: boolean | null;
    element_name: string;
    language_code: string | null;
  }>(
    `
    WITH claimed AS (
      SELECT r.id
      FROM whatsapp_campaign_recipients r
      INNER JOIN whatsapp_campaigns campaign ON campaign.id = r.campaign_id
      WHERE (
          r.status = 'queued'
          OR (
            r.status = 'sending'
            AND COALESCE(r.queued_at, 'epoch'::timestamptz) < now() - interval '15 minutes'
          )
        )
        AND campaign.status IN ('queued', 'sending')
      ORDER BY r.queued_at ASC NULLS FIRST, r.id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 20
    )
    UPDATE whatsapp_campaign_recipients r
    SET status = 'sending', queued_at = now(), error = NULL
    FROM claimed, whatsapp_campaigns campaign, whatsapp_templates t, crm_contacts c
    WHERE r.id = claimed.id
      AND campaign.id = r.campaign_id
      AND t.id = campaign.template_id
      AND c.id = r.contact_id
    RETURNING
      r.id,
      r.campaign_id,
      c.normalized_phone,
      c.opt_in_whatsapp,
      c.opted_out_whatsapp,
      t.element_name,
      t.language_code
    `,
  );
}

async function sendCampaignRecipient(recipient: {
  normalized_phone: string | null;
  element_name: string;
  language_code: string | null;
}) {
  try {
    return await sendWoztellResponse({
      recipientId: String(recipient.normalized_phone),
      response: [
        {
          type: "TEMPLATE",
          elementName: recipient.element_name,
          languageCode: recipient.language_code || "zh_HK",
        },
      ],
    });
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

async function refreshTouchedCampaignStatuses(campaignIds: string[]) {
  if (!campaignIds.length) return;

  const stats = await queryRows(
    `
    SELECT
      campaign_id,
      count(*)::int AS total_recipients,
      count(*) FILTER (WHERE status = 'queued')::int AS queued_recipients,
      count(*) FILTER (WHERE status = 'sending')::int AS sending_recipients,
      count(*) FILTER (WHERE status = 'failed')::int AS failed_recipients,
      count(*) FILTER (WHERE status = 'blocked')::int AS blocked_recipients
    FROM whatsapp_campaign_recipients
    WHERE campaign_id = ANY($1::uuid[])
    GROUP BY campaign_id
    `,
    [campaignIds],
  );

  for (const stat of stats) {
    const nextStatus = classifyCampaignDeliveryStatus({
      queuedRecipients: Number(stat.queued_recipients ?? 0),
      sendingRecipients: Number(stat.sending_recipients ?? 0),
      totalRecipients: Number(stat.total_recipients ?? 0),
      failedRecipients: Number(stat.failed_recipients ?? 0),
      blockedRecipients: Number(stat.blocked_recipients ?? 0),
    });
    if (!nextStatus) continue;

    await queryRows(
      `
      UPDATE whatsapp_campaigns
      SET status = $1::whatsapp_campaign_status, updated_at = now()
      WHERE id = $2
        AND status IN ('queued', 'sending')
      `,
      [nextStatus, stat.campaign_id],
    );
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
