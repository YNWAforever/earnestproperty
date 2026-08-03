#!/usr/bin/env node
// Runs as `prebuild` (npm's automatic pre-script for `npm run build`) so a Vercel
// deploy missing WhatsApp contact env vars fails the BUILD, not a live request.
//
// Without this check, an unset VITE_CONTACT_WHATSAPP_PHONE silently degrades
// every WhatsApp CTA site-wide to a plain /contact link (see the fallback in
// src/config/site.ts) -- the deploy still succeeds, the site still looks fine,
// and nobody notices until a real buyer clicks 我要買樓 and lands on a branch
// directory instead of WhatsApp. This turns that into a loud, pre-deploy
// failure instead.
//
// Deliberately NOT a runtime throw inside application code: site.ts is
// imported by nearly every route (via SiteHeader/SiteFooter), so throwing at
// module load there would 500 every single page on first request after an
// unconfigured deploy -- worse than the dead CTAs it replaces, and it takes
// down pages that have nothing to do with WhatsApp. Failing here instead
// blocks the new deploy in Vercel's build log while the previous, working
// deployment keeps serving traffic.
//
// Only runs for actual Vercel builds (VERCEL_ENV set) so local `npm run build`
// and `npm run build:dev` are unaffected.

const REQUIRED_FOR_WHATSAPP_CTAS = [
  "VITE_CONTACT_WHATSAPP_PHONE",
  "VITE_CONTACT_PHONE_DISPLAY",
  "VITE_CONTACT_PHONE_TEL",
];

const vercelEnv = process.env.VERCEL_ENV;
const isVercelDeploy = vercelEnv === "production" || vercelEnv === "preview";

if (isVercelDeploy) {
  const missing = REQUIRED_FOR_WHATSAPP_CTAS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    console.error(
      [
        "",
        `Build blocked (${vercelEnv}): missing required environment variable(s): ${missing.join(", ")}.`,
        "Every WhatsApp CTA site-wide (buy/rent/valuation buttons, listing enquiries, the header",
        "WhatsApp button) silently falls back to /contact without these. See .env.example.",
        "Set them in the Vercel project settings for this environment and redeploy.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}
