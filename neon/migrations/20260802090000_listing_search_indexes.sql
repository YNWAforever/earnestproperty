-- /listings runs the same shape on every request: WHERE p.status = 'active'
-- (true for nearly every row, so idx_properties_status is never selective)
-- plus optional filters, then
-- ORDER BY p.featured DESC, p.last_seen_at DESC NULLS LAST, p.created_at DESC
-- LIMIT/OFFSET (see searchListings in src/lib/neon/public-data.server.ts).
-- Without a matching index the planner sorts the whole active set on every
-- page. This partial index matches the ORDER BY term for term -- including
-- NULLS LAST, which must be restated or the index cannot be used -- and is
-- restricted to the only status the public listing queries ever ask for.
CREATE INDEX IF NOT EXISTS idx_properties_active_sort
  ON properties (featured DESC, last_seen_at DESC NULLS LAST, created_at DESC)
  WHERE status = 'active';

-- Deliberately not added here:
-- - btree indexes on price/bedrooms: both are optional predicates on a table
--   where the new keyword LIKE filter (see listingWhere) already forces a
--   sequential scan when present, and bedrooms is NULL on many legacy rows.
--   Not worth the write overhead at this corpus size.
-- - a pg_trgm GIN index for the keyword LIKE: the searched text spans a JOIN
--   (properties p LEFT JOIN estates e), and Postgres cannot use a single
--   index across two tables, so it would only ever cover half the haystack.
