import {
  castlePeakRoadHub,
  castlePeakRoadSegments,
  type CorridorLink,
} from "../content/castle-peak-road.ts";
import { clientAreaGroupsInNavOrder } from "../content/client-area-presentation.ts";
import { estateRegistry } from "../content/estate-registry.ts";
import { estatePath } from "./estate-links.ts";

const pathname = (href: string) => href.split(/[?#]/)[0];

/** Derive related guides from estate identity, never from article keywords. */
export function blogCorridorLinks(
  estateSlugs: readonly string[] = [],
  existingLinks: readonly CorridorLink[] = [],
): CorridorLink[] {
  const segmentSlugs = new Set<string | null>(
    estateRegistry
      .filter(
        (estate) =>
          estate.hasPage &&
          estate.published &&
          (estateSlugs.includes(estate.slug) ||
            existingLinks.some((link) => pathname(link.href) === estatePath(estate.slug))),
      )
      .map((estate) => estate.corridorSegment),
  );
  const segments = castlePeakRoadSegments.filter((segment) => segmentSlugs.has(segment.slug));
  if (segments.length === 0) return [];
  const candidates = [
    { href: castlePeakRoadHub.path, label: "青山公路置業指南" },
    ...segments.map((segment) => ({ href: segment.path, label: segment.nameZh })),
  ];
  return candidates.filter(
    (link) => !existingLinks.some((existing) => pathname(existing.href) === link.href),
  );
}

/** Keep the client's area labels; expose each canonical guide only once. */
export function corridorFooterLinks(): CorridorLink[] {
  const areas = clientAreaGroupsInNavOrder().map((group) => ({
    href: pathname(group.href),
    label: `${group.label}買樓租樓`,
  }));
  const guides = [
    { href: castlePeakRoadHub.path, label: "青山公路置業指南" },
    ...castlePeakRoadSegments
      .filter((segment) => segment.slug === "sham-tseng")
      .map((segment) => ({ href: segment.path, label: "青山公路深井段／青龍頭指南" })),
  ];
  return [...areas, ...guides.filter((guide) => !areas.some((area) => area.href === guide.href))];
}
