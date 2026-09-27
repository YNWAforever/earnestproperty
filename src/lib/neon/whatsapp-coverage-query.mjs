import { canonicalListingCte } from "./public-listing-query.js";

export function websiteCandidateLateral(
  propertyId,
  publicListingNo,
  dealType,
  channelParam = "$1",
) {
  return `LEFT JOIN LATERAL (
    SELECT count(*)::int AS candidate_count, min(l.code) AS code
    FROM whatsapp_tracking_links l
    JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version
    WHERE v.enabled AND v.placement_verified_at IS NOT NULL
      AND v.channel_id=${channelParam} AND v.placement_source='website' AND v.entry_point_type='sales'
      AND v.property_id=${propertyId} AND v.public_listing_no=${publicListingNo}
      AND v.deal_type=${dealType}
      AND (
        EXISTS (SELECT 1 FROM whatsapp_tracking_link_placements pl
          WHERE pl.link_id=l.id AND pl.placement_id='website:primary')
        OR NOT EXISTS (SELECT 1 FROM whatsapp_tracking_link_placements pl WHERE pl.link_id=l.id)
      )
  ) site ON true`;
}

export function buildWebsiteCoverageQuery() {
  return `${canonicalListingCte("TRUE", true)}
    SELECT c.id AS property_id,c.public_listing_no,p.deal_type::text AS deal_type,
      site.candidate_count,site.code
    FROM canonical c JOIN properties p ON p.id=c.id
    ${websiteCandidateLateral("c.id", "c.public_listing_no", "p.deal_type::text")}
    WHERE ($2::text IS NULL OR p.deal_type::text=$2)
      AND ($3::text IS NULL OR strpos(lower(c.public_listing_no),lower($3))>0)
      AND ($4::uuid[] IS NULL OR c.id=ANY($4::uuid[]))
    ORDER BY c.public_listing_no,p.deal_type,c.id`;
}
