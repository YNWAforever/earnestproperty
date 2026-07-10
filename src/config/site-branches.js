export const SITE_BRANCHES = [
  {
    id: "lido",
    name: "麗都分行",
    address: "深井麗都花園地下5A舖",
    phone: "26882988",
    estateSlugs: ["bellagio", "sea-crest-villa", "lido-garden"],
    districtSlugs: ["sham-tseng"],
  },
  {
    id: "rhine",
    name: "海韻分行",
    address: "深井海韻花園地下G3舖",
    phone: "26886996",
    estateSlugs: ["rhine-garden", "sea-pearl-garden"],
    districtSlugs: [],
  },
  {
    id: "hong-kong-garden",
    name: "青山公路豪景分行",
    address: "青龍頭村11號地下",
    phone: "26882883",
    estateSlugs: ["hong-kong-garden"],
    districtSlugs: ["ting-kau"],
  },
];

function normalizedSlug(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function resolveBranchContact({ branches, fallback, estateSlug, districtSlug }) {
  const estate = normalizedSlug(estateSlug);
  if (estate) {
    const estateBranch = branches.find((branch) => branch.estateSlugs.includes(estate));
    if (estateBranch) return estateBranch;
  }

  const district = normalizedSlug(districtSlug);
  if (district) {
    const districtBranch = branches.find((branch) => branch.districtSlugs.includes(district));
    if (districtBranch) return districtBranch;
  }

  return fallback;
}
