// FX-13 L-05: production logs show crawlers on /estate/null. A listing whose
// estate row has no usable slug must not emit an estate link at all, so every
// estate href on the listing page and in the estate directory is built here.

const EMPTY_SLUGS = new Set(["", "null", "undefined"]);

/**
 * "/estate/<slug>" or null for null/undefined/""/whitespace/"null"/"undefined".
 * A slug with surrounding whitespace is refused rather than trimmed: callers
 * link with the raw slug (Link params, encodeURIComponent), so a trimmed href
 * would disagree with the link they actually render.
 */
export function estatePath(slug: string | null | undefined): string | null {
  if (typeof slug !== "string") return null;
  if (slug !== slug.trim()) return null;
  if (EMPTY_SLUGS.has(slug.toLowerCase())) return null;
  return `/estate/${slug}`;
}
