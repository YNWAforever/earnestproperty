/**
 * The client's 2026-09-07 feedback (網頁07092026.docx) names three commercial
 * area groups, gives each an exact visible label, and then orders them two
 * different ways on two different pages:
 *
 *   - p1 (分區屋苑總覽 shortcuts / navigation): 深井 → 青山公路西 → 油柑頭汀九
 *   - p5 (走向示意 schematic, east→west):      油柑頭汀九 → 深井 → 青山公路西
 *
 * Both orders are stored explicitly below rather than being derived from one
 * array, because they genuinely differ and a component that reuses "the" order
 * would silently render one of the two pages wrong.
 *
 * This module is presentation only. Canonical estate identity (slug, aliases,
 * districtSlug, hasPage, photo) still lives in estate-registry.ts (DR-10); the
 * lists here are ordered *references* to those slugs plus the labels the client
 * asked to see. Nothing here is a database join key:
 *
 *   - `districtSlugs` are the real `estates.district_slug` values whose rows a
 *     group's cards need loaded. A group spans more than one because the
 *     client's commercial grouping and the DB's district column genuinely
 *     disagree (帝華軒/龍騰閣 are 青龍頭 = `tsing-lung-tau` rows, but the client
 *     groups them with 深井).
 *   - `unresolved` records a client-supplied name with no verified canonical
 *     identity in this repo. It is deliberately NOT rendered as an estate
 *     card, is never given a guessed slug, and is not counted anywhere. It
 *     exists so the requirement ledger and its tests can assert that these
 *     names were carried forward as open questions rather than quietly
 *     dropped or silently mapped onto a similarly-named estate.
 *
 * Deliberately NOT here: corridor *inventory* scope (castle-peak-road.ts's
 * `segment.estateSlugs` / `districtSlugs`) or the historical transaction
 * statistics that read from it. Those describe which listings a segment claims
 * as its own stock; widening them is a separate, evidence-backed decision.
 */
import { getEstateEntry } from "./estate-registry.ts";

export type ClientAreaGroupKey = "sham-tseng" | "castle-peak-road-west" | "yau-kom-tau-ting-kau";

export type ClientAreaEstateRef = {
  /** Canonical slug in estate-registry.ts. */
  slug: string;
  /**
   * The label the client wrote, when it differs from the estate's canonical
   * `nameZh` and the client asked to see their own wording. Only two entries
   * carry one today (帝御系列, 海韻台) and both are explicitly authorised by the
   * brief as display labels. `undefined` everywhere else, so the canonical
   * name keeps rendering and the card cannot drift from the detail page.
   */
  presentationLabel?: string;
};

export type ClientAreaUnresolvedEstate = {
  /** Verbatim, in the client's own spelling. Never normalised or "corrected". */
  label: string;
  /** "primary" = one of the 12 main western cards; "secondary" = inside 其他. */
  tier: "primary" | "secondary";
  /** 1-based position in the client's own list, so order survives resolution. */
  rank: number;
};

export type ClientAreaGroup = {
  key: ClientAreaGroupKey;
  /** The exact visible label from docx p1. Rendered verbatim. */
  label: string;
  /** Existing route this group's shortcut navigates to. Never a new invented route. */
  href: string;
  /** Real `estates.district_slug` values whose published rows this group needs. */
  districtSlugs: string[];
  /** Ordered canonical members shown as primary cards. */
  primary: ClientAreaEstateRef[];
  /** Ordered canonical members shown behind the 其他 control. Empty when the group has none. */
  secondary: ClientAreaEstateRef[];
  /** Client-supplied names with no verified identity yet. Never rendered as a card. */
  unresolved: ClientAreaUnresolvedEstate[];
};

/**
 * docx p3. 逸璟瓏灣 heads the client's list but matches no registry entry,
 * alias or published row in this repo, so it stays in `unresolved` rather than
 * being guessed onto a similarly-named estate.
 *
 * 龍騰閣 is absent from the client's new ten-item order and so is absent here.
 * Its registry entry, DB row, /estate/lung-tang-kok URL and directory
 * visibility are all untouched -- this list is a curated homepage sequence,
 * not the estate's existence.
 *
 * 海韻台 is the client's spelling; the canonical display name is 海韻臺 and
 * 海韻台 is already one of its aliases. One estate, one slug, one card.
 */
