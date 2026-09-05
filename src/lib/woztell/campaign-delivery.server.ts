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
  job?: { jobId: string; workerId: string; attempt: number };
  isEnabled?: () => boolean;
  checkpoint?: () => Promise<void>;
  claimRecipients?: typeof claimCampaignRecipients;
  hasPendingRecipients?: typeof pendingCampaignRecipients;
  beginDispatch?: (campaignId: string, recipientId: string) => Promise<CampaignRecipient | null>;
  updateRecipient?: typeof updateCampaignRecipient;
  refreshStatus?: typeof refreshCampaignDeliveryStatus;
  sendResponse?: typeof sendWoztellResponse;
};

function deliveryError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/** Locks are followed by a fresh statement snapshot before reserving dispatch. */
export async function beginCampaignDispatch(
  campaignId: string,
  recipientId: string,
  job?: { jobId: string; workerId: string; attempt: number },
): Promise<CampaignRecipient | null> {
  if (!job) throw deliveryError("JOB_OWNERSHIP_LOST", "A delivery job lease is required.");
  const { transactionRows } = await import("../neon/db.server.ts");
  const results = await transactionRows([
    {
      statement: "SELECT id FROM whatsapp_campaigns WHERE id = $1::uuid FOR UPDATE",
      params: [campaignId],
    },
    {
      statement: `SELECT contact.id FROM crm_contacts contact JOIN whatsapp_campaign_recipients r
        ON r.contact_id = contact.id WHERE r.id = $1::uuid FOR UPDATE OF contact`,
      params: [recipientId],
    },
    {
      statement: `SELECT t.id FROM whatsapp_templates t JOIN whatsapp_campaigns c ON c.template_id = t.id
        WHERE c.id = $1::uuid FOR UPDATE OF t`,
      params: [campaignId],
    },
    { statement: "SELECT id FROM ops_jobs WHERE id = $1::uuid FOR UPDATE", params: [job.jobId] },
    {
      statement: `WITH eligible AS (
        SELECT r.id, c.status AS campaign_status, contact.normalized_phone, contact.whatsapp_member_id,
          contact.opt_in_whatsapp, contact.opted_out_whatsapp, t.element_name, t.language_code, t.components, j.attempt_count,
          (c.status IN ('queued', 'sending') AND contact.opt_in_whatsapp = true
            AND contact.opted_out_whatsapp = false AND t.status LIKE 'active%'
            AND COALESCE(NULLIF(contact.whatsapp_member_id, ''), NULLIF(contact.normalized_phone, '')) IS NOT NULL
            AND j.status = 'running' AND j.lease_owner = $4 AND j.lease_expires_at > clock_timestamp()) AS allowed
        FROM whatsapp_campaign_recipients r
        JOIN whatsapp_campaigns c ON c.id = r.campaign_id
        JOIN crm_contacts contact ON contact.id = r.contact_id
        LEFT JOIN whatsapp_templates t ON t.id = c.template_id
        LEFT JOIN ops_jobs j ON j.id = $3::uuid
        WHERE r.id = $2::uuid AND r.campaign_id = $1::uuid
          AND r.status = 'sending' AND r.dispatch_started_at IS NULL
          AND r.claim_job_id = $3::uuid AND r.claim_worker_id = $4 AND r.claim_attempt = j.attempt_count AND j.attempt_count = $5
      ), reserved AS (
        UPDATE whatsapp_campaign_recipients r
        SET dispatch_started_at = CASE WHEN e.allowed THEN clock_timestamp() ELSE NULL END,
            dispatch_job_id = CASE WHEN e.allowed THEN $3::uuid END, dispatch_worker_id = CASE WHEN e.allowed THEN $4 END,
            dispatch_attempt = CASE WHEN e.allowed THEN e.attempt_count END,
            status = CASE WHEN e.allowed THEN 'sending' WHEN e.campaign_status = 'cancelled' THEN 'cancelled' ELSE 'blocked' END,
            error = CASE WHEN e.allowed THEN NULL ELSE 'WOZTELL_DISPATCH_INELIGIBLE' END
        FROM eligible e WHERE r.id = e.id AND r.status = 'sending' AND r.dispatch_started_at IS NULL
        RETURNING r.id, r.dispatch_started_at
      ), audited AS (
        INSERT INTO audit_logs (action, subject_type, subject_id, metadata)
        SELECT 'campaign.dispatch', 'campaign_recipient', id, jsonb_build_object('campaignId', $1::text)
        FROM reserved WHERE dispatch_started_at IS NOT NULL RETURNING id
      ) SELECT e.* FROM eligible e JOIN reserved r ON r.id = e.id
        WHERE r.dispatch_started_at IS NOT NULL`,
      params: [campaignId, recipientId, job.jobId, job.workerId, job.attempt],
    },
  ]);
  return (results[4]?.[0] as CampaignRecipient | undefined) ?? null;
}

