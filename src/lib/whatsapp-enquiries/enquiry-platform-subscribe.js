/**
 * Pure helpers for the one-off platform subscription probe. The probe exists because every
 * Cloud Public API credential path is refused while the Open API still works; the operator
 * authorized exactly one `subscribeChannel` attempt. Nothing here sends a message.
 */
export const PLATFORM_SUBSCRIBE_JOB_TYPE = "woztell.enquiry.platform.subscribe";
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_CODE = /^[A-Za-z0-9_]{1,40}$/;
export function platformSubscribeEnabled(env = {}) {
  return env.EP_WA_PLATFORM_SUBSCRIBE_ENABLED === "true";
}
/** Payload must be exactly `{}`: the channel, credentials and etag never come from a payload. */
export function platformSubscribePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)
    throw Object.assign(new Error("Invalid platform subscribe job"), { code: "VALIDATION_ERROR" });
  return {};
}
function cloudEnvironment(channel) {
  const environments = Array.isArray(channel?.environments)
    ? channel.environments.slice(0, 20)
    : [];
  const cloud = environments.filter(
    (entry) => entry?.integration?.integrationId === "whatsapp-cloud",
  );
  return cloud.length === 1 ? cloud[0] : null;
}
/** Bounded channel observation. The etag value is never returned or stored. */
export function channelState(body) {
  const channel = body?.data?.apiViewer?.channel;
  if (!channel || typeof channel !== "object")
    return {
      observed: false,
      etagPresent: false,
      connected: null,
      archived: null,
      cloudEnvironmentCount: 0,
      subscribed: null,
      enabled: null,
      installed: null,
    };
  const cloud = cloudEnvironment(channel);
  const info = cloud?.info && typeof cloud.info === "object" ? cloud.info : null;
  return {
    observed: typeof channel._id === "string",
    etagPresent: typeof channel.etag === "string" && IDENTIFIER.test(channel.etag),
    connected: typeof channel.connected === "boolean" ? channel.connected : null,
    archived: typeof channel.archived === "boolean" ? channel.archived : null,
    cloudEnvironmentCount: cloud ? 1 : 0,
    subscribed: info && typeof info.subscribed === "boolean" ? info.subscribed : null,
    enabled: cloud && typeof cloud.on === "boolean" ? cloud.on : null,
    installed:
      cloud && typeof cloud.integrationInstalled === "boolean" ? cloud.integrationInstalled : null,
  };
}
/** Only the optimistic-concurrency token, for the single mutation attempt. */
export function channelEtag(body) {
  const etag = body?.data?.apiViewer?.channel?.etag;
  return typeof etag === "string" && IDENTIFIER.test(etag) ? etag : null;
}
/** Bounded mutation outcome: error codes are validated, never free text. */
export function subscribeOutcome(body) {
  const payload = body?.data?.subscribeChannel;
  const errors = Array.isArray(body?.errors) ? body.errors.slice(0, 5) : [];
  const codes = [];
  const payloadCode = payload?.error?.code;
  if (typeof payloadCode === "string" && ERROR_CODE.test(payloadCode)) codes.push(payloadCode);
  for (const error of errors) {
    const code = error?.extensions?.code;
    if (typeof code === "string" && ERROR_CODE.test(code)) codes.push(code);
  }
  const rejected = Boolean(payload?.error) || errors.length > 0;
  return {
    responded: Boolean(payload) || errors.length > 0,
    accepted: Boolean(payload) && !rejected,
    hasErrors: errors.length > 0,
    errorCodes: [...new Set(codes)].slice(0, 5),
    channelState: channelState(
      payload?.channel ? { data: { apiViewer: { channel: payload.channel } } } : null,
    ),
  };
}
