-- SELECT only. $1 = 28hse_agent_540 or propertyhk. No addresses, contacts or descriptions.
SELECT p.id, p.canonical_property_no, p.deal_type, p.price, p.rent, p.status,
       coalesce(g.review_required, false) AS review_required,
       CASE WHEN EXISTS(SELECT 1 FROM property_source_links l
            WHERE l.property_id=p.id AND l.source=$1 AND l.status='active')
            THEN $1::text ELSE NULL END AS source,
       ARRAY(SELECT l.external_listing_id FROM property_source_links l
             WHERE l.property_id=p.id AND l.source=$1 AND l.status='active'
             ORDER BY l.external_listing_id) AS source_ids,
       ARRAY(SELECT l.external_listing_id FROM property_source_links l
             WHERE l.property_id=p.id AND l.source=$1 AND l.status<>'active'
             ORDER BY l.external_listing_id) AS source_review_ids,
       ARRAY(SELECT f.field_name FROM property_sync_fields f
             WHERE f.property_id=p.id AND (f.active_override OR f.selection_reason='manual_override'
               OR f.winning_observation_id IS NULL
               OR (f.field_name IN ('price','rent','status') AND
                   CASE WHEN f.field_name IN ('price','rent')
                          AND jsonb_typeof(f.last_published_value) IN ('number','string')
                          AND (f.last_published_value #>> '{}') ~ '^[0-9]{1,16}(\.[0-9]{1,8})?$'
                     THEN (f.last_published_value #>> '{}')::numeric
                            IS DISTINCT FROM (to_jsonb(p)->>f.field_name)::numeric
                     ELSE f.last_published_value IS DISTINCT FROM to_jsonb(p)->f.field_name
                   END))
             UNION
             SELECT field FROM (VALUES ('price', p.price::text), ('rent', p.rent::text),
               ('status', p.status::text)) AS current_fields(field, value)
             WHERE value IS NOT NULL AND NOT EXISTS(SELECT 1 FROM property_sync_fields f
               WHERE f.property_id=p.id AND f.field_name=field)
             UNION
             SELECT field FROM jsonb_object_keys(coalesce(o.shared, '{}'::jsonb) ||
               CASE p.deal_type WHEN 'sale' THEN coalesce(o.sale, '{}'::jsonb)
               ELSE coalesce(o.rent, '{}'::jsonb) END) field) AS override_fields
FROM properties p
LEFT JOIN property_public_members m ON m.property_id=p.id
LEFT JOIN property_public_groups g ON g.public_listing_no=m.public_listing_no
LEFT JOIN admin_property_overrides o ON o.property_no=m.public_listing_no
WHERE ($1='28hse_agent_540' AND p.canonical_property_no IS NOT NULL)
   OR EXISTS(SELECT 1 FROM property_source_links l
             WHERE l.property_id=p.id AND l.source=$1)
ORDER BY p.id;
