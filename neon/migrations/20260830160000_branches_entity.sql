-- /agents and PropertyDecisionActions resolve branch contact info two
-- different ways today, and neither is a real relational link: (1)
-- resolveBranchContact() (src/config/site-branches.js) matches an
-- estate/district slug against the hardcoded SITE_BRANCHES array, and (2)
-- resolveAgentContact() (src/lib/agent-directory.ts) matches
-- staff_users.branch's free-text string against that SAME array by exact
-- name. Neither ties an agent row to a branch row -- an agent's branch is
-- just whatever string was typed into the admin form.
--
-- That free-text field is the exact source of a real, documented production
-- bug (CHANGELOG.md:79-87): a `branch ?? DEFAULT_AGENT_BRANCH.name` fallback
-- silently claimed 15 of 23 real agents worked at 麗都分行 when they didn't,
-- simply because a missing/unmatched branch defaulted to the first
-- configured one. That fallback is already removed -- a missing branch now
-- renders nothing, never a guess -- but the underlying fragility (free text,
-- no real entity, no way to safely link an agent to a branch) remains. This
-- migration gives branches a real row so a future admin action can assign
-- one correctly, without ever guessing.
--
-- `site-branches.js` stays the SEED for this table (three rows, direct
-- mirror of SITE_BRANCHES's existing id/name/address/phone/whatsapp/photo
-- values -- not new facts). estateSlugs/districtSlugs/photoWidth/
-- photoHeight are deliberately NOT carried over: resolveBranchContact()'s
-- estate/district-slug matching stays on the JS config unchanged (this
-- migration doesn't touch it), and photo intrinsic dimensions are a
-- display-only concern of AppImage, not a fact about the branch itself.
-- Once seeded, branch_id-based resolution reads from THIS table going
-- forward -- the real, admin-editable source of truth -- not from the
-- static JS file. The free-text `branch` column and its existing
-- SITE_BRANCHES-based resolution are untouched and stay the fallback path
-- for any agent not yet linked.
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  whatsapp TEXT,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO branches (slug, name, address, phone, whatsapp, photo) VALUES
  ('lido', '麗都分行', '深井麗都花園地下5A舖', '26882988', NULL, '/branches/lido.jpg'),
  ('rhine', '海韻分行', '深井海韻花園地下G3舖', '26886996', NULL, '/branches/rhine.jpg'),
  ('hong-kong-garden', '青山公路豪景分行', '青龍頭村11號地下', '26882883', NULL, '/branches/hong-kong-garden.jpg')
ON CONFLICT (slug) DO NOTHING;

-- Additive, nullable FK -- see the header comment. Every existing
-- staff_users row starts NULL: no backfill/guess of which real branch an
-- agent belongs to, even via an exact free-text-to-name match, per this
-- plan's explicit instruction not to reintroduce any unverified-fact
-- shortcut. A human links this going forward via the admin CMS agent-profile
-- form's new 分行 dropdown, which reads from this table.
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);
