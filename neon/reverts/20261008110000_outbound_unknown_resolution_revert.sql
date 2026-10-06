-- Rollback for neon/migrations/20261008110000_outbound_unknown_resolution.sql.
-- Drops only the resolution guard trigger and its function.
--
-- It deliberately keeps the widened state CHECK (wa_intent_state_check) and the
-- resolved_at, resolved_by and resolution_reason columns. Older application code never
-- writes the resolved states, and narrowing the CHECK would fail once any intent has been
-- resolved. Resolved rows stay resolved and keep their audit trail.
--
-- This file lives outside neon/migrations on purpose: npm run neon:migrate and the
-- migration drift check never discover it. Apply it by hand, with owner approval.
-- It leaves the forward migration app_migrations row in place, so the drift check
-- still reports up to date and neon:migrate will not re-apply the forward file.
-- Re-apply the forward file by hand if needed.
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS wa_intent_resolution_guard ON whatsapp_outbound_intents;
DROP FUNCTION IF EXISTS wa_guard_outbound_resolution();
