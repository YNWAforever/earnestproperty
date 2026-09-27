import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import type { MappingConflict } from "./staff-mapping-review.types.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Ports = { query: typeof queryRows };
const defaultPorts: Ports = { query: queryRows };
const saveSchema = z
  .object({
    staffId: z.string().uuid(),
    expectedVersion: z.number().int().positive().nullable(),
    evidenceId: z.string().uuid(),
    eligible: z.boolean(),
  })
  .strict();
const retireSchema = z
  .object({
    mappingId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

async function authorize(actor: Actor, query: typeof queryRows) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
}
function scope() {
  const channelId = process.env.EP_WA_COMPANY_CHANNEL_ID;
  const providerScope = process.env.EP_WA_INBOX_INTEGRATION_ID;
  if (!channelId || !providerScope)
    throw new Response("MAPPING_PROVIDER_SCOPE_UNCONFIGURED", { status: 409 });
  return { channelId, providerScope };
}
export async function mappingConflict(
  query: typeof queryRows,
  where: "staff" | "mapping",
  id: string,
  channelId: string,
  code: MappingConflict["code"] = "MAPPING_VERSION_CONFLICT",
): Promise<never> {
  const [row] = await query<{
    id: string;
    version: number;
    eligible: boolean;
    retired_at: string | null;
  }>(
    where === "staff"
      ? "SELECT id,version,eligible,retired_at FROM whatsapp_staff_channels WHERE staff_id=$1::uuid AND channel_id=$2"
      : "SELECT id,version,eligible,retired_at FROM whatsapp_staff_channels WHERE id=$1::uuid AND channel_id=$2",
    [id, channelId],
  );
  const body: MappingConflict = {
    code,
    latest: row
      ? {
          mappingId: row.id,
          version: Number(row.version),
          eligible: row.eligible,
          retiredAt: row.retired_at ? new Date(row.retired_at).toISOString() : null,
        }
      : null,
  };
  throw new Response(JSON.stringify(body), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
}

export async function saveReviewedStaffChannel(
  value: unknown,
  actor: Actor,
  ports: Ports = defaultPorts,
) {
  const { query } = ports;
  const input = saveSchema.parse(value);
  await authorize(actor, query);
  const { channelId, providerScope } = scope();
  let row: { id: string; version: number; review_evidence_id: string } | undefined;
  try {
    [row] = await query<{ id: string; version: number; review_evidence_id: string }>(
      `WITH evidence AS (
        SELECT e.* FROM whatsapp_staff_mapping_reviews e
        JOIN staff_users s ON s.id=e.staff_id AND s.active
        WHERE e.id=$3::uuid AND e.staff_id=$1::uuid AND e.channel_id=$2
          AND e.provider_scope=$4 AND e.actor_id=$5::uuid
          AND EXISTS (SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id
            WHERE a.id=$5::uuid AND a.active AND r.role IN ('admin','manager'))
          AND e.basis='provider_verified' AND e.result='verified'
          AND e.checked_at<=now() AND e.expires_at>now()
          AND e.mapping_version IS NOT DISTINCT FROM $6::int
          AND (($6::int IS NULL AND NOT EXISTS (
            SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=e.staff_id AND m.channel_id=e.channel_id
          )) OR ($6::int IS NOT NULL AND EXISTS (
            SELECT 1 FROM whatsapp_staff_channels m WHERE m.staff_id=e.staff_id AND m.channel_id=e.channel_id AND m.version=$6::int
          )))
      ), changed AS (
        INSERT INTO whatsapp_staff_channels(
          staff_id,channel_id,inbox_user_id,folder_id,routing_node_id,branch_id,
          verification_ref,eligible,verified_at,verified_by,retired_at,
          review_basis,review_enforced,review_evidence_id
        )
        SELECT staff_id,channel_id,inbox_user_id,folder_id,'',NULL,
          id::text,$7::boolean,checked_at,$5::uuid,NULL,
          'provider_verified',true,id FROM evidence
        ON CONFLICT(channel_id,staff_id) DO UPDATE SET
          inbox_user_id=EXCLUDED.inbox_user_id,folder_id=EXCLUDED.folder_id,
          verification_ref=EXCLUDED.verification_ref,eligible=EXCLUDED.eligible,
          verified_at=EXCLUDED.verified_at,verified_by=EXCLUDED.verified_by,
          retired_at=NULL,review_basis='provider_verified',review_enforced=true,
          review_evidence_id=EXCLUDED.review_evidence_id
        WHERE whatsapp_staff_channels.version=$6::int
        RETURNING id,version,review_evidence_id
      ), audit AS (
        INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
        SELECT $5::uuid,'whatsapp.mapping.review','staff_channel',id,
          jsonb_build_object('basis','provider_verified','evidenceId',review_evidence_id,'version',version)
        FROM changed RETURNING id
      )
      SELECT id,version,review_evidence_id FROM changed`,
      [
        input.staffId,
        channelId,
        input.evidenceId,
        providerScope,
        actor.staffId,
        input.expectedVersion,
        input.eligible,
      ],
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "23505")
      return mappingConflict(query, "staff", input.staffId, channelId, "MAPPING_IDENTITY_CONFLICT");
    throw error;
  }
  if (!row) return mappingConflict(query, "staff", input.staffId, channelId);
  return { mappingId: row.id, version: Number(row.version), evidenceId: row.review_evidence_id };
}

export async function retireStaffChannel(
  value: unknown,
  actor: Actor,
  ports: Ports = defaultPorts,
) {
  const { query } = ports;
  const input = retireSchema.parse(value);
  await authorize(actor, query);
  const { channelId } = scope();
  const [row] = await query<{ id: string; version: number }>(
    `WITH changed AS (
      UPDATE whatsapp_staff_channels m SET eligible=false,retired_at=now()
      WHERE m.id=$1::uuid AND m.channel_id=$2 AND m.version=$3::int AND m.retired_at IS NULL
        AND EXISTS (SELECT 1 FROM staff_users a JOIN staff_roles r ON r.staff_user_id=a.id
          WHERE a.id=$4::uuid AND a.active AND r.role IN ('admin','manager'))
      RETURNING id,version
    ), audit AS (
      INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
      SELECT $4::uuid,'whatsapp.mapping.retire','staff_channel',id,
        jsonb_build_object('version',version,'reason',$5::text)
      FROM changed RETURNING id
    )
    SELECT id,version FROM changed`,
    [input.mappingId, channelId, input.expectedVersion, actor.staffId, input.reason],
  );
  if (!row) return mappingConflict(query, "mapping", input.mappingId, channelId);
  return { mappingId: row.id, version: Number(row.version) };
}
