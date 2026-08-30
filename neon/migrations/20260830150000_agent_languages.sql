-- /agents has no way to filter or display which language(s) an agent can
-- serve a client in -- nowhere in the schema today. Nullable and additive,
-- matching this repo's established discipline for a new per-agent fact
-- (see 20260802100000_agent_specialties.sql for specialties/
-- served_estate_slugs, added the same way): every existing row starts NULL
-- ("not yet recorded"), never a guessed default. Unlike specialties/
-- served_estate_slugs this column has no NOT NULL DEFAULT '{}' -- the public
-- query layer (public-data.server.ts) treats a NULL/missing value as "no
-- languages recorded" and renders nothing rather than fabricating one, the
-- same discipline documented for staff_users.branch (see the P5 plan's
-- ground truth on the branch-defaulting bug this project already fixed).
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS languages TEXT[];
