-- Rollback for neon/migrations/20261007100000_wa_access_unassigned.sql.
-- Restores the wa_can_read_conversation body from
-- 20260929104000_whatsapp_enquiry_access.sql verbatim (managers limited to
-- conversations assigned to staff in their own branch).
--
-- This file lives outside neon/migrations on purpose: npm run neon:migrate and the
-- migration drift check never discover it. Apply it by hand, with owner approval.
-- It does not remove the app_migrations row of the forward migration.
CREATE OR REPLACE FUNCTION wa_can_read_conversation(p_actor uuid,p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
   SELECT a.active AND (
     EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
       AND a.branch_id IS NOT NULL AND a.branch_id=assignee.branch_id)
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='agent')
       AND c.assigned_agent_id=a.id)
   )
   FROM whatsapp_conversations c JOIN staff_users a ON a.id=p_actor
   LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
   WHERE c.id=p_conversation
 ),false)
$$;
