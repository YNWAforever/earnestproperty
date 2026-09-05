-- Persistent public identity for property offerings. `properties` remains the
-- source-history and inquiry target table; this migration only adds aliases.
CREATE TABLE IF NOT EXISTS property_public_groups (
  public_listing_no TEXT PRIMARY KEY,
  canonical_property_no TEXT,
  review_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_public_groups_canonical ON property_public_groups (canonical_property_no);
CREATE TABLE IF NOT EXISTS property_public_members (
  property_id UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  public_listing_no TEXT NOT NULL REFERENCES property_public_groups(public_listing_no),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_property_public_members_group ON property_public_members (public_listing_no, property_id);

CREATE OR REPLACE FUNCTION assign_property_public_identity(target_property_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  candidate properties%ROWTYPE;
  canonical_no TEXT;
  compatible_group TEXT;
  compatible_group_count INTEGER := 0;
  chosen_public_listing_no TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM property_public_members WHERE property_id = target_property_id) THEN RETURN; END IF;
  SELECT * INTO candidate FROM properties WHERE id = target_property_id;
  IF NOT FOUND THEN RETURN; END IF;
  canonical_no := NULLIF(upper(regexp_replace(trim(candidate.canonical_property_no), '\s+', '', 'g')), '');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'property-public:' || COALESCE(canonical_no, candidate.listing_no), 0
  ));
  IF canonical_no IS NOT NULL THEN
    SELECT min(g.public_listing_no), count(*)::int INTO compatible_group, compatible_group_count
    FROM property_public_groups g
    WHERE g.canonical_property_no = canonical_no
      AND NOT EXISTS (
        SELECT 1 FROM property_public_members m JOIN properties existing ON existing.id = m.property_id
        WHERE m.public_listing_no = g.public_listing_no AND (
          (candidate.estate_id IS NOT NULL AND existing.estate_id IS NOT NULL AND candidate.estate_id <> existing.estate_id)
          OR (candidate.district_slug IS NOT NULL AND existing.district_slug IS NOT NULL AND candidate.district_slug <> existing.district_slug)
          OR (candidate.saleable_area IS NOT NULL AND existing.saleable_area IS NOT NULL AND candidate.saleable_area <> existing.saleable_area)
          OR (candidate.gross_area IS NOT NULL AND existing.gross_area IS NOT NULL AND candidate.gross_area <> existing.gross_area)
          OR (candidate.bedrooms IS NOT NULL AND existing.bedrooms IS NOT NULL AND candidate.bedrooms <> existing.bedrooms)
          OR (NULLIF(lower(regexp_replace(trim(candidate.floor), '\s+', '', 'g')), '') IS NOT NULL
              AND NULLIF(lower(regexp_replace(trim(existing.floor), '\s+', '', 'g')), '') IS NOT NULL
              AND NULLIF(lower(regexp_replace(trim(candidate.floor), '\s+', '', 'g')), '') <>
                  NULLIF(lower(regexp_replace(trim(existing.floor), '\s+', '', 'g')), ''))
        )
      );
  END IF;
  IF compatible_group_count = 1 THEN
    chosen_public_listing_no := compatible_group;
  ELSIF compatible_group_count = 0 AND canonical_no IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM property_public_groups WHERE public_listing_no = canonical_no) THEN
    chosen_public_listing_no := canonical_no;
    INSERT INTO property_public_groups(public_listing_no, canonical_property_no) VALUES (chosen_public_listing_no, canonical_no);
  ELSE
    chosen_public_listing_no := candidate.listing_no;
    INSERT INTO property_public_groups(public_listing_no, canonical_property_no, review_required)
      VALUES (chosen_public_listing_no, canonical_no, true)
      ON CONFLICT (public_listing_no) DO UPDATE SET review_required = true, updated_at = now();
    IF canonical_no IS NOT NULL THEN
      UPDATE property_public_groups SET review_required = true, updated_at = now() WHERE canonical_property_no = canonical_no;
    END IF;
  END IF;
  INSERT INTO property_public_members(property_id, public_listing_no)
    VALUES (candidate.id, chosen_public_listing_no) ON CONFLICT (property_id) DO NOTHING;
END;
$$;

DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT id FROM properties ORDER BY created_at ASC NULLS LAST, listing_no ASC, id ASC LOOP
    PERFORM assign_property_public_identity(item.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION assign_property_public_identity_after_insert_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assign_property_public_identity(NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assign_property_public_identity_after_insert ON properties;
CREATE TRIGGER assign_property_public_identity_after_insert
AFTER INSERT ON properties FOR EACH ROW EXECUTE FUNCTION assign_property_public_identity_after_insert_fn();

CREATE OR REPLACE FUNCTION revalidate_property_public_identity_after_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  existing_public_listing_no TEXT;
  existing_member_count INTEGER;
BEGIN
  IF NEW.canonical_property_no IS DISTINCT FROM OLD.canonical_property_no
     OR NEW.estate_id IS DISTINCT FROM OLD.estate_id
     OR NEW.district_slug IS DISTINCT FROM OLD.district_slug
     OR NEW.saleable_area IS DISTINCT FROM OLD.saleable_area
     OR NEW.gross_area IS DISTINCT FROM OLD.gross_area
     OR NEW.bedrooms IS DISTINCT FROM OLD.bedrooms
     OR NEW.floor IS DISTINCT FROM OLD.floor THEN
    -- Serialize revalidation with both old and new canonical assignment keys.
    -- Sorting the two keys gives concurrent corrections one lock order.
    PERFORM pg_advisory_xact_lock(hashtextextended('property-public:' || lock_key, 0))
    FROM (
      SELECT DISTINCT lock_key
      FROM unnest(ARRAY[
        COALESCE(NULLIF(upper(regexp_replace(trim(OLD.canonical_property_no), '\s+', '', 'g')), ''), OLD.listing_no),
        COALESCE(NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no), '\s+', '', 'g')), ''), NEW.listing_no)
      ]) AS keys(lock_key)
      ORDER BY lock_key
    ) ordered_locks;

    SELECT m.public_listing_no,
      (SELECT count(*)::int FROM property_public_members peers WHERE peers.public_listing_no = m.public_listing_no)
      INTO existing_public_listing_no, existing_member_count
    FROM property_public_members m WHERE m.property_id = NEW.id;

    IF existing_member_count = 1 THEN
      -- A stable public URL already issued for a sole-member group remains an
      -- alias even if the source later corrects its canonical/physical facts.
      UPDATE property_public_groups
      SET canonical_property_no = NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no), '\s+', '', 'g')), ''),
          updated_at = now()
      WHERE public_listing_no = existing_public_listing_no;
    ELSE
      DELETE FROM property_public_members WHERE property_id = NEW.id;
      PERFORM assign_property_public_identity(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS revalidate_property_public_identity_after_update ON properties;
CREATE TRIGGER revalidate_property_public_identity_after_update
AFTER UPDATE OF canonical_property_no, estate_id, district_slug, saleable_area, gross_area, bedrooms, floor
ON properties FOR EACH ROW EXECUTE FUNCTION revalidate_property_public_identity_after_update_fn();
