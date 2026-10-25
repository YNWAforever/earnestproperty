export const PREVIEW_HOME_LIMIT = 9;

function postingAge(posted) {
  const match = String(posted ?? "").match(/(\d+)\s*(分鐘|小時|日)前/);
  if (!match) return Infinity;
  return Number(match[1]) * { 分鐘: 1, 小時: 60, 日: 1440 }[match[2]];
}

export function previewListingsForDeal(listings, deal, limit = Infinity) {
  return listings
    .filter((listing) => listing.deal_type === deal)
    .sort((a, b) => {
      const ageA = postingAge(a.posted);
      const ageB = postingAge(b.posted);
      if (ageA !== ageB) return ageA < ageB ? -1 : 1;
      return Number(b.id) - Number(a.id);
    })
    .slice(0, limit);
}
