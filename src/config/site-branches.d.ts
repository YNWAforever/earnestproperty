export type SiteBranch = {
  id: "lido" | "rhine" | "hong-kong-garden";
  name: string;
  address: string;
  phone: string;
  estateSlugs: string[];
  districtSlugs: string[];
};

export const SITE_BRANCHES: SiteBranch[];

export function resolveBranchContact<TFallback>(input: {
  branches: SiteBranch[];
  fallback: TFallback;
  estateSlug?: string | null;
  districtSlug?: string | null;
}): SiteBranch | TFallback;
