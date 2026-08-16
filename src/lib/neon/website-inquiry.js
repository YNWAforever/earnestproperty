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

export const WEBSITE_LISTING_NO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

export function isValidWebsiteListingNo(value) {
  return typeof value === "string" && WEBSITE_LISTING_NO_PATTERN.test(value);
}

/**
 * KNOWN GAP -- needs a product decision, do not assume it is handled.
 *
 * Because the ON CONFLICT branch below carries name/email/opt_in_whatsapp over
 * unchanged, an EXISTING contact cannot change any of them through the public
 * form. For consent specifically that is a one-way door today: there is no
 * admin screen and no server fn anywhere that sets crm_contacts.opt_in_whatsapp,
 * so the only remaining way for it to become true is the customer sending an
 * inbound WhatsApp message (api.woztell.webhook.ts, `opt_in_whatsapp OR $6`).
 *
 * Concretely: a customer who submits once WITHOUT ticking the consent box, and
 * later returns and ticks it, has that consent silently discarded, and the form
 * still reports success.
 *
 * Deliberately left as-is rather than papered over: allowing the public form to
 * raise consent is exactly the forgery this guards against. The fix is a
 * staff-side, audited mutation (mirror clearContactWhatsappOptOut in
 * admin-data.server.ts) plus a control in the admin -- not a change here.
 */
export async function persistWebsiteInquiry(query, input) {
  const { name, phone, normalizedPhone, email, message, listingNo, propertyId, consentWhatsapp } =
    input;
  const contactCte = normalizedPhone
    ? `
      contact AS (
        INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
        VALUES ($1, $2, $3, $4, 'website', $6)
        ON CONFLICT (normalized_phone) DO UPDATE SET
          -- Existing values win. This endpoint is unauthenticated: the only
          -- thing a submitter proves is that they typed a phone number, so
          -- letting EXCLUDED win meant anyone who knew a customer's number
          -- could rewrite that contact's name and email in the CRM. New values
          -- still fill blanks, which is the case the public form is for.
          name = COALESCE(crm_contacts.name, EXCLUDED.name),
          email = COALESCE(crm_contacts.email, EXCLUDED.email),
          -- Deliberately NOT "OR EXCLUDED.opt_in_whatsapp". Raising consent here
          -- let an unauthenticated caller forge WhatsApp marketing opt-in for
          -- any number already in the CRM, and a forged opt-in feeds straight
          -- into real blast delivery (see campaign-delivery.server.ts).
          opt_in_whatsapp = crm_contacts.opt_in_whatsapp,
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
      source, property_id, intent, name, phone, email, message, assigned_agent_id, crm_contact_id
    )
    SELECT 'website', routing.property_id, routing.intent, $1, $2, $4, $5,
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
