/**
 * Default lead assignee for public website enquiries (Phase 2.5 of
 * `docs/runbooks/whatsapp-sales-followup-go-live.md`).
 *
 * Today a website enquiry is assigned only when the visitor picked a
 * correspondent agent or the active listing's own agent is an active staff
 * member. Every other case — the contact page, an estate/district page, and any
 * listing whose agent row is missing or inactive — inserts `crm_leads` and
 * `inquiries` with `assigned_agent_id = NULL`, so nobody owns the follow-up.
 * Production on 2026-11-24: 7 of 7 website leads in the last 30 days were
 * unassigned.
 *
 * This module is the pure half: it reads one optional staff UUID from the
 * server environment and decides the assignment in the same priority order the
 * intake SQL uses, so the tested projection and the statement cannot drift.
 *
 * Design rules (deliberate, keep them):
 * - Unset or malformed configuration is inert. No env var, no error, no
 *   behaviour change: the intake statement keeps the exact parameter list it
 *   had before this module existed, so a merge cannot change routing by itself.
 * - A configured staff member who is inactive (or no longer exists) is ignored.
 *   Only the intake SQL's `AND d.active = true` guard decides that; this module
 *   never claims a staff row is active.
 * - The visitor's explicit choice still wins. This is a fallback, not a
 *   re-routing: a lead must never be moved away from the colleague a buyer
 *   picked, or from the listing's own agent.
 */

/** Server-only. Never exposed to the browser bundle. */
export const LEAD_DEFAULT_ASSIGNEE_ENV = "EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID";

// Same shape the intake statement accepts for a visitor-chosen agent: any
// canonical Postgres uuid, not only the v1-v5 forms.
const STAFF_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trim and validate a configured staff id. Anything that is not a canonical
 * UUID is treated as "not configured" rather than as an error: a typo in an env
 * var must not take the public enquiry form down.
 */
export function parseDefaultLeadAssignee(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return STAFF_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** Read the fallback staff id from the environment (server only). */
export function readDefaultLeadAssignee(env = globalThis.process?.env) {
  if (!env || typeof env !== "object") return null;
  // Read through the literal name as well: scripts/check-required-env.test.mjs
  // scans for env reads and fails when a documented variable is not read anywhere
  // by that shape.
  return parseDefaultLeadAssignee(
    env.EP_LEAD_DEFAULT_ASSIGNEE_STAFF_ID ?? env[LEAD_DEFAULT_ASSIGNEE_ENV],
  );
}

/**
 * The "copy" destination every lead alert should also reach.
 *
 * Willy, 2026-11-24: the copy goes to 張秋 on 85297987774. It lives in the
 * environment, not in the repository, so a personal number stays a deployment
 * setting instead of a published constant.
 *
 * Note for whoever wires the send: 張秋's own `staff_users.phone`/`whatsapp` is
 * 92786562, so 85297987774 is a second (office) line rather than his personal
 * number. The two are deliberately not assumed to be the same.
 */
export const LEAD_COPY_PHONE_ENV = "EP_LEAD_COPY_PHONE";

/** Hong Kong mobile: 8 local digits, or 852 + 8 digits, digits only. */
const COPY_PHONE_PATTERN = /^(?:852)?([2-9]\d{7})$/;

/**
 * Normalise the copy destination to the company-prefixed digits the notification
 * plan stores. Returns null when unset or not a Hong Kong number, so a typo can
 * never route an alert to a stranger.
 */
export function parseLeadCopyPhone(value) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  const match = COPY_PHONE_PATTERN.exec(digits);
  return match ? `852${match[1]}` : null;
}

/** Read the copy destination from the environment (server only). */
export function readLeadCopyPhone(env = globalThis.process?.env) {
  if (!env || typeof env !== "object") return null;
  return parseLeadCopyPhone(env.EP_LEAD_COPY_PHONE ?? env[LEAD_COPY_PHONE_ENV]);
}

/**
 * The assignment decision for one enquiry.
 *
 * Priority: visitor's chosen correspondent agent > the 負責經紀 shown on the
 * listing page (`property_agents`) > the listing's own `properties.agent_id` when
 * that staff row is active > the configured default assignee. Returns null when
 * none applies, which is what the intake SQL inserts in that case.
 *
 * `properties.agent_id` is the weakest listing-level source: production on
 * 2026-11-24 had it set on 0 of 836 active property rows, while 781 of them had
 * an active correspondent agent.
 */
export function resolveAssignedAgentId({
  chosenAgentId = null,
  correspondentAgentId = null,
  listingAgentId = null,
  listingAgentActive = false,
  defaultAssigneeId = null,
} = {}) {
  if (chosenAgentId) return chosenAgentId;
  if (correspondentAgentId) return correspondentAgentId;
  if (listingAgentActive && listingAgentId) return listingAgentId;
  return defaultAssigneeId ?? null;
}
