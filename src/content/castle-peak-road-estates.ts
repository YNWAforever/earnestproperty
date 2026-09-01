/**
 * The 青山公路屋苑 home page card list -- the 12 estates from the 2026-09-01
 * 17-estate expansion whose homepageDistrict is "青山公路" (estate-registry.ts).
 * Mirrors core-estates.ts's exact shape and discipline: identity (slug, name,
 * photo, district, hasPage) comes from estate-registry.ts (DR-10); this file
 * only fixes display order. units/avgPsf/listingCount stay null here and are
 * merged from the live DB at render time by CoreEstateGrid, same as
 * core-estates.ts's own entries -- hardcoding them here would let the card
 * drift from the estate page.
 */
import { type CoreEstate } from "./core-estates.ts";
import { getEstateEntry } from "./estate-registry.ts";

/**
 * Order matches the 2026-09-01 data pack's own canonical identity table
 * (estates 6-17), the same source order every other file this session built
 * from this data pack already follows.
 */
const CASTLE_PEAK_ROAD_SLUGS = [
  "mun-ming-shan",
  "wong-gam-hoi-ngon",
  "oi-kam-hoi-ngon",
  "tai-yu",
  "wong-gam-hoi-waan",
  "sing-tai",
  "seong-yuen",
  "the-carmel",
  "oma-oma",
  "lin-shan",
  "long-tou-waan",
  "tai-tou-waan",
] as const;

export const castlePeakRoadEstates: CoreEstate[] = CASTLE_PEAK_ROAD_SLUGS.map((slug) => {
  const entry = getEstateEntry(slug);
  return {
    slug: entry.slug,
    name: entry.nameZh,
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: entry.photo,
    district: entry.homepageDistrict,
    hasPage: entry.hasPage,
  };
});
