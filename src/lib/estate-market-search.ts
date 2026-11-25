import { fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

/**
 * Search params for the 市場註冊成交 module on `/estate/$slug`.
 *
 * Shared by the route (which validates them) and the presentational module
 * (which links to filtered views), so the two can never drift. Filters are
 * additive and reset the page to 1; the canonical URL is still the bare
 * `/estate/{slug}` and the route marks filtered views `noindex,follow`, so
 * filter permutations do not compete with the estate page in search results.
 *
 * Deliberately NOT part of the agency (本行成交) surfaces: market registered
 * rows and company deals stay on separate dependency paths.
 */
export const estateMarketSearchSchema = z.object({
  mtYear: fallback(z.number().int().min(2002).max(2100).optional(), undefined),
  mtNature: fallback(z.string().min(1).max(20).optional(), undefined),
  mtPhase: fallback(z.string().min(1).max(40).optional(), undefined),
  mtPage: fallback(z.number().int().min(1).max(1000), 1).default(1),
});

export type EstateMarketSearch = z.infer<typeof estateMarketSearchSchema>;

export const ESTATE_MARKET_SEARCH_DEFAULTS: EstateMarketSearch = { mtPage: 1 };

/** True when any filter (not just pagination) is active. */
export function hasEstateMarketFilters(search: Partial<EstateMarketSearch>): boolean {
  return search.mtYear != null || (search.mtNature ?? "") !== "" || (search.mtPhase ?? "") !== "";
}
