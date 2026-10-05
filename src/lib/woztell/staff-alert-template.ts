/** The one owner-approved staff alert template (`EP_WA_STAFF_ALERT_TEMPLATE`).
 *
 * Pure: no `server-only` import, so `node --test` reads it directly. The setting
 * holds no secret, only the approved element name, language and the order of
 * the body parameters. Anything unparseable means "not configured", which
 * blocks staff WhatsApp outside the 24-hour window; it never falls back to TEXT.
 */

export type StaffAlertTemplateParam = "name" | "source" | "link";
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

const PARAMS: readonly StaffAlertTemplateParam[] = ["name", "source", "link"];
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
  return { name, language, params: [...(params as StaffAlertTemplateParam[])] };
}

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
    Array.from(text.replace(/[\s\p{Cc}\p{Cf}]+/gu, " ").trim())
      .slice(0, Math.max(1, max))
      .join("")
      .trim();
  return clean(value ?? "") || clean(fallback) || "-";
}

const FALLBACK: Record<StaffAlertTemplateParam, string> = {
  name: "客戶",
  source: "新查詢",
  link: "請登入後台查看",
};
// A link is an opaque URL; a short cap would cut it into a dead link.
const MAX: Record<StaffAlertTemplateParam, number> = { name: 60, source: 60, link: 1000 };

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
          text: sanitizeTemplateParam(values[param], FALLBACK[param], MAX[param]),
        })),
      },
    ],
  };
}
