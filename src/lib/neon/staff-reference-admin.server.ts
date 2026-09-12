import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows, transactionRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server";
type Actor = Pick<StaffAccess, "staffId" | "roles">;
const exact = z.string().min(1).max(160);
export const referenceInput = z
  .object({
    namespace: exact,
    externalReference: exact,
    staffId: z.string().uuid(),
    verificationRef: z.string().trim().min(1).max(160),
  })
  .strict();
async function authorize(actor: Actor, query = queryRows) {
  if (
    !actor.roles.some((r) => r === "admin" || r === "manager") ||
    !(
      await query(
        "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager')",
        [actor.staffId],
      )
    ).length
  )
    throw new Response("Forbidden", { status: 403 });
}
export async function listStaffReferences(actor: Actor, query = queryRows) {
  await authorize(actor, query);
  const rows = await query(
    "SELECT r.id,r.namespace,r.external_reference,r.staff_id,r.mapping_version,r.valid_from,r.valid_until,r.verification_ref,COALESCE(s.name_zh,s.name_en) AS staff_name FROM staff_external_references r JOIN staff_users s ON s.id=r.staff_id ORDER BY r.verified_at DESC,r.id DESC LIMIT 200",
  );
  return rows.map((r) => ({
    id: String(r.id),
    namespace: String(r.namespace),
    external_reference: String(r.external_reference),
    staff_id: String(r.staff_id),
    mapping_version: Number(r.mapping_version),
    valid_from: String(r.valid_from),
    valid_until: r.valid_until ? String(r.valid_until) : null,
    verification_ref: String(r.verification_ref),
    staff_name: r.staff_name ? String(r.staff_name) : null,
  }));
}
export async function saveStaffReference(
  value: unknown,
  actor: Actor,
  ports = { query: queryRows, transaction: transactionRows },
) {
  await authorize(actor, ports.query);
  const data = referenceInput.parse(value);
  const result = await ports.transaction([
    {
      statement: "SELECT s.id FROM staff_users s WHERE s.id=$1::uuid FOR UPDATE",
      params: [actor.staffId],
    },
    {
      statement:
        "SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text,$2::text)::text,0))",
      params: [data.namespace, data.externalReference],
    },
    {
      statement: `WITH inserted AS (INSERT INTO staff_external_references(namespace,external_reference,staff_id,mapping_version,valid_from,verified_by,verification_ref)
 SELECT $1,$2,$3::uuid,COALESCE((SELECT max(mapping_version) FROM staff_external_references WHERE namespace=$1 AND external_reference=$2),0)+1,now(),$4::uuid,$5 WHERE EXISTS(SELECT 1 FROM staff_users s WHERE s.id=$3::uuid AND s.active) AND EXISTS(SELECT 1 FROM staff_users a JOIN staff_roles ar ON ar.staff_user_id=a.id WHERE a.id=$4::uuid AND a.active AND ar.role IN ('admin','manager')) RETURNING id), audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $4::uuid,'staff.reference.verify','staff_reference',id,'{}'::jsonb FROM inserted RETURNING id) SELECT id FROM inserted`,
      params: [
        data.namespace,
        data.externalReference,
        data.staffId,
        actor.staffId,
        data.verificationRef,
      ],
    },
  ]);
  if (!result[2]?.length) throw new Response("ACTIVE_STAFF_REQUIRED", { status: 409 });
  return { id: String(result[2][0].id) };
}
export async function retireStaffReference(value: unknown, actor: Actor, query = queryRows) {
  await authorize(actor, query);
  const { id } = z.object({ id: z.string().uuid() }).strict().parse(value);
  const rows = await query(
    `WITH retired AS (UPDATE staff_external_references SET valid_until=now() WHERE id=$1::uuid AND valid_until IS NULL AND valid_from<now() AND EXISTS(SELECT 1 FROM staff_users a JOIN staff_roles ar ON ar.staff_user_id=a.id WHERE a.id=$2::uuid AND a.active AND ar.role IN ('admin','manager')) RETURNING id), audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $2::uuid,'staff.reference.retire','staff_reference',id,'{}'::jsonb FROM retired RETURNING id) SELECT id FROM retired`,
    [id, actor.staffId],
  );
  return { retired: rows.length };
}
