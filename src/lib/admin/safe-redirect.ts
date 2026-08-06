/** Validates a post-sign-in return path.
 *
 * The sign-in gate used to drop the requested page entirely, so a deep link to
 * /admin/whatsapp sent staff to sign-in and then to the public homepage, and
 * they had to navigate back by hand.
 *
 * Carrying the destination in a query parameter is the standard fix and the
 * standard open-redirect hazard: `?redirect=https://evil.example` would hand an
 * attacker a login page on a trusted origin that bounces to theirs. So this is
 * an allowlist, not a sanitiser -- anything that is not obviously an internal
 * admin path is discarded rather than repaired.
 */
const DEFAULT_REDIRECT = "/admin";

export function safeAdminRedirect(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_REDIRECT;
  const path = value.trim();

  // Must be a root-relative path. Rejects absolute URLs ("https://…"),
  // protocol-relative ones ("//evil.example", which a browser treats as
  // absolute), and backslash variants some parsers normalise to slashes.
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return DEFAULT_REDIRECT;
  }
  // Scheme-ish payloads can survive the checks above once a browser decodes
  // them; nothing legitimate here contains a colon before the first slash.
  if (/^\/[^/?#]*:/.test(path)) return DEFAULT_REDIRECT;

  // Narrowed to the admin area on purpose: this parameter exists only to return
  // staff to the page they asked for, so there is no reason to let it point
  // anywhere else on the site.
  if (path !== "/admin" && !path.startsWith("/admin/") && !path.startsWith("/admin?")) {
    return DEFAULT_REDIRECT;
  }
  return path;
}
