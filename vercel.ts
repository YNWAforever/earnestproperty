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
  crons: [
    { path: "/api/mls-sync", schedule: "0 20 * * *" },
    // runClaimedJobs is only reachable from these two routes, so without them
    // nothing drains ops_jobs: queued WhatsApp campaigns and AI knowledge
    // rebuilds return 202 and then sit forever. Both authenticate with
    // Bearer ${CRON_SECRET}.
    { path: "/api/admin/control-plane/worker", schedule: "*/5 * * * *" },
    { path: "/api/admin/jobs/send-queue", schedule: "*/10 * * * *" },
  ],
  redirects: [
    ...detailRedirects,
    redirectEntry("/", "/", true, {
      has: [{ type: "query", key: "ln", value: "^(sc|tc)$" }],
    }),
    redirectEntry("/district/ting-kau", "/castle-peak-road/ting-kau", true),
    redirectEntry("/district/ting-kau/", "/castle-peak-road/ting-kau", true),
    redirectEntry("/estate/belvedere-garden", "/estate/bellagio", true),
    redirectEntry("/estate/sea-pearl-garden", "/estate/rhine-garden", true),
    redirectEntry("/property-detail/:oldId.html", "/listings", true),
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
