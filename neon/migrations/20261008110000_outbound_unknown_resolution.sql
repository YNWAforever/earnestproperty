-- FX-08 / D-02. Releases the lock by moving out of (dispatching, unknown). Sends nothing.
-- Rollback: `neon/reverts/20261008110000_outbound_unknown_resolution_revert.sql`.
--
-- A manager resolves an unknown outbound intent to resolved_sent or resolved_not_sent.
-- Both are terminal and outside the reservation lock states, so the existing reservation
-- trigger and its function are left exactly as they are.
-- Additive and re-runnable. Nullable columns with no fill, a widened CHECK and a new
-- guard trigger. No intent row is written or rewritten here.
--
-- Comments here avoid semicolons and quotes because apply-migrations.mjs splits
-- the file on them.

SET LOCAL lock_timeout = '5s';

ALTER TABLE whatsapp_outbound_intents
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolution_reason text;

-- Replace the unnamed inline state CHECK with a named one that also allows the two
-- resolved states. Guarded through pg_constraint so a re-run changes nothing.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_outbound_intents_state_check'
      AND conrelid = 'whatsapp_outbound_intents'::regclass
  ) THEN
    ALTER TABLE whatsapp_outbound_intents DROP CONSTRAINT whatsapp_outbound_intents_state_check;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wa_intent_state_check'
      AND conrelid = 'whatsapp_outbound_intents'::regclass
  ) THEN
    ALTER TABLE whatsapp_outbound_intents ADD CONSTRAINT wa_intent_state_check
      CHECK (state IN ('queued','dispatching','accepted','unknown','failed','cancelled','resolved_sent','resolved_not_sent'));
  END IF;
END $$;

-- The resolved states are reachable only from unknown, only with actor, time and reason,
-- and are final.
CREATE OR REPLACE FUNCTION wa_guard_outbound_resolution()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IN ('resolved_sent','resolved_not_sent') THEN
      RAISE EXCEPTION 'OUTBOUND_RESOLUTION_INVALID';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;
  -- Nothing leaves a resolved state, neither provider evidence nor lease recovery.
  IF OLD.state IN ('resolved_sent','resolved_not_sent') THEN
    RAISE EXCEPTION 'OUTBOUND_RESOLUTION_FINAL';
  END IF;
  IF NEW.state IN ('resolved_sent','resolved_not_sent') AND (
    OLD.state <> 'unknown'
    OR NEW.resolved_at IS NULL
    OR NEW.resolved_by IS NULL
    OR NEW.resolution_reason IS NULL
  ) THEN
    RAISE EXCEPTION 'OUTBOUND_RESOLUTION_INVALID';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wa_intent_resolution_guard ON whatsapp_outbound_intents;
CREATE TRIGGER wa_intent_resolution_guard
  BEFORE INSERT OR UPDATE OF state ON whatsapp_outbound_intents
  FOR EACH ROW EXECUTE FUNCTION wa_guard_outbound_resolution();
