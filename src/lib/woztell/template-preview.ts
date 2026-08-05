/** Human-readable rendering of a WhatsApp template's send-time components.
 *
 * `whatsapp_templates.components` is passed straight through to Woztell by
 * `campaign-delivery.server.ts`, so it carries the WhatsApp Cloud API
 * *parameter substitutions* — not the approved body text, which lives with the
 * provider and is never mirrored into this database. Staff therefore cannot be
 * shown the exact message; what they can be shown is every value this system
 * will substitute into it, which is what this module produces.
 */

export type TemplateParameterLine = { label: string; value: string };

const COMPONENT_LABELS: Record<string, string> = {
  header: "標題",
  body: "內文",
  footer: "註腳",
  button: "按鈕",
};

function parameterText(parameter: unknown): string | null {
  if (typeof parameter === "string") return parameter.trim() || null;
  if (!parameter || typeof parameter !== "object") return null;
  const record = parameter as Record<string, unknown>;

  // The common shapes Woztell forwards: {type:"text",text}, {type:"currency",
  // currency:{fallback_value}}, {type:"date_time",date_time:{fallback_value}}.
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();

  for (const key of ["currency", "date_time"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const fallback = (nested as Record<string, unknown>).fallback_value;
      if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
    }
  }

  if (typeof record.fallback_value === "string" && record.fallback_value.trim()) {
    return record.fallback_value.trim();
  }
  return null;
}

/** Flattens template components into `{label, value}` lines for display.
 * Returns `[]` for a template with no variables — which is the normal case for
 * a fully static marketing template, and must not be presented as an error. */
export function describeTemplateParameters(components: unknown): TemplateParameterLine[] {
  if (!Array.isArray(components)) return [];

  const lines: TemplateParameterLine[] = [];
  const buttonIndexes = new Map<string, number>();

  for (const component of components) {
    if (!component || typeof component !== "object") continue;
    const record = component as Record<string, unknown>;
    const type = String(record.type ?? "").toLowerCase();
    const base = COMPONENT_LABELS[type] ?? type ?? "參數";

    const values = Array.isArray(record.parameters)
      ? record.parameters.map(parameterText).filter((text): text is string => Boolean(text))
      : [];
    if (!values.length) continue;

    let label = base;
    if (type === "button") {
      // Several button components can appear; number them so a staff member can
      // match a value to the button they see in the approved template.
      const next = (buttonIndexes.get(base) ?? 0) + 1;
      buttonIndexes.set(base, next);
      label = `${base} ${next}`;
    }

    lines.push({ label, value: values.join(" · ") });
  }

  return lines;
}

/** True when the template carries no substitutions at all — the message is
 * whatever Woztell has approved, with nothing injected from this system. */
export function templateHasNoParameters(components: unknown) {
  return describeTemplateParameters(components).length === 0;
}
