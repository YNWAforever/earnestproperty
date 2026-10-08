import importedRedirects from "./src/generated/old-site-redirects.json" with { type: "json" };

import { resolveSiteOrigin } from "./scripts/site-origin.mjs";

type VercelRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Array<
    | {
        type: "query";
        key: string;
        value: string;
      }
    | { type: "host"; value: string }
  >;
};

type VercelConfig = {
  buildCommand: string;
  crons: Array<{ path: string; schedule: string }>;
  redirects: VercelRedirect[];
  regions: string[];
};

const detailRedirects = importedRedirects.map((redirect) =>
  redirectEntry(redirect.source, redirect.destination, redirect.permanent),
);

// SEO canonical URLs do not activate a domain cutover. Enable host redirects
// only after the custom domain is verified to serve this deployment and assets.
const FALLBACK_HOST = "earnestproperty.vercel.app";
function canonicalHostRedirects(): VercelRedirect[] {
  if (process.env.CANONICAL_HOST_REDIRECT_ENABLED !== "true") return [];
  const resolved = resolveSiteOrigin();
  if (!resolved) return [];
  const origin = new URL(resolved);
  if (origin.host === FALLBACK_HOST || origin.host.endsWith(".vercel.app")) return [];
  return [
    redirectEntry("/:path*", `${origin.origin}/:path*`, true, {
      has: [{ type: "host", value: FALLBACK_HOST }],
    }),
  ];
}

export const config: VercelConfig = {
  buildCommand: "npm run build",
  // No recurring Vercel requests: manual sync remains available to staff.
  crons: [],
  // F-01: run next to Neon (aws-ap-southeast-1); see FX-15 fact 3.
  regions: ["sin1"],
  redirects: [
    ...canonicalHostRedirects(),
    ...detailRedirects,
    redirectEntry("/", "/", true, {
      has: [{ type: "query", key: "ln", value: "^(sc|tc)$" }],
    }),
    redirectEntry("/district/ting-kau", "/castle-peak-road/ting-kau", true),
    redirectEntry("/district/ting-kau/", "/castle-peak-road/ting-kau", true),
    // Five lifestyle zones collapsed to three. Both retired URLs are already
    // indexed, and /castle-peak-road/$segment throws notFound() on an unknown
    // slug, so without these 301s they become hard 404s. Successor zones:
    // 油柑頭 → 汀九, 青龍頭 → 深井 / 青山公路.
    redirectEntry("/castle-peak-road/tsuen-wan-yau-kom-tau", "/castle-peak-road/ting-kau", true),
    redirectEntry("/castle-peak-road/tsuen-wan-yau-kom-tau/", "/castle-peak-road/ting-kau", true),
    redirectEntry("/castle-peak-road/tsing-lung-tau", "/castle-peak-road/sham-tseng", true),
    redirectEntry("/castle-peak-road/tsing-lung-tau/", "/castle-peak-road/sham-tseng", true),
    // Client narrowed scope to 深井 / 青山公路 / 汀九 only; 小欖/掃管笏/三聖
    // (incl. Gold Coast 黃金海岸) is out of scope even though the corridor
    // inventory filter (corridorRegionScope.outOfScopeTextAliases) already
    // excludes its listings from every other page. This retires the segment
    // page itself, which stayed indexable and cross-linked from Ting Kau.
    redirectEntry("/castle-peak-road/so-kwun-wat-gold-coast", "/castle-peak-road/sham-tseng", true),
    redirectEntry(
      "/castle-peak-road/so-kwun-wat-gold-coast/",
      "/castle-peak-road/sham-tseng",
      true,
    ),
    redirectEntry("/estate/belvedere-garden", "/estate/bellagio", true),
    redirectEntry("/estate/sea-pearl-garden", "/estate/rhine-garden", true),
    // /property-detail/:oldId.html is NOT redirected here: it is an app route
    // (src/routes/property-detail.$file.ts) that looks the legacy id up in
    // properties.legacy_detail_id and 301s to the matching /property/ page,
    // falling back to /listings only when nothing matches. A blanket
    // many-to-one redirect to /listings threw away every old listing's
    // equity and reads as a soft 404 to Google.
    redirectEntry("/eng/property-detail/:oldId.html", "/property-detail/:oldId.html", true),
    redirectEntry("/eng", "/", true),
    redirectEntry("/eng/", "/", true),
    redirectEntry("/profile.php", "/about", true),
    redirectEntry("/contactus.php", "/contact", true),
    redirectEntry("/property", "/listings?deal=all&page=1", true),
    redirectEntry("/property/", "/listings?deal=all&page=1", true),
    redirectEntry("/property/c1", "/listings?deal=all&page=1", true),
    redirectEntry("/property/c1/", "/listings?deal=all&page=1", true),
    redirectEntry("/property/c2", "/listings?deal=all&page=1", true),
    redirectEntry("/property/c2/", "/listings?deal=all&page=1", true),
    redirectEntry("/property/c5", "/listings?deal=rent&page=1", true),
    redirectEntry("/property/c5/", "/listings?deal=rent&page=1", true),
    redirectEntry("/listprop.php", "/contact", true),
    redirectEntry("/companynews.php", "/blog", true),
    redirectEntry("/news_content.php", "/blog", true),
    redirectEntry("/mortgage.php", "/contact", true),
    redirectEntry("/mortgage_rate.php", "/contact", true),
    redirectEntry("/school.php", "/blog", true),
    redirectEntry("/bankval.php", "/contact", true),
    redirectEntry("/unlucky.php", "/blog", true),
    redirectEntry("/tran_trends.php", "/blog", true),
  ],
};

function redirectEntry(
  source: string,
  destination: string,
  permanent: boolean,
  options: Pick<VercelRedirect, "has"> = {},
): VercelRedirect {
  return { source, destination, permanent, ...options };
}
