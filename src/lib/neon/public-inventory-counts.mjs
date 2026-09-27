import { canonicalListingCte } from "./public-listing-query.js";

export function buildPublicInventoryCountsQuery() {
  return `${canonicalListingCte("TRUE")}
    SELECT
      (SELECT count(*)::int FROM eligible_groups) AS public_properties,
      (SELECT count(*)::int
       FROM current_offerings current
       JOIN properties p ON p.id = current.id
       WHERE p.status = 'active') AS public_offers`;
}
