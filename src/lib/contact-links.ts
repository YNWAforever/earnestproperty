/**
 * Shared helpers for turning a raw phone number into safe `tel:`/WhatsApp
 * links. Centralizes the Hong Kong number normalization that used to be
 * copy-pasted between `agents.tsx` and `agents_.$slug.tsx`.
 */

const HK_COUNTRY_CODE = "852";

export const DEFAULT_AGENT_WHATSAPP_MESSAGE = "你好，我從晉誠地產網站找到你，想查詢物業資料。";

/**
 * Normalize a phone number to digits-only international form
 * (e.g. "2688 2988" -> "85226882988", "+852 2688 2988" -> "85226882988").
 * Returns null when the input doesn't have enough digits to be a real number,
 * so callers can safely hide contact buttons rather than link to "tel:".
 */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const hasPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    return digits.length >= 8 ? digits : null;
  }
  // Plain 8-digit HK local number (e.g. landline/mobile without area code).
  if (digits.length === 8) {
    return `${HK_COUNTRY_CODE}${digits}`;
  }
  // Already includes the HK country code (e.g. "85226882988").
  if (digits.length > 8 && digits.startsWith(HK_COUNTRY_CODE)) {
    return digits;
  }
  // Looks like some other already-international number.
  if (digits.length >= 10) {
    return digits;
  }
  return null;
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
