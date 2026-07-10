export function deriveWebsiteInquiryRouting(listing) {
  if (!listing) {
    return {
      propertyId: null,
      assignedAgentId: null,
      intent: "buyer",
    };
  }

  return {
    propertyId: listing.id,
    assignedAgentId: listing.agentActive && listing.agentId ? listing.agentId : null,
    intent: listing.dealType === "rent" ? "renter" : "buyer",
  };
}

export const WEBSITE_LISTING_NO_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

export function isValidWebsiteListingNo(value) {
  return typeof value === "string" && WEBSITE_LISTING_NO_PATTERN.test(value);
}

export async function persistWebsiteInquiry(query, input) {
  const {
    name,
    phone,
    normalizedPhone,
    email,
    message,
    listingNo,
    propertyId,
    consentWhatsapp,
  } = input;
  const contactCte = normalizedPhone
    ? `
      contact AS (
        INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
        VALUES ($1, $2, $3, $4, 'website', $6)
        ON CONFLICT (normalized_phone) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, crm_contacts.name),
          email = COALESCE(EXCLUDED.email, crm_contacts.email),
          opt_in_whatsapp = crm_contacts.opt_in_whatsapp OR EXCLUDED.opt_in_whatsapp,
          updated_at = now()
        RETURNING id
      )`
    : `
      contact AS (
        INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
        VALUES ($1, $2, $3, $4, 'website', $6)
        RETURNING id
      )`;

  const rows = await query(
    `
    WITH resolved_listing AS (
      SELECT
        p.id AS property_id,
        s.id AS assigned_agent_id,
        CASE WHEN p.deal_type = 'rent' THEN 'renter' ELSE 'buyer' END AS intent
      FROM properties p
      LEFT JOIN staff_users s ON s.id = p.agent_id AND s.active = true
      WHERE p.status = 'active'
        AND (
          ($7::uuid IS NOT NULL AND p.id = $7::uuid)
          OR ($8::text IS NOT NULL AND p.listing_no = $8::text)
        )
      ORDER BY CASE WHEN p.id = $7::uuid THEN 0 ELSE 1 END
      LIMIT 1
    ),
    routing AS (
      SELECT property_id, assigned_agent_id, intent FROM resolved_listing
      UNION ALL
      SELECT NULL::uuid, NULL::uuid, 'buyer'::text
      WHERE NOT EXISTS (SELECT 1 FROM resolved_listing)
    ),
    ${contactCte},
    new_lead AS (
      INSERT INTO crm_leads (contact_id, property_id, assigned_agent_id, stage, intent, source, note)
      SELECT contact.id, routing.property_id, routing.assigned_agent_id,
        'new', routing.intent, 'website', $5
      FROM contact
      CROSS JOIN routing
    )
    INSERT INTO inquiries (
      source, property_id, name, phone, email, message, assigned_agent_id, crm_contact_id
    )
    SELECT 'website', routing.property_id, $1, $2, $4, $5,
      routing.assigned_agent_id, contact.id
    FROM contact
    CROSS JOIN routing
    RETURNING id
    `,
    [
      name,
      phone,
      normalizedPhone,
      email,
      message,
      consentWhatsapp === true,
      propertyId || null,
      listingNo || null,
    ],
  );

  return { id: rows[0]?.id == null ? "" : String(rows[0].id) };
}
