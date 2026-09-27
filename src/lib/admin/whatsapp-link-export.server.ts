import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { queryRows } from "../neon/db.server.ts";
import type { StaffAccess } from "../neon/auth.server.ts";
import { linkDto } from "../neon/whatsapp-enquiries.server.ts";
import { linkFilterParams, linkFilterSql } from "../neon/whatsapp-link-management.server.ts";
import { csvPage, exportInput, type LinkCsvRow } from "./whatsapp-link-export.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
async function authorize(actor: Actor, query = queryRows) {
  if (!actor.roles.some((r) => r === "admin" || r === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
}
export async function prepareWhatsappLinkExport(value: unknown, actor: Actor, query = queryRows) {
  const input = exportInput.parse(value);
  await authorize(actor, query);
  const ids = input.selectedIds ?? [];
  if (input.scope === "selected" && (ids.length === 0 || new Set(ids).size !== ids.length))
    throw new Response("EXPORT_SELECTION_INVALID", { status: 400 });
  await query(`DELETE FROM whatsapp_link_export_snapshots WHERE id IN (
    SELECT id FROM whatsapp_link_export_snapshots WHERE expires_at<now() ORDER BY expires_at LIMIT 100
  )`);
  const snapshotId = randomUUID(),
    params = linkFilterParams(input.filter);
  const [result] = await query(
    `WITH chosen AS (
      SELECT l.id,l.current_version,row_number() OVER (ORDER BY l.created_at DESC,l.id DESC) AS ordinal
      FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version
      WHERE ${linkFilterSql} AND ($5='all' OR l.id IN (SELECT jsonb_array_elements_text($6::jsonb)::uuid))
    ), authorized AS (
      SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id
      WHERE s.id=$7::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1
    ), snapshot AS (
      INSERT INTO whatsapp_link_export_snapshots(id,actor_staff_id,scope)
      SELECT $8::uuid,id,$5 FROM authorized
      WHERE $5='all' OR (SELECT count(*) FROM chosen)=jsonb_array_length($6::jsonb)
      RETURNING id
    ), inserted AS (
      INSERT INTO whatsapp_link_export_items(snapshot_id,ordinal,link_id,version)
      SELECT snapshot.id,chosen.ordinal,chosen.id,chosen.current_version FROM snapshot CROSS JOIN chosen
      RETURNING link_id
    ) SELECT (SELECT count(*)::int FROM inserted) AS total,(SELECT count(*)::int FROM snapshot) AS snapshots`,
    [...params, input.scope, JSON.stringify(ids), actor.staffId, snapshotId],
  );
  if (Number(result?.snapshots) !== 1)
    throw new Response("EXPORT_SELECTION_CHANGED", { status: 409 });
  return { snapshotId, total: Number(result.total), scope: input.scope, expiresInSeconds: 900 };
}

export async function readWhatsappLinkExportPage(
  value: { snapshotId: string; offset: number },
  actor: Actor,
  query = queryRows,
) {
  const input = z
    .object({ snapshotId: z.string().uuid(), offset: z.number().int().min(0) })
    .strict()
    .parse(value);
  await authorize(actor, query);
  const [snapshot] = await query(
    `SELECT s.id,(SELECT count(*)::int FROM whatsapp_link_export_items e WHERE e.snapshot_id=s.id) AS total
    FROM whatsapp_link_export_snapshots s WHERE s.id=$1::uuid AND s.actor_staff_id=$2::uuid AND s.expires_at>now()`,
    [input.snapshotId, actor.staffId],
  );
  if (!snapshot) throw new Response("EXPORT_SNAPSHOT_EXPIRED", { status: 404 });
  const raw = await query(
    `SELECT l.id,l.code,l.created_at AS link_created_at,v.*,
      COALESCE(s.name_zh,s.name_en) AS requested_staff_name,p.placement_id
    FROM whatsapp_link_export_items e JOIN whatsapp_tracking_links l ON l.id=e.link_id
    JOIN whatsapp_tracking_link_versions v ON v.link_id=e.link_id AND v.version=e.version
    LEFT JOIN staff_users s ON s.id=v.requested_staff_id
    LEFT JOIN whatsapp_tracking_link_placements p ON p.link_id=l.id
    WHERE e.snapshot_id=$1::uuid AND e.ordinal>$2 AND e.ordinal<=$2+500
    ORDER BY e.ordinal`,
    [input.snapshotId, input.offset],
  );
  const ids = raw.map((r) => String(r.id));
  let counts: Awaited<ReturnType<typeof query>> = [];
  let countsUnavailable = false;
  try {
    if (ids.length)
      counts = await query(
        `SELECT o.link_id,count(DISTINCT o.id)::int opens,count(DISTINCT i.id)::int enquiries
      FROM whatsapp_link_opens o LEFT JOIN inquiries i ON i.link_open_id=o.id AND i.source='whatsapp'
      WHERE o.link_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) GROUP BY o.link_id`,
        [JSON.stringify(ids)],
      );
  } catch {
    countsUnavailable = true;
  }
  const byId = new Map(counts.map((r) => [String(r.link_id), r]));
  const rows: LinkCsvRow[] = raw.map((r) => {
    const link = linkDto({ ...r, created_at: r.link_created_at });
    const count = byId.get(link.id);
    return {
      publicListingNo: link.publicListingNo ?? null,
      dealType: link.dealType ?? null,
      placementSource: link.placementSource,
      entryPointType: link.entryPointType,
      placementId: r.placement_id
        ? String(r.placement_id)
        : (link.externalListingId ?? link.videoId ?? null),
      requestedStaffName: r.requested_staff_name ? String(r.requested_staff_name) : null,
      code: link.code,
      version: link.version,
      enabled: link.enabled,
      opens: countsUnavailable ? null : Number(count?.opens ?? 0),
      enquiries: countsUnavailable ? null : Number(count?.enquiries ?? 0),
      createdAt: link.createdAt,
      placementVerifiedAt: link.placementVerifiedAt,
    };
  });
  const nextOffset = input.offset + raw.length,
    total = Number(snapshot.total);
  return {
    csv: csvPage(rows, input.offset === 0),
    nextOffset: nextOffset < total ? nextOffset : null,
    total,
  };
}
