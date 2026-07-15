import "@tanstack/react-start/server-only";

import { isBlastRecipientAllowed, sendWoztellResponse, woztellEnabled } from "./woztell.server.ts";

type CampaignRecipient = {
  id: string;
  normalized_phone: string | null;
  whatsapp_member_id: string | null;
  opt_in_whatsapp: boolean | null;
  opted_out_whatsapp: boolean | null;
  element_name: string;
  language_code: string | null;
  components: unknown;
};

export type WoztellCampaignDeliverySummary = {
  sent: number;
  blocked: number;
  failed: number;
  checked: number;
};

function deliveryError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function claimCampaignRecipients(campaignId: string) {
  const { queryRows } = await import("../neon/db.server.ts");
  return queryRows<CampaignRecipient>(
    `WITH claimed AS (
       SELECT recipient.id
       FROM whatsapp_campaign_recipients recipient
       INNER JOIN whatsapp_campaigns campaign ON campaign.id = recipient.campaign_id
       WHERE recipient.campaign_id = $1::uuid
         AND (
           recipient.status = 'queued'
           OR (
             recipient.status = 'sending'
             AND COALESCE(recipient.queued_at, 'epoch'::timestamptz)
               < now() - interval '15 minutes'
           )
         )
         AND campaign.status IN ('queued', 'sending')
       ORDER BY recipient.queued_at ASC NULLS FIRST, recipient.id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 20
     )
     UPDATE whatsapp_campaign_recipients AS recipient
     SET status = 'sending', queued_at = now(), error = NULL
     FROM claimed, whatsapp_campaigns campaign, whatsapp_templates template, crm_contacts contact
     WHERE recipient.id = claimed.id
       AND campaign.id = recipient.campaign_id
       AND template.id = campaign.template_id
       AND contact.id = recipient.contact_id
     RETURNING
       recipient.id,
       contact.normalized_phone,
       contact.whatsapp_member_id,
       contact.opt_in_whatsapp,
       contact.opted_out_whatsapp,
       template.element_name,
       template.language_code,
       template.components`,
    [campaignId],
  );
}

async function updateCampaignRecipient(
  recipientId: string,
  status: "queued" | "sent" | "failed" | "blocked",
  errorCode: string | null,
) {
  const { queryRows } = await import("../neon/db.server.ts");
  await queryRows(
    `UPDATE whatsapp_campaign_recipients
     SET status = $1,
         sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END,
         error = $2
     WHERE id = $3::uuid AND status = 'sending'`,
    [status, errorCode, recipientId],
  );
}

