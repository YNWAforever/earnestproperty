/** The one owner-approved staff alert template (`EP_WA_STAFF_ALERT_TEMPLATE`).
 *
 * Pure: no `server-only` import, so `node --test` reads it directly. The setting
 * holds no secret, only the approved element name, language and the order of
 * the body parameters. Anything unparseable means "not configured", which
 * blocks staff WhatsApp outside the 24-hour window; it never falls back to TEXT.
 */

export type StaffAlertTemplateParam = "name" | "source" | "phone" | "link" | "context";
export type StaffAlertTemplate = {
  name: string;
  language: string;
  params: StaffAlertTemplateParam[];
};
export type StaffTemplateResponse = {
  type: "TEMPLATE";
  elementName: string;
  languageCode: string;
  components: [{ type: "body"; parameters: { type: "text"; text: string }[] }];
};

const LEGACY_PARAMS = ["name", "source", "phone", "link"] as const;
const PARAMS: readonly StaffAlertTemplateParam[] = [...LEGACY_PARAMS, "context"];
export const CONTEXT_TEMPLATE = "staff_enquiry_followup_context";

function isContextFollowup(template: StaffAlertTemplate) {
  return (
    template.name === CONTEXT_TEMPLATE &&
    template.language === "zh_HK" &&
    template.params.join(",") === "name,source,phone,context,link"
  );
}

export function isStaffPhoneFollowup(template: StaffAlertTemplate | null) {
  return (
    !!template &&
    (isContextFollowup(template) ||
      (template.name === "staff_enquiry_followup" &&
        template.language === "zh_HK" &&
        template.params.join(",") === LEGACY_PARAMS.join(",")))
  );
}

export function sameStaffAlertTemplate(a: StaffAlertTemplate | null, b: StaffAlertTemplate | null) {
  return (
    a?.name === b?.name &&
    a?.language === b?.language &&
    a?.params.join(",") === b?.params.join(",")
  );
}

export function isForwardingTemplate(template: StaffAlertTemplate) {
  return (
    isContextFollowup(template) ||
    (template.name !== CONTEXT_TEMPLATE &&
      template.params.length === 4 &&
      LEGACY_PARAMS.every((param) => template.params.includes(param)))
  );
}

const KEYS = new Set(["name", "language", "params"]);

export function parseStaffAlertTemplate(raw: string | undefined): StaffAlertTemplate | null {
  if (!raw?.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.has(key))) return null;
  const { name, language, params } = record;
  if (typeof name !== "string" || !/^[a-z0-9_]{1,512}$/.test(name)) return null;
  if (typeof language !== "string" || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return null;
  if (!Array.isArray(params) || params.length < 1 || params.length > PARAMS.length) return null;
  if (!params.every((p) => PARAMS.includes(p as StaffAlertTemplateParam))) return null;
  if (new Set(params).size !== params.length) return null;
  const template = { name, language, params: [...(params as StaffAlertTemplateParam[])] };
  if ((name === CONTEXT_TEMPLATE || params.includes("context")) && !isContextFollowup(template))
    return null;
  return template;
}

const TEMPLATE_WHITESPACE = /[\s\p{Cc}\p{Cf}]+/gu;

/** WhatsApp refuses a parameter with a newline, a tab or more than four spaces
 * in a row, and an empty one. Customer-typed text is reduced to one line, every
 * whitespace, control or format (zero-width, bidi) run becomes a single space, and the result is capped
 * (in code points) and never empty. */
export function sanitizeTemplateParam(
  value: string | null | undefined,
  fallback: string,
  max = 60,
): string {
  const clean = (text: string) =>
    Array.from(text.replace(TEMPLATE_WHITESPACE, " ").trim())
      .slice(0, Math.max(1, max))
      .join("")
      .trim();
  return clean(value ?? "") || clean(fallback) || "-";
}

/** The customer number staff call back. Woztell contacts arrive as one run of
 * digits (`85291234567`); the alert shows them grouped and callable, and a
 * number that is absent stays empty so the fallback applies. */
export function formatCustomerPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("852")) {
    return `+852 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

const FALLBACK: Record<StaffAlertTemplateParam, string> = {
  name: "未提供姓名",
  source: "新查詢",
  phone: "電話未提供",
  context: "未有查詢文字",
  link: "請登入後台查看",
};
// A link is an opaque URL; a short cap would cut it into a dead link.
export const STAFF_PARAM_LIMITS: Record<StaffAlertTemplateParam, number> = {
  name: 60,
  source: 60,
  phone: 40,
  context: 500,
  link: 1000,
};

export function formatEnquiryContext(value: string | null | undefined): string {
  const limit = STAFF_PARAM_LIMITS.context;
  const excerpt = (value ?? "").replace(TEMPLATE_WHITESPACE, " ").trim() || FALLBACK.context;
  const characters = Array.from(excerpt);
  return characters.length > limit
    ? characters
        .slice(0, limit - 1)
        .join("")
        .trimEnd() + "…"
    : excerpt;
}

export function buildStaffTemplateResponse(
  t: StaffAlertTemplate,
  values: Record<StaffAlertTemplateParam, string>,
): StaffTemplateResponse {
  return {
    type: "TEMPLATE",
    elementName: t.name,
    languageCode: t.language,
    components: [
      {
        type: "body",
        parameters: t.params.map((param) => ({
          type: "text" as const,
          text:
            param === "context"
              ? formatEnquiryContext(values.context)
              : sanitizeTemplateParam(values[param], FALLBACK[param], STAFF_PARAM_LIMITS[param]),
        })),
      },
    ],
  };
}
