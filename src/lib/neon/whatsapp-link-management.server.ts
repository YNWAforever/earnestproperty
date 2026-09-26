import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import { linkDto } from "./whatsapp-enquiries.server.ts";
import { listWhatsappStaffReadiness } from "./whatsapp-readiness.server.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
import { linkPageInput, type LinkPageFilter } from "./whatsapp-link-management.types.ts";

const cursorPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export function encodeLinkCursor(value: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeLinkCursor(value: string | undefined) {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid");
    const row = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !row ||
      typeof row !== "object" ||
      !cursorPattern.test(row.createdAt) ||
      !z.string().uuid().safeParse(row.id).success
    )
      throw new Error("invalid");
    return { createdAt: row.createdAt as string, id: row.id as string };
  } catch {
    throw new Response("LINK_CURSOR_INVALID", { status: 400 });
  }
}
export const linkFilterSql = `($1::text IS NULL OR l.code ILIKE $1 ESCAPE '\\' OR v.public_listing_no ILIKE $1 ESCAPE '\\'
 OR v.external_listing_id ILIKE $1 ESCAPE '\\' OR v.video_id ILIKE $1 ESCAPE '\\')
 AND ($2::text IS NULL OR v.placement_source=$2)
 AND ($3::uuid IS NULL OR v.requested_staff_id=$3::uuid)
 AND ($4::boolean IS NULL OR v.enabled=$4::boolean)`;
export function linkFilterParams(input: LinkPageFilter) {
  const q = input.q?.trim();
  const escaped = q?.replace(/[\\%_]/g, "\\$&");
  return [
    escaped ? `%${escaped}%` : null,
    input.source ?? null,
    input.staffId ?? null,
    input.enabled ?? null,
  ];
}
async function authorize(actor: Actor, query = queryRows) {
  if (!actor.roles.some((r) => r === "admin" || r === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
}

export async function listWhatsappTrackingLinksPage(
  value: unknown,
  actor: Actor,
  query = queryRows,
) {
  const input = linkPageInput.parse(value);
  await authorize(actor, query);
  const params = linkFilterParams(input),
    cursor = decodeLinkCursor(input.cursor),
    pageSize = input.pageSize ?? 50;
  const [totalRow] = await query(
    `SELECT count(*)::int AS total FROM whatsapp_tracking_links l
    JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version
    WHERE ${linkFilterSql}`,
    params,
  );
  const raw = await query(
    `SELECT l.id,l.code,v.*,l.created_at AS link_created_at,
      to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
      COALESCE(s.name_zh,s.name_en) AS requested_staff_name,p.placement_id AS source_placement_id
    FROM whatsapp_tracking_links l JOIN whatsapp_tracking_link_versions v ON v.link_id=l.id AND v.version=l.current_version
    LEFT JOIN staff_users s ON s.id=v.requested_staff_id
    LEFT JOIN whatsapp_tracking_link_placements p ON p.link_id=l.id
    WHERE ${linkFilterSql}
      AND ($5::timestamptz IS NULL OR (l.created_at,l.id)<($5::timestamptz,$6::uuid))
    ORDER BY l.created_at DESC,l.id DESC LIMIT $7`,
    [...params, cursor?.createdAt ?? null, cursor?.id ?? null, pageSize + 1],
  );
  const page = raw.slice(0, pageSize);
  const ids = page.map((r) => String(r.id));
  let counts: Awaited<ReturnType<typeof query>> = [];
  let countsUnavailable = false;
  try {
    if (ids.length)
      counts = await query(
        `SELECT o.link_id,count(DISTINCT o.id)::int AS opens,count(DISTINCT i.id)::int AS enquiries
      FROM whatsapp_link_opens o LEFT JOIN inquiries i ON i.link_open_id=o.id AND i.source='whatsapp'
      WHERE o.link_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)
      GROUP BY o.link_id`,
        [JSON.stringify(ids)],
      );
  } catch {
    countsUnavailable = true;
  }
  const byId = new Map(counts.map((r) => [String(r.link_id), r]));
  let readiness = new Map<string, string>();
  try {
    const capabilities = await listWhatsappStaffReadiness(actor, { query });
    readiness = new Map(capabilities.map((r) => [r.staffId, r.assignment.state]));
  } catch {
    /* unknown must stay unknown, never zero or ready */
  }
  let recent = new Map<string, { state: string; createdAt: string }>();
  const staffIds = [
    ...new Set(
      page
        .map((r) => r.requested_staff_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
  if (staffIds.length) {
    try {
      const attempts = await query(
        `SELECT DISTINCT ON (staff_id) staff_id,state,created_at FROM staff_notification_test_attempts
        WHERE staff_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)
        ORDER BY staff_id,created_at DESC,id DESC`,
        [JSON.stringify(staffIds)],
      );
      recent = new Map(
        attempts.map((r) => [
          String(r.staff_id),
          { state: String(r.state), createdAt: new Date(String(r.created_at)).toISOString() },
        ]),
      );
    } catch {
      /* missing test schema is explicitly unknown */
    }
  }
  const items = page.map((row) => {
    const base = linkDto({ ...row, created_at: row.link_created_at });
    const count = byId.get(base.id);
    return {
      ...base,
      requestedStaffName: row.requested_staff_name ? String(row.requested_staff_name) : null,
      sourcePlacementId: row.source_placement_id
        ? String(row.source_placement_id)
        : (base.externalListingId ?? base.videoId ?? null),
      opens: countsUnavailable ? null : Number(count?.opens ?? 0),
      enquiries: countsUnavailable ? null : Number(count?.enquiries ?? 0),
      readiness: base.requestedStaffId
        ? (readiness.get(base.requestedStaffId) ?? "unknown")
        : "not_applicable",
      recentTest: base.requestedStaffId ? (recent.get(base.requestedStaffId) ?? null) : null,
    };
  });
  const last = page.at(-1);
  return {
    items,
    total: Number(totalRow?.total ?? 0),
    nextCursor:
      raw.length > pageSize && last
        ? encodeLinkCursor({ createdAt: String(last.cursor_at), id: String(last.id) })
        : null,
  };
}
