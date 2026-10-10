import { maskStaffDestination } from "@/lib/neon/whatsapp-readiness-policy";

export type CustomerConfirmLabel = { name: string; phone: string };

// Separators people and imports put inside numbers: spaces, brackets, plus, dots, every dash.
const SEPARATORS = /[\s()+.\-\u2010-\u2015\u2212\uff0d]/g;
// Only phone characters, at least one digit (checked after NFKC, so full-width forms count).
const PHONE_ONLY =
  /^[\d\s()+.\-\u2010-\u2015\u2212\uff0d]*\d[\d\s()+.\-\u2010-\u2015\u2212\uff0d]*$/;

/**
 * A display name that is, or contains, a phone number. The conversation list falls back to the
 * phone as its display name and imported names can carry one (「陳生 9123 4567」); a confirmation
 * must never print a full number, so such a name is replaced by the fallback.
 */
function carriesPhone(name: string) {
  const normalized = name.normalize("NFKC");
  return PHONE_ONLY.test(normalized) || /\d{8,}/.test(normalized.replace(SEPARATORS, ""));
}

function confirmName(name: string | null | undefined) {
  // NFKC only to detect a number; the name is shown as staff typed it (full-width brackets stay).
  const trimmed = name?.trim() ?? "";
  return trimmed && !carriesPhone(trimmed) ? trimmed : "WhatsApp 客戶";
}

/** `••••` + the last four digits, or 未有電話 when there are no digits. */
function maskedDigits(value: string | null | undefined) {
  return maskStaffDestination(value?.normalize("NFKC").replace(/\D/g, "")) ?? "未有電話";
}

/**
 * Who a consent or 不是退訂 confirmation is about (FX-17a G-24): the contact those actions
 * change, so its CRM phone. Build it from the same record the action targets (the open
 * conversation's detail), never from a list row. The full number never reaches the dialog.
 */
export function customerConfirmLabel({
  name,
  phone,
}: {
  name: string | null | undefined;
  phone: string | null | undefined;
}): CustomerConfirmLabel {
  return { name: confirmName(name), phone: maskedDigits(phone) };
}

/**
 * Who a template send reaches. The provider dispatch goes to the conversation's
 * `woztell_member_id` (outbound-intent.server.ts reserves `wc.woztell_member_id` and sends to
 * it), not to the CRM contact's phone, which staff can edit or relink. So the masked digits are
 * the member id's, and a member id that is not phone-like (letters, an opaque provider id, or no
 * digits) shows 未有電話 rather than four digits that are not a phone number.
 */
export function templateRecipientLabel({
  name,
  memberId,
}: {
  name: string | null | undefined;
  memberId: string | null | undefined;
}): CustomerConfirmLabel {
  const target = memberId?.normalize("NFKC").trim() ?? "";
  return {
    name: confirmName(name),
    phone: PHONE_ONLY.test(target) ? maskedDigits(target) : "未有電話",
  };
}
