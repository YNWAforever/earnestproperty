-- Repair missing foreign keys for unambiguous estate-name prefixes only.
-- Existing explicit links remain authoritative; 臺/台 and spacing are equivalent.
CREATE OR REPLACE FUNCTION assign_missing_listing_estate_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE matching_ids UUID[];
BEGIN
 IF NEW.estate_id IS NOT NULL THEN RETURN NEW; END IF;
 SELECT array_agg(e.id) INTO matching_ids FROM estates e
 WHERE NULLIF(trim(e.name_zh),'') IS NOT NULL
 AND starts_with(
   lower(regexp_replace(replace(replace(COALESCE(NEW.title_zh,''),'香港黃金海岸','黃金海岸'),'臺','台'),'[[:space:]‧·]','','g')),
   lower(regexp_replace(replace(e.name_zh,'臺','台'),'[[:space:]‧·]','','g'))
 );
 IF array_length(matching_ids,1)=1 THEN NEW.estate_id:=matching_ids[1]; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assign_missing_listing_estate ON properties;
CREATE TRIGGER assign_missing_listing_estate
BEFORE INSERT OR UPDATE OF title_zh,estate_id ON properties
FOR EACH ROW EXECUTE FUNCTION assign_missing_listing_estate_fn();
UPDATE properties SET estate_id=estate_id WHERE estate_id IS NULL;
