-- Old-site inventory capture (Phase 1 of the legacy-site sync plan).
--
-- The legacy earnestproperty.com.hk listing detail pages carry facts the 28hse
-- stream cannot provide: the unit, the year the building was completed, the
-- lease expiry year, the property use, the raw contact block and the remark.
-- Capture them additively so the public listing page and the estate/area
-- aggregations can use them later without re-crawling 635 detail pages.
--
-- `remarks` is internal only. On some legacy pages 備註 holds the company
-- licence number (e.g. "C-018613") instead of a property feature, so it must
-- never be rendered as listing copy -- it is stored for audit/review only.
--
-- `source_payload` keeps the full parsed detail table (label -> value), the
-- contact list and the psf facts. It is JSONB rather than more columns because
-- the legacy label set drifts between pages and a future fact should be
-- recoverable from history, not from another crawl.
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS unit_no TEXT,
  ADD COLUMN IF NOT EXISTS year_completed INTEGER,
  ADD COLUMN IF NOT EXISTS lease_expiry_year INTEGER,
  ADD COLUMN IF NOT EXISTS property_use TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS source_payload JSONB;

COMMENT ON COLUMN properties.remarks IS
  'Internal only: legacy 備註, sometimes the company licence number, never rendered publicly.';
COMMENT ON COLUMN properties.source_payload IS
  'Parsed legacy detail payload (parser, rawFields, contacts, psf) for reuse and audit.';

-- Some legacy listings cannot be tied to an estate in `estates` and their
-- street text names no known corridor district. Tagging them with a guessed
-- district (the old importer fell back to "tsuen-wan", which is not a district
-- in this site's model) silently mis-files stock on the district pages, so the
-- sync writes NULL instead and reports the row for review. `properties` still
-- had the original NOT NULL from 20260622; readers already tolerate an empty
-- value (`stringOrEmpty` in public-data.server.ts, and the branch/JSON-LD
-- consumers in property.$listingNo.tsx treat falsy as "no district"). District
-- pages join on a concrete slug, so a NULL row is simply absent there rather
-- than misfiled.
ALTER TABLE properties
  ALTER COLUMN district_slug DROP NOT NULL;
