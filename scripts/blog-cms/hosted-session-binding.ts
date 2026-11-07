// Neon Auth IDs can be UUID columns; staff_users keeps provider IDs as text.
// Cast the provider ID rather than requiring every stored staff ID to be a UUID.
export const hostedSessionBindingSql = `
SELECT s."userId"::text AS user_id, st.id::text AS staff_id,
       array_agg(r.role::text ORDER BY r.role::text) AS roles
FROM neon_auth.session s
JOIN staff_users st ON st.auth_user_id = s."userId"::text
JOIN staff_roles r ON r.staff_user_id = st.id
WHERE s.token = $1 AND s."expiresAt" > $2::timestamptz AND st.active
GROUP BY s."userId", st.id`;
