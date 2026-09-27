// Canonical public offering selection shared by listing reads and overview counts.
// Rank every status first: a newer withdrawal suppresses an older active scrape.
export const CURRENT_PUBLIC_OFFERING_ORDER =
  "p.source_updated_at DESC NULLS LAST, p.last_seen_at DESC NULLS LAST, p.updated_at DESC NULLS LAST, p.created_at DESC, p.id ASC";
export const LISTING_FRESHNESS_ORDER =
  "p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC, p.id ASC";

export function canonicalListingCte(
  where,
  splitByDeal = false,
  candidateOrder = LISTING_FRESHNESS_ORDER,
) {
  return `WITH ranked_offerings AS (
    SELECT p.id, ppm.public_listing_no, ROW_NUMBER() OVER (
      PARTITION BY ppm.public_listing_no, p.deal_type
      ORDER BY ${CURRENT_PUBLIC_OFFERING_ORDER}
    ) AS offering_rank
    FROM properties p
    JOIN property_public_members ppm ON ppm.property_id = p.id
  ), current_offerings AS (
    SELECT id, public_listing_no FROM ranked_offerings WHERE offering_rank = 1
  ), eligible_candidates AS (
    SELECT p.id, current_offerings.public_listing_no, ROW_NUMBER() OVER (
      PARTITION BY current_offerings.public_listing_no${splitByDeal ? ", p.deal_type" : ""}
      ORDER BY ${candidateOrder}
    ) AS group_rank
    FROM current_offerings
    JOIN properties p ON p.id = current_offerings.id
    LEFT JOIN estates e ON e.id = p.estate_id
    WHERE p.status = 'active' AND ${where}
  ), eligible_groups AS (
    SELECT id, public_listing_no FROM eligible_candidates WHERE group_rank = 1
  ), canonical AS (
    SELECT eligible_groups.id, eligible_groups.public_listing_no,
      ARRAY(
        SELECT alias_property.listing_no
        FROM property_public_members alias_member
        JOIN properties alias_property ON alias_property.id = alias_member.property_id
        WHERE alias_member.public_listing_no = eligible_groups.public_listing_no
        ORDER BY alias_property.listing_no
      ) AS listing_aliases,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', offering.id, 'listing_no', offering.listing_no,
          'deal_type', offering.deal_type, 'price', offering.price,
          'rent', offering.rent, 'status', offering.status
        ) ORDER BY offering.deal_type, offering.listing_no)
        FROM current_offerings all_current
        JOIN properties offering ON offering.id = all_current.id
        WHERE all_current.public_listing_no = eligible_groups.public_listing_no
          AND offering.status = 'active'
      ), '[]'::jsonb) AS offerings
    FROM eligible_groups
  )`;
}
