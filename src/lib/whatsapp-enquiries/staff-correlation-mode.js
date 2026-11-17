/**
 * Staff reply-correlation basis.
 *
 * `strict` (default) requires both a correlation verification reference and the exact provider
 * reply-context path, so an inbound reply is matched to the outbound message id it quotes.
 *
 * `member_id` is an explicit operator waiver for providers that never emit reply context. The
 * WOZTELL Bot webhook recorded by this app carries only `data.text` (28 Production payloads plus
 * two live staff replies), so no reply-context path can be verified there. In this mode the
 * correlation evidence reference is still required, and correlation itself uses the opaque
 * provider member id that accompanies both the outbound destination and the inbound reply.
 * Nothing about consent, ownership or isolation is relaxed: only the unusable quote metadata.
 */
export const STAFF_CORRELATION_STRICT = "strict";
export const STAFF_CORRELATION_MEMBER_ID = "member_id";
export const STAFF_CORRELATION_MODES = Object.freeze([
  STAFF_CORRELATION_STRICT,
  STAFF_CORRELATION_MEMBER_ID,
]);
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function staffCorrelationMode(env = {}) {
  return text(env.EP_WA_STAFF_CORRELATION_MODE)?.toLowerCase() === STAFF_CORRELATION_MEMBER_ID
    ? STAFF_CORRELATION_MEMBER_ID
    : STAFF_CORRELATION_STRICT;
}
export function staffCorrelationPlan(env = {}) {
  const mode = staffCorrelationMode(env);
  const verificationRef = text(env.EP_WA_STAFF_CORRELATION_VERIFICATION_REF);
  const replyContextPath = text(env.EP_WA_STAFF_REPLY_CONTEXT_PATH);
  const requiresReplyContext = mode === STAFF_CORRELATION_STRICT;
  const replyContextAvailable = Boolean(verificationRef && replyContextPath);
  return Object.freeze({
    mode,
    verificationRef,
    replyContextPath,
    requiresReplyContext,
    replyContextAvailable,
    // Member-id correlation needs the reviewed evidence reference but never the quote path.
    ready: requiresReplyContext ? replyContextAvailable : Boolean(verificationRef),
  });
}
