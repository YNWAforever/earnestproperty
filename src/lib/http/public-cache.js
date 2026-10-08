// F-01 (FX-15 Task 3): anonymous public pages are served from Vercel's CDN for
// 60 s and may be served stale for 300 s more while it refreshes in the
// background. Only Vercel's CDN reads `Vercel-CDN-Cache-Control`; it is never
// forwarded, so browsers keep Vercel's default
// `public, max-age=0, must-revalidate` and always revalidate.
//
// The cache key is method + host + deployment URL + full path and query, so
// `?deal=rent` and `?deal=sale` are separate entries and a new deployment never
// serves the previous one's HTML.

export const PUBLIC_CDN_CACHE = "max-age=60, stale-while-revalidate=300";

// Refused even if a private route is wired up by mistake.
const PRIVATE_PREFIXES = ["/admin", "/auth", "/account", "/dashboard", "/api", "/w", "/_serverFn"];

/**
 * Route `headers` option for anonymous public pages. Returns the Vercel-only CDN
 * header when the match loaded successfully, otherwise undefined (Vercel's default
 * `public, max-age=0, must-revalidate` stays). Browsers always revalidate.
 *
 * TanStack Start runs `headers` on the server after the loaders settle, with the
 * match's final status: a thrown error is `"error"` (500), a notFound() is
 * `"notFound"` on its own boundary (404) or stops at the root boundary before
 * this route's `headers` runs, and a redirect never carries route headers. Server
 * functions (`/_serverFn/*`) never run route `headers` at all.
 *
 * @param {{ match: { status: string; pathname?: string }, loaderData?: unknown }} ctx
 * @param {{ require?: (loaderData: any) => boolean }} [options]
 */
export function publicPageCacheHeaders(ctx, options = {}) {
  const path = ctx.match.pathname ?? "";
  if (PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return undefined;
  if (ctx.match.status !== "success" || ctx.loaderData == null) return undefined;
  if (options.require && !options.require(ctx.loaderData)) return undefined;
  return { "Vercel-CDN-Cache-Control": PUBLIC_CDN_CACHE };
}
