-- FX-17a L-02 dry run. READ ONLY. Lists candidate test records; changes nothing.
-- The owner runs it on a Neon branch of production (or production with a read-only role),
-- names the records to act on, and takes a branch/snapshot BEFORE any change.
BEGIN TRANSACTION READ ONLY;

-- 1. Staff that look like test identities.
SELECT 'staff' AS kind, s.id, COALESCE(NULLIF(s.name_zh,''), s.name_en) AS name,
       s.email, s.active, s.created_at
FROM staff_users s
WHERE s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%'
   OR s.name_zh LIKE '%測試%'
ORDER BY s.created_at;

-- 2. Live WhatsApp routing that points at those staff.
SELECT 'wa_mapping' AS kind, c.id, c.staff_id, c.eligible, c.retired_at
FROM whatsapp_staff_channels c JOIN staff_users s ON s.id = c.staff_id
WHERE c.retired_at IS NULL
  AND (s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%' OR s.name_zh LIKE '%測試%');

-- 3. Enabled source links that route to them.
SELECT 'link' AS kind, l.id, l.code, v.public_listing_no, v.requested_staff_id
FROM whatsapp_tracking_links l
JOIN whatsapp_tracking_link_versions v ON v.link_id = l.id AND v.version = l.current_version
JOIN staff_users s ON s.id = v.requested_staff_id
WHERE v.enabled
  AND (s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%' OR s.name_zh LIKE '%測試%');

-- 4. Open conversations owned by them (no phone numbers printed).
SELECT 'conversation' AS kind, w.id, w.status, w.assigned_agent_id, w.confirmed_staff_id
FROM whatsapp_conversations w JOIN staff_users s ON s.id IN (w.assigned_agent_id, w.confirmed_staff_id)
WHERE w.status <> 'closed'
  AND (s.name_zh ILIKE '%test%' OR s.name_en ILIKE '%test%' OR s.email ILIKE '%test%' OR s.name_zh LIKE '%測試%');

-- 5. Test leads (only the last 4 phone digits).
SELECT 'lead' AS kind, l.id, l.stage, l.source, c.name, right(c.phone, 4) AS phone_tail, l.created_at
FROM crm_leads l LEFT JOIN crm_contacts c ON c.id = l.contact_id
WHERE l.source = 'manual_test' OR c.name LIKE '[內部測試]%' OR l.note LIKE '%內部測試%'
ORDER BY l.created_at;

-- 6. Sizing for Task 13's checklist read.
SELECT count(*) AS audit_log_rows FROM audit_logs;

ROLLBACK;
