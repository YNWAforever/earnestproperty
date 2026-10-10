/**
 * Invisible honeypot shared by the four public forms (contact, property enquiry, valuation,
 * listing alert). A filled field only FLAGS a submission as a likely bot: it is still saved,
 * still alerts staff and still shows the visitor the normal success message. It must never be
 * a reason to reject, drop or delay an enquiry, because autofill can fill it for real people.
 */
export const HONEYPOT_FIELD = "website";

/** Bounded read: a huge value is never fully stringified or trimmed. */
const MAX_INSPECTED_CHARS = 1000;

export function isHoneypotFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  let text: string;
  try {
    text = typeof value === "string" ? value : String(value);
  } catch {
    // A value that cannot even be stringified is not something a person typed.
    return true;
  }
  // Over the bound counts as filled (no person types 1,000 blanks); otherwise trim the bounded
  // prefix only.
  return text.length > MAX_INSPECTED_CHARS || text.slice(0, MAX_INSPECTED_CHARS).trim() !== "";
}
