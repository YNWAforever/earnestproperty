/**
 * Classifies the WhatsApp tracking-link coverage of the listings on one page and
 * decides what (if anything) to log.
 *
 * ## Why this is not just `if (gaps.length) console.warn(...)`
 *
 * The previous version warned once per property page render for every listing
 * without exactly one usable `website:primary` tracking link. Production has
 * **zero** provisioned website tracking links (3 links exist in total, and none
 * matches `placement_source='website'` + `entry_point_type='sales'`), so all 629
 * canonical listings miss, and every property page view emitted:
 *
 *     WA_TRACKING_LINK_GAP [{"propertyId":"…","candidates":0}]
 *
 * That is a configuration state, not an anomaly, and at production traffic it
 * buries real warnings. The three states below are genuinely different and are
 * now logged differently:
 *
 *   1. UNPROVISIONED — no listing on the page has a link. Nothing is broken;
 *      tracking has never been set up. Log at most once per interval.
 *   2. GAP — some listings have a link and some do not. That IS an anomaly: a
 *      listing lost its link, or a batch import half-succeeded. Always log.
 *   3. AMBIGUOUS — a listing has more than one candidate. The link that gets
 *      used is arbitrary. Always log; it is a data-integrity problem.
 *
 * Authored as plain JS with a `.d.mts` sibling so `node --test` imports it with
 * no build step, matching `whatsapp-coverage-query.mjs`.
 */

/** At most one "unprovisioned" line per interval, per server instance. */
export const UNPROVISIONED_LOG_INTERVAL_MS = 10 * 60 * 1000;

/** Keep a single log line bounded; the ids are for sampling, not accounting. */
export const GAP_SAMPLE_LIMIT = 50;

/**
 * @param {ReadonlyArray<{ propertyId: string; candidateCount: number; code?: string | null }>} candidates
 * @returns {{
 *   total: number;
 *   missing: Array<{ propertyId: string; candidateCount: number }>;
 *   ambiguous: Array<{ propertyId: string; candidateCount: number }>;
 *   unprovisioned: boolean;
 * }}
 */
export function classifyTrackingGaps(candidates) {
  const missing = [];
  const ambiguous = [];
  for (const candidate of candidates) {
    const count = Number(candidate.candidateCount);
    if (count === 0) missing.push({ propertyId: candidate.propertyId, candidateCount: count });
    else if (count > 1) ambiguous.push({ propertyId: candidate.propertyId, candidateCount: count });
  }
  const total = candidates.length;
  return {
    total,
    missing,
    ambiguous,
    // Every listing missing and nothing ambiguous: tracking has not been set up.
    // A single ambiguous candidate means something IS provisioned, so it is a
    // real gap rather than an unconfigured site.
    unprovisioned: total > 0 && missing.length === total && ambiguous.length === 0,
  };
}

/**
 * @param {ReturnType<typeof classifyTrackingGaps>} classification
 * @returns {Array<{ code: string; throttled: boolean; payload: Record<string, unknown> }>}
 */
export function trackingGapLogEntries({ total, missing, ambiguous, unprovisioned }) {
  /** @type {Array<{ code: string; throttled: boolean; payload: Record<string, unknown> }>} */
  const entries = [];
  if (ambiguous.length)
    entries.push({
      code: "WA_TRACKING_LINK_AMBIGUOUS",
      throttled: false,
      payload: {
        ambiguous: ambiguous.slice(0, GAP_SAMPLE_LIMIT),
        note: "more than one usable website:primary tracking link; the one used is arbitrary",
      },
    });
  if (missing.length && unprovisioned)
    entries.push({
      code: "WA_TRACKING_LINKS_UNPROVISIONED",
      throttled: true,
      payload: {
        listings: total,
        note: "no website:primary tracking link is provisioned; every listing falls back to the untracked company link",
      },
    });
  else if (missing.length)
    entries.push({
      code: "WA_TRACKING_LINK_GAP",
      throttled: false,
      payload: {
        gaps: missing.slice(0, GAP_SAMPLE_LIMIT),
        covered: total - missing.length,
        note: "some listings have a usable tracking link and some do not; a link was lost or a batch import half-succeeded",
      },
    });
  return entries;
}

/**
 * True when the throttled "unprovisioned" line is allowed to be written again.
 * `lastLoggedAt` of 0 means it has never been written on this instance.
 *
 * @param {number} now
 * @param {number} lastLoggedAt
 * @param {number} [intervalMs]
 * @returns {boolean}
 */
export function unprovisionedLogDue(now, lastLoggedAt, intervalMs = UNPROVISIONED_LOG_INTERVAL_MS) {
  if (!lastLoggedAt) return true;
  return now - lastLoggedAt >= intervalMs;
}
