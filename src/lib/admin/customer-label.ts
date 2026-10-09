import { maskStaffDestination } from "@/lib/neon/whatsapp-readiness-policy";

export type CustomerConfirmLabel = { name: string; phone: string };

// A name made only of phone characters is the number itself: the conversation list falls back
// to the phone as its display name, and a confirmation must never print a full number.
const PHONE_LIKE = /^[+\d\s().-]+$/;

/**
 * Who a sending or consent confirmation is about (FX-17a G-24). Build it from the same record
 * the action targets (the open conversation's detail), never from a list row. The phone is
 * reduced to its last four digits; the full number never reaches the dialog.
 */
export function customerConfirmLabel({
  name,
  phone,
}: {
  name: string | null | undefined;
  phone: string | null | undefined;
}): CustomerConfirmLabel {
  const trimmed = name?.trim() ?? "";
  return {
    name: trimmed && !PHONE_LIKE.test(trimmed) ? trimmed : "WhatsApp 客戶",
    phone: maskStaffDestination(phone?.replace(/\D/g, "")) ?? "未有電話",
  };
}
