import { leadAlertEnqueueCte } from "./lead-alert-enqueue.js";

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

/** Staff timeline note for a filled honeypot (owner copy); a server constant, never user text. */
export const SUSPECTED_BOT_NOTE =
  "表格的隱藏欄位有內容，可能是自動程式提交。查詢已照常保存及通知，請照常跟進。";

/** Atomic intake; existing customer consent is never changed by phone-only requests. */
export async function persistWebsiteInquiry(query, input) {
  const { name, phone, normalizedPhone, email, message, listingNo, propertyId, consentWhatsapp } =
    input;
  const submissionId = input.submissionId;
  if (
    submissionId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)
  ) {
    throw Object.assign(new Error("Invalid submission identity"), {
      code: "INQUIRY_SUBMISSION_INVALID",
    });
  }
  const payloadHash = submissionId
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              JSON.stringify([
                name,
                phone,
                normalizedPhone,
                email,
                message,
                consentWhatsapp === true,
                propertyId || null,
                listingNo || null,
              ]),
            ),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
    : null;
  const submissionCte = submissionId
    ? `submission AS (
      INSERT INTO website_inquiry_submissions (submission_id, payload_hash)
      VALUES ($9::uuid, $10)
      ON CONFLICT (submission_id) DO NOTHING
      RETURNING inquiry_id
    ),`
    : "";
  // Public phone-only requests may fill blanks but cannot rewrite an existing identity or consent.
  const sourceGuard = submissionId ? "EXISTS (SELECT 1 FROM submission)" : "true";
  const contactCte = normalizedPhone
    ? `
      matched_contact AS (
        UPDATE crm_contacts c SET
          name = COALESCE(c.name, $1),
          email = COALESCE(c.email, $4),
          updated_at = now()
        WHERE ${sourceGuard} AND c.id = (
          SELECT id FROM crm_contacts
          WHERE normalized_phone = $3
            OR (length($3::text) = 11 AND left($3::text, 3) = '852'
              AND normalized_phone = right($3::text, 8))
          ORDER BY (normalized_phone = $3) DESC, id
          LIMIT 1
        )
        RETURNING id
      ),
      inserted_contact AS (
        INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
        SELECT $1, $2, $3, $4, 'website', $6
        WHERE ${sourceGuard} AND NOT EXISTS (SELECT 1 FROM matched_contact)
        ON CONFLICT (normalized_phone) DO UPDATE SET
          name = COALESCE(crm_contacts.name, EXCLUDED.name),
          email = COALESCE(crm_contacts.email, EXCLUDED.email),
          opt_in_whatsapp = crm_contacts.opt_in_whatsapp,
          updated_at = now()
        RETURNING id
      ),
      contact AS (SELECT id FROM matched_contact UNION ALL SELECT id FROM inserted_contact)`
    : `
      contact AS (
        INSERT INTO crm_contacts (name, phone, normalized_phone, email, source, opt_in_whatsapp)
        SELECT $1, $2, $3, $4, 'website', $6 WHERE ${sourceGuard}
        RETURNING id
      )`;
  // The honeypot flag and its note body are always the LAST two params ($9/$10 exist only with a
  // submissionId). The flag only adds rows; it never gates the lead, inquiry or alert job, and
  // it is not part of the replay hash above.
  const baseParamCount = submissionId ? 10 : 8;
  const botBody = `$${baseParamCount + 1}`;
  const botFlag = `$${baseParamCount + 2}::boolean`;
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
    ${submissionCte}
    ${contactCte},
    new_lead AS (
      INSERT INTO crm_leads (contact_id, property_id, assigned_agent_id, stage, intent, source, note)
      SELECT contact.id, routing.property_id, routing.assigned_agent_id,
        'new', routing.intent, 'website', $5
      FROM contact
      CROSS JOIN routing
      RETURNING id, contact_id
    ),
    bot_note AS (
      INSERT INTO crm_activities (lead_id, contact_id, activity_type, body)
      SELECT new_lead.id, new_lead.contact_id, 'suspected_bot', ${botBody}
      FROM new_lead WHERE ${botFlag}
      RETURNING id
    ),
    bot_audit AS (
      INSERT INTO audit_logs (actor_id, action, subject_type, subject_id, metadata)
      SELECT NULL, 'public_form.suspected_bot', 'crm_lead', new_lead.id, '{"form":"website_inquiry"}'::jsonb
      FROM new_lead WHERE ${botFlag}
      RETURNING id
    ),
    ${leadAlertEnqueueCte("new_lead")}
    INSERT INTO inquiries (
${submissionId ? "id, crm_lead_id, marketing_consent_requested, consent_copy_version," : ""}
      source, property_id, intent, name, phone, email, message, assigned_agent_id, crm_contact_id
    )
    SELECT ${submissionId ? "(SELECT inquiry_id FROM submission), (SELECT id FROM new_lead), $6, 'website-whatsapp-v1'," : ""}
      'website', routing.property_id, routing.intent, $1, $2, $4, $5,
      routing.assigned_agent_id, contact.id
    FROM contact
    CROSS JOIN routing
    RETURNING id, (SELECT count(*) FROM lead_alert) > 0 AS lead_alert_queued
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
      ...(submissionId ? [submissionId, payloadHash] : []),
      SUSPECTED_BOT_NOTE,
      input.suspectedBot === true,
    ],
  );

  if (submissionId && !rows[0]) {
    // A concurrent ON CONFLICT wait uses the statement's old snapshot. Resolve
    // the committed original in a fresh read, never retry the intake insert.
    const existing = await query(
      `SELECT i.id, s.payload_hash, s.created_at > now() - interval '72 hours' AS replayable
       FROM website_inquiry_submissions s JOIN inquiries i ON i.id = s.inquiry_id
       WHERE s.submission_id = $1::uuid AND $2::text IS NOT NULL`,
      [submissionId, payloadHash],
    );
    const prior = existing[0];
    if (!prior || prior.payload_hash !== payloadHash) {
      throw Object.assign(new Error("Submission identity has already been used."), {
        code: "INQUIRY_SUBMISSION_CONFLICT",
      });
    }
    if (!prior.replayable) {
      throw Object.assign(
        new Error("Submission replay window expired; contact staff to verify the earlier enquiry."),
        { code: "INQUIRY_REPLAY_EXPIRED" },
      );
    }
    return { id: String(prior.id), leadAlertQueued: false };
  }
  return {
    id: rows[0]?.id == null ? "" : String(rows[0].id),
    leadAlertQueued: rows[0]?.lead_alert_queued === true,
  };
}
