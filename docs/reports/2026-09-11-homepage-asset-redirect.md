# Broken homepage assets — 2026-09-11

Live browser evidence: 43 homepage images, 15 loaded and 28 failed after forcing lazy images to load. All 28 failures were same-origin brand, responsive, estate, agent and branch images. JavaScript modules also failed CORS. Direct checks showed same-origin assets returned 308 to www.earnestproperty.com; the destination logo URL returned HTML (200 text/html), not image data.

Cause: vercel.ts enabled a catch-all domain redirect solely because VITE_SITE_URL named the SEO canonical domain. That setting does not prove the custom host serves this deployment. The fix requires CANONICAL_HOST_REDIRECT_ENABLED=true before generating the host redirect. Leave it unset until the custom domain serves this deployment, including its assets. SEO canonical URLs, existing legacy redirects, inventory and images remain unchanged.

Note (2026-10-08, FX-13): CANONICAL_HOST_REDIRECT_ENABLED has since been removed; vercel.ts now emits a production-only 308 that excludes /api, /_serverFn, /w, /assets and /.well-known.

Regression tests load the actual Vercel configuration with the canonical domain set: absent/false activation yields no host redirect; explicit true yields the intended redirect; the fallback origin never redirects to itself. Production needs the fix deployed before image restoration can be claimed. Previously cached permanent redirects may require a hard refresh after deployment.
