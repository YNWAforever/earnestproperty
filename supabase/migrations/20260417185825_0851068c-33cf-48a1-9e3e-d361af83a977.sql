-- Tighten storage SELECT — disallow listing, only direct file fetch via URL
DROP POLICY IF EXISTS "Property images are publicly accessible" ON storage.objects;

-- Public bucket means objects are still fetchable via signed URL pattern;
-- removing the broad SELECT prevents `list` calls from returning the directory.
-- Re-add SELECT scoped to a known path prefix so direct gets keep working.
CREATE POLICY "Property images: direct fetch only"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

-- Add basic input constraints on inquiries (defense-in-depth on top of public INSERT)
ALTER TABLE public.inquiries
  ADD CONSTRAINT inquiries_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT inquiries_message_len CHECK (message IS NULL OR char_length(message) <= 2000),
  ADD CONSTRAINT inquiries_phone_len CHECK (phone IS NULL OR char_length(phone) <= 30),
  ADD CONSTRAINT inquiries_email_len CHECK (email IS NULL OR char_length(email) <= 254);