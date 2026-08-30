import { z } from "zod";

import type { WebsiteInquiryInput } from "@/lib/neon/admin-data";

// "查詢類型" -- lets the form route an enquiry to the right kind of
// follow-up (buy / rent / owner valuation / general) without forcing the
// visitor to explain it in free text. Matches the terminology already used
// elsewhere on the site: "放盤估價" is OwnerValuationPanel's own label.
export const ENQUIRY_TYPE_OPTIONS = [
  { value: "buy", label: "買樓" },
  { value: "rent", label: "租樓" },
  { value: "valuation", label: "放盤估價" },
  { value: "general", label: "一般查詢" },
] as const;

export const PREFERRED_CONTACT_OPTIONS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "電話" },
  { value: "email", label: "Email" },
] as const;

type EnquiryTypeValue = (typeof ENQUIRY_TYPE_OPTIONS)[number]["value"];
type PreferredContactValue = (typeof PREFERRED_CONTACT_OPTIONS)[number]["value"];

const ENQUIRY_TYPE_VALUES = ENQUIRY_TYPE_OPTIONS.map((option) => option.value) as [
  EnquiryTypeValue,
  ...EnquiryTypeValue[],
];
const PREFERRED_CONTACT_VALUES = PREFERRED_CONTACT_OPTIONS.map((option) => option.value) as [
  PreferredContactValue,
  ...PreferredContactValue[],
];

// Mirrors the identical constraints already enforced server-side in
// admin-data.ts's websiteInquirySchema (name/phone/email/message) -- this
// file adds enquiryType/preferredContact on top, which are a UI-routing
// decision only (see composeInquiryMessage below), not a server schema
// change.
export const contactInquirySchema = z.object({
  name: z.string().trim().min(1, "請輸入姓名").max(120, "姓名過長"),
  phone: z
    .string()
    .trim()
    .min(8, "請輸入有效電話")
    .max(30, "電話過長")
    .regex(/^[\d+\-\s()]+$/, "電話格式不正確"),
  email: z.string().trim().max(255).email("電郵格式不正確").optional().or(z.literal("")),
  enquiryType: z.enum(ENQUIRY_TYPE_VALUES, {
    errorMap: () => ({ message: "請選擇查詢類型" }),
  }),
  preferredContact: z.enum(PREFERRED_CONTACT_VALUES, {
    errorMap: () => ({ message: "請選擇偏好聯絡方式" }),
  }),
  message: z.string().trim().max(1000, "訊息過長").optional(),
});

export type ContactInquiryFormValues = z.infer<typeof contactInquirySchema>;

export type RawContactInquiryInput = {
  name: string;
  phone: string;
  email: string;
  enquiryType: string;
  preferredContact: string;
  message: string;
};

function labelFor<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * enquiryType/preferredContact are a deliberate UI-routing decision, not a
 * database schema change: `inquiries.message` is already free text that
 * reaches staff via the CRM, so folding the two new fields into it (rather
 * than adding new columns + a migration + extending admin-data.ts's
 * server-side websiteInquirySchema) keeps this task's footprint additive
 * and reversible. If a future task needs to filter/report on enquiry type
 * structurally, that's the point to add a real column -- not here.
 */
export function composeInquiryMessage(data: ContactInquiryFormValues): string {
  const lines = [
    `查詢類型：${labelFor(ENQUIRY_TYPE_OPTIONS, data.enquiryType)}`,
    `偏好聯絡方式：${labelFor(PREFERRED_CONTACT_OPTIONS, data.preferredContact)}`,
  ];
  if (data.message) {
    lines.push(`留言：${data.message}`);
  }
  return lines.join("\n");
}

export function buildWebsiteInquiryPayload(
  data: ContactInquiryFormValues,
  consentWhatsapp: boolean,
): WebsiteInquiryInput {
  return {
    name: data.name,
    phone: data.phone,
    email: data.email || "",
    message: composeInquiryMessage(data),
    consentWhatsapp,
  };
}

export type ContactSubmitOutcome =
  | { status: "validation-error"; message: string }
  | { status: "server-error"; message: string }
  | { status: "success" };

export type ContactSubmitFn = (
  payload: WebsiteInquiryInput,
) => Promise<{ id: string } | { error: string }>;

export interface SubmitGuard {
  tryStart(): boolean;
  finish(): void;
}

/**
 * Plain, framework-free re-entrancy guard -- deliberately NOT React state.
 * `submitting` state doesn't update synchronously: two handler invocations
 * fired before the first re-render commits (a fast double-click or a
 * double-Enter) would both read the same stale `false` from their own
 * closures and both proceed, which is exactly the race this guards against.
 * A plain mutable flag closed over here is flipped the instant `tryStart()`
 * runs, with no re-render in the loop at all. The caller (contact.tsx's
 * handleSubmit) calls `tryStart()` as its very first statement -- before
 * touching any React state -- and must call `finish()` in a `finally` block
 * once the submit settles, win or lose.
 */
export function createSubmitGuard(): SubmitGuard {
  let inFlight = false;
  return {
    tryStart() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish() {
      inFlight = false;
    },
  };
}

/**
 * The validate -> compose -> submit orchestration, extracted out of
 * contact.tsx so it can be exercised directly in a test without React/DOM.
 * Deliberately guard-free: the caller (contact.tsx's handleSubmit, and this
 * file's own tests) owns the `tryStart()`/`finish()` dance around this call,
 * so a duplicate-blocked attempt never even reaches here and never causes
 * the "submitting" UI state to flicker on and off for an attempt that was
 * never actually sent.
 */
export async function submitContactInquiry({
  raw,
  consentWhatsapp,
  submitFn,
}: {
  raw: RawContactInquiryInput;
  consentWhatsapp: boolean;
  submitFn: ContactSubmitFn;
}): Promise<ContactSubmitOutcome> {
  const parsed = contactInquirySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "validation-error",
      message: parsed.error.issues[0]?.message ?? "請檢查輸入",
    };
  }
  const payload = buildWebsiteInquiryPayload(parsed.data, consentWhatsapp);
  const result = await submitFn(payload).catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  if ("error" in result && result.error) {
    return { status: "server-error", message: result.error };
  }
  return { status: "success" };
}
