/**
 * Shared helpers for turning a raw phone number into safe `tel:`/WhatsApp
 * links. Centralizes the Hong Kong number normalization that used to be
 * copy-pasted between `agents.tsx` and `agents_.$slug.tsx`.
 */

import { normalizePhone } from "./phone.js";

export const DEFAULT_AGENT_WHATSAPP_MESSAGE = "你好，我從晉誠地產網站找到你，想查詢物業資料。";

/**
 * Normalize a phone number to digits-only international form
 * (e.g. "2688 2988" -> "85226882988", "+852 2688 2988" -> "85226882988").
 * Returns null when the input is not clearly a phone number, so callers can
 * safely hide contact buttons rather than link to "tel:".
 *
 * FX-12 (D-12): this is the shared customer normaliser, which fixes two wrong
 * links the old copy built: "+9123 4567" used to link wa.me/91234567 (now
 * 85291234567), and "00852 ..." used to keep the 00 and link a 13-digit number.
 */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  return normalizePhone(phone);
}

export function toTelHref(phone: string | null | undefined): string | null {
  const normalized = normalizePhoneDigits(phone);
  return normalized ? `tel:+${normalized}` : null;
}

/**
 * Builds a `https://wa.me/<intl number>?text=<encoded message>` link.
 * Returns null when the phone number can't be normalized, so callers must
 * not render a WhatsApp button for records without a valid number.
 */
export function toWhatsAppHref(
  phone: string | null | undefined,
  message: string = DEFAULT_AGENT_WHATSAPP_MESSAGE,
): string | null {
  const normalized = normalizePhoneDigits(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
