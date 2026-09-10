/**
 * The 深井核心屋苑 card list the client approved, re-ordered by the 2026-09-07
 * feedback (網頁07092026.docx p3).
 *
 * The homepage previously rendered whatever `fetchEstates()` returned, which is
 * only the estates whose DB row carries district_slug = "sham-tseng". The
 * client asked for estates that have no page and no figures, and for 青龍頭
 * estates whose row is district_slug = "tsing-lung-tau", so the card list is
 * declared here and live DB values are merged in by slug — rather than
 * inventing rows in the estates table, or falsifying an estate's real district
 * to make a card appear.
 *
 * Order is the client's and is not alphabetical. It now comes from
 * client-area-presentation.ts so the same sequence backs the navigation
 * shortcut, this card grid and the 青山公路 overview. Identity (slug, name,
 * photo, district grouping, hasPage) is sourced from estate-registry.ts
 * (DR-10) — this file only adds the homepage-card-specific fields
 * (units/avgPsf/listingCount, always null here and merged from the live DB at
 * render time).
 */
import {
  type ClientAreaEstateRef,
  clientAreaEstateLabel,
  getClientAreaGroup,
} from "./client-area-presentation.ts";
import { type EstateHomepageDistrict, getEstateEntry } from "./estate-registry.ts";

export type CoreEstateDistrict = EstateHomepageDistrict;

export type CoreEstate = {
  slug: string;
  /**
   * The label rendered on the card. Equals the registry's canonical `nameZh`
   * unless the client asked for their own wording (帝御系列, 海韻台) -- see
   * client-area-presentation.ts's `presentationLabel`. Identity is still the
   * slug, so a presentation label never forks the estate.
   */
  name: string;
  /** null until the client supplies a figure — the card renders 「—」, never 0. */
  units: number | null;
  avgPsf: number | null;
  listingCount: number | null;
  photo: string | null;
  /** Attribution line for `photo`, when it's CC-licensed rather than client-supplied. */
  photoCredit?: string;
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
 * Builds a card list from an ordered client presentation reference list.
 * Shared with castle-peak-road-estates.ts so both homepage groups resolve
 * identity the same way: units/avgPsf/listingCount stay null here and are
 * merged from the live DB at render time -- hardcoding them would let the
 * card drift from the estate page.
 */
export function coreEstatesFromRefs(refs: ClientAreaEstateRef[]): CoreEstate[] {
  return refs.map((ref) => {
    const entry = getEstateEntry(ref.slug);
    return {
      slug: entry.slug,
      name: clientAreaEstateLabel(ref),
      units: null,
      avgPsf: null,
      listingCount: null,
      photo: entry.photo,
      photoCredit: entry.photoCredit,
      district: entry.homepageDistrict,
      hasPage: entry.hasPage,
    };
  });
}

/**
 * The client's 2026-09-07 深井 / 青龍頭 order (docx p3). Sourced from
 * client-area-presentation.ts rather than a second slug array here, so the
 * navigation shortcut, the homepage cards and the 青山公路 overview's 主要屋苑
 * section cannot drift apart.
 *
 * 龍騰閣 is deliberately absent -- it is not in the client's new ten-item
 * order. Its registry entry, DB row and /estate/lung-tang-kok URL are
 * untouched; only this curated homepage sequence drops it.
 *
 * 逸璟瓏灣 heads the client's list but has no verified identity in this repo
 * and is recorded as unresolved in client-area-presentation.ts -- it is not
 * guessed onto another estate here.
 */
export const coreEstates: CoreEstate[] = coreEstatesFromRefs(
  getClientAreaGroup("sham-tseng").primary,
);

/**
 * Default cards shown before the 查看更多屋苑 expander, for any estate grid
 * that does not ask for its own count.
 *
 * The two client-approved homepage groups deliberately opt out of it and pass
 * their own full length instead (see index.tsx): the client's amendment is a
 * specific ordered set, and hiding its tail behind an expander made the
 * amendment look unfinished. This constant stays the default so unrelated
 * grids keep the previous behaviour rather than every preview limit being
 * removed globally.
 */
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
