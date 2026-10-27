import type { EstateRegistryEntry } from "./estate-registry";

export type EstateHeroPhoto = {
  src: string;
  label: string;
  credit?: string;
  sourceUrl?: string;
  licenseUrl?: string;
};

/** Only reviewed estate photography can represent an estate, including on social cards.
 * Listing photos and unclassified CMS hero_image values are deliberately ineligible. */
export function getEstateHeroPhoto(
  entry: EstateRegistryEntry | null | undefined,
): EstateHeroPhoto | null {
  if (entry?.exteriorPhoto) return entry.exteriorPhoto;
  if (!entry?.photo?.trim() || !["exterior", "panorama"].includes(entry.photoKind ?? "")) {
    return null;
  }
  return {
    src: entry.photo,
    label: entry.photoLabel ?? (entry.photoKind === "panorama" ? "屋苑全景" : "屋苑外觀"),
    credit: entry.photoCredit,
  };
}
