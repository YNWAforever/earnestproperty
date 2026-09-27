import "@tanstack/react-start/server-only";

import { queryRows } from "./db.server";
import { buildPublicInventoryCountsQuery } from "./public-inventory-counts.mjs";

export async function getPublicInventoryCounts(): Promise<{
  publicProperties: number;
  publicOffers: number;
  checkedAt: string;
}> {
  const [row] = await queryRows(buildPublicInventoryCountsQuery());
  return {
    publicProperties: Number(row?.public_properties ?? 0),
    publicOffers: Number(row?.public_offers ?? 0),
    checkedAt: new Date().toISOString(),
  };
}
