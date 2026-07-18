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
type CampaignDeliveryDependencies = {
  isEnabled?: () => boolean;
  checkpoint?: () => Promise<void>;
  claimRecipients?: typeof claimCampaignRecipients;
  updateRecipient?: typeof updateCampaignRecipient;
  refreshStatus?: typeof refreshCampaignDeliveryStatus;
  sendResponse?: typeof sendWoztellResponse;
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
         AND recipient.status = 'queued'
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
  if (!result.status) return "WOZTELL_CONFIGURATION_UNAVAILABLE";
  if ([400, 401, 403, 404, 422].includes(result.status)) return "WOZTELL_PROVIDER_REJECTED";
  return "WOZTELL_DELIVERY_UNKNOWN";
}

async function deliverCampaignRecipient(
  recipient: CampaignRecipient,
  dependencies: Required<CampaignDeliveryDependencies>,
) {
  if (
    !isBlastRecipientAllowed({
      optedIn: recipient.opt_in_whatsapp === true,
      optedOut: recipient.opted_out_whatsapp === true,
    })
  ) {
    await dependencies.updateRecipient(recipient.id, "blocked", "WOZTELL_RECIPIENT_NOT_OPTED_IN");
    return "blocked" as const;
  }

  const memberId = recipient.whatsapp_member_id ?? recipient.normalized_phone;
  if (!memberId) {
    await dependencies.updateRecipient(recipient.id, "failed", "WOZTELL_RECIPIENT_MISSING");
    return "failed" as const;
  }

  let result: Awaited<ReturnType<typeof sendWoztellResponse>>;
  try {
    result = await dependencies.sendResponse({
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
  } catch {
    await dependencies.updateRecipient(recipient.id, "failed", "WOZTELL_DELIVERY_UNKNOWN");
    return "failed" as const;
  }

  if (result.ok) {
    await dependencies.updateRecipient(recipient.id, "sent", null);
    return "sent" as const;
  }

  const code = providerFailureCode(result);
  if (code === "WOZTELL_CONFIGURATION_UNAVAILABLE") {
    await dependencies.updateRecipient(recipient.id, "queued", code);
    throw deliveryError(code, "WozTell configuration is unavailable.");
  }
  await dependencies.updateRecipient(recipient.id, "failed", code);
  return "failed" as const;
}

export async function deliverWoztellCampaign(
  campaignId: string,
  overrides: CampaignDeliveryDependencies = {},
): Promise<WoztellCampaignDeliverySummary> {
  const dependencies: Required<CampaignDeliveryDependencies> = {
    isEnabled: overrides.isEnabled ?? woztellEnabled,
    checkpoint: overrides.checkpoint ?? (async () => {}),
    claimRecipients: overrides.claimRecipients ?? claimCampaignRecipients,
    updateRecipient: overrides.updateRecipient ?? updateCampaignRecipient,
    refreshStatus: overrides.refreshStatus ?? refreshCampaignDeliveryStatus,
    sendResponse: overrides.sendResponse ?? sendWoztellResponse,
  };
  if (!dependencies.isEnabled()) {
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
      await dependencies.checkpoint();
      const recipients = await dependencies.claimRecipients(campaignId);
      if (recipients.length === 0) {
        exhausted = false;
        break;
      }
      for (let index = 0; index < recipients.length; index += 1) {
        const recipient = recipients[index];
        try {
          await dependencies.checkpoint();
        } catch (error) {
          await Promise.all(
            recipients
              .slice(index)
              .map((pending) =>
                dependencies.updateRecipient(pending.id, "queued", "JOB_OWNERSHIP_LOST"),
              ),
          );
          throw error;
        }
        let outcome: Awaited<ReturnType<typeof deliverCampaignRecipient>>;
        try {
          outcome = await deliverCampaignRecipient(recipient, dependencies);
        } catch (error) {
          await Promise.all(
            recipients
              .slice(index + 1)
              .map((pending) =>
                dependencies.updateRecipient(pending.id, "queued", "JOB_DELIVERY_INTERRUPTED"),
              ),
          );
          throw error;
        }
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
    await dependencies.refreshStatus(campaignId);
  }
}
