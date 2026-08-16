import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy district URL. Ting Kau sits on the Castle Peak Road corridor, so the
 * canonical page is /castle-peak-road/ting-kau — which renders the same segment
 * content (intro, featured estates, estate cards, recent transactions) from
 * getCastlePeakRoadSegment("ting-kau").
 *
 * vercel.ts already 301s this path at the edge in production; redirecting here
 * too keeps dev and any request that bypasses the edge rule in agreement about
 * the canonical URL, instead of serving a page whose canonical points at a URL
 * that permanently redirects away from it.
 */
export const Route = createFileRoute("/district/ting-kau")({
  beforeLoad: () => {
    throw redirect({
      to: "/castle-peak-road/$segment",
      params: { segment: "ting-kau" },
      statusCode: 301,
    });
  },
});
