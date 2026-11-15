import { notificationPhone } from "./enquiry-routing.mjs";

export const ENQUIRY_FORWARD_JOB = "woztell.enquiry.forward";
export const ENQUIRY_FORWARD_RECONCILE_JOB = "woztell.enquiry.forward.reconcile";
export const ENQUIRY_FORWARD_PURPOSE = "enquiry_forward";
export const ENQUIRY_COPY_PHONE = "85297987774";

/** Notifications use the explicitly registered Hong Kong WhatsApp destination. */
export function forwardingPhone(value) {
  return notificationPhone(value);
}

export function forwardingSubjectKey(source, subjectId) {
  if (
    !["website", "whatsapp"].includes(source) ||
    typeof subjectId !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subjectId)
  )
    throw Error("ENQUIRY_FORWARD_SUBJECT_INVALID");
  return `enquiry-forward:${source}:${subjectId.toLowerCase()}`;
}

/** A fixed copy and a Sales/manager using one phone receive one message. */
export function uniqueForwardingRecipients(recipients) {
  const byPhone = new Map();
  for (const recipient of recipients) {
    const phone = forwardingPhone(recipient.phone);
    if (!phone) continue;
    const previous = byPhone.get(phone);
    if (!previous || recipient.kind === "copy") byPhone.set(phone, { ...recipient, phone });
  }
  return [...byPhone.values()];
}

export function forwardingSourceLabel(route) {
  const source = route.source === "website" ? "網站查詢" : "WhatsApp 查詢";
  const target = route.propertyNo ? ` · ${route.propertyNo}` : "";
  const summary =
    typeof route.summary === "string" ? route.summary.replace(/\s+/g, " ").trim() : "";
  return `${source}${target}${summary ? ` · ${summary}` : ""}`;
}
