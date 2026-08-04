-- Agent detail pages promise expertise ("熟悉深井、青山公路及汀九市場") with no
-- fields to back it up: NeonPublicAgentProfile had only bio (already rendered,
-- just empty for every agent), with no specialisation or served-estate data
-- anywhere in the schema. Content is client-supplied and lands separately via
-- /admin/agents; this just adds the columns and a safe default so every
-- existing row reads as "no specialties yet" rather than NULL.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS specialties TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS served_estate_slugs TEXT[] NOT NULL DEFAULT '{}';
