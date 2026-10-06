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
//
// WhatsApp intake (FX-10a, C-07/C-08): when WOZTELL_ENABLED=true the webhook
// answers 503 to everything without WOZTELL_APP_ID, WOZTELL_CHANNEL_ID and
// WOZTELL_CHANNEL_SECRET; when EP_WA_TRACKED_LINKS_ENABLED=true every tracked
// /w/ link needs EP_WA_COMPANY_CHANNEL_ID and a usable EP_WA_COMPANY_PHONE.
// Gaps block production builds. Preview builds only warn, because previews
// legitimately run with partial or no WhatsApp configuration and must stay
// deployable for review. Messages name variables only, never their values.

import { whatsappPhoneProblem } from "../src/config/whatsapp-phone.js";
import { resolveSiteOrigin } from "./site-origin.mjs";

const REQUIRED_FOR_WHATSAPP_CTAS = [
  "VITE_CONTACT_WHATSAPP_PHONE",
  "VITE_CONTACT_PHONE_DISPLAY",
  "VITE_CONTACT_PHONE_TEL",
];
const WHATSAPP_INTEGRATION = ["WOZTELL_APP_ID", "WOZTELL_CHANNEL_ID", "WOZTELL_CHANNEL_SECRET"];

const vercelEnv = process.env.VERCEL_ENV;
const isVercelDeploy = vercelEnv === "production" || vercelEnv === "preview";

// The production origin feeds every canonical, sitemap <loc>, og:image and
// JSON-LD url (src/content/seo.ts). Left unset, the site canonicalises to the
// *.vercel.app fallback and the custom domain never consolidates in search.
// Production-only: previews legitimately run on their own generated hosts.
// Resolution order lives in scripts/site-origin.mjs: an explicit
// VITE_SITE_URL, else Vercel's VERCEL_PROJECT_PRODUCTION_URL (always present
// on Vercel builds, and it follows the custom domain once one is attached), so
// no manual project setting is needed for the common case.
if (vercelEnv === "production") {
  const origin = resolveSiteOrigin();
  if (!origin || !origin.startsWith("https://")) {
    console.error(
      [
        "",
        `Build blocked (production): could not resolve an https production origin (VITE_SITE_URL=${process.env.VITE_SITE_URL ?? "<unset>"}, VERCEL_PROJECT_PRODUCTION_URL=${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "<unset>"}).`,
        "Every canonical, sitemap URL, og:image and JSON-LD url is built from it. Set VITE_SITE_URL",
        "to the live origin in the Vercel project settings.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(`[check-required-env] production origin: ${origin}`);
  if (origin.endsWith(".vercel.app")) {
    console.warn(
      "[check-required-env] the production origin is a vercel.app host. That is correct until a custom domain is attached to the Vercel project; once one is, this resolves to it automatically.",
    );
  }
}

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

  // Presence is not plausibility. The check above passes on ANY non-empty
  // value -- which is how .env.example's placeholder reached production and
  // sent every WhatsApp enquiry to +852 0000 0000 for eight days. A set-but-fake
  // number is worse than a missing one: the guard stays quiet and the CTAs look
  // fine right up until a real buyer taps one.
  const problem = whatsappPhoneProblem(process.env.VITE_CONTACT_WHATSAPP_PHONE);
  if (problem) {
    console.error(
      [
        "",
        `Build blocked (${vercelEnv}): VITE_CONTACT_WHATSAPP_PHONE ${problem}.`,
        "This value is interpolated straight into https://wa.me/<number> on every WhatsApp CTA,",
        "so a wrong one silently sends buyers to a chat that does not exist.",
        "Set the agency's real WhatsApp-capable mobile in the Vercel project settings for this",
        "environment -- digits only, including the country code, with no leading +.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

if (isVercelDeploy) {
  // Names only: never print a value, since these include secrets and the
  // company phone number.
  const problems = [];
  if (process.env.WOZTELL_ENABLED === "true") {
    for (const name of WHATSAPP_INTEGRATION) {
      if (!process.env[name]?.trim()) problems.push(`${name} is not set (WOZTELL_ENABLED=true)`);
    }
  }
  if (process.env.EP_WA_TRACKED_LINKS_ENABLED === "true") {
    const channel = process.env.EP_WA_COMPANY_CHANNEL_ID;
    if (!channel || channel.length > 160) {
      problems.push("EP_WA_COMPANY_CHANNEL_ID is not set or is longer than 160 characters");
    }
    const phone = process.env.EP_WA_COMPANY_PHONE ?? "";
    if (!/^[1-9]\d{7,14}$/.test(phone) || whatsappPhoneProblem(phone) !== null) {
      problems.push("EP_WA_COMPANY_PHONE is not a usable company WhatsApp number");
    }
  }

  if (problems.length > 0 && vercelEnv === "production") {
    console.error(
      [
        "",
        "Build blocked (production): the WhatsApp intake configuration is incomplete:",
        ...problems.map((problem) => `  - ${problem}`),
        "Without these, WhatsApp intake answers 503 or tracked /w/ links fall back untracked.",
        "Set them in the Vercel project settings (see docs/woztell-activation.md) and redeploy.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (problems.length > 0) {
    console.warn(
      `[check-required-env] warning (preview): the WhatsApp intake configuration is incomplete: ${problems.join("; ")}. A production build with this configuration would be blocked.`,
    );
  }
}
