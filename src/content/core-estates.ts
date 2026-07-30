/**
 * The 深井核心屋苑 card list the client approved (docx p13/p15).
 *
 * The homepage previously rendered whatever `fetchEstates()` returned, which is
 * only the five estates that have a detail page. The client asked for five more
 * that have no page and no figures, so the card list is declared here and live
 * DB values are merged in by slug — rather than inventing rows in the estates
 * table for estates we know nothing about.
 *
 * Order is the client's and is not alphabetical.
 */
export type CoreEstateDistrict = "深井" | "青山公路" | "汀九";

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

export const coreEstates: CoreEstate[] = [
  // The five with detail pages. units / avgPsf / listingCount stay null here and
  // are filled from the live DB at render time; hardcoding them would let the
  // card drift from the estate page.
  {
    slug: "bellagio",
    name: "碧堤半島",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: "/estates/bellagio.jpg",
    district: "深井",
    hasPage: true,
  },
  {
    slug: "hong-kong-garden",
    name: "豪景花園",
    units: null,
    avgPsf: null,
    listingCount: null,
    // TODO(client): 豪景花園 photo not supplied — the other four arrived in 屋苑相/.
    photo: null,
    district: "青山公路",
    hasPage: true,
  },
  {
    slug: "sea-crest-villa",
    name: "浪翠園",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: "/estates/sea-crest-villa.jpg",
    district: "深井",
    hasPage: true,
  },
  {
    slug: "lido-garden",
    name: "麗都花園",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: "/estates/lido-garden.jpg",
    district: "深井",
    hasPage: true,
  },
  {
    slug: "rhine-garden",
    name: "海韻花園",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: "/estates/rhine-garden.jpg",
    district: "深井",
    hasPage: true,
  },

  // The five the client added (docx p13/p15). No figures, no photos and no detail
  // pages were supplied, so every value below is null and the cards do not link —
  // linking would ship five thin pages, which is the SEO problem this repo just
  // spent a PR fixing.
  //
  // TODO(client): confirm the romanised slugs before any of these gets a URL.
  // They are React keys only today, so nothing is committed to yet.
  {
    slug: "hoi-wan-hin",
    name: "海雲軒",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: null,
    // Not 深井: castle-peak-road.ts already lists 海雲軒 among 油柑頭 / 汀九's
    // featured estates, and its listings normalise to the tsuen-wan district.
    district: "汀九",
    hasPage: false,
  },
  {
    slug: "tai-wah-hin",
    name: "帝華軒",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: null,
    // TODO(client): district unknown — no reference anywhere in the repo.
    district: null,
    hasPage: false,
  },
  {
    slug: "hoi-wan-toi",
    name: "海韻台",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: null,
    // TODO(client): district unknown. Do not assume it follows 海韻花園 just
    // because the names share 海韻.
    district: null,
    hasPage: false,
  },
  {
    slug: "chun-wong-kui",
    name: "縉皇居",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: null,
    // As with 海雲軒, the corridor registry already places 縉皇居 in 油柑頭 / 汀九.
    district: "汀九",
    hasPage: false,
  },
  {
    slug: "lung-tang-kok",
    name: "龍騰閣",
    units: null,
    avgPsf: null,
    listingCount: null,
    photo: null,
    // TODO(client): district unknown — no reference anywhere in the repo.
    district: null,
    hasPage: false,
  },
];

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
