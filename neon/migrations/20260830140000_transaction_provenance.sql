-- /transactions today renders every row in the `transactions` table with no
-- provenance or verification at all -- a scraped/estimated figure sits next
-- to a genuinely confirmed one, indistinguishable to a reader. This adds the
-- columns needed to gate public rendering on "a human verified this row",
-- matching the "don't fabricate, gate on real verification" discipline this
-- project has followed since P2's DR-5 (estates.verified_at) and P4's
-- estate-expansion published-gate (20260830130000_estate_expansion.sql).
--
-- Every existing row gets verification_state = 'unverified' and
-- published = false (both column defaults below) -- nobody has reviewed any
-- of them yet, so the public queries this same P5 task updates
-- (fetchRecentTransactions/fetchDistrictTransactions/fetchEstateTransactions
-- in src/lib/neon/public-data.server.ts) will legitimately return nothing
-- until a human verifies real rows through the admin CMS. That is the
-- correct, honest behaviour -- not a bug to work around by defaulting either
-- column to true.
--
-- verification_state is a Postgres ENUM, not a bare TEXT/CHECK column --
-- matching this repo's own precedent for a small, fixed set of states
-- (listing_alerts.status's listing_alert_status enum, added one migration
-- earlier in 20260830120000_listing_alerts.sql), rather than the older
-- bare-TEXT approach properties.status/inquiries.status used before that
-- precedent existed.
--
-- agent_id records the staff member currently responsible for this
-- transaction record -- the same "current assignment" meaning as
-- properties.agent_id, not "who verified it" (that fact lives in
-- verification_state/verified_at above, which never move). It is therefore
-- listed in STAFF_OWNERSHIP_COLUMNS (src/lib/neon/staff-ownership.ts) and
-- reassigned by the same staff-deactivation handover properties.agent_id
-- already goes through. Nullable, since no existing row has one and nothing
-- should guess an assignment.
--
-- block/floor_band/social_state are nullable additive facts about the deal
-- itself (social_state tracks whether/how a verified deal has been used in a
-- social post) -- none of them are known for any existing row either.

DO $$
BEGIN
  CREATE TYPE transaction_verification_state AS ENUM ('unverified', 'pending', 'verified');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS verification_state transaction_verification_state NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block TEXT,
  ADD COLUMN IF NOT EXISTS floor_band TEXT,
  ADD COLUMN IF NOT EXISTS social_state TEXT;

-- Every public transaction query now filters on exactly this pair -- see
-- transactionsWhere()/fetchDistrictTransactions()/fetchEstateTransactions()
-- in src/lib/neon/public-data.server.ts.
CREATE INDEX IF NOT EXISTS idx_transactions_published_verified
  ON transactions(published, verification_state);
