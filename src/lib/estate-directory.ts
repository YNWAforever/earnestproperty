import {
  type ClientAreaGroupKey,
  clientAreaGroupsInNavOrder,
  getClientAreaGroup,
} from "../content/client-area-presentation.ts";
import { estateRegistry } from "../content/estate-registry.ts";
export type EstateDirectoryRow = {
  slug: string;
  nameZh: string;
  nameEn: string | null;
  aliases: string[];
  districtSlug: string | null;
  total: number;
  sale: number;
  rent: number;
};
export type EstateDirectoryData = { rows: EstateDirectoryRow[]; generatedAt: string };
const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s‧·]/g, "")
    .replaceAll("臺", "台");
export function estateListingHref(slug: string, deal: "sale" | "rent") {
  return `/listings?estate=${encodeURIComponent(slug)}&deal=${deal}`;
}

/** Anything outside the client's three commercial groups. Sorts last. */
const OTHER_GROUP_LABEL = "其他屋苑";

/**
 * Resolves a row to one of the client's three commercial groups (docx p1).
 *
 * `homepageDistrict` is the display grouping and wins when the registry has an
 * entry; the district-slug fallback below only covers a published row with no
 * registry entry at all. Both are read-only here -- a display group never
 * rewrites a row's real `district_slug`, which is why 青龍頭
 * ("tsing-lung-tau") rows can sit in the 深井 / 青龍頭 group without their
 * database district being touched.
 */
function groupKeyFor(
  homepageDistrict: string | null | undefined,
  districtSlug: string | null,
): ClientAreaGroupKey | null {
  const region =
    homepageDistrict ??
    (["sham-tseng", "tsing-lung-tau"].includes(districtSlug ?? "")
      ? "深井"
      : districtSlug === "castle-peak-road"
        ? "青山公路"
        : districtSlug === "ting-kau" || districtSlug === "yau-kom-tau"
          ? "汀九"
          : null);
  if (region === "深井") return "sham-tseng";
  if (region === "青山公路") return "castle-peak-road-west";
  if (region === "汀九") return "yau-kom-tau-ting-kau";
  return null;
}

/**
 * Position of a slug in its group's client-approved order (primary cards
 * first, then the 其他 tier). Estates the client did not sequence fall back to
 * registry order, offset past every sequenced entry so they never interleave.
 */
function presentationRank(slug: string, key: ClientAreaGroupKey | null): number {
  if (key) {
    const group = getClientAreaGroup(key);
    const ordered = [...group.primary, ...group.secondary].map((ref) => ref.slug);
    const index = ordered.indexOf(slug);
    if (index >= 0) return index;
  }
  const registryIndex = estateRegistry.findIndex((entry) => entry.slug === slug);
  return 1000 + (registryIndex === -1 ? 999 : registryIndex);
}

export function groupEstateDirectory(rows: EstateDirectoryRow[], query: string) {
  const needle = normalized(query);
  const groups = new Map<string, EstateDirectoryRow[]>();
  const registryBySlug = new Map(estateRegistry.map((entry) => [entry.slug, entry]));
  const keyFor = (row: EstateDirectoryRow) =>
    groupKeyFor(registryBySlug.get(row.slug)?.homepageDistrict, row.districtSlug);

  for (const row of [...rows].sort(
    (a, b) =>
      presentationRank(a.slug, keyFor(a)) - presentationRank(b.slug, keyFor(b)) ||
      a.nameZh.localeCompare(b.nameZh),
  )) {
    const entry = registryBySlug.get(row.slug);
    if (
      needle &&
      ![row.nameZh, row.nameEn ?? "", ...row.aliases, ...(entry?.aliases ?? [])].some((value) =>
        normalized(value).includes(needle),
      )
    )
      continue;
    const key = keyFor(row);
    // The exact visible labels the client supplied (docx p1). The same three
    // labels back the directory shortcuts and the navigation, so one
    // destination cannot acquire two different names on two screen sizes.
    const label = key ? getClientAreaGroup(key).label : OTHER_GROUP_LABEL;
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }

  // docx p1's navigation order, not insertion order. The schematic's own,
  // deliberately different east-to-west order lives in
  // client-area-presentation.ts and is applied by the corridor overview.
  const labelOrder = clientAreaGroupsInNavOrder().map((group) => group.label);
  const rank = (label: string) => {
    const index = labelOrder.indexOf(label);
    return index === -1 ? labelOrder.length : index;
  };
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([label, estates]) => ({ label, estates }));
}
