import "@tanstack/react-start/server-only";

/**
 * FX-19c-1: consolidated WhatsApp settings. Each getter reads the surviving name
 * (or derives the value from EP_WA_ENQUIRY_MODE) and still honours the old name
 * while it is set, so production behaves the same until the owner deletes the old
 * names in Vercel. 19c-2 removes the old-name branches.
 *
 * "Set" means a non-empty string. The first time a getter resolves through an old
 * name, one `[wa-config] legacy_name_in_use` line is logged per process carrying the
 * variable NAME only, never its value.
 */
type Env = NodeJS.ProcessEnv;

const LEGACY_NAMES = [
  "EP_WA_COMPANY_CHANNEL_ID",
  "EP_WA_COMPANY_PHONE",
  "EP_WA_INBOX_VERIFICATION_REF",
  "EP_WA_REDIRECT_GLOBAL_SHARD_PER_MIN",
  "EP_WA_REDIRECT_LINK_PER_MIN",
  "EP_WA_ROUTING_ENABLED",
  "EP_WA_TRACKED_LINKS_ENABLED",
] as const;

const logged = new Set<string>();

function isSet(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function legacy(name: (typeof LEGACY_NAMES)[number]) {
  if (logged.has(name)) return;
  logged.add(name);
  console.warn("[wa-config] legacy_name_in_use", { name });
}

/** Test-only: forget which legacy names were already logged. */
export function resetLegacyNameLog() {
  logged.clear();
}

/** Raw company WhatsApp number (callers keep their own usableCompanyPhone check). */
export function companyPhone(env: Env = process.env): string | undefined {
  if (isSet(env.EP_WA_COMPANY_PHONE)) {
    legacy("EP_WA_COMPANY_PHONE");
    return env.EP_WA_COMPANY_PHONE;
  }
  return env.VITE_CONTACT_WHATSAPP_PHONE;
}

/**
 * Old name while set. The WOZTELL_CHANNEL_ID fallback applies only once an enquiry
 * mode (observe/active) is set: environments without one (General Preview) keep
 * null exactly as before, so admin channel writes there still refuse (409/throw).
 */
export function companyChannelId(env: Env = process.env): string | null {
  if (isSet(env.EP_WA_COMPANY_CHANNEL_ID)) {
    legacy("EP_WA_COMPANY_CHANNEL_ID");
    return env.EP_WA_COMPANY_CHANNEL_ID;
  }
  const modeSet = env.EP_WA_ENQUIRY_MODE === "observe" || env.EP_WA_ENQUIRY_MODE === "active";
  return modeSet && isSet(env.WOZTELL_CHANNEL_ID) ? env.WOZTELL_CHANNEL_ID : null;
}

/** Old switch wins while set ("false" still turns links off); else on in observe/active. */
export function trackedLinksEnabled(env: Env = process.env): boolean {
  if (isSet(env.EP_WA_TRACKED_LINKS_ENABLED)) {
    legacy("EP_WA_TRACKED_LINKS_ENABLED");
    return env.EP_WA_TRACKED_LINKS_ENABLED === "true";
  }
  return env.EP_WA_ENQUIRY_MODE === "observe" || env.EP_WA_ENQUIRY_MODE === "active";
}

/** Routing is on only in active mode; a set old switch other than "true" still turns it off. */
export function routingEnabled(env: Env = process.env): boolean {
  if (env.EP_WA_ENQUIRY_MODE !== "active") return false;
  if (isSet(env.EP_WA_ROUTING_ENABLED)) {
    legacy("EP_WA_ROUTING_ENABLED");
    return env.EP_WA_ROUTING_ENABLED === "true";
  }
  return true;
}

export function inboxVerificationRef(env: Env = process.env): string {
  if (isSet(env.EP_WA_INBOX_VERIFICATION_REF)) {
    legacy("EP_WA_INBOX_VERIFICATION_REF");
    return env.EP_WA_INBOX_VERIFICATION_REF;
  }
  return "env-config";
}

/** Sorted old names that are still set. Names only. */
export function legacyWaNamesInUse(env: Env = process.env): string[] {
  return LEGACY_NAMES.filter((name) => isSet(env[name])).sort();
}
