/**
 * A legacy CRM row may store a Hong Kong number as eight digits while a newer
 * row stores 852 plus those digits. Marketing must respect consent on both.
 * This predicate is used only inside explicit staff queue/send operations.
 */
export function marketingIdentitySafeSql(contactAlias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(contactAlias)) {
    throw new Error("Invalid contact SQL alias");
  }
  const phone = `${contactAlias}.normalized_phone`;
  const member = `${contactAlias}.whatsapp_member_id`;
  const otherFormat = `CASE
    WHEN length(${phone}) = 11 AND left(${phone}, 3) = '852' THEN right(${phone}, 8)
    WHEN length(${phone}) = 8 THEN '852' || ${phone}
    ELSE NULL END`;
  return `NOT EXISTS (
    SELECT 1 FROM crm_contacts identity_peer
    WHERE identity_peer.id <> ${contactAlias}.id
      AND (
        identity_peer.normalized_phone IN (${phone}, ${otherFormat})
        OR (${member} IS NOT NULL AND identity_peer.whatsapp_member_id = ${member})
      )
      AND (identity_peer.opted_out_whatsapp = true OR identity_peer.opt_in_whatsapp = false)
  )`;
}
/** Only the lowest active recipient id may send to one phone in a campaign. */
export function campaignRecipientPrimarySql(recipientAlias: string, contactAlias: string): string {
  for (const alias of [recipientAlias, contactAlias]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid SQL alias");
  }
  const phone = `${contactAlias}.normalized_phone`;
  const member = `${contactAlias}.whatsapp_member_id`;
  const otherFormat = `CASE
    WHEN length(${phone}) = 11 AND left(${phone}, 3) = '852' THEN right(${phone}, 8)
    WHEN length(${phone}) = 8 THEN '852' || ${phone}
    ELSE NULL END`;
  return `NOT EXISTS (
    SELECT 1 FROM whatsapp_campaign_recipients earlier
    JOIN crm_contacts earlier_contact ON earlier_contact.id = earlier.contact_id
    WHERE earlier.campaign_id = ${recipientAlias}.campaign_id
      AND earlier.id <> ${recipientAlias}.id
      AND (
        earlier.status = 'sent'
        OR earlier.error = 'WOZTELL_DELIVERY_UNKNOWN'
        OR (earlier.id < ${recipientAlias}.id
          AND earlier.status NOT IN ('cancelled', 'blocked'))
      )
      AND (
        earlier_contact.normalized_phone IN (${phone}, ${otherFormat})
        OR (${member} IS NOT NULL AND earlier_contact.whatsapp_member_id = ${member})
      )
  )`;
}
