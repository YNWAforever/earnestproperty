-- FX-06 / B-01 (owner decision D2 and the 2026-10-06 follow-up): admins and
-- managers see and act on every WhatsApp conversation, company-wide, including
-- unassigned ones and other branches. Agents stay limited to conversations
-- assigned to them. Inactive staff and viewers still see nothing.
--
-- Function replace only. The body is the previous definition from
-- 20260929104000_whatsapp_enquiry_access.sql with the manager branch condition
-- removed; a.active, STABLE, the signature, the COALESCE(..., false) wrapper, the
-- admin branch and the agent branch are unchanged. wa_can_reply_enquiry is not
-- touched, so replying on a linked enquiry still requires the conversation to be
-- assigned to and confirmed for the actor.
--
-- Rollback (owner-approved only): neon/reverts/20261007100000_wa_access_unassigned_revert.sql
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
