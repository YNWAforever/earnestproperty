import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { queryRows } from "./db.server.ts";
import { leadCopyStaffIds } from "./lead-default-assignee.js";
import {
  enquiryEstateRoutes,
  type EnquiryRoutingQuery,
} from "../whatsapp-enquiries/enquiry-routing.server.ts";
import {
  historicalEstateManager,
  mentionsSpecificProperty,
} from "../whatsapp-enquiries/enquiry-routing.mjs";

// Closed interval at the start, open at the end. A growing lookback would admit new enquiries.
const batch = ["2026-11-21T09:30:04+08:00", "2026-11-25T09:30:04+08:00"];
// SHA-256 of lead/inquiry/staff UUIDs for the six originally reviewed notifications.
// Route edits and newly imported records can remove eligibility but cannot enlarge this batch.
const approvedRecipients = new Set([
  "8fbf7d9dea3b9b853e83b1e15cbf021e93d9dc3b43c877fd1cc22febb00e42ac",
  "aa609a3712969889da3bf71a4e28ca75aa46d768d3549b4ae23aa115c54d66cb",
  "2fb91721481fb7711d62dd715055d77d740000ae0e12665d5c48be862747e612",
  "3c56f8844cca534a5ab584ddcfed3addb1c8ba089a51dc532dd53ba753430927",
  "2854c72a51f15f4d0c60d757a8c4c691a705dc419376f2e09420965a84d55556",
  "ee7d3d07bc031d0c23a4d666dee73e95a498328f483919bec99fd21bd6a4310f",
]);
async function historicalLeadIds(query: EnquiryRoutingQuery = queryRows) {
  const rows = await query(
    `SELECT id FROM crm_leads WHERE created_at >= $1 AND created_at < $2 AND source IN ('website','whatsapp') ORDER BY created_at,id`,
    batch,
  );
  return rows.map((row) => String(row.id));
}

export async function listHistoricalRecipients(
  channelId: string,
  query: EnquiryRoutingQuery = queryRows,
) {
  const ids = await historicalLeadIds(query);
  const routes = (
    await Promise.all(ids.map((id) => resolveHistoricalLead(id, channelId, query)))
  ).filter((r) => r !== null);
  const recipients = [...new Set(routes.flatMap((r) => r.staffIds))];
  const directory = await query(
    "SELECT id, coalesce(name_zh,name_en) AS name FROM staff_users WHERE id=ANY($1::uuid[])",
    [recipients],
  );
  const names = new Map(directory.map((r) => [String(r.id), String(r.name ?? "同事")]));
  return routes.flatMap((r) =>
    r.staffIds.map((staffId) => ({
      leadId: r.leadId,
      staffId,
      sourceLabel: r.sourceLabel,
      createdAt: r.createdAt,
      staffName: names.get(staffId) ?? "未能核實同事",
    })),
  );
}

export async function resolveHistoricalLead(
  leadId: string,
  channelId: string,
  query: EnquiryRoutingQuery = queryRows,
) {
  const route = await readHistoricalIntakeRoute(leadId, channelId, query);
  if (!route) return null;
  const staffIds = route.staffIds.filter((staffId) =>
    approvedRecipients.has(
      createHash("sha256").update([route.leadId, route.inquiryId, staffId].join("/")).digest("hex"),
    ),
  );
  return staffIds.length ? { ...route, staffIds } : null;
}

