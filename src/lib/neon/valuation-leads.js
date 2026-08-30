/**
 * Pure-logic module backing OwnerValuationPanel's structured form -- mirrors
 * listing-alerts.js's shape (a plain function taking an injected `query`,
 * parameterized SQL only, no side effects at import time) so a reader
 * familiar with one recognizes the other.
 *
 * `valuation_leads` is deliberately its OWN table, not a write into
 * crm_contacts/inquiries: this consent is narrower than
 * crm_contacts.opt_in_whatsapp ("opt in to WhatsApp marketing broadly") --
 * it is consent to be contacted about ONE specific valuation request. See
 * neon/migrations/20260830170000_valuation_leads.sql for the full reasoning.
 */

// The exact copy shown next to the (never preselected) consent checkbox on
// OwnerValuationPanel's structured form. Both the client form
// (src/components/site/OwnerValuationPanel.tsx) and the server persistence
// path (src/lib/neon/admin-data.server.ts) import this SAME constant rather
// than each carrying their own copy of the string, so the text that gets
// stored as consent_text is guaranteed to be the text the user actually saw
// -- the server writes this constant unconditionally, it never trusts a
// client-submitted consent_text.
export const VALUATION_CONSENT_TEXT =
  "我同意晉誠地產透過電話或 WhatsApp 聯絡我，跟進呢個放盤估價查詢。";

// Bump this (and keep the old copy visible in git history) whenever
// VALUATION_CONSENT_TEXT's wording changes, so consent_version on rows
// written under the old copy keeps meaning "the wording that was live when
// this row was created" instead of silently being reinterpreted.
export const VALUATION_CONSENT_VERSION = "1";

export async function persistValuationLead(query, input) {
  const {
    name,
    phone,
    email,
    propertyAddress,
    estateId,
    notes,
    consentText,
    consentVersion,
    consentedAt,
    utm,
  } = input;

  const rows = await query(
    `
    INSERT INTO valuation_leads (
      name, phone, email, property_address, estate_id, notes,
      consent_text, consent_version, consented_at, utm
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    RETURNING id
    `,
    [
      name,
      phone,
      email ?? null,
      propertyAddress,
      estateId ?? null,
      notes ?? null,
      consentText,
      consentVersion,
      consentedAt,
      JSON.stringify(utm ?? {}),
    ],
  );

  return { id: rows[0]?.id == null ? "" : String(rows[0].id) };
}
