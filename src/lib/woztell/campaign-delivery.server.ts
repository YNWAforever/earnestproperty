import "@tanstack/react-start/server-only";
import { campaignRecipientPrimarySql, marketingIdentitySafeSql } from "../neon/phone-identity.ts";
import { normalizePhone } from "../phone.js";

import {
  CAMPAIGN_PAUSED_ERROR,
  CAMPAIGN_RETRY_CONTACT_CHANGED,
  campaignAttemptedIdentityMatchesSql,
  campaignContactIdentityDigestSql,
} from "../neon/campaign-retry.ts";
import {
  CAMPAIGN_UNKNOWN_STREAK_LIMIT,
  classifyCampaignSendResult,
  nextUnknownStreak,
  type CampaignStopReason,
} from "./campaign-send-outcome.ts";
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
  pauseCampaign?: typeof pauseCampaignDelivery;
};

function deliveryError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/**
 * Locks are followed by a fresh statement snapshot before reserving dispatch.
 *
 * FX-10b I1: a reservation stores attempted_identity, a digest of the member id
 * and phone the send goes to. A row that was attempted before (a requeued
 * refusal) is sent only if the contact still has that identity. Otherwise it is
 * blocked as CONTACT_CHANGED_SINCE_ATTEMPT, under the contact row lock, and no
 * provider call is made. A row never attempted (NULL) is checked as before.
 */
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
          ${campaignContactIdentityDigestSql("contact")} AS current_identity,
          NOT ${campaignAttemptedIdentityMatchesSql("r", "contact")} AS identity_changed,
          (c.status IN ('queued', 'sending') AND contact.opt_in_whatsapp = true
            AND contact.opted_out_whatsapp = false
            AND ${marketingIdentitySafeSql("contact")}
            AND ${campaignRecipientPrimarySql("r", "contact")}
            AND ${campaignAttemptedIdentityMatchesSql("r", "contact")}
            AND t.status LIKE 'active%'
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
            attempted_identity = CASE WHEN e.allowed THEN e.current_identity ELSE r.attempted_identity END,
            status = CASE WHEN e.allowed THEN 'sending' WHEN e.campaign_status = 'cancelled' THEN 'cancelled'
              WHEN e.campaign_status = 'review' THEN 'queued' ELSE 'blocked' END,
            error = CASE WHEN e.allowed THEN NULL
              WHEN e.campaign_status = 'cancelled' THEN 'WOZTELL_DISPATCH_INELIGIBLE'
              WHEN e.campaign_status = 'review' THEN '${CAMPAIGN_PAUSED_ERROR}'
              WHEN e.identity_changed THEN '${CAMPAIGN_RETRY_CONTACT_CHANGED}'
              ELSE 'WOZTELL_DISPATCH_INELIGIBLE' END
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
         dispatch_started_at = CASE
           WHEN $2 IN ('WOZTELL_PROVIDER_REJECTED', 'WOZTELL_CONFIGURATION_UNAVAILABLE', 'WOZTELL_AUTH_REJECTED')
           THEN NULL ELSE dispatch_started_at END,
         error = $2
     WHERE id = $3::uuid AND status = 'sending'
       AND claim_job_id = $4::uuid AND claim_worker_id = $5 AND claim_attempt = $6
       AND ($1 <> 'queued' OR dispatch_started_at IS NULL
         OR $2 IN ('WOZTELL_CONFIGURATION_UNAVAILABLE', 'WOZTELL_AUTH_REJECTED'))`,
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
 * Pauses a campaign back to review (待審核) after a systemic stop, keeping every
 * unsent recipient queued and marked WOZTELL_CAMPAIGN_PAUSED. Only the live
 * owner of the delivery job may pause: a stale worker gets {paused:false}.
 *
 * Rows already reserved for dispatch (`sending` with dispatch_started_at set)
 * are left alone, so an in-flight result is still recorded exactly once. The
 * audit carries no phone, member id or provider text.
 */
export async function pauseCampaignDelivery(
  campaignId: string,
  reason: CampaignStopReason,
  providerStatus: number | null,
  job: { jobId: string; workerId: string; attempt: number },
): Promise<{ paused: boolean; remaining: number }> {
  const { transactionRows } = await import("../neon/db.server.ts");
  const results = await transactionRows([
    {
      statement: "SELECT id FROM whatsapp_campaigns WHERE id=$1::uuid FOR UPDATE",
      params: [campaignId],
    },
    { statement: "SELECT id FROM ops_jobs WHERE id=$1::uuid FOR UPDATE", params: [job.jobId] },
    {
      statement: `WITH owner AS (
          SELECT 1 FROM ops_jobs j WHERE j.id=$2::uuid AND j.status='running'
            AND j.lease_owner=$3 AND j.attempt_count=$4 AND j.lease_expires_at>clock_timestamp()
        ), paused AS (
          UPDATE whatsapp_campaigns c SET status='review', updated_at=now()
          WHERE c.id=$1::uuid AND c.status IN ('queued','sending') AND EXISTS (SELECT 1 FROM owner)
            -- Pause only when something is left to send. Otherwise the run ends
            -- with the stop code and the normal status refresh finishes it.
            AND EXISTS (SELECT 1 FROM whatsapp_campaign_recipients w
              WHERE w.campaign_id=c.id AND (w.status='queued'
                OR (w.status='sending' AND w.dispatch_started_at IS NULL AND w.claim_job_id=$2::uuid)))
          RETURNING c.id
        ), remaining AS (
          UPDATE whatsapp_campaign_recipients r SET status='queued', error='${CAMPAIGN_PAUSED_ERROR}'
          WHERE r.campaign_id IN (SELECT id FROM paused)
            AND (r.status='queued'
              OR (r.status='sending' AND r.dispatch_started_at IS NULL AND r.claim_job_id=$2::uuid))
          RETURNING r.id
        ), audited AS (
          INSERT INTO audit_logs(action,subject_type,subject_id,metadata)
          SELECT 'campaign.paused','campaign',p.id, jsonb_build_object('reason',$5::text,
            'providerStatus',$6::int,'jobId',$2::text,'attempt',$4::int,
            'remaining',(SELECT count(*) FROM remaining))
          FROM paused p RETURNING id
        )
        SELECT (SELECT count(*) FROM paused)::int AS paused,
          (SELECT count(*) FROM remaining)::int AS remaining`,
      params: [campaignId, job.jobId, job.workerId, job.attempt, reason, providerStatus],
    },
  ]);
  const row = results[2]?.[0] as { paused?: number; remaining?: number } | undefined;
  return { paused: Number(row?.paused ?? 0) > 0, remaining: Number(row?.remaining ?? 0) };
}

type RecipientDelivery =
  | {
      result: "sent" | "blocked" | "failed";
      streak: "sent" | "failed" | "unknown" | "thrown" | null;
      halt?: { reason: "WOZTELL_AUTH_REJECTED"; providerStatus: number };
    }
  | {
      result: "stop";
      reason: Exclude<CampaignStopReason, "WOZTELL_PROVIDER_UNSTABLE">;
      providerStatus: number | null;
    };

async function deliverCampaignRecipient(
  recipient: CampaignRecipient,
  dependencies: Required<Omit<CampaignDeliveryDependencies, "job">>,
): Promise<RecipientDelivery> {
  if (
    !isBlastRecipientAllowed({
      optedIn: recipient.opt_in_whatsapp === true,
      optedOut: recipient.opted_out_whatsapp === true,
    })
  ) {
    await dependencies.updateRecipient(recipient.id, "blocked", "WOZTELL_RECIPIENT_NOT_OPTED_IN");
    return { result: "blocked", streak: null };
  }

  // FX-12 fix round 1 (I-3, D-09 for this path): without a member id, send only the
  // canonical phone. A stored legacy spelling (91234567, 0085291234567) is sent as
  // 852XXXXXXXX; a phone that does not parse is never sent raw.
  const storedMemberId =
    typeof recipient.whatsapp_member_id === "string" && recipient.whatsapp_member_id !== ""
      ? recipient.whatsapp_member_id
      : null;
  const storedPhone =
    typeof recipient.normalized_phone === "string" && recipient.normalized_phone !== ""
      ? recipient.normalized_phone
      : null;
  if (!storedMemberId && !storedPhone) {
    await dependencies.updateRecipient(recipient.id, "failed", "WOZTELL_RECIPIENT_MISSING");
    return { result: "failed", streak: null };
  }
  const memberId = storedMemberId ?? normalizePhone(storedPhone);
  if (!memberId) {
    await dependencies.updateRecipient(recipient.id, "failed", "WOZTELL_RECIPIENT_PHONE_INVALID");
    return { result: "failed", streak: null };
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
    // A thrown send (timeout, network error after the request left) may have
    // been accepted, so it is never classified as retry-safe.
    await dependencies.updateRecipient(recipient.id, "failed", "WOZTELL_DELIVERY_UNKNOWN");
    return { result: "failed", streak: "thrown" };
  }

  // WOZTELL_DELIVERY_UNKNOWN is TERMINAL: materializeCampaignRecipients refuses
  // to re-queue it, because the provider may already have delivered (and
  // billed) the message. classifyCampaignSendResult is the one place that
  // decides "provably not sent" (retry-safe) versus "possibly accepted".
  const outcome = classifyCampaignSendResult(result);
  switch (outcome.kind) {
    case "sent":
      await dependencies.updateRecipient(recipient.id, "sent", null);
      return { result: "sent", streak: "sent" };
    case "failed":
      await dependencies.updateRecipient(recipient.id, "failed", outcome.code);
      return { result: "failed", streak: "failed" };
    case "unknown":
      await dependencies.updateRecipient(recipient.id, "failed", outcome.code);
      return outcome.halt
        ? { result: "failed", streak: "unknown", halt: outcome.halt }
        : { result: "failed", streak: "unknown" };
    case "stop":
      // Provably not sent (no HTTP exchange, or an auth/channel refusal), so the
      // reservation is released and the recipient goes back to the queue.
      await dependencies.updateRecipient(recipient.id, "queued", outcome.reason);
      return { result: "stop", reason: outcome.reason, providerStatus: outcome.providerStatus };
  }
}

const STOP_MESSAGES: Record<CampaignStopReason, string> = {
  WOZTELL_CONFIGURATION_UNAVAILABLE: "WozTell configuration is unavailable.",
  WOZTELL_AUTH_REJECTED: "WozTell rejected the credentials or channel.",
  WOZTELL_PROVIDER_UNSTABLE: "WozTell returned too many unconfirmed results in a row.",
};

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
    pauseCampaign: overrides.pauseCampaign ?? pauseCampaignDelivery,
  };
  // Pauses the campaign to review and returns the error the job must fail
  // with. Without a job lease, or when the pause could not apply (the lease was
  // lost, or the campaign was cancelled meanwhile), the original stop code is
  // kept so the handler treats it exactly as before.
  const stopRun = async (reason: CampaignStopReason, providerStatus: number | null) => {
    const { paused } = overrides.job
      ? await dependencies.pauseCampaign(campaignId, reason, providerStatus, overrides.job)
      : { paused: false };
    if (!paused) return deliveryError(reason, STOP_MESSAGES[reason]);
    return Object.assign(
      deliveryError(CAMPAIGN_PAUSED_ERROR, "WozTell campaign paused for review."),
      { reason, providerStatus },
    );
  };
  if (!dependencies.isEnabled()) {
    throw await stopRun("WOZTELL_CONFIGURATION_UNAVAILABLE", null);
  }
  const summary: WoztellCampaignDeliverySummary = {
    sent: 0,
    blocked: 0,
    failed: 0,
    checked: 0,
  };
  let exhausted = true;
  let unknownStreak = 0;

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
        const requeueRest = () =>
          Promise.all(
            recipients
              .slice(index + 1)
              .map((pending) =>
                dependencies.updateRecipient(pending.id, "queued", "JOB_DELIVERY_INTERRUPTED"),
              ),
          );
        let outcome: RecipientDelivery;
        try {
          const current = await dependencies.beginDispatch(campaignId, recipient.id);
          if (!current) {
            summary.blocked += 1;
            summary.checked += 1;
            continue;
          }
          outcome = await deliverCampaignRecipient(current, dependencies);
        } catch (error) {
          await requeueRest();
          throw error;
        }
        if (outcome.result === "stop") {
          // Auth or configuration refused: every later send would fail the same
          // way. Hand the rest back to the queue first, then pause.
          await requeueRest();
          throw await stopRun(outcome.reason, outcome.providerStatus);
        }
        summary[outcome.result] += 1;
        summary.checked += 1;
        if (outcome.halt) {
          // An unreadable 401/403: this recipient stays unknown (never re-sent),
          // and the auth refusal stops the run before anyone else is tried.
          await requeueRest();
          throw await stopRun(outcome.halt.reason, outcome.halt.providerStatus);
        }
        if (outcome.streak) unknownStreak = nextUnknownStreak(unknownStreak, outcome.streak);
        if (unknownStreak >= CAMPAIGN_UNKNOWN_STREAK_LIMIT) {
          // Provider-outage breaker: stop spending recipients on answers that can
          // never be retried. The rest go back to the queue first, then pause.
          await requeueRest();
          throw await stopRun("WOZTELL_PROVIDER_UNSTABLE", null);
        }
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
