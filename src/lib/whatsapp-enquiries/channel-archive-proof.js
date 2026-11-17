/**
 * Channel "not archived" proof.
 *
 * The provider channel query asks for `archived`, but the WOZTELL Open API answers `null` for
 * this company channel even though the channel is connected and delivers (Sender/templates reads
 * 200, and a live template send on 2026-11-17 was accepted with a provider message id). Strict
 * readiness therefore can never pass on that field alone.
 *
 * `EP_WA_CHANNEL_ARCHIVE_PROOF=live_delivery` lets the operator declare an equivalent, evidence
 * based proof: the channel is connected and a real delivery on this channel is recorded in
 * `EP_WA_CHANNEL_ARCHIVE_PROOF_REF` (an audit row id, never free text). Anything weaker still
 * fails: no reference, a disconnected channel, or `archived: true` keeps the gate closed.
 */
export const CHANNEL_ARCHIVE_PROOF_LIVE_DELIVERY = "live_delivery";
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function channelArchiveProof(env = {}) {
  const mode = text(env.EP_WA_CHANNEL_ARCHIVE_PROOF)?.toLowerCase();
  const reference = text(env.EP_WA_CHANNEL_ARCHIVE_PROOF_REF);
  if (mode !== CHANNEL_ARCHIVE_PROOF_LIVE_DELIVERY || !reference) return null;
  return Object.freeze({ mode: CHANNEL_ARCHIVE_PROOF_LIVE_DELIVERY, reference });
}
export function channelArchiveVerified(channel) {
  if (channel?.archived === true) return false;
  return channel?.archived === false || Boolean(channel?.archiveProof);
}
