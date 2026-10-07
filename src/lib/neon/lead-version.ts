/**
 * Optimistic-concurrency token for a CRM lead (FX-09).
 *
 * The version is crm_leads.updated_at rendered by Postgres as an exact UTC
 * microsecond string. It is generated, compared (under FOR UPDATE) and returned
 * by the same SQL expression, so it never passes through a JS Date: a Date keeps
 * milliseconds only, and a token rounded through one would never match again
 * (the FX-05b self-409). Callers treat it as opaque and compare it as a string.
 *
 * Pure module with no server-only import, so the client and the browser fixture
 * can share the constants.
 */

/** Exact UTC microsecond token, e.g. "2026-10-06T03:04:05.123456Z". Opaque: compare as a string only. */
export const LEAD_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** `to_char(<alias>.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. alias must match /^[a-z_]+$/ or it throws. */
export function leadVersionSql(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("leadVersionSql: unsafe alias");
  return `to_char(${alias}.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function isLeadVersion(value: unknown): value is string {
  return typeof value === "string" && LEAD_VERSION_PATTERN.test(value);
}

/** 409 body: another colleague saved this lead since it was read. */
export const LEAD_CHANGED = "LEAD_CHANGED";
/** 400 body: the save carried no valid version (e.g. a pre-deploy bundle). */
export const LEAD_VERSION_REQUIRED = "LEAD_VERSION_REQUIRED";
/** 400 body: the save would newly assign the lead to deactivated staff. */
export const ASSIGNEE_INACTIVE = "ASSIGNEE_INACTIVE";
