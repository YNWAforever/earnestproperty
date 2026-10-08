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
};

const detailRedirects = importedRedirects.map((redirect) =>
  redirectEntry(redirect.source, redirect.destination, redirect.permanent),
);

const FALLBACK_HOST = "earnestproperty.vercel.app";
// Machine and browser-runtime paths are never host-redirected: a cross-origin
// 308 drops Authorization, WozTell may not follow it, and the cron worker
// refuses it (JOB_DRAIN_REDIRECTED). Vercel cannot match on method. /assets/*
// is excluded too: a tab left open on vercel.app keeps lazy-loading chunks
// from it after a deploy, and a cross-origin 308 would break those imports.
export const HOST_REDIRECT_SOURCE =
  "/((?!api(?:/|$)|_serverFn(?:/|$)|w/|assets/|\\.well-known(?:/|$)).*)";
export function canonicalHostRedirects(env = process.env): VercelRedirect[] {
  if (env.VERCEL_ENV !== "production") return [];
  const resolved = resolveSiteOrigin(env);
  if (!resolved) return [];
  const origin = new URL(resolved);
  if (origin.protocol !== "https:" || origin.host.endsWith(".vercel.app")) return [];
  return [
    redirectEntry(HOST_REDIRECT_SOURCE, `${origin.origin}/$1`, true, {
      has: [{ type: "host", value: FALLBACK_HOST }],
    }),
  ];
}

export const config: VercelConfig = {
  buildCommand: "npm run build",
  // No recurring Vercel requests: manual sync remains available to staff.
  crons: [],
  redirects: [
    ...canonicalHostRedirects(),
    ...detailRedirects,
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
    redirectEntry("/property", "/listings", true),
    redirectEntry("/property/", "/listings", true),
    redirectEntry("/property/c1", "/listings", true),
    redirectEntry("/property/c1/", "/listings", true),
    redirectEntry("/property/c2", "/listings", true),
    redirectEntry("/property/c2/", "/listings", true),
    redirectEntry("/property/c5", "/listings?deal=rent", true),
    redirectEntry("/property/c5/", "/listings?deal=rent", true),
    redirectEntry("/listprop.php", "/contact", true),
    redirectEntry("/companynews.php", "/blog", true),
    redirectEntry("/news_content.php", "/blog", true),
    redirectEntry("/mortgage.php", "/mortgage", true),
    redirectEntry("/mortgage_rate.php", "/contact", true),
    redirectEntry("/school.php", "/blog", true),
    redirectEntry("/bankval.php", "/contact", true),
    redirectEntry("/unlucky.php", "/blog", true),
    redirectEntry("/tran_trends.php", "/blog", true),
    // L-04 (audit :150): old-site 404s, 24 h counts in brackets.
    redirectEntry("/info_gallery.php", "/listings", true), // 707
    redirectEntry("/vr.php", "/listings", true), // 52
    redirectEntry("/qrcode_page.php", "/contact", true), // 590 -- Open question 1
    redirectEntry("/eng/special_prop_st.php", "/listings", true), // 987 incl. variants
    redirectEntry("/seccode_enquiry/seccode.php", "/contact", true), // 209 incl. /eng (the /eng path waits for the 404 export)
    redirectEntry("/unlucky_detail.php", "/blog", true), // 64, same target as /unlucky.php
    // Detail pages go through the legacy-id resolver (src/routes/property-detail.$file.ts),
    // temporary because the final page depends on properties.legacy_detail_id.
    redirectEntry("/special_prop_detail.php", "/property-detail/:legacyId.html", false, {
      has: [{ type: "query", key: "id", value: "(?<legacyId>\\d+)" }],
    }),
    redirectEntry("/special_prop_detail.php", "/listings", true), // 189 incl. the above
    redirectEntry("/m/property_detail.php", "/property-detail/:legacyId.html", false, {
      has: [{ type: "query", key: "id", value: "(?<legacyId>\\d+)" }],
    }),
    redirectEntry("/m/property_detail.php", "/listings", true), // 14
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
