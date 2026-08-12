/**
 * Plausibility check for VITE_CONTACT_WHATSAPP_PHONE.
 *
 * The prebuild guard in scripts/check-required-env.mjs was written to stop a
 * deploy shipping dead WhatsApp CTAs. It failed at exactly that job, because it
 * only asked whether the variable was SET -- and .env.example's placeholder
 * answers yes. Production served `wa.me/85200000000` for eight days: every
 * 我要買樓, 我要租樓, 我要放盤估價, listing enquiry and header button opened a chat
 * with a number that does not exist, and nothing anywhere said so.
 *
 * Presence is not plausibility. This adds the second half.
 *
 * Authored as plain JS (not TS) so both the prebuild script and a `node --test`
 * .mjs test import it with no build step -- the same convention as
 * website-inquiry.js and site-branches.js.
 */

/** The literal example value in .env.example. */
const PLACEHOLDER = "85200000000";

/**
 * The three branch switchboards. .env.example names them explicitly as
 * landlines that cannot receive WhatsApp, and site-branches.js carries
 * `whatsapp: null` plus a TODO for each -- so pasting one here is a realistic
 * mistake, not a hypothetical one.
 */
const KNOWN_LANDLINES = ["85226882988", "85226886996", "85226882883"];

/**
 * Returns a human-readable reason the value is unusable, or null if it looks
 * like a real number.
 *
 * Deliberately NOT a country-specific format check. This agency is in Hong
 * Kong, but a guard that rejects a legitimate future number is its own outage --
 * so this only rejects shapes that cannot possibly work, never shapes that
 * merely look unfamiliar.
 */
export function whatsappPhoneProblem(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "is empty";

  // whatsappUrl() builds `https://wa.me/${phone}`, and wa.me needs bare digits.
  // A leading + or any spacing produces a malformed link on every CTA site-wide
  // -- and it degrades silently, since the URL is still technically valid.
  if (!/^\d+$/.test(raw)) {
    return `must be digits only with no + or spaces (wa.me rejects anything else); got "${raw}"`;
  }

  if (raw === PLACEHOLDER) {
    return `is still the .env.example placeholder (${PLACEHOLDER}) -- set the agency's real WhatsApp mobile`;
  }

  if (KNOWN_LANDLINES.includes(raw)) {
    return `is a branch landline (${raw}) -- landlines cannot receive WhatsApp, use a mobile`;
  }

  if (/^(\d)\1+$/.test(raw)) {
    return `is a single repeated digit (${raw}) -- that is not a real number`;
  }

  // A country code followed by nothing but zeros is the shape every placeholder
  // takes. Checked after the exact-placeholder case so that one gets the
  // clearer message.
  if (/^\d{1,3}0+$/.test(raw)) {
    return `has an all-zero subscriber number (${raw}) -- that is a placeholder, not a real number`;
  }

  return null;
}
