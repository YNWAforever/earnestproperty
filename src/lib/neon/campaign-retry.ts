// Shared codes and SQL predicates for campaign retry (FX-10b). Pure: no
// server-only import, so node --test can load it and both the delivery worker
// and the admin data layer can share one definition.

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
