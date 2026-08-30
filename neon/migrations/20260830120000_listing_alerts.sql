-- /listings' zero-results state today only offers a WhatsApp "講低預算" CTA
-- (SearchFallbackCTA) that hands the buyer off to a chat and records nothing
-- server-side -- if they never send that message, the search that found
-- nothing is gone the moment they close the tab. This table lets the
-- zero-results notify-me form capture "tell me when a matching listing
-- appears" as a real, queryable request instead of letting the lead
-- disappear.
--
-- Deliberately its OWN table, not a write into crm_contacts/inquiries: this
-- consent is narrower than crm_contacts.opt_in_whatsapp ("opt in to
-- WhatsApp marketing broadly") -- it is consent to be notified about ONE
-- specific saved search. Reusing the shared contact-level flag would
-- conflate the two. consent_text/consent_version/consented_at (rather than
-- a bare boolean) exist so that if the copy shown at signup ever changes,
-- it stays possible to tell exactly which wording a given row's consent
-- actually covers.

DO $$
BEGIN
  CREATE TYPE listing_alert_status AS ENUM ('active', 'paused', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS listing_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The validated /listings search-params object, JSON-serialized verbatim --
  -- the same shape Task 4's localStorage-backed saved searches already use
  -- (see saveSearch() in src/lib/saved-listings.ts), so a future "convert a
  -- saved search into an alert" feature would not need to reshape anything.
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,
  status listing_alert_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_alerts_status ON listing_alerts(status);
CREATE INDEX IF NOT EXISTS idx_listing_alerts_created_at ON listing_alerts(created_at);