async function refreshCampaignDeliveryStatus(campaignId: string) {
  const [{ queryRows }, { classifyCampaignDeliveryStatus }] = await Promise.all([
    import("../neon/db.server.ts"),
    import("../neon/admin-workflow.ts"),
  ]);
  const rows = await queryRows<{
    total_recipients: number;
    queued_recipients: number;
    sending_recipients: number;
    failed_recipients: number;
    blocked_recipients: number;
  }>(
    `SELECT
       count(*)::int AS total_recipients,
       count(*) FILTER (WHERE status = 'queued')::int AS queued_recipients,
       count(*) FILTER (WHERE status = 'sending')::int AS sending_recipients,
       count(*) FILTER (WHERE status = 'failed')::int AS failed_recipients,
       count(*) FILTER (WHERE status = 'blocked')::int AS blocked_recipients
     FROM whatsapp_campaign_recipients
     WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  const stats = rows[0];
  if (!stats) return;
  const nextStatus = classifyCampaignDeliveryStatus({
    queuedRecipients: Number(stats.queued_recipients ?? 0),
    sendingRecipients: Number(stats.sending_recipients ?? 0),
    totalRecipients: Number(stats.total_recipients ?? 0),
    failedRecipients: Number(stats.failed_recipients ?? 0),
    blockedRecipients: Number(stats.blocked_recipients ?? 0),
  });
  if (!nextStatus) return;
  await queryRows(
    `UPDATE whatsapp_campaigns
     SET status = $1::whatsapp_campaign_status, updated_at = now()
     WHERE id = $2::uuid AND status IN ('queued', 'sending')`,
    [nextStatus, campaignId],
  );
}

function providerFailureCode(result: { ok: boolean; status?: number }) {
  if (result.status === 408 || result.status === 429) return "WOZTELL_PROVIDER_TIMEOUT";
  if (result.status && result.status >= 500) return "WOZTELL_PROVIDER_UNAVAILABLE";
  if (!result.status) return "WOZTELL_CONFIGURATION_UNAVAILABLE";
  return "WOZTELL_PROVIDER_REJECTED";
}

async function deliverCampaignRecipient(recipient: CampaignRecipient) {
  if (
    !isBlastRecipientAllowed({
      optedIn: recipient.opt_in_whatsapp === true,
      optedOut: recipient.opted_out_whatsapp === true,
    })
  ) {
    await updateCampaignRecipient(recipient.id, "blocked", "WOZTELL_RECIPIENT_NOT_OPTED_IN");
    return "blocked" as const;
  }

  const memberId = recipient.whatsapp_member_id ?? recipient.normalized_phone;
  if (!memberId) {
    await updateCampaignRecipient(recipient.id, "failed", "WOZTELL_RECIPIENT_MISSING");
    return "failed" as const;
  }

  let result: Awaited<ReturnType<typeof sendWoztellResponse>>;
  try {
    result = await sendWoztellResponse({
      memberId: String(memberId),
      response: [
        {
          type: "TEMPLATE",
          elementName: recipient.element_name,
          languageCode: recipient.language_code || "zh_HK",
          ...(Array.isArray(recipient.components) && recipient.components.length > 0
            ? { components: recipient.components }
            : {}),
        },
      ],
    });
  } catch (error) {
    await updateCampaignRecipient(recipient.id, "queued", "WOZTELL_PROVIDER_TIMEOUT");
    if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
      throw deliveryError("WOZTELL_PROVIDER_TIMEOUT", "WozTell request timed out.");
    }
    throw deliveryError("WOZTELL_PROVIDER_UNAVAILABLE", "WozTell request failed.");
  }

  if (result.ok) {
    await updateCampaignRecipient(recipient.id, "sent", null);
    return "sent" as const;
  }

  const code = providerFailureCode(result);
  if (code !== "WOZTELL_PROVIDER_REJECTED") {
    await updateCampaignRecipient(recipient.id, "queued", code);
    throw deliveryError(code, "WozTell provider is temporarily unavailable.");
  }
  await updateCampaignRecipient(recipient.id, "failed", code);
  return "failed" as const;
}

export async function deliverWoztellCampaign(
  campaignId: string,
): Promise<WoztellCampaignDeliverySummary> {
  if (!woztellEnabled()) {
    throw deliveryError("WOZTELL_CONFIGURATION_UNAVAILABLE", "WozTell delivery is disabled.");
  }
  const summary: WoztellCampaignDeliverySummary = {
    sent: 0,
    blocked: 0,
    failed: 0,
    checked: 0,
  };
  let exhausted = true;

  try {
    for (let batch = 0; batch < 100; batch += 1) {
      const recipients = await claimCampaignRecipients(campaignId);
      if (recipients.length === 0) {
        exhausted = false;
        break;
      }
      for (const recipient of recipients) {
        const outcome = await deliverCampaignRecipient(recipient);
        summary[outcome] += 1;
        summary.checked += 1;
      }
    }
    if (exhausted) {
      throw deliveryError(
        "WOZTELL_DELIVERY_INCOMPLETE",
        "WozTell campaign delivery exceeded one worker run.",
      );
    }
    return summary;
  } finally {
    await refreshCampaignDeliveryStatus(campaignId);
  }
}
