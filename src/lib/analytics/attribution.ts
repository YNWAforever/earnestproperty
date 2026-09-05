/** Public route templates prevent arbitrary URL segments from becoming analytics dimensions. */
const PUBLIC_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/listings",
  "/transactions",
  "/videos",
  "/agents",
  "/blog",
  "/mortgage",
  "/estate-reviews",
  "/castle-peak-road",
  "/privacy",
  "/terms",
  "/disclaimer",
  "/district/sham-tseng",
  "/district/tsuen-wan",
  "/district/ting-kau",
  "/blog/editorial-standards",
]);
export function safePublicPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return null;
  let path: string;
  try {
    path = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
  // Reject decoded control characters in untrusted URLs.
  // eslint-disable-next-line no-control-regex
  if (/[\\\x00-\x20]/.test(path) || /%[0-9a-f]{2}/i.test(path)) return null;
  path = path.replace(/\/$/, "") || "/";
  if (PUBLIC_PATHS.has(path)) return path;
  for (const [prefix, parameter] of [
    ["property", "listingNo"],
    ["estate", "slug"],
    ["agents", "slug"],
    ["blog", "slug"],
    ["castle-peak-road", "segment"],
  ]) {
    if (new RegExp(`^/${prefix}/[^/]+$`).test(path)) return `/${prefix}/:${parameter}`;
  }
  return null;
}
export function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
export function safeToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 80 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) &&
    !/\d{8,}/.test(value.replace(/[-_]/g, ""))
  );
}
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export function safeCampaignParams(
  value: unknown,
  approvedTokens: readonly string[] = [],
): Record<string, string> {
  if (!plainRecord(value)) return {};
  const allowed = new Set(approvedTokens.filter(safeToken));
  return Object.fromEntries(
    UTM_KEYS.flatMap((key) =>
      safeToken(value[key]) && allowed.has(value[key]) ? [[key, value[key]]] : [],
    ),
  );
}
export type FirstTouch = {
  landingPath: string;
  referrerHost?: string;
  utm?: Record<string, string>;
};
export type AnalyticsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const ATTRIBUTION_STORAGE_KEY = "earnest:analytics:first-touch:v1";
export function safeReferrerHost(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname.length > 253 ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) ||
      !url.hostname.includes(".") ||
      /^\d+(\.\d+){3}$/.test(url.hostname)
    )
      return undefined;
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
function storedTouch(value: unknown, tokens: readonly string[]): FirstTouch | null {
  if (
    !plainRecord(value) ||
    Object.keys(value).some((key) => !["landingPath", "referrerHost", "utm"].includes(key))
  )
    return null;
  const path = safePublicPath(value.landingPath);
  if (!path || path !== value.landingPath) return null;
  const host =
    typeof value.referrerHost === "string"
      ? safeReferrerHost("https://" + value.referrerHost)
      : undefined;
  if (value.referrerHost !== undefined && host !== value.referrerHost) return null;
  const utm = safeCampaignParams(value.utm, tokens);
  return {
    landingPath: path,
    ...(host ? { referrerHost: host } : {}),
    ...(Object.keys(utm).length ? { utm } : {}),
  };
}
/** Invoked only after explicit adapter enablement, never from private routes. */
export function captureFirstTouch(input: {
  enabled: boolean;
  pathname: string;
  search?: string;
  referrer?: string;
  storage?: AnalyticsStorage | null;
  approvedTokens?: readonly string[];
}): FirstTouch | null {
  const path = safePublicPath(input.pathname);
  if (input.enabled !== true || !path) return null;
  const tokens = input.approvedTokens ?? [];
  try {
    const raw = input.storage?.getItem(ATTRIBUTION_STORAGE_KEY);
    if (raw && raw.length <= 2048) {
      const existing = storedTouch(JSON.parse(raw), tokens);
      if (existing) return existing;
    }
    if (raw) input.storage?.removeItem(ATTRIBUTION_STORAGE_KEY);
  } catch {
    /* Corrupt/blocked storage must not block the public journey. */
  }
  const utm = safeCampaignParams(
    Object.fromEntries(new URLSearchParams(input.search ?? "")),
    tokens,
  );
  const host = safeReferrerHost(input.referrer);
  const touch = {
    landingPath: path,
    ...(host ? { referrerHost: host } : {}),
    ...(Object.keys(utm).length ? { utm } : {}),
  };
  try {
    input.storage?.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(touch));
  } catch {
    /* In-memory attribution remains bounded. */
  }
  return touch;
}

/** Root uses this classification to force a fresh document across private boundaries. */
export function isAnalyticsPrivatePath(value: string): boolean {
  try {
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    return /^\/(admin|auth|account|api)(\/|$)/i.test(path);
  } catch {
    return true;
  }
}
