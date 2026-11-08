/**
 * The company WhatsApp channel a tracking link must carry.
 *
 * `src/lib/whatsapp-enquiries/wa-config.server.ts#companyChannelId` is the only
 * definition the running site uses: `EP_WA_COMPANY_CHANNEL_ID` wins while set,
 * otherwise `WOZTELL_CHANNEL_ID` applies only once `EP_WA_ENQUIRY_MODE` is
 * observe/active. `resolveTrackingLinks()` and `trackedRedirect()` compare a
 * link's `channel_id` against that value, so a link minted for any other channel
 * redirects as untracked.
 *
 * This is deliberately a copy of that rule rather than an import: the server
 * module is TypeScript with a server-only guard and this file must run under
 * plain `node` for the provisioning script and its tests. `company-channel.test.mjs`
 * pins the behaviour; keep it in step with `wa-config.server.ts`.
 *
 * Never infer the channel from an existing tracking link. Production changed
 * channel on 2026-10-30 and the one old verified website link still carried the
 * retired id, so inferring it minted 628 links the redirect rejected.
 */

/**
 * @param {{ env?: Record<string, string | undefined>; argv?: string[] }} [input]
 * @returns {{ channelId: string; source: "--channel" | "EP_WA_COMPANY_CHANNEL_ID" | "WOZTELL_CHANNEL_ID" }}
 */
export function resolveCompanyChannel({ env = {}, argv = [] } = {}) {
  const flagIndex = argv.indexOf("--channel");
  if (flagIndex >= 0) {
    const value = argv[flagIndex + 1];
    if (!value || value.startsWith("--")) throw new Error("WA_CHANNEL_FLAG_VALUE_REQUIRED");
    return { channelId: value, source: "--channel" };
  }
  const explicit = env.EP_WA_COMPANY_CHANNEL_ID;
  if (typeof explicit === "string" && explicit.length > 0) {
    return { channelId: explicit, source: "EP_WA_COMPANY_CHANNEL_ID" };
  }
  const mode = env.EP_WA_ENQUIRY_MODE;
  const woztell = env.WOZTELL_CHANNEL_ID;
  if (
    (mode === "observe" || mode === "active") &&
    typeof woztell === "string" &&
    woztell.length > 0
  ) {
    return { channelId: woztell, source: "WOZTELL_CHANNEL_ID" };
  }
  throw new Error("WA_COMPANY_CHANNEL_REQUIRED");
}
