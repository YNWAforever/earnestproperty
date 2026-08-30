/**
 * The 深井核心屋苑 card list the client approved (docx p13/p15).
 *
 * The homepage previously rendered whatever `fetchEstates()` returned, which is
 * only the five estates that have a detail page. The client asked for five more
 * that have no page and no figures, so the card list is declared here and live
 * DB values are merged in by slug — rather than inventing rows in the estates
 * table for estates we know nothing about.
 *
 * Order is the client's and is not alphabetical. Identity (slug, name, photo,
 * district grouping, hasPage) is sourced from estate-registry.ts (DR-10) —
 * this file only adds the homepage-card-specific fields (units/avgPsf/
 * listingCount, always null here and merged from the live DB at render time).
 */
import { type EstateHomepageDistrict, getEstateEntry } from "./estate-registry.ts";

export type CoreEstateDistrict = EstateHomepageDistrict;

export type CoreEstate = {
  slug: string;
  name: string;
  /** null until the client supplies a figure — the card renders 「—」, never 0. */
  units: number | null;
  avgPsf: number | null;
  listingCount: number | null;
  photo: string | null;
  /**
   * null where the client has not said and the repo has no evidence. The spec's
   * schema does not allow null here, but guessing a district would put a false
   * location on a real estate, which is worse than an omission.
   */
  district: CoreEstateDistrict | null;
  /** Estates without a detail page render as a non-linking card. */
  hasPage: boolean;
};

/**
 * The client's approved homepage order (docx p13/p15): the five estates with
 * a detail page first, then the five added estates. Kept as an explicit slug
 * list — rather than e.g. `estateRegistry.filter(...)` — so this order stays
 * this file's own decision and doesn't silently follow a reordering of the
 * registry array, which is free to be in any order.
 */
const CLIENT_ORDER_SLUGS = [
  "bellagio",
  "hong-kong-garden",
  "sea-crest-villa",
  "lido-garden",
  "rhine-garden",
  "hoi-wan-hin",
  "tai-wah-hin",
  "hoi-wan-toi",
  "chun-wong-kui",
  "lung-tang-kok",
] as const;

// units / avgPsf / listingCount stay null here and are filled from the live
// DB at render time; hardcoding them would let the card drift from the
// estate page. slug/name/photo/district/hasPage come from estate-registry.ts.
export const coreEstates: CoreEstate[] = CLIENT_ORDER_SLUGS.map((slug) => {
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

/** Cards shown before the 查看更多屋苑 expander. */
export const CORE_ESTATES_PREVIEW_COUNT = 8;

/**
 * Renders a missing figure as an em dash. The card previously did
 * `(units ?? 0).toLocaleString()`, which printed a confident "0 個單位" and "$0"
 * for anything the DB had not filled in.
 */
export function estateFigure(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}