async function claimCampaignRecipients(
  campaignId: string,
  job?: { jobId: string; workerId: string; attempt: number },
) {
  if (!job) throw deliveryError("JOB_OWNERSHIP_LOST", "A delivery job lease is required.");
  const { transactionRows } = await import("../neon/db.server.ts");
  const results = await transactionRows([
    {
      statement: "SELECT id FROM whatsapp_campaigns WHERE id=$1::uuid FOR UPDATE",
      params: [campaignId],
    },
    {
      statement: `UPDATE whatsapp_campaign_recipients r
      SET status = 'failed', error = 'WOZTELL_DELIVERY_UNKNOWN'
      WHERE r.campaign_id=$1::uuid AND r.status='sending' AND r.dispatch_started_at IS NOT NULL
        AND (r.dispatch_job_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM ops_jobs j WHERE j.id=r.dispatch_job_id AND j.status='running'
            AND j.lease_owner=r.dispatch_worker_id AND j.attempt_count=r.dispatch_attempt
            AND j.lease_expires_at>clock_timestamp()
        ))`,
      params: [campaignId],
    },
    {
      statement: `UPDATE whatsapp_campaign_recipients r
      SET status='queued', error='UNDISPATCHED_LEASE_EXPIRED'
      WHERE r.campaign_id=$1::uuid AND r.status='sending' AND r.dispatch_started_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ops_jobs j WHERE j.id=r.claim_job_id AND j.status='running'
            AND j.lease_owner=r.claim_worker_id AND j.attempt_count=r.claim_attempt
            AND j.lease_expires_at>clock_timestamp()
        )`,
      params: [campaignId],
    },
    {
      statement: `WITH claimed AS (
       SELECT recipient.id FROM whatsapp_campaign_recipients recipient
       JOIN whatsapp_campaigns campaign ON campaign.id=recipient.campaign_id
       WHERE recipient.campaign_id=$1::uuid AND recipient.status='queued'
         AND recipient.dispatch_started_at IS NULL AND campaign.status IN ('queued', 'sending')
       ORDER BY recipient.queued_at ASC NULLS FIRST, recipient.id ASC
       FOR UPDATE OF recipient SKIP LOCKED LIMIT 20
     ) UPDATE whatsapp_campaign_recipients recipient
       SET status='sending', queued_at=now(), error=NULL,
           claim_job_id=j.id, claim_worker_id=$3, claim_attempt=j.attempt_count
       FROM claimed, whatsapp_campaigns campaign, whatsapp_templates template, crm_contacts contact, ops_jobs j
       WHERE recipient.id=claimed.id AND recipient.status='queued'
         AND campaign.id=recipient.campaign_id AND template.id=campaign.template_id AND contact.id=recipient.contact_id
         AND j.id=$2::uuid AND j.status='running' AND j.lease_owner=$3 AND j.lease_expires_at>clock_timestamp() AND j.attempt_count=$4
       RETURNING recipient.id, contact.normalized_phone, contact.whatsapp_member_id,
         contact.opt_in_whatsapp, contact.opted_out_whatsapp, template.element_name, template.language_code, template.components`,
      params: [campaignId, job.jobId, job.workerId, job.attempt],
    },
  ]);
  return results[3] as CampaignRecipient[];
}

async function pendingCampaignRecipients(campaignId: string) {
  const { queryRows } = await import("../neon/db.server.ts");
  const rows = await queryRows(
    `SELECT count(*)::int AS pending
    FROM whatsapp_campaign_recipients r JOIN whatsapp_campaigns c ON c.id=r.campaign_id
    WHERE r.campaign_id=$1::uuid AND c.status IN ('queued','sending') AND r.status IN ('queued','sending')`,
    [campaignId],
  );
  return Number(rows[0]?.pending ?? 0) > 0;
}

