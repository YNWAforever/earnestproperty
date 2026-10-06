-- FX-06 / B-01 (owner decision D2, 2026-10-06 follow-ups): admins and managers
-- see and act on every WhatsApp conversation, company-wide, including unassigned
-- ones and other branches, and managers read every WhatsApp enquiry. Agents stay
-- limited to their own conversations and enquiries. Inactive staff and viewers
-- still see nothing.
--
-- Function replace only. Both bodies are the previous definitions from
-- 20260929104000_whatsapp_enquiry_access.sql with only the manager branch condition
-- removed; a.active, STABLE, the signatures, the COALESCE(..., false) wrappers, the
-- admin branches and the agent branches are unchanged. wa_can_correct_enquiry stays
-- branch-scoped and wa_can_reply_enquiry is not touched: a reply on an open explicit
-- customer-statement enquiry without a link-open still needs the conversation to be
-- assigned to and confirmed for the actor.
--
-- Rollback (owner-approved only): neon/reverts/20261007100000_wa_access_unassigned_revert.sql
CREATE OR REPLACE FUNCTION wa_can_read_enquiry(p_actor uuid,p_inquiry uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((
   SELECT a.active AND (
     EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='admin')
     OR EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
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
     OR EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='manager')
     OR (EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role::text='agent')
       AND c.assigned_agent_id=a.id)
   )
   FROM whatsapp_conversations c JOIN staff_users a ON a.id=p_actor
   LEFT JOIN staff_users assignee ON assignee.id=c.assigned_agent_id
   WHERE c.id=p_conversation
 ),false)
$$;
