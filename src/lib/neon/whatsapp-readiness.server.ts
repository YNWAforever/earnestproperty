import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import { assessStaffReadiness, assessWhatsappRuntime } from "./whatsapp-readiness-policy.ts";
import type { StaffReadinessInput, StaffWhatsappReadiness } from "./whatsapp-readiness.types.ts";
import { staffNotificationRuntime } from "../whatsapp-enquiries/staff-notifications.server.ts";
import { createInboxApi } from "../woztell/inbox-api.server.ts";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Query = typeof queryRows;
type Runtime = StaffReadinessInput["runtime"];

async function authorize(actor: Actor, query: Query) {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [allowed] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!allowed) throw new Response("Forbidden", { status: 403 });
}
export function currentWhatsappReadinessRuntime(): Runtime {
  const notification = staffNotificationRuntime();
  let inboxProviderVerified = false,
    staffTransportVerified = false;
  try {
    createInboxApi();
    inboxProviderVerified = true;
  } catch {
    inboxProviderVerified = false;
  }
  try {
    createStaffWhatsAppTransport();
    staffTransportVerified = true;
  } catch {
    staffTransportVerified = false;
  }
  return {
    channelId: notification.channelId,
    assignmentEnabled: process.env.EP_WA_ENQUIRY_MODE === "active",
    notificationsEnabled: notification.enabled,
    inboxProviderVerified,
    staffTransportVerified:
      staffTransportVerified && process.env.WOZTELL_CHANNEL_ID === notification.channelId,
    templateContractVerified: notification.template !== null,
  };
}
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (v == null ? null : String(v));
const stamp = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);
function mapping(value: unknown): StaffReadinessInput["mapping"] {
  const r = obj(value);
  return r
    ? {
        channelId: String(r.channel_id),
        version: Number(r.version),
        reviewBasis: r.review_basis === "provider_verified" ? "provider_verified" : "legacy_manual",
        reviewEnforced: r.review_enforced === true,
        reviewEvidenceId: str(r.review_evidence_id),
        eligible: r.eligible === true,
        verificationRef: str(r.verification_ref),
        verifiedAt: stamp(r.verified_at),
        retiredAt: stamp(r.retired_at),
        inboxUserId: String(r.inbox_user_id ?? ""),
        folderId: String(r.folder_id ?? ""),
      }
    : null;
}
function endpoint(value: unknown): StaffReadinessInput["staffEndpoint"] {
  const r = obj(value);
  if (!r) return null;
  const quiet = obj(r.quiet_hours_policy);
  return {
    channelId: String(r.channel_id),
    version: Number(r.version),
    mappingVersion: r.mapping_version == null ? null : Number(r.mapping_version),
    transport: r.transport === "inbox_private_note" ? "inbox_private_note" : "staff_whatsapp",
    destinationReference: String(r.destination_reference ?? ""),
    enabled: r.enabled === true,
    verifiedAt: stamp(r.verified_at),
    retiredAt: stamp(r.retired_at),
    permissionGranted: r.permission_granted === true,
    permissionRef: str(r.permission_ref),
    quietHoursApproved: quiet?.approved === true && quiet?.allowAllHours === true,
    lastInboundAt: stamp(r.last_inbound_at),
    templateName: str(r.template_name),
    templateLanguage: str(r.template_language),
    templateVerifiedAt: stamp(r.template_verified_at),
  };
}
type ReadinessOptions = { staffId?: string; query?: Query; runtime?: Runtime; checkedAt?: string };
async function loadStaffReadiness(options: ReadinessOptions = {}) {
  const query = options.query ?? queryRows;
  const [schema] = await query(
    "SELECT to_regclass('staff_users') IS NOT NULL AND to_regclass('staff_roles') IS NOT NULL AND to_regclass('whatsapp_staff_channels') IS NOT NULL AND to_regclass('staff_notification_endpoints') IS NOT NULL AS available",
  );
  if (schema?.available !== true) throw new Response("SCHEMA_UNAVAILABLE", { status: 503 });
  const staffId = options.staffId ? z.string().uuid().parse(options.staffId) : null;
  const runtime = options.runtime ?? currentWhatsappReadinessRuntime();
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const rows = await query(
    `SELECT s.id,s.active,COALESCE(s.name_zh,s.name_en,'未命名同事') AS display_name,
      ARRAY(SELECT r.role::text FROM staff_roles r WHERE r.staff_user_id=s.id) AS roles,
      to_jsonb(m) AS mapping,to_jsonb(inep) AS inbox_endpoint,to_jsonb(waep) AS staff_endpoint
    FROM staff_users s
    LEFT JOIN LATERAL (
      SELECT * FROM whatsapp_staff_channels m WHERE m.staff_id=s.id
      ORDER BY (m.channel_id=$1) DESC,m.verified_at DESC NULLS LAST,m.id DESC LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT * FROM staff_notification_endpoints e WHERE e.staff_id=s.id AND e.transport='inbox_private_note'
      ORDER BY (e.channel_id=$1) DESC,e.updated_at DESC,e.id DESC LIMIT 1
    ) inep ON true
    LEFT JOIN LATERAL (
      SELECT * FROM staff_notification_endpoints e WHERE e.staff_id=s.id AND e.transport='staff_whatsapp'
      ORDER BY (e.channel_id=$1) DESC,e.updated_at DESC,e.id DESC LIMIT 1
    ) waep ON true
    WHERE ($2::uuid IS NULL OR s.id=$2::uuid) ORDER BY display_name,s.id`,
    [runtime.channelId, staffId],
  );
  return rows.map((row) =>
    assessStaffReadiness({
      staffId: String(row.id),
      displayName: String(row.display_name),
      active: row.active === true,
      roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
      mapping: mapping(row.mapping),
      inboxEndpoint: endpoint(row.inbox_endpoint),
      staffEndpoint: endpoint(row.staff_endpoint),
      runtime,
      checkedAt,
    }),
  );
}
export async function listWhatsappStaffReadiness(actor: Actor, options: ReadinessOptions = {}) {
  await authorize(actor, options.query ?? queryRows);
  return loadStaffReadiness(options);
}

// Trusted worker read: current evidence, no browser entry point.
export async function inspectWhatsappStaffReadinessForDispatch(
  staffId: string,
  options: Omit<ReadinessOptions, "staffId"> = {},
): Promise<StaffWhatsappReadiness | null> {
  const rows = await loadStaffReadiness({ ...options, staffId });
  return rows[0] ?? null;
}
export async function readWhatsappRuntimeStatus(
  actor: Actor,
  options: { query?: Query; runtime?: Runtime; checkedAt?: string } = {},
) {
  const query = options.query ?? queryRows;
  await authorize(actor, query);
  const runtime = options.runtime ?? currentWhatsappReadinessRuntime();
  return assessWhatsappRuntime({
    mode: process.env.EP_WA_ENQUIRY_MODE ?? "off",
    serviceEnabled: runtime.assignmentEnabled,
    channelId: runtime.channelId,
    inboxProviderVerified: runtime.inboxProviderVerified,
    staffTransportVerified: runtime.staffTransportVerified,
    staffWhatsappEnabled: runtime.notificationsEnabled,
    checkedAt: options.checkedAt ?? new Date().toISOString(),
  });
}
