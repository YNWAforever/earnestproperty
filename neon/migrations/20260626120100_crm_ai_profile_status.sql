-- Track whether a CRM AI profile was produced by the model or by the deterministic
-- fallback path. When generateAiJson reports ai.ok === false we still persist a canned
-- profile so staff have something to work with, but it must be distinguishable from a
-- genuine AI-generated profile (and surfaced rather than reported as silent success).
ALTER TABLE crm_ai_profiles
  ADD COLUMN IF NOT EXISTS generated_by TEXT NOT NULL DEFAULT 'ai';
