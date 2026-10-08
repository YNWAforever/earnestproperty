// FX-13 L-05: production logs show crawlers on /estate/null. A listing whose
// estate row has no usable slug must not emit an estate link at all, so every
// estate href on the listing page and in the estate directory is built here.

const EMPTY_SLUGS = new Set(["", "null", "undefined"]);

/** "/estate/<slug>" or null for null/undefined/""/whitespace/"null"/"undefined". */
export function estatePath(slug: string | null | undefined): string | null {
  if (typeof slug !== "string") return null;
  const trimmed = slug.trim();
  if (EMPTY_SLUGS.has(trimmed.toLowerCase())) return null;
  return `/estate/${trimmed}`;
}
