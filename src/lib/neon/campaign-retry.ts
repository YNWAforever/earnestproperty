// Shared codes and SQL predicates for campaign retry (FX-10b). Pure: no
// server-only import, so node --test can load it and both the delivery worker
// and the admin data layer can share one definition.
import { campaignRecipientPrimarySql, marketingIdentitySafeSql } from "./phone-identity.ts";

/**
 * Failed rows that provably never reached WhatsApp. Order is irrelevant.
 *
 * WOZTELL_DELIVERY_UNKNOWN is deliberately absent: the provider may already
 * have delivered (and billed) that message, so re-sending it would double-send.
 */
export const CAMPAIGN_RETRYABLE_FAILURE_CODES = [
  "WOZTELL_PROVIDER_REJECTED",
  "WOZTELL_DELIVERY_ATTEMPTS_EXHAUSTED",
] as const;

export const CAMPAIGN_PAUSED_ERROR = "WOZTELL_CAMPAIGN_PAUSED";
export const CAMPAIGN_DELIVERY_UNKNOWN = "WOZTELL_DELIVERY_UNKNOWN";

const SQL_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sqlAlias(alias: string): string {
  if (!SQL_ALIAS.test(alias)) throw new Error(`Invalid SQL alias: ${JSON.stringify(alias)}`);
  return alias;
}

// The codes are compile-time constants matching /^[A-Z_]+$/, so inlining them
// as literals is safe; no caller-supplied value ever reaches this string.
const retryableCodeList = CAMPAIGN_RETRYABLE_FAILURE_CODES.map((code) => `'${code}'`).join(", ");

/** `<r>.status='failed' AND <r>.dispatch_started_at IS NULL AND <r>.error IN (<codes>)`. */
export function retryableFailedRecipientSql(recipientAlias: string): string {
  const r = sqlAlias(recipientAlias);
  return `(${r}.status = 'failed' AND ${r}.dispatch_started_at IS NULL AND ${r}.error IN (${retryableCodeList}))`;
}

/** EXISTS(any row of <c>.id with dispatch_started_at set, status IN ('sent','sending','failed'), or error UNKNOWN). */
export function campaignHasDeliveryHistorySql(campaignAlias: string): string {
  const c = sqlAlias(campaignAlias);
  return `EXISTS (SELECT 1 FROM whatsapp_campaign_recipients history
    WHERE history.campaign_id = ${c}.id
      AND (history.dispatch_started_at IS NOT NULL
        OR history.status IN ('sent', 'sending', 'failed')
        OR history.error = '${CAMPAIGN_DELIVERY_UNKNOWN}'))`;
}

/** Campaign statuses from which failed recipients may be re-queued. */
export const CAMPAIGN_RETRY_STATUSES = ["failed", "completed", "review"] as const;
const retryStatusList = CAMPAIGN_RETRY_STATUSES.map((status) => `'${status}'`).join(", ");

/** `<c>.status` allows a retry (failed, completed or review). */
export function campaignRetryStatusSql(campaignAlias: string): string {
  return `(${sqlAlias(campaignAlias)}.status IN (${retryStatusList}))`;
}

/**
 * Consent and identity as queueAdminCampaign and beginCampaignDispatch check
 * them. FX-08 (#228) adds opt-out evidence columns; its rebase may extend this.
 */
export function campaignRetryConsentSql(contactAlias: string): string {
  const k = sqlAlias(contactAlias);
  return `(${k}.opt_in_whatsapp = true
    AND ${k}.opted_out_whatsapp = false
    AND NULLIF(${k}.normalized_phone, '') IS NOT NULL
    AND ${marketingIdentitySafeSql(k)})`;
}

// FX-10b controller ruling I2: a re-send goes only to the number the refused
// attempt used. The recipient row stores no phone or member snapshot, so the
// conservative test is time-based: the contact must not have been updated
// since that attempt was claimed (r.queued_at, set by the claim). A row with no
// claim time is treated as changed. Any contact update (consent toggle,
// inbound message, live-agent phone correction) therefore excludes the row.
export const CAMPAIGN_RETRY_CONTACT_CHANGED = "CONTACT_CHANGED_SINCE_ATTEMPT";
export function campaignRetryContactUnchangedSql(recipientAlias: string, contactAlias: string) {
  const r = sqlAlias(recipientAlias);
  const k = sqlAlias(contactAlias);
  return `(${r}.queued_at IS NOT NULL AND ${k}.updated_at <= ${r}.queued_at)`;
}

/**
 * The one definition of "a failed row the re-queue would move" (status and
 * busy aside): retry-safe failure, consent and identity now, contact unchanged
 * since the attempt, and the primary row for its phone. The campaign list's
 * 「重新發送失敗收件人（N）」, the retry preview and the re-queue all use it.
 */
export function campaignRetryEligibleSql(recipientAlias: string, contactAlias: string): string {
  return `(${retryableFailedRecipientSql(recipientAlias)}
    AND ${campaignRetryConsentSql(contactAlias)}
    AND ${campaignRetryContactUnchangedSql(recipientAlias, contactAlias)}
    AND ${campaignRecipientPrimarySql(recipientAlias, contactAlias)})`;
}

/**
 * A queued row that delivery would still dispatch: never dispatched, consent
 * and identity now, and the primary row for its phone (the checks
 * beginCampaignDispatch re-applies). The preview's alreadyQueued and the
 * 發送… count for a campaign with history both use it.
 */
export function campaignDispatchableQueuedSql(recipientAlias: string, contactAlias: string) {
  const r = sqlAlias(recipientAlias);
  return `(${r}.status = 'queued' AND ${r}.dispatch_started_at IS NULL
    AND ${campaignRetryConsentSql(contactAlias)}
    AND ${campaignRecipientPrimarySql(r, contactAlias)})`;
}

/**
 * True while a recipient of the campaign is on the wire or a delivery job
 * holds a live lease on it; a late result must land before a retry.
 * `campaignIdSql` is a bound uuid parameter (`$1::uuid`) or `<alias>.id`.
 */
export function campaignRetryBusySql(campaignIdSql: string): string {
  if (!/^(\$[0-9]+::uuid|[A-Za-z_][A-Za-z0-9_]*\.id)$/.test(campaignIdSql)) {
    throw new Error(`Invalid campaign id SQL: ${JSON.stringify(campaignIdSql)}`);
  }
  return `(EXISTS (
    SELECT 1 FROM whatsapp_campaign_recipients busy_row
    WHERE busy_row.campaign_id = ${campaignIdSql} AND busy_row.status = 'sending'
  ) OR EXISTS (
    SELECT 1 FROM ops_jobs busy_job
    WHERE busy_job.job_type = 'woztell.campaign.deliver'
      AND busy_job.payload->>'campaignId' = (${campaignIdSql})::text
      AND busy_job.status = 'running' AND busy_job.lease_expires_at > clock_timestamp()
  ))`;
}
