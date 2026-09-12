export type EventOrigin = "live_webhook" | "history_import";
export type EventKind =
  | "customer_message"
  | "customer_survey_answer"
  | "staff_outbound"
  | "automated_outbound"
  | "unverified_outbound"
  | "delivery_receipt"
  | "internal_note"
  | "control_event"
  | "unsupported";
export type EnquiryMode = "off" | "observe" | "active";
export function enquiryMode(value = process.env.EP_WA_ENQUIRY_MODE): EnquiryMode {
  if (!value || value === "off") return "off";
  if (value === "observe" || value === "active") return value;
  throw Object.assign(new Error("EP_WA_ENQUIRY_MODE supports off, observe or active"), {
    code: "WA_ENQUIRY_MODE_UNSUPPORTED",
  });
}
