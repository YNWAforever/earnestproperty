import importedRedirects from "./src/generated/old-site-redirects.json" with { type: "json" };

type VercelRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Array<{
    type: "query";
    key: string;
    value: string;
  }>;
};

type VercelConfig = {
  buildCommand: string;
  crons: Array<{ path: string; schedule: string }>;
  redirects: VercelRedirect[];
};

const detailRedirects = importedRedirects.map((redirect) =>
  redirectEntry(redirect.source, redirect.destination, redirect.permanent),
);

export const config: VercelConfig = {
  buildCommand: "npm run build",
  // Vercel Hobby allows one run per day per cron, so anything more frequent fails
  // the deploy outright. These four are the once-a-day floor; the every-5-and-10
  // minute cadence the job queue actually needs comes from a Cloudflare Worker
  // (workers/cron/ — Cron Triggers are on Cloudflare's free plan).
  //
  // Keeping the daily entries alongside the Worker is deliberate: if the Worker is
  // ever unconfigured or down, queued jobs still drain within 24h instead of
  // sitting forever. Both endpoints claim jobs under a lease, so two schedulers
  // calling them is safe.
  crons: [
    { path: "/api/youtube-sync", schedule: "0 19 * * *" },
    // runClaimedJobs is only reachable from these two routes, so without them
    // nothing drains ops_jobs: queued WhatsApp campaigns and AI knowledge
    // rebuilds return 202 and then sit forever. Both authenticate with
    // Bearer ${CRON_SECRET}.
    { path: "/api/admin/control-plane/worker", schedule: "10 20 * * *" },
    { path: "/api/admin/jobs/send-queue", schedule: "20 20 * * *" },
    { path: "/api/youtube-sync/full", schedule: "0 21 1 * *" },
  ],
  redirects: [
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
    redirectEntry(
      "/castle-peak-road/tsuen-wan-yau-kom-tau",
      "/castle-peak-road/ting-kau",
      true,
    ),
    redirectEntry(
      "/castle-peak-road/tsuen-wan-yau-kom-tau/",
      "/castle-peak-road/ting-kau",
      true,
    ),
    redirectEntry(
      "/castle-peak-road/tsing-lung-tau",
      "/castle-peak-road/sham-tseng",
      true,
    ),
    redirectEntry(
      "/castle-peak-road/tsing-lung-tau/",
      "/castle-peak-road/sham-tseng",
      true,
    ),
    // Client narrowed scope to 深井 / 青山公路 / 汀九 only; 小欖/掃管笏/三聖
    // (incl. Gold Coast 黃金海岸) is out of scope even though the corridor
    // inventory filter (corridorRegionScope.outOfScopeTextAliases) already
    // excludes its listings from every other page. This retires the segment
    // page itself, which stayed indexable and cross-linked from Ting Kau.
    redirectEntry(
      "/castle-peak-road/so-kwun-wat-gold-coast",
      "/castle-peak-road/sham-tseng",
      true,
    ),
    redirectEntry(
      "/castle-peak-road/so-kwun-wat-gold-coast/",
      "/castle-peak-road/sham-tseng",
      true,
    ),
    redirectEntry("/estate/belvedere-garden", "/estate/bellagio", true),
    redirectEntry("/estate/sea-pearl-garden", "/estate/rhine-garden", true),
    redirectEntry("/property-detail/:oldId.html", "/listings", true),
    redirectEntry(
      "/eng/property-detail/:oldId.html",
      "/property-detail/:oldId.html",
      true,
    ),
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
