-- Client feedback 網頁07092026.docx p5: the homepage's live listing feed should
-- put 28Hse 黃金 listings first, then 置頂, then ordinary listings.
--
-- Nothing in this schema recorded a source's paid placement grade, so the
-- ordering had nowhere to read from. This adds the smallest normalized store
-- for it, keyed exactly the way every other per-source-listing fact in this
-- schema is keyed -- (source, external_listing_id, deal_type) -- so it joins to
-- properties through the existing property_source_links row and needs no change
-- to either ingestion generation's own identity or matching rules.
--
-- Additive and idempotent: creates one new table plus its indexes, and touches
-- no existing table, column, constraint or row. Safe to re-run.
--
-- Rollback: DROP TABLE IF EXISTS mls_source_promotion_tiers;
-- Dropping it makes every listing rank as 'unknown' again (the reader's
-- COALESCE default), which is the pre-migration behaviour -- no listing is
-- hidden, delisted or re-attributed.

CREATE TABLE IF NOT EXISTS mls_source_promotion_tiers (
  source TEXT NOT NULL CHECK (source IN ('old_site', '28hse_agent_540', 'propertyhk')),
  external_listing_id TEXT NOT NULL CHECK (length(external_listing_id) BETWEEN 1 AND 200),
  deal_type deal_type NOT NULL,
  -- 'unknown' is a real, distinct state: we did not observe a grade for this
  -- listing. It must never be silently treated as 'normal', because a public
  -- paid-tier badge on an unclassified listing would be a false claim.
  promotion_tier TEXT NOT NULL DEFAULT 'unknown'
    CHECK (promotion_tier IN ('gold', 'pinned', 'normal', 'unknown')),
  -- The grade text exactly as observed, so an unrecognised future grade can be
  -- reviewed by a human instead of being guessed into one of the four values.
  promotion_tier_raw TEXT CHECK (promotion_tier_raw IS NULL OR length(promotion_tier_raw) <= 64),
  observed_at TIMESTAMPTZ NOT NULL,
  -- Whether the crawl that produced this row was a complete, trustworthy pass.
  -- Only a complete pass is allowed to demote a listing; an incomplete one
  -- carries no evidence about placement and must not flatten valid tiers.
  snapshot_complete BOOLEAN NOT NULL DEFAULT false,
  observation_id UUID REFERENCES listing_source_observations(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_listing_id, deal_type)
);

-- Supports the homepage feed's per-property tier lookup, which filters to the
-- paid grades before joining.
CREATE INDEX IF NOT EXISTS mls_source_promotion_tiers_ranked
  ON mls_source_promotion_tiers (source, promotion_tier)
  WHERE promotion_tier IN ('gold', 'pinned');