const SHAM_TSENG_GROUP: ClientAreaGroup = {
  key: "sham-tseng",
  label: "深井 / 青龍頭",
  href: "/district/sham-tseng",
  // 青龍頭 rows carry district_slug "tsing-lung-tau", not "sham-tseng" -- the
  // reason 帝華軒 never reached the homepage before (fetchEstates() asked the
  // database for "sham-tseng" only).
  districtSlugs: ["sham-tseng", "tsing-lung-tau"],
  primary: [
    { slug: "hong-kong-garden" },
    { slug: "tai-wah-hin" },
    { slug: "sea-crest-villa" },
    { slug: "hoi-wan-hin" },
    { slug: "lido-garden" },
    { slug: "bellagio" },
    { slug: "chun-wong-kui" },
    { slug: "rhine-garden" },
    { slug: "hoi-wan-toi", presentationLabel: "海韻台" },
  ],
  secondary: [],
  unresolved: [{ label: "逸璟瓏灣", tier: "primary", rank: 1 }],
};

/**
 * docx p2. The client's 12-item primary order ends with a 13th tile, 其他,
 * which is a group control and not an estate -- it has no slug here, no
 * registry entry, no row, no unit count and no detail page.
 *
 * 黃金海岸 (canonical 香港黃金海岸, slug wong-gam-hoi-ngon) and 黃金海灣
 * (wong-gam-hoi-waan) are two different estates and stay two entries.
 *
 * NAPA / 凱和山 / 緹岸 / 飛揚 / 翠濤居 / 棕月灣 / 愛琴灣 have no registry entry,
 * alias or verified row in this repo. They are recorded verbatim in
 * `unresolved` with their client-list positions; none is substituted with a
 * similarly-named estate (in particular 棕月灣 is not resolved to anything).
 */
const CASTLE_PEAK_ROAD_WEST_GROUP: ClientAreaGroup = {
  key: "castle-peak-road-west",
  label: "青山公路區小欖至三聖",
  // Anchors the existing overview's 主要屋苑 section (docx p4) rather than
  // inventing a route with no loader or content. ASCII id so the fragment
  // survives copy/paste and URL encoding intact.
  href: "/castle-peak-road#main-estates",
  districtSlugs: ["castle-peak-road"],
  primary: [
    { slug: "tai-tou-waan" },
    { slug: "oi-kam-hoi-ngon" },
    { slug: "wong-gam-hoi-ngon" },
    { slug: "mun-ming-shan" },
    { slug: "wong-gam-hoi-waan" },
    { slug: "tai-yu", presentationLabel: "帝御系列" },
    { slug: "sing-tai" },
    { slug: "seong-yuen" },
  ],
  secondary: [
    { slug: "oma-oma" },
    { slug: "the-carmel" },
    { slug: "lin-shan" },
    { slug: "long-tou-waan" },
  ],
  unresolved: [
    { label: "NAPA", tier: "primary", rank: 8 },
    { label: "凱和山", tier: "primary", rank: 10 },
    { label: "緹岸", tier: "primary", rank: 11 },
    { label: "飛揚", tier: "primary", rank: 12 },
    { label: "翠濤居", tier: "secondary", rank: 5 },
    { label: "棕月灣", tier: "secondary", rank: 6 },
    { label: "愛琴灣", tier: "secondary", rank: 7 },
  ],
};

/**
 * docx p1 names this group; p4's 主要屋苑 complaint applies to it too. No
 * registry entry carries districtSlug "ting-kau" or "yau-kom-tau" today, so
 * this group has no canonical members and renders an honest empty state.
 * Inventing estates to balance three columns is explicitly out of scope --
 * the segment's real, curated 觀海別墅 / 嘉御龍庭 / 汀九別墅 names live in
 * castle-peak-road.ts's `featuredEstates` as free text precisely because they
 * are not DB-backed estates.
 */
