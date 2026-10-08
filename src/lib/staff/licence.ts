/**
 * Validation for agent contact details transcribed from namecard images.
 *
 * OCR misreads digits. A wrong phone number on a live agent card is worse than a
 * blank one — it sends a real enquiry to a stranger — so every transcribed value
 * passes through here, and anything that fails becomes null rather than a guess.
 */

import { hkLocalNumber, normalizePhone } from "../phone.js";

/** Hong Kong subscriber numbers are 8 digits and start 2, 3, 5, 6 or 9. */
const HK_PHONE = /^[23569]\d{7}$/;

/** EAA individual licence: one letter, six digits. The agency form is excluded below. */
const EAA_INDIVIDUAL = /^([A-Z])-?(\d{6})$/;

/**
 * Parsed by the shared customer normaliser (FX-12), but the result stays the 8-digit
 * local number: staff phones are display data, not customer identity.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const local = hkLocalNumber(normalizePhone(input));
  return local && HK_PHONE.test(local) ? local : null;
}

export function normaliseLicence(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.trim().toUpperCase().match(EAA_INDIVIDUAL);
  if (!match) return null;
  // C- is the agency licence prefix. Earnest Property's own is C-018613 and it
  // appears throughout the site copy, so seeing it in an individual's field means
  // the wrong number was read off the card.
  if (match[1] === "C") return null;
  return `${match[1]}-${match[2]}`;
}

/**
 * WhatsApp needs a mobile number. normalisePhone accepts fixed-line prefixes 2
 * and 3, so an office DID transcribed off a namecard would otherwise be written
 * to the whatsapp column and rendered as a wa.me link that does not resolve.
 */
const HK_MOBILE = /^[569]\d{7}$/;

export function normaliseWhatsapp(input: string | null | undefined): string | null {
  const digits = normalisePhone(input);
  return digits && HK_MOBILE.test(digits) ? digits : null;
}
