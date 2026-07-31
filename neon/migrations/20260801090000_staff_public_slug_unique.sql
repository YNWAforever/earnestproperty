-- staff_users.public_slug is the natural key for seeding agents from the static
-- roster, but no unique constraint was ever created, so ON CONFLICT has nothing
-- to target. Postgres permits multiple NULLs under a unique constraint, so the
-- two existing rows (the admin account and a leftover test row, both with a null
-- public_slug) are unaffected.
ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_public_slug_key UNIQUE (public_slug);

-- 20260622060000_public_content.sql declares this constraint inline, but the faqs
-- table pre-dated that migration and CREATE TABLE IF NOT EXISTS skipped the whole
-- statement, so production never got it. saveAdminFaq does a bare INSERT with no
-- conflict handling, which means importing the same file twice through the admin
-- panel silently creates duplicates.
ALTER TABLE faqs
  ADD CONSTRAINT faqs_scope_question_key UNIQUE (scope, question);
