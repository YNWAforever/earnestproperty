// Security headers for every response, read by vercel.ts and by node --test.
// Plain JS with no imports so a future enforcing PR can reuse the same source.
//
// Only frame-ancestors is enforced. The full policy below is report-only until
// FX-14's follow-up has collected violation reports and enforces it.
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // 'unsafe-inline': TanStack Start hydration and JSON-LD are inline <script>s.
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://vercel.live",
  // https://vercel.live: Vercel toolbar on previews (Vercel toolbar CSP docs).
  "style-src 'self' 'unsafe-inline' https://vercel.live",
  // Listing and floorplan photos come from many synced hosts (28hse, property.hk, Blob).
  "img-src 'self' data: blob: https:",
  // Fonts are self-hosted via @fontsource; the Vercel toolbar loads its own.
  "font-src 'self' data: https://vercel.live https://assets.vercel.com",
  "connect-src 'self' https://*.neon.tech https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://vercel.live wss://ws-us3.pusher.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://www.google.com https://my.matterport.com https://kuula.co https://vercel.live",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const CSP_ENFORCED = "frame-ancestors 'none'";

export const SECURITY_HEADERS = [
  {
    source: "/(.*)",
    headers: [
      { key: "Content-Security-Policy", value: CSP_ENFORCED },
      { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  },
  // /w/* sets its own stricter Referrer-Policy: no-referrer (whatsapp-enquiries.server.ts).
  // [wW]: Vercel matches `source` case-sensitively, but the router also serves /W/*.
  {
    source: "/((?![wW]/).*)",
    headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
  },
];
