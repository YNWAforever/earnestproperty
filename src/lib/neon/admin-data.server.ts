import "@tanstack/react-start/server-only";

import { dateOrNull, numberOrNull, queryRows, stringOrEmpty, stringOrNull } from "./db.server";
import type { StaffAccess } from "./auth.server";

export type AdminPropertyInput = {
  id?: string;
  listing_no: string;
  title_zh: string;
  deal_type: "sale" | "rent";
  estate_id: string | null;
  district_slug: string;
  address: string | null;
  price: number | null;
  rent: number | null;
  saleable_area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  description: string | null;
  status: "draft" | "active" | "sold" | "rented" | "offline";
  featured: boolean;
  images: string[];
  agent_id: string | null;
};

function rowDate(value: unknown) {
  return dateOrNull(value) ?? new Date().toISOString();
}

export async function getAdminOverview() {
  const [properties, leads, contacts, conversations, campaigns] = await Promise.all([
    queryRows("SELECT count(*)::int AS total FROM properties"),
    queryRows(
      "SELECT count(*)::int AS total FROM crm_leads WHERE stage NOT IN ('closed_won', 'closed_lost')",
    ),
    queryRows("SELECT count(*)::int AS total FROM crm_contacts"),
    queryRows("SELECT count(*)::int AS total FROM whatsapp_conversations WHERE status = 'open'"),
    queryRows(
      "SELECT count(*)::int AS total FROM whatsapp_campaigns WHERE status IN ('draft', 'review', 'queued', 'sending')",
    ),
  ]);
  return {
    properties: Number(properties[0]?.total ?? 0),
    openLeads: Number(leads[0]?.total ?? 0),
    contacts: Number(contacts[0]?.total ?? 0),
    openConversations: Number(conversations[0]?.total ?? 0),
    activeCampaigns: Number(campaigns[0]?.total ?? 0),
  };
}

export async function listAdminListings(input: { limit?: number } = {}) {
  const rows = await queryRows(
    `
    SELECT
      p.id,
      p.listing_no,
      p.title_zh,
      p.deal_type,
      p.price,
      p.rent,
      p.saleable_area,
      p.status,
      p.featured,
      p.images,
      p.updated_at,
      e.name_zh AS estate_name_zh,
      s.name_zh AS agent_name_zh,
      s.name_en AS agent_name_en
    FROM properties p
    LEFT JOIN estates e ON e.id = p.estate_id
    LEFT JOIN staff_users s ON s.id = p.agent_id
    ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
    LIMIT $1
    `,
    [input.limit ?? 80],
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    listing_no: stringOrEmpty(row.listing_no),
    title_zh: stringOrEmpty(row.title_zh),
    deal_type: stringOrEmpty(row.deal_type),
    price: numberOrNull(row.price),
    rent: numberOrNull(row.rent),
    saleable_area: numberOrNull(row.saleable_area),
    status: stringOrEmpty(row.status),
    featured: row.featured === true,
    images: Array.isArray(row.images) ? row.images.map(String) : [],
    updated_at: rowDate(row.updated_at),
    estate_name_zh: stringOrNull(row.estate_name_zh),
    agent_name: stringOrNull(row.agent_name_zh) ?? stringOrNull(row.agent_name_en),
  }));
}

