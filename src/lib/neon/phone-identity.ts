import { phoneEquivalentsSql, phoneSpellingRankSql } from "../phone.js";

/**
 * A legacy CRM row may store a Hong Kong number as eight digits, or as 00852 plus
 * those digits, while a newer row stores 852 plus them. Marketing must respect
 * consent on every spelling (FX-12, Fact 14).
 * This predicate is used only inside explicit staff queue/send operations.
 */
export function marketingIdentitySafeSql(contactAlias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(contactAlias)) {
    throw new Error("Invalid contact SQL alias");
  }
  const phone = `${contactAlias}.normalized_phone`;
  const member = `${contactAlias}.whatsapp_member_id`;
  const equivalents = phoneEquivalentsSql(phone);
  return `NOT EXISTS (
    SELECT 1 FROM crm_contacts identity_peer
    WHERE identity_peer.id <> ${contactAlias}.id
      AND (
        identity_peer.normalized_phone = ANY(${equivalents})
        OR (${member} IS NOT NULL AND identity_peer.whatsapp_member_id = ${member})
      )
      AND (identity_peer.opted_out_whatsapp = true OR identity_peer.opt_in_whatsapp = false)
  )`;
}
/**
 * Only one active recipient may send to one phone in a campaign. FX-12 fix round 1
 * (I-3): the primary is the contact with a WhatsApp member id, then the canonical
 * phone spelling, then the lowest recipient id, so a member-less 00852 or 8-digit
 * duplicate never displaces the customer's WhatsApp contact.
 */
export function campaignRecipientPrimarySql(recipientAlias: string, contactAlias: string): string {
  for (const alias of [recipientAlias, contactAlias]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid SQL alias");
  }
  const phone = `${contactAlias}.normalized_phone`;
  const member = `${contactAlias}.whatsapp_member_id`;
  const equivalents = phoneEquivalentsSql(phone);
  return `NOT EXISTS (
    SELECT 1 FROM whatsapp_campaign_recipients earlier
    JOIN crm_contacts earlier_contact ON earlier_contact.id = earlier.contact_id
    WHERE earlier.campaign_id = ${recipientAlias}.campaign_id
      AND earlier.id <> ${recipientAlias}.id
      AND (
        earlier.status = 'sent'
        OR earlier.error = 'WOZTELL_DELIVERY_UNKNOWN'
        OR ((NULLIF(earlier_contact.whatsapp_member_id, '') IS NULL,
            ${phoneSpellingRankSql("earlier_contact.normalized_phone")}, earlier.id)
          < (NULLIF(${member}, '') IS NULL, ${phoneSpellingRankSql(phone)}, ${recipientAlias}.id)
          AND earlier.status NOT IN ('cancelled', 'blocked'))
      )
      AND (
        earlier_contact.normalized_phone = ANY(${equivalents})
        OR (${member} IS NOT NULL AND earlier_contact.whatsapp_member_id = ${member})
      )
  )`;
}
