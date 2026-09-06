-- The business property number is authoritative identity. Physical facts may
-- disagree across agent source records; they must never split public identity.
-- Original source rows, inquiry IDs and source listing aliases remain intact.
LOCK TABLE properties IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION assign_property_public_identity(target_property_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  candidate properties%ROWTYPE;
  canonical_no TEXT;
  chosen_public_listing_no TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM property_public_members WHERE property_id = target_property_id) THEN RETURN; END IF;
  SELECT * INTO candidate FROM properties WHERE id = target_property_id;
  IF NOT FOUND THEN RETURN; END IF;
  canonical_no := NULLIF(upper(regexp_replace(trim(candidate.canonical_property_no), '\s+', '', 'g')), '');
  PERFORM pg_advisory_xact_lock(hashtextextended('property-public:' || COALESCE(canonical_no, candidate.listing_no), 0));
  SELECT g.public_listing_no INTO chosen_public_listing_no
  FROM property_public_groups g
  WHERE canonical_no IS NOT NULL AND g.canonical_property_no = canonical_no
  ORDER BY (g.public_listing_no = canonical_no) DESC, g.created_at, g.public_listing_no LIMIT 1;
  chosen_public_listing_no := COALESCE(chosen_public_listing_no, canonical_no, candidate.listing_no);
  INSERT INTO property_public_groups(public_listing_no, canonical_property_no)
    VALUES (chosen_public_listing_no, canonical_no) ON CONFLICT (public_listing_no) DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM property_public_members m JOIN properties existing ON existing.id=m.property_id
    WHERE m.public_listing_no=chosen_public_listing_no AND (
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
  ) THEN
    UPDATE property_public_groups SET review_required=true, updated_at=now()
      WHERE public_listing_no=chosen_public_listing_no;
  END IF;
  INSERT INTO property_public_members(property_id, public_listing_no)
    VALUES(candidate.id, chosen_public_listing_no) ON CONFLICT(property_id) DO NOTHING;
END;
$$;

-- Retain old group rows for audit, consolidate their memberships into the
-- already issued canonical group. Source listing aliases resolve via members.
WITH choices AS (
 SELECT DISTINCT ON (canonical_property_no) canonical_property_no, public_listing_no
 FROM property_public_groups WHERE canonical_property_no IS NOT NULL
 ORDER BY canonical_property_no, (public_listing_no=canonical_property_no) DESC, created_at, public_listing_no
)
UPDATE property_public_groups target SET review_required=true, updated_at=now()
FROM choices c WHERE target.public_listing_no=c.public_listing_no AND EXISTS (
 SELECT 1 FROM property_public_groups old WHERE old.canonical_property_no=c.canonical_property_no AND old.review_required
);
WITH choices AS (
 SELECT DISTINCT ON (canonical_property_no) canonical_property_no, public_listing_no
 FROM property_public_groups WHERE canonical_property_no IS NOT NULL
 ORDER BY canonical_property_no, (public_listing_no=canonical_property_no) DESC, created_at, public_listing_no
)
UPDATE property_public_members m SET public_listing_no=c.public_listing_no
FROM property_public_groups old, choices c
WHERE m.public_listing_no=old.public_listing_no AND old.canonical_property_no=c.canonical_property_no
 AND m.public_listing_no<>c.public_listing_no;

CREATE OR REPLACE FUNCTION revalidate_property_public_identity_after_update_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  existing_public_listing_no TEXT;
  existing_member_count INTEGER;
  canonical_no TEXT;
BEGIN
  -- The assignment function records conflicting facts but always uses one
  -- group for the number. Reassignment is also safe for source corrections.
  PERFORM pg_advisory_xact_lock(hashtextextended('property-public:' || lock_key, 0))
  FROM (
    SELECT DISTINCT lock_key FROM unnest(ARRAY[
      COALESCE(NULLIF(upper(regexp_replace(trim(OLD.canonical_property_no), '\s+', '', 'g')), ''), OLD.listing_no),
      COALESCE(NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no), '\s+', '', 'g')), ''), NEW.listing_no)
    ]) AS keys(lock_key) ORDER BY lock_key
  ) ordered_locks;
  canonical_no := NULLIF(upper(regexp_replace(trim(NEW.canonical_property_no), '\s+', '', 'g')), '');
  SELECT m.public_listing_no,
    (SELECT count(*)::int FROM property_public_members peers WHERE peers.public_listing_no=m.public_listing_no)
  INTO existing_public_listing_no, existing_member_count
  FROM property_public_members m WHERE m.property_id=NEW.id;
  IF existing_member_count=1 AND NEW.canonical_property_no IS DISTINCT FROM OLD.canonical_property_no
     AND NOT EXISTS (SELECT 1 FROM property_public_groups WHERE canonical_property_no=canonical_no AND public_listing_no<>existing_public_listing_no) THEN
    UPDATE property_public_groups SET canonical_property_no=canonical_no, updated_at=now()
      WHERE public_listing_no=existing_public_listing_no;
  END IF;
  DELETE FROM property_public_members WHERE property_id=NEW.id;
  PERFORM assign_property_public_identity(NEW.id);
  RETURN NEW;
END;
$$;
