export type WoztellProviderOutcome =
  | "execution_accepted"
  | "identifiable_acceptance"
  | "definitive_refusal"
  | "partial_or_unknown";

type AnyRecord = Record<string, unknown>;

export type WoztellProviderResultEvidence = {
  index: number;
  messageId: string | null;
  error: string | null;
  evidence: unknown;
};

export type ParsedWoztellProviderResult = {
  outcome: WoztellProviderOutcome;
  possibleAccepted: boolean;
  primaryMessageId: string | null;
  messageIds: string[];
  responseCount: number;
  errors: string[];
  results: WoztellProviderResultEvidence[];
  evidence: unknown;
};

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function messageId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
}

function providerError(value: unknown): string | null {
  const entry = record(value);
  const raw = entry.err ?? entry.error;
  if (raw === undefined || raw === null) return null;
  const reason = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  const code = entry.err_code ?? entry.errCode;
  return (
    code === undefined || code === null ? reason : `WOZTELL_${String(code)}: ${reason}`
  ).slice(0, 500);
}

export function parseWoztellProviderResult(
  body: unknown,
  options: { expectedResponseCount?: number } = {},
): ParsedWoztellProviderResult {
  const envelope = record(body);
  const data = record(envelope.data);
  const sendResult = record(envelope.sendResult);
  const nested = sendResult.result;
  const nestedResults = Array.isArray(nested) ? nested : [];
  const results = nestedResults.map((evidence, index) => {
    const item = record(evidence);
    return {
      index,
      messageId: messageId(record(item.messageEvent).messageId),
      error:
        providerError(item) ??
        providerError(item.messageEvent) ??
        (item.ok === 0 ? "WOZTELL_RESULT_REFUSED" : null),
      evidence,
    };
  });
  const legacyIds = [messageId(envelope.messageId), messageId(data.messageId)].filter(
    (value): value is string => value !== null,
  );
  const nestedIds = results.flatMap((result) => (result.messageId ? [result.messageId] : []));
  const messageIds = [...new Set([...legacyIds, ...nestedIds])];
  const errors = results.flatMap((result) => (result.error ? [result.error] : []));
  const outerError = providerError(envelope);
  const sendResultError =
    providerError(sendResult) ?? (sendResult.ok === 0 ? "WOZTELL_SEND_RESULT_REFUSED" : null);
  if (sendResultError) errors.unshift(sendResultError);
  if (outerError) errors.unshift(outerError);
  if (
    options.expectedResponseCount !== undefined &&
    Array.isArray(nested) &&
    nestedResults.length !== options.expectedResponseCount
  )
    errors.push("WOZTELL_RESPONSE_COUNT_MISMATCH");

  const conflictingIds =
    new Set(legacyIds).size > 1 ||
    (legacyIds.length > 0 && nestedIds.some((id) => !legacyIds.includes(id)));
  if (conflictingIds) errors.push("WOZTELL_CONFLICTING_MESSAGE_IDS");

  const refused = envelope.ok === 0;
  const accepted = envelope.ok === 1;
  const innerAccepted =
    sendResult.ok === 1 || nestedResults.some((value) => record(value).ok === 1);
  const possibleAccepted = messageIds.length > 0 || (!refused && accepted) || innerAccepted;
  const partial =
    errors.length > 0 ||
    (nestedIds.length > 0 && results.some((result) => result.messageId === null));
  let outcome: WoztellProviderOutcome = "partial_or_unknown";
  if (refused && !possibleAccepted) outcome = "definitive_refusal";
  else if (!refused && messageIds.length > 0 && !partial) outcome = "identifiable_acceptance";
  else if (accepted && !partial) outcome = "execution_accepted";

  return {
    outcome,
    possibleAccepted,
    primaryMessageId: !conflictingIds && messageIds.length === 1 ? messageIds[0] : null,
    messageIds,
    responseCount: nestedResults.length || (messageIds.length > 0 ? 1 : 0),
    errors,
    results,
    evidence: body,
  };
}

/**
 * FX-08 / D-02: HTTP statuses that mean the provider refused the request outright. With no
 * acceptance signal in the body, these are `failed` (safe to resend), not `unknown`.
 */
export const DEFINITE_REJECTION_STATUSES: readonly number[] = [400, 401, 403, 404, 422, 429];

/**
 * The outcome of one staff or service-automation send. First match wins:
 * 1. ok with an identifiable acceptance       -> accepted
 * 2. any acceptance signal at all              -> unknown (the customer may have the message)
 * 3. a preflight (configuration) failure       -> failed, WOZTELL_CONFIGURATION_UNAVAILABLE
 * 4. an explicit refusal (flag or ok:0 body)   -> failed, WOZTELL_REFUSED
 * 5. a definite-rejection HTTP status          -> failed, WOZTELL_PROVIDER_REJECTED
 * 6. anything else (5xx, timeouts, ambiguity)  -> unknown
 * A thrown send (timeout or network error) never reaches this function: the caller keeps it
 * `unknown`.
 */
export function classifyOutboundSendResult(
  result: { ok: boolean; status?: number; refused?: boolean; stage?: "preflight" },
  parsed: ParsedWoztellProviderResult,
): { state: "accepted" | "failed" | "unknown"; error: string | null } {
  if (result.ok && parsed.outcome === "identifiable_acceptance")
    return { state: "accepted", error: null };
  if (result.ok || parsed.possibleAccepted)
    return { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" };
  if (result.stage === "preflight")
    return { state: "failed", error: "WOZTELL_CONFIGURATION_UNAVAILABLE" };
  if (result.refused === true || parsed.outcome === "definitive_refusal")
    return { state: "failed", error: "WOZTELL_REFUSED" };
  if (result.status !== undefined && DEFINITE_REJECTION_STATUSES.includes(result.status))
    return { state: "failed", error: "WOZTELL_PROVIDER_REJECTED" };
  return { state: "unknown", error: "WOZTELL_DELIVERY_UNKNOWN" };
}
