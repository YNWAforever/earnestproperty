// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

import { resolveSiteOrigin } from "./scripts/site-origin.mjs";

// The production origin (canonicals, sitemap, robots, og:image, JSON-LD) is
// resolved once at build time: VITE_SITE_URL if set, else Vercel's own
// VERCEL_PROJECT_PRODUCTION_URL, which follows the custom domain the moment
// one is attached. Exposed to the app as import.meta.env.VITE_SITE_URL so
// src/content/seo.ts needs no Vercel-specific knowledge.
const siteOrigin = resolveSiteOrigin();

export default defineConfig({
  cloudflare: false,
  // F-01: pin the Nitro Vercel function itself (.vc-config.json) next to Neon.
  plugins: [nitro({ vercel: { functions: { regions: ["sin1"] } } })],
  vite: {
    define: siteOrigin ? { "import.meta.env.VITE_SITE_URL": JSON.stringify(siteOrigin) } : {},
  },
});