const YAU_KOM_TAU_TING_KAU_GROUP: ClientAreaGroup = {
  key: "yau-kom-tau-ting-kau",
  label: "油柑頭汀九",
  href: "/castle-peak-road/ting-kau",
  districtSlugs: ["ting-kau", "yau-kom-tau"],
  primary: [],
  secondary: [],
  unresolved: [],
};

export const clientAreaGroups: ClientAreaGroup[] = [
  SHAM_TSENG_GROUP,
  CASTLE_PEAK_ROAD_WEST_GROUP,
  YAU_KOM_TAU_TING_KAU_GROUP,
];

/** docx p1: the order the three shortcuts appear in the estate directory / navigation. */
export const clientAreaNavOrder: ClientAreaGroupKey[] = [
  "sham-tseng",
  "castle-peak-road-west",
  "yau-kom-tau-ting-kau",
];

/**
 * docx p5: the east-to-west schematic order, deliberately different from the
 * navigation order above. Stored separately for that reason -- see this file's
 * header comment.
 */
export const clientAreaSchematicOrder: ClientAreaGroupKey[] = [
  "yau-kom-tau-ting-kau",
  "sham-tseng",
  "castle-peak-road-west",
];

export function getClientAreaGroup(key: ClientAreaGroupKey): ClientAreaGroup {
  const group = clientAreaGroups.find((candidate) => candidate.key === key);
  if (!group) throw new Error(`Unknown client area group: ${key}`);
  return group;
}

function order(keys: ClientAreaGroupKey[]): ClientAreaGroup[] {
  return keys.map(getClientAreaGroup);
}

/** The three groups in docx p1's navigation order. */
export function clientAreaGroupsInNavOrder(): ClientAreaGroup[] {
  return order(clientAreaNavOrder);
}

/** The three groups in docx p5's east-to-west schematic order. */
export function clientAreaGroupsInSchematicOrder(): ClientAreaGroup[] {
  return order(clientAreaSchematicOrder);
}

/**
 * Every canonical slug the client's approved presentation groups claim, across
 * primary and secondary tiers.
 *
 * This is what makes an approved estate eligible for the public surfaces the
 * client asked to see it on -- notably 香港黃金海岸, whose own canonical name
 * contains 黃金海岸, one of corridorRegionScope.outOfScopeTextAliases's place
 * names. That place-name gate exists to keep unrelated 屯門 / 大欖涌 stock off
 * the site and stays in force for everything else; membership here is an
 * explicit, per-estate allowance, not a blanket widening of the corridor.
 */
export const approvedPresentationEstateSlugs: string[] = clientAreaGroups.flatMap((group) =>
  [...group.primary, ...group.secondary].map((ref) => ref.slug),
);

const approvedSlugSet = new Set(approvedPresentationEstateSlugs);

export function isApprovedPresentationEstate(slug: string | null | undefined): boolean {
  return typeof slug === "string" && approvedSlugSet.has(slug);
}

/** The label to render for a member: the client's own wording where they gave one. */
export function clientAreaEstateLabel(ref: ClientAreaEstateRef): string {
  return ref.presentationLabel ?? getEstateEntry(ref.slug).nameZh;
}

/**
 * Every client-supplied name still awaiting a verified identity, across all
 * groups, in the order the client listed them. Consumed by the requirement
 * ledger and its test -- never rendered as an estate.
 */
export const unresolvedClientEstateLabels: Array<
  ClientAreaUnresolvedEstate & { group: ClientAreaGroupKey }
> = clientAreaGroups.flatMap((group) =>
  group.unresolved.map((entry) => ({ ...entry, group: group.key })),
);

/**
 * Guard against a slug typo silently dropping a card: every referenced slug
 * must resolve in estate-registry.ts. getEstateEntry throws on an unknown
 * slug, so this both validates and documents the dependency at module load.
 * A slug may also not appear twice, in one group or across two -- that would
 * render the same estate as both a primary card and an 其他 entry.
 */
{
  const seen = new Set<string>();
  for (const slug of approvedPresentationEstateSlugs) {
    getEstateEntry(slug);
    if (seen.has(slug)) throw new Error(`Estate ${slug} is claimed by two presentation groups`);
    seen.add(slug);
  }
}
