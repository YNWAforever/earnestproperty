-- Rollback for neon/migrations/20261007100000_wa_access_unassigned.sql.
-- Restores the wa_can_read_enquiry and wa_can_read_conversation bodies from
-- 20260929104000_whatsapp_enquiry_access.sql verbatim (managers limited to their
-- own branch).
--
-- This file lives outside neon/migrations on purpose: npm run neon:migrate and the
-- migration drift check never discover it. Apply it by hand, with owner approval.
-- It leaves the forward migration's app_migrations row in place, so the drift check
-- still reports up to date and neon:migrate will not re-apply the forward file;
-- re-apply the forward file by hand if needed.
CREATE OR REPLACE FUNCTION wa_can_read_enquiry(p_actor uuid,p_inquiry uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
   SELECT a.active AND (
     EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
       AND a.branch_id IS NOT NULL
       AND a.branch_id=COALESCE(owner.branch_id,assignee.branch_id))
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='agent')
       AND (i.enquiry_owner_staff_id=a.id OR c.assigned_agent_id=a.id))
   )
   FROM inquiries i JOIN whatsapp_conversations c ON c.id=i.conversation_id
   JOIN staff_users a ON a.id=p_actor
   LEFT JOIN staff_users owner ON owner.id=i.enquiry_owner_staff_id
   LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
   WHERE i.id=p_inquiry AND i.source='whatsapp'
 ),false)
$$;
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
