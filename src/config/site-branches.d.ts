export type SiteBranch = {
  id: "lido" | "rhine" | "hong-kong-garden";
  name: string;
  address: string;
  phone: string;
  estateSlugs: string[];
  districtSlugs: string[];
  /** Shop-front photo path under `public/`, if supplied. */
  photo?: string;
  /** Opening hours — only set once confirmed by the client. */
  hours?: string;
  /** Google Maps link — only set once confirmed by the client. */
  mapUrl?: string;
};

export const SITE_BRANCHES: SiteBranch[];

export function resolveBranchContact<TFallback>(input: {
  branches: SiteBranch[];
  fallback: TFallback;
  estateSlug?: string | null;
  districtSlug?: string | null;
}): SiteBranch | TFallback;