export async function getAdminProperty(id: string) {
  const rows = await queryRows("SELECT * FROM properties WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

export async function listAdminEstateOptions() {
  const rows = await queryRows(
    "SELECT id, name_zh, district_slug FROM estates ORDER BY name_zh ASC",
  );
  return rows.map((row) => ({
    id: stringOrEmpty(row.id),
    name_zh: stringOrEmpty(row.name_zh),
    district_slug: stringOrEmpty(row.district_slug),
  }));
}

export async function saveAdminProperty(input: AdminPropertyInput, actor: StaffAccess) {
  const params = [
    input.listing_no,
    input.title_zh,
    input.deal_type,
    input.estate_id,
    input.district_slug,
    input.address,
    input.price,
    input.rent,
    input.saleable_area,
    input.bedrooms,
    input.bathrooms,
    input.floor,
    input.description,
    input.status,
    input.featured,
    input.images,
    input.agent_id || actor.staffId,
  ];

  const rows = input.id
    ? await queryRows(
        `
        UPDATE properties SET
          listing_no = $1,
          title_zh = $2,
          deal_type = $3::deal_type,
          estate_id = $4,
          district_slug = $5,
          address = $6,
          price = $7,
          rent = $8,
          saleable_area = $9,
          bedrooms = $10,
          bathrooms = $11,
          floor = $12,
          description = $13,
          status = $14::property_status,
          featured = $15,
          images = $16::text[],
          agent_id = $17,
          updated_at = now()
        WHERE id = $18
        RETURNING id
        `,
        [...params, input.id],
      )
    : await queryRows(
        `
        INSERT INTO properties (
          listing_no, title_zh, deal_type, estate_id, district_slug, address, price, rent,
          saleable_area, bedrooms, bathrooms, floor, description, status, featured, images, agent_id
        )
        VALUES ($1, $2, $3::deal_type, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::property_status, $15, $16::text[], $17)
        RETURNING id
        `,
        params,
      );

  const id = stringOrEmpty(rows[0]?.id);
  await writeAudit(actor.staffId, input.id ? "property.update" : "property.create", "property", id);
  return { id };
}

export async function deleteAdminProperty(id: string, actor: StaffAccess) {
  await queryRows("DELETE FROM properties WHERE id = $1", [id]);
  await writeAudit(actor.staffId, "property.delete", "property", id);
  return { ok: true };
}

export async function listAdminCms() {
  const [estates, articles, faqs] = await Promise.all([
    queryRows(
      "SELECT id, slug, name_zh, district_slug, total_units, updated_at FROM estates ORDER BY updated_at DESC LIMIT 40",
    ),
    queryRows(
      "SELECT id, slug, title, category, published, published_at, updated_at FROM articles ORDER BY updated_at DESC LIMIT 40",
    ),
    queryRows(
      "SELECT scope, count(*)::int AS total FROM faqs GROUP BY scope ORDER BY scope ASC LIMIT 80",
    ),
  ]);
  return {
    estates,
    articles,
    faqGroups: faqs,
  };
}

export async function listAdminLeads() {
  const rows = await queryRows(
    `
    SELECT
      l.id,
      l.stage,
      l.intent,
      l.budget_min,
      l.budget_max,
      l.source,
      l.note,
      l.created_at,
      c.name,
      c.phone,
      c.email,
      c.opt_in_whatsapp,
      p.listing_no,
      p.title_zh AS property_title
    FROM crm_leads l
    LEFT JOIN crm_contacts c ON c.id = l.contact_id
    LEFT JOIN properties p ON p.id = l.property_id
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT 100
    `,
  );
  return rows;
}

export async function listAdminConversations() {
  const rows = await queryRows(
    `
    SELECT
      wc.id,
      wc.status,
      wc.last_message_at,
      wc.last_inbound_at,
      c.name,
      c.phone,
      c.opted_out_whatsapp,
      m.text AS last_text,
      m.direction AS last_direction
    FROM whatsapp_conversations wc
    LEFT JOIN crm_contacts c ON c.id = wc.contact_id
    LEFT JOIN LATERAL (
      SELECT text, direction
      FROM whatsapp_messages
      WHERE conversation_id = wc.id
      ORDER BY created_at DESC
      LIMIT 1
    ) m ON true
    ORDER BY wc.last_message_at DESC NULLS LAST, wc.updated_at DESC
    LIMIT 100
    `,
  );
  return rows;
}

export async function listAdminCampaigns() {
  const rows = await queryRows(
    `
    SELECT
      c.id,
      c.name,
      c.status,
      c.scheduled_at,
      c.created_at,
      t.element_name,
      t.language_code,
      a.name AS audience_name,
      count(r.id)::int AS recipients
    FROM whatsapp_campaigns c
    LEFT JOIN whatsapp_templates t ON t.id = c.template_id
    LEFT JOIN whatsapp_audiences a ON a.id = c.audience_id
    LEFT JOIN whatsapp_campaign_recipients r ON r.campaign_id = c.id
    GROUP BY c.id, t.element_name, t.language_code, a.name
    ORDER BY c.updated_at DESC, c.created_at DESC
    LIMIT 100
    `,
  );
  return rows;
}

export async function createWebsiteInquiry(input: {
  property_id: string;
  assigned_agent_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
}) {
  const normalizedPhone = input.phone.replace(/\D/g, "");
  const contacts = await queryRows(
    `
    INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
    VALUES ($1, $2, $3, $4, 'website', true)
    ON CONFLICT (normalized_phone) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, crm_contacts.name),
      email = COALESCE(EXCLUDED.email, crm_contacts.email),
      updated_at = now()
    RETURNING id
    `,
    [input.name, input.phone, normalizedPhone, input.email],
  );
  const contactId = stringOrEmpty(contacts[0]?.id);
  const inquiries = await queryRows(
    `
    INSERT INTO inquiries (source, property_id, name, phone, email, message, assigned_agent_id, crm_contact_id)
    VALUES ('website', $1, $2, $3, $4, $5, $6, $7)
    RETURNING id
    `,
    [
      input.property_id,
      input.name,
      input.phone,
      input.email,
      input.message,
      input.assigned_agent_id,
      contactId,
    ],
  );
  await queryRows(
    `
    INSERT INTO crm_leads (contact_id, property_id, assigned_agent_id, stage, intent, source, note)
    VALUES ($1, $2, $3, 'new', 'buyer', 'website', $4)
    `,
    [contactId, input.property_id, input.assigned_agent_id, input.message],
  );
  return { id: stringOrEmpty(inquiries[0]?.id) };
}

export async function updateInquiryStatus(id: string, status: string, actor: StaffAccess) {
  await queryRows("UPDATE inquiries SET status = $1, updated_at = now() WHERE id = $2", [
    status,
    id,
  ]);
  await writeAudit(actor.staffId, "inquiry.status", "inquiry", id, { status });
  return { ok: true };
}

export async function queueCampaign(id: string, actor: StaffAccess) {
  const rows = await queryRows(
    `
    SELECT c.id, c.status, t.status AS template_status
    FROM whatsapp_campaigns c
    LEFT JOIN whatsapp_templates t ON t.id = c.template_id
    WHERE c.id = $1
    LIMIT 1
    `,
    [id],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Campaign not found" };
  if (!["draft", "review", "scheduled"].includes(stringOrEmpty(row.status))) {
    return { ok: false, error: "Campaign cannot be queued from current status" };
  }
  if (!String(row.template_status ?? "").startsWith("active")) {
    return { ok: false, error: "Template is not active" };
  }
  await queryRows(
    "UPDATE whatsapp_campaigns SET status = 'queued', reviewed_by = $1, reviewed_at = now(), updated_at = now() WHERE id = $2",
    [actor.staffId, id],
  );
  await writeAudit(actor.staffId, "campaign.queue", "campaign", id);
  return { ok: true };
}

export async function writeAudit(
  actorId: string | null,
  action: string,
  subjectType?: string,
  subjectId?: string,
  metadata: Record<string, unknown> = {},
) {
  const params: unknown[] = [actorId, action, subjectType ?? null, subjectId ?? null, metadata];
  await queryRows(
    `
    INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    params,
  );
}
