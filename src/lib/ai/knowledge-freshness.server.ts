import "@tanstack/react-start/server-only";
import { canonicalListingCte } from "../neon/public-listing-query.js";

// Use the same current-offer selection as public pages. A newer inactive offer
// must suppress an older active row. Revision covers every sibling offer,
// canonical identity, estate text, effective protected edits and source state.
export function publicKnowledgeCurrentSourcesCte() {
  return `${canonicalListingCte("true", true)}, current_public_listings AS (
    SELECT p.*, c.public_listing_no, c.offerings, e.slug AS estate_slug,
      e.name_zh AS estate_name_zh,
      md5(jsonb_build_object(
        'policy', 'public-knowledge-v1',
        'group', to_jsonb(g), 'estate', to_jsonb(e),
        'members', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.property_id)
          FROM property_public_members m WHERE m.public_listing_no=c.public_listing_no),
        'properties', (SELECT jsonb_agg(to_jsonb(sibling) ORDER BY sibling.id)
          FROM property_public_members m JOIN properties sibling ON sibling.id=m.property_id
          WHERE m.public_listing_no=c.public_listing_no),
        'protected', (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.property_id,f.field_name)
          FROM property_sync_fields f JOIN property_public_members m ON m.property_id=f.property_id
          WHERE m.public_listing_no=c.public_listing_no),
        'source_identity', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.source,s.external_listing_id,s.deal_type)
          FROM mls_source_state s JOIN property_public_members m ON m.property_id=s.property_id
          WHERE m.public_listing_no=c.public_listing_no)
      )::text) AS source_revision
    FROM canonical c JOIN properties p ON p.id=c.id
    JOIN property_public_groups g ON g.public_listing_no=c.public_listing_no
    LEFT JOIN estates e ON e.id=p.estate_id
  ), current_public_sources AS (
    SELECT 'listing'::text AS source_type,id::text AS source_id,source_revision FROM current_public_listings
    UNION ALL SELECT 'faq',id::text,md5(to_jsonb(f)::text) FROM faqs f
    UNION ALL SELECT 'estate',id::text,md5(to_jsonb(e)::text) FROM estates e
    UNION ALL SELECT 'article',id::text,md5(to_jsonb(a)::text) FROM articles a WHERE a.published=true
    UNION ALL SELECT source_type::text,source_id,content_hash FROM ai_knowledge_sources
      WHERE source_type IN ('manual_public','district') AND published AND public_visibility='public'
  )`;
}

export const publicKnowledgeRevisionGate = `
  AND current_source.source_revision IS NOT NULL
  AND (s.source_type IN ('manual_public','district')
    OR c.metadata->>'source_revision'=current_source.source_revision)
  AND (s.source_type<>'listing' OR c.listing_id::text=s.source_id)`;
