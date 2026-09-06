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
export function groupEstateDirectory(rows: EstateDirectoryRow[], query: string) {
  const needle = normalized(query);
  const groups = new Map<string, EstateDirectoryRow[]>();
  const order = new Map(estateRegistry.map((entry, index) => [entry.slug, index]));
  for (const row of [...rows].sort(
    (a, b) =>
      (order.get(a.slug) ?? 999) - (order.get(b.slug) ?? 999) || a.nameZh.localeCompare(b.nameZh),
  )) {
    const entry = estateRegistry.find((e) => e.slug === row.slug);
    if (
      needle &&
      ![row.nameZh, row.nameEn ?? "", ...row.aliases, ...(entry?.aliases ?? [])].some((value) =>
        normalized(value).includes(needle),
      )
    )
      continue;
    const region =
      entry?.homepageDistrict ??
      (["sham-tseng", "tsing-lung-tau"].includes(row.districtSlug ?? "")
        ? "深井"
        : row.districtSlug === "castle-peak-road"
          ? "青山公路"
          : row.districtSlug === "ting-kau"
            ? "汀九"
            : "其他屋苑");
    const label = region === "深井" ? "深井／青龍頭" : region;
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return [...groups].map(([label, estates]) => ({ label, estates }));
}
