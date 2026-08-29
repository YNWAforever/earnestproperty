/**
 * Pure-logic module backing /listings' zero-results "notify me" form --
 * mirrors website-inquiry.js's shape (a plain function taking an injected
 * `query`, parameterized SQL only, no side effects at import time) so a
 * reader familiar with one recognizes the other.
 *
 * `listing_alerts` is deliberately its OWN table, not a write into
 * crm_contacts/inquiries: this consent is narrower than
 * crm_contacts.opt_in_whatsapp ("opt in to WhatsApp marketing broadly") --
 * it is consent to be notified about ONE specific saved search. See
 * neon/migrations/20260830120000_listing_alerts.sql for the full reasoning.
 */

// The exact copy shown next to the (never preselected) consent checkbox on
// /listings' zero-results notify-me form. Both the client form
// (src/routes/listings.tsx) and the server persistence path
// (src/lib/neon/admin-data.server.ts) import this SAME constant rather than
// each carrying their own copy of the string, so the text that gets stored
// as consent_text is guaranteed to be the text the user actually saw --
// the server writes this constant unconditionally, it never trusts a
// client-submitted consent_text.
export const LISTING_ALERT_CONSENT_TEXT =
  "我同意晉誠地產透過電話或 WhatsApp 聯絡我，喺呢個搜尋條件出現新放盤時通知我。";

// Bump this (and keep the old copy visible in git history) whenever
// LISTING_ALERT_CONSENT_TEXT's wording changes, so consent_version on rows
// written under the old copy keeps meaning "the wording that was live when
// this row was created" instead of silently being reinterpreted.
export const LISTING_ALERT_CONSENT_VERSION = "1";

export async function persistListingAlert(query, input) {
  const { name, phone, email, filters, consentText, consentVersion, consentedAt, utm } = input;

  const rows = await query(
    `
    INSERT INTO listing_alerts (
      filters, name, phone, email, consent_text, consent_version, consented_at, utm
    )
    VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7, $8::jsonb)
    RETURNING id
    `,
    [
      JSON.stringify(filters ?? {}),
      name,
      phone,
      email,
      consentText,
      consentVersion,
      consentedAt,
      JSON.stringify(utm ?? {}),
    ],
  );

  return { id: rows[0]?.id == null ? "" : String(rows[0].id) };
}
