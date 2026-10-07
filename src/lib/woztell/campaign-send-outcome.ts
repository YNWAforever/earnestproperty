// One classifier for every campaign send result (FX-10b). Pure: no
// server-only import, so node --test can load it directly.
//
// The governing rule is "never double-send": any answer that shows the
// provider MAY have accepted the message is `unknown`, which is terminal and
// never re-sent. Only an answer that proves nothing left the building is
// `failed` (retry-safe), and only a refusal that will hit every recipient
// (auth, channel, configuration) is `stop`.

export type CampaignStopReason =
  | "WOZTELL_CONFIGURATION_UNAVAILABLE" // no HTTP status: disabled / missing token or channel / scope mismatch
  | "WOZTELL_AUTH_REJECTED" // 401, 403, or an ok:0 refusal naming auth or the channel
  | "WOZTELL_PROVIDER_UNSTABLE"; // breaker: N consecutive unknown outcomes

export type CampaignSendOutcome =
  | { kind: "sent" }
  | { kind: "failed"; code: "WOZTELL_PROVIDER_REJECTED" } // retry-safe
  | {
      kind: "unknown";
      code: "WOZTELL_DELIVERY_UNKNOWN"; // terminal
      // Set only for an unreadable 401/403: the recipient stays unknown, but the
      // refusal is systemic, so the run stops at once as an auth stop.
      halt?: { reason: "WOZTELL_AUTH_REJECTED"; providerStatus: number };
    }
  | {
      kind: "stop";
      reason: Exclude<CampaignStopReason, "WOZTELL_PROVIDER_UNSTABLE">;
      providerStatus: number | null;
    };

/** Consecutive unconfirmed outcomes that trip the provider-outage breaker. */
export const CAMPAIGN_UNKNOWN_STREAK_LIMIT = 3;

/** Matches the reason text of a systemic refusal. Case-insensitive. */
export const SYSTEMIC_REFUSAL_PATTERN =
  /not authori[sz]ed|access ?token|channel id not found|WOZTELL_112\b/i;

const UNKNOWN: CampaignSendOutcome = { kind: "unknown", code: "WOZTELL_DELIVERY_UNKNOWN" };
const FAILED: CampaignSendOutcome = { kind: "failed", code: "WOZTELL_PROVIDER_REJECTED" };

// Statuses where the provider refused the request outright. 401/403 are
// handled earlier as a systemic stop; 429 stays per-recipient and retryable.
const PER_RECIPIENT_REFUSAL_STATUSES = [400, 404, 422, 429];

/**
 * First match wins. The order is load-bearing:
 * acceptance evidence (3) is checked before any status or refusal rule, so a
 * 4xx or ok:0 whose body still carries a message id can never be filed as
 * retry-safe.
 *
 * Thrown sends (timeout, network) are not classified here: the caller treats
 * them as `unknown`.
 */
export function classifyCampaignSendResult(result: {
  ok: boolean;
  status?: number;
  refused?: boolean;
  error?: string;
  providerResult?: { possibleAccepted?: boolean };
  bodyUnreadable?: boolean;
}): CampaignSendOutcome {
  // 1. WOZTELL confirmed the send.
  if (result.ok) return { kind: "sent" };
  // 2. No HTTP exchange happened: disabled, missing token/channel, or a
  //    channel-scope mismatch caught before the request. Nothing was sent.
  if (result.status === undefined) {
    return { kind: "stop", reason: "WOZTELL_CONFIGURATION_UNAVAILABLE", providerStatus: null };
  }
  // 2b. The provider answered, but its body could not be read or parsed (a
  //     gateway HTML page, empty or truncated JSON). Nothing in it proves the
  //     message was refused, so it is never retry-safe -- whatever the status,
  //     4xx and 429 included (FX-10b controller ruling I1).
  //     An unreadable 401/403 is still unknown for this recipient, but it is
  //     a systemic refusal: halt the run now instead of spending two more
  //     recipients on the breaker (FX-10b fix round 1 ruling).
  if (result.bodyUnreadable === true) {
    if (result.status === 401 || result.status === 403) {
      return {
        kind: "unknown",
        code: "WOZTELL_DELIVERY_UNKNOWN",
        halt: { reason: "WOZTELL_AUTH_REJECTED", providerStatus: result.status },
      };
    }
    return UNKNOWN;
  }
  // 3. Any sign the provider may have accepted the message (Fact 15).
  if (result.providerResult?.possibleAccepted === true) return UNKNOWN;
  // 4. Credentials rejected: every later recipient would fail the same way.
  if (result.status === 401 || result.status === 403) {
    return { kind: "stop", reason: "WOZTELL_AUTH_REJECTED", providerStatus: result.status };
  }
  // 5. An ok:0 refusal whose reason names auth or the channel is systemic too.
  if (result.refused === true && SYSTEMIC_REFUSAL_PATTERN.test(result.error ?? "")) {
    return { kind: "stop", reason: "WOZTELL_AUTH_REJECTED", providerStatus: result.status };
  }
  // 6. A per-recipient refusal: provably not sent, safe to retry.
  if (result.refused === true || PER_RECIPIENT_REFUSAL_STATUSES.includes(result.status)) {
    return FAILED;
  }
  // 7. Everything else may have gone through.
  return UNKNOWN;
}

/** unknown/thrown -> previous + 1; sent/failed -> 0; stop -> previous. */
export function nextUnknownStreak(
  previous: number,
  outcome: CampaignSendOutcome["kind"] | "thrown",
): number {
  switch (outcome) {
    case "unknown":
    case "thrown":
      return previous + 1;
    case "sent":
    case "failed":
      return 0;
    case "stop":
      return previous;
  }
}
