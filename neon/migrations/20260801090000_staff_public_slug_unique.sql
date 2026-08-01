-- staff_users.public_slug is the natural key for seeding agents from the static
-- roster. 20260710090000 already created a PARTIAL unique index on it
-- (staff_users_public_slug_unique ... WHERE public_slug IS NOT NULL), but Postgres
-- cannot infer a partial index as an ON CONFLICT arbiter unless the predicate is
-- restated, so the seed script had nothing to target. This adds a total constraint.
-- Postgres permits multiple NULLs under a unique constraint, so the admin account
-- and the leftover test row -- both with a null public_slug -- are unaffected.
--
-- Guarded because apply-migrations.mjs runs each statement in its own implicit
-- transaction and only records the version once all of them succeed. An unguarded
-- failure here commits the first statement, skips the app_migrations write, and
-- wedges every subsequent retry on the statement that already succeeded.
DO $$
BEGIN
  ALTER TABLE staff_users
    ADD CONSTRAINT staff_users_public_slug_key UNIQUE (public_slug);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- 20260622060000_public_content.sql declares this constraint inline, so every
-- database built by replaying the migration set already has it. Production's faqs
-- table pre-dated that migration and CREATE TABLE IF NOT EXISTS skipped the whole
-- statement, so production alone was missing it.
--
-- Only duplicate_object/duplicate_table are swallowed. A unique_violation means the
-- table genuinely holds duplicate (scope, question) rows and must fail loudly --
-- silently skipping would leave saveAdminFaq's ON CONFLICT with nothing to target.
DO $$
BEGIN
  ALTER TABLE faqs
    ADD CONSTRAINT faqs_scope_question_key UNIQUE (scope, question);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
