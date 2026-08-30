-- OwnerValuationPanel today is WhatsApp-only: a business owner reads "我要放盤
-- 估價" and taps a wa.me deep link -- exactly like SearchFallbackCTA before
-- listing_alerts existed, this records nothing server-side, so an owner who
-- reads the link but never actually opens WhatsApp (or opens it and never
-- sends) leaves no trace the enquiry ever happened. This table gives that a
-- structured, queryable alternative ALONGSIDE the WhatsApp link, not
-- replacing it -- the same "offer a structured path without removing the
-- WhatsApp-first option" choice already made for /listings' zero-results
-- notify-me form (see 20260830120000_listing_alerts.sql).
--
-- Deliberately its own table, not a write into crm_contacts/inquiries, for
-- the same reason listing_alerts is its own table: this consent is narrower
-- than crm_contacts.opt_in_whatsapp ("opt in to WhatsApp marketing
-- broadly") -- it is consent to be contacted about ONE specific valuation
-- request. consent_text/consent_version/consented_at (rather than a bare
-- boolean) exist so that if the copy shown at signup ever changes, it stays
-- possible to tell exactly which wording a given row's consent actually
-- covers.

DO $$
BEGIN
  CREATE TYPE valuation_lead_status AS ENUM ('new', 'contacted', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS valuation_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  -- Free-text description of the property being valued -- an owner may type
  -- a building name, a rough location, or just an estate name, so this stays
  -- a plain string rather than forcing a lookup against `estates` before the
  -- form can even submit.
  property_address TEXT NOT NULL,
  -- Set only when the panel is rendered from a known estate page
  -- (estate.$slug.tsx passes its own already-loaded estate.id) -- never
  -- guessed or resolved from property_address's free text. NULL on every
  -- homepage submission, where no specific estate is in context.
  estate_id UUID REFERENCES estates(id) ON DELETE SET NULL,
  -- Rough size/condition notes -- optional, free text.
  notes TEXT,
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL DEFAULT 'website',
  utm JSONB NOT NULL DEFAULT '{}'::jsonb,
  status valuation_lead_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_valuation_leads_status ON valuation_leads(status);
CREATE INDEX IF NOT EXISTS idx_valuation_leads_created_at ON valuation_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_valuation_leads_estate_id ON valuation_leads(estate_id);