export async function readHistoricalIntakeRoute(
  leadId: string,
  channelId: string,
  query: EnquiryRoutingQuery,
) {
  const rows = await query(
    `WITH lead AS (
    SELECT l.*, c.name,coalesce(nullif(c.normalized_phone,''),c.phone) customer_phone,c.whatsapp_member_id
    FROM crm_leads l JOIN crm_contacts c ON c.id=l.contact_id
    WHERE l.id=$1::uuid AND l.created_at >= $3 AND l.created_at < $4 AND l.stage='new'
      AND NOT EXISTS (SELECT 1 FROM staff_users s WHERE s.active AND
        (enquiry_notification_phone(c.normalized_phone) IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp)) OR
         enquiry_notification_phone(c.phone) IN (enquiry_notification_phone(s.phone),enquiry_notification_phone(s.whatsapp))))
  ), intake AS (
    SELECT l.id lead_id,i.id inquiry_id,l.created_at,l.source, l.name,l.customer_phone,
      i.public_listing_no,CASE WHEN l.enquiry_routing_context->>'selectedAgentId'=i.requested_staff_id::text THEN i.requested_staff_id END assigned_staff,
      i.property_id IS NOT NULL AS specific, NULL::text AS intake_text, NULL::uuid AS message_id
    FROM lead l JOIN inquiries i ON i.crm_lead_id=l.id AND i.crm_contact_id=l.contact_id
    WHERE l.source='website' AND i.source='website' AND i.status='new' AND i.created_at >= $3 AND i.created_at < $4
      AND (i.requested_staff_id IS NULL OR l.assigned_agent_id IS NULL OR i.requested_staff_id=l.assigned_agent_id)
    UNION ALL
    SELECT l.id,i.id,l.created_at,l.source,l.name,l.customer_phone,i.public_listing_no,
      i.requested_staff_id,i.property_id IS NOT NULL,m.text,m.id
    FROM lead l JOIN whatsapp_conversations w ON w.contact_id=l.contact_id AND w.channel_id=$2
    JOIN inquiries i ON i.conversation_id=w.id AND i.crm_contact_id=l.contact_id AND i.source='whatsapp' AND i.status='new'
    JOIN whatsapp_messages m ON m.id=i.intake_message_id AND m.conversation_id=w.id AND m.contact_id=w.contact_id
    JOIN whatsapp_enquiry_events e ON e.message_id=m.id AND e.inquiry_id=i.id AND e.channel_id=w.channel_id
    WHERE l.source='whatsapp' AND (i.crm_lead_id=l.id OR (i.crm_lead_id IS NULL AND m.created_at=l.created_at AND NOT EXISTS (
        SELECT 1 FROM crm_leads other WHERE other.contact_id=l.contact_id AND other.source=l.source AND other.created_at=l.created_at AND other.id<>l.id)))
      AND i.created_at >= $3 AND i.created_at < $4 AND m.created_at >= $3 AND m.created_at < $4
      AND m.direction='inbound' AND m.channel_id=e.channel_id AND m.woztell_member_id=e.member_id AND w.woztell_member_id=e.member_id
      AND e.origin='live_webhook' AND e.kind='customer_message' AND e.identity_quality='provider_id' AND e.timing='fresh'
      AND e.processing_state='processed' AND e.capture_mode IN ('observe','active')
      AND e.occurred_at BETWEEN e.received_at-interval '15 minutes' AND e.received_at+interval '1 minute'
      AND NOT EXISTS(SELECT 1 FROM staff_notification_internal_events x WHERE x.channel_id=e.channel_id AND x.member_id=e.member_id)
  ) SELECT * FROM intake LIMIT 2`,
    [leadId, channelId, ...batch],
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  const staff = new Set(leadCopyStaffIds());
  const text = String(row.intake_text ?? "");
  let sourceLabel = row.source === "website" ? "網站查詢" : "WhatsApp 查詢";
  if (row.public_listing_no) sourceLabel += ` · ${row.public_listing_no}`;
  if (row.assigned_staff) staff.add(String(row.assigned_staff));
  else if (
    row.source === "whatsapp" &&
    !row.specific &&
    !row.public_listing_no &&
    !mentionsSpecificProperty(text)
  ) {
    const slugs = [
      ...new Set(
        Array.from(text.matchAll(/來源[：:]\s*estate-([a-z0-9-]+)(?![\w-])/gi), (m) =>
          m[1].toLowerCase(),
        ),
      ),
    ];
    let estateLabel: string | null = null;
    if (slugs.length === 1) {
      const [estate] = await query("SELECT name_zh FROM estates WHERE slug=$1", [slugs[0]]);
      if (estate?.name_zh) {
        estateLabel = String(estate.name_zh);
        sourceLabel += ` · 來源：${estateLabel}`;
      }
    }
    if (slugs.length === 0 || estateLabel) {
      const manager = historicalEstateManager({
        text,
        estateLabel,
        routes: await enquiryEstateRoutes(query),
      });
      if (manager) staff.add(manager);
    }
  }
  const resolved = {
    leadId,
    inquiryId: String(row.inquiry_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    sourceLabel,
    customerName: String(row.name ?? ""),
    customerPhone: String(row.customer_phone ?? ""),
    staffIds: [...staff].sort(),
  };
  return {
    ...resolved,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([channelId, row.message_id, text, resolved]))
      .digest("hex"),
  };
}