async function updateCampaignRecipient(
  recipientId: string,
  status: "queued" | "sent" | "failed" | "blocked",
  errorCode: string | null,
  job?: { jobId: string; workerId: string; attempt: number },
) {
  const { queryRows } = await import("../neon/db.server.ts");
  await queryRows(
    `UPDATE whatsapp_campaign_recipients
     SET status = $1,
         sent_at = CASE WHEN $1 = 'sent' THEN now() ELSE sent_at END,
         dispatch_started_at = CASE WHEN $2 IN ('WOZTELL_PROVIDER_REJECTED', 'WOZTELL_CONFIGURATION_UNAVAILABLE')
           THEN NULL ELSE dispatch_started_at END,
         error = $2
     WHERE id = $3::uuid AND status = 'sending'
       AND claim_job_id = $4::uuid AND claim_worker_id = $5 AND claim_attempt = $6
       AND ($1 <> 'queued' OR dispatch_started_at IS NULL OR $2 = 'WOZTELL_CONFIGURATION_UNAVAILABLE')`,
    [
      status,
      errorCode,
      recipientId,
      job?.jobId ?? null,
      job?.workerId ?? null,
      job?.attempt ?? null,
    ],
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

/**
 * WOZTELL_DELIVERY_UNKNOWN is now a TERMINAL state: materializeCampaignRecipients
 * refuses to re-queue a recipient carrying it, because the provider may already
 * have delivered the message and re-queueing would send (and bill) a second one.
 *
 * That makes it important not to over-apply. Only outcomes where delivery is
 * genuinely ambiguous belong here. Anything that proves the request was
 * rejected BEFORE dispatch means nothing was sent, so it stays retryable and
 * the recipient can be re-queued. Three things prove it: WOZTELL answering
 * ok:0 (`refused`), a 429 rate-limit, and the 4xx set below.
 *
 * The status alone cannot carry that distinction, which is why `refused`
 * exists: WOZTELL reports a refusal as HTTP 500, the same status a genuinely
 * ambiguous mid-flight failure produces.
 */
function providerFailureCode(result: { ok: boolean; status?: number; refused?: boolean }) {
  if (!result.status) return "WOZTELL_CONFIGURATION_UNAVAILABLE";
  // WOZTELL said ok:0 -- it refused before handing anything to the integration
  // server, so the recipient definitively did not get a message. That has to be
  // decided before the status list, because WOZTELL answers a refusal with 500
  // and would otherwise fall through to UNKNOWN, which is terminal: a single
  // wrong token scope or unknown channel id would permanently strand every
  // recipient in the blast, none of whom were ever contacted.
  if (result.refused === true) return "WOZTELL_PROVIDER_REJECTED";
  // 429: the provider refused to accept the request at all. Definitively not
  // delivered, so this must not be misfiled as ambiguous and stranded forever.
  if ([400, 401, 403, 404, 422, 429].includes(result.status)) return "WOZTELL_PROVIDER_REJECTED";
  // Anything else is genuinely ambiguous -- the send may have gone through
  // before the failure -- and stays terminal so a retry cannot bill a customer
  // for a second message.
  return "WOZTELL_DELIVERY_UNKNOWN";
}

async function deliverCampaignRecipient(
  recipient: CampaignRecipient,
  dependencies: Required<Omit<CampaignDeliveryDependencies, "job">>,
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
  const dependencies: Required<Omit<CampaignDeliveryDependencies, "job">> = {
    isEnabled: overrides.isEnabled ?? woztellEnabled,
    checkpoint: overrides.checkpoint ?? (async () => {}),
    claimRecipients:
      overrides.claimRecipients ?? ((id) => claimCampaignRecipients(id, overrides.job)),
    hasPendingRecipients: overrides.hasPendingRecipients ?? pendingCampaignRecipients,
    beginDispatch:
      overrides.beginDispatch ??
      ((id, recipientId) => beginCampaignDispatch(id, recipientId, overrides.job)),
    updateRecipient:
      overrides.updateRecipient ??
      ((id, status, code) => updateCampaignRecipient(id, status, code, overrides.job)),
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
        if (await dependencies.hasPendingRecipients(campaignId)) {
          // Another live lease owns work; defer without spending retry attempts.
          throw Object.assign(
            deliveryError("JOB_DEFERRED", "Campaign work is still owned by a live worker."),
            { runAfter: new Date(Date.now() + 60_000).toISOString() },
          );
        }
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
          const current = await dependencies.beginDispatch(campaignId, recipient.id);
          if (!current) {
            summary.blocked += 1;
            summary.checked += 1;
            continue;
          }
          outcome = await deliverCampaignRecipient(current, dependencies);
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
