// Resolves the production origin for a build, in priority order:
//   1. VITE_SITE_URL      -- explicit override (must be an http(s) origin)
//   2. VERCEL_PROJECT_PRODUCTION_URL -- set by Vercel on every build; it is the
//      project's production host, and becomes the custom domain automatically
//      the moment one is attached to the project.
//   3. null -- local dev / tests; src/content/seo.ts then falls back to the
//      vercel.app host.
// Shared by vite.config.ts (injects it as import.meta.env.VITE_SITE_URL),
// vercel.ts (production-only 308 from earnestproperty.vercel.app onto the
// canonical origin; /api, /_serverFn, /w, /assets and /.well-known excluded) and
// scripts/check-required-env.mjs.
export function normalizeOrigin(value) {
  if (!value) return null;
  const candidate = /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveSiteOrigin(env = process.env) {
  return (
    normalizeOrigin(env.VITE_SITE_URL) ?? normalizeOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) ?? null
  );
}
