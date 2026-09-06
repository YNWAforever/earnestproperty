import { createFileRoute, redirect } from "@tanstack/react-router";

import { fetchPropertyByLegacyDetailId } from "@/lib/neon/public-data.server";

// Old-site listing URLs: https://www.earnestproperty.com/property-detail/6621030.html
// Each imported listing keeps that id in properties.legacy_detail_id, so the
// old URL 301s to the unit's current canonical page. Anything unknown (never
// imported, or no longer public) 301s to the search page -- the same
// destination the old blanket vercel.ts rule sent every legacy URL to.
const LEGACY_FILE = /^(\d+)\.html?$/i;

export const LEGACY_DETAIL_FALLBACK = "/listings";

export function parseLegacyDetailId(file: string): string | null {
  const match = LEGACY_FILE.exec(file);
  return match ? match[1] : null;
}

export const Route = createFileRoute("/property-detail/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const oldId = parseLegacyDetailId(params.file);
        const match = oldId
          ? await fetchPropertyByLegacyDetailId({ oldId }).catch((error: unknown) => {
              console.error("[property-detail] legacy lookup failed; falling back", error);
              return null;
            })
          : null;
        throw redirect({
          href: match?.listing_no
            ? `/property/${encodeURIComponent(match.listing_no)}`
            : LEGACY_DETAIL_FALLBACK,
          statusCode: 301,
        });
      },
    },
  },
});
