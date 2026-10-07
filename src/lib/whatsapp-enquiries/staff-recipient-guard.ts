/**
 * D-11: a staff WhatsApp destination is never a customer's WhatsApp member or phone.
 *
 * ONE SQL fragment for every staff send path: lead alerts (plan, claim and
 * beforeSend), the enquiry-notification dispatch boundary and the staff test
 * notification (enqueue and dispatch boundary). Pure: no `server-only` import.
 *
 * Exact strings still match. Phones and member ids also compare by digits: the
 * destination's digits (at least 8) against a customer's full digits, their last 8,
 * 852 + their last 8, and, when both have at least 8 digits, the last 8 of each
 * (refuse-leaning: "+852 9123 4567" = "85291234567" = "91234567", and
 * "8613812345678" = "13812345678").
 */

const digits = (expr: string) => `regexp_replace(${expr},'\\D','','g')`;

function digitsMatch(dest: string, customer: string) {
  return `(length(${dest})>=8 AND (${dest} IN (${customer},right(${customer},8),'852'||right(${customer},8)) OR (length(${customer})>=8 AND right(${dest},8)=right(${customer},8))))`;
}

/** `alias` is the staff_notification_endpoints alias in the surrounding query. */
export function staffDestinationNotACustomer(alias = "ep") {
  const ref = `${alias}.destination_reference`;
  const dest = digits(ref);
  const member = digits("guard_w.woztell_member_id");
  const contactMember = digits("guard_c.whatsapp_member_id");
  const contactPhone = digits("guard_c.normalized_phone");
  return `(NOT EXISTS(SELECT 1 FROM whatsapp_conversations guard_w WHERE guard_w.channel_id=${alias}.channel_id AND (guard_w.woztell_member_id=${ref} OR ${digitsMatch(dest, member)})) AND NOT EXISTS(SELECT 1 FROM crm_contacts guard_c WHERE guard_c.whatsapp_member_id=${ref} OR guard_c.normalized_phone=${ref} OR ${digitsMatch(dest, contactMember)} OR ${digitsMatch(dest, contactPhone)}))`;
}

/** One phone typed two ways is one destination: the digits when there are at least
 * 8, else the reference as typed (a non-phone member id is never merged). */
export function staffDestinationKey(expr = "destination_reference") {
  return `CASE WHEN length(${digits(expr)})>=8 THEN ${digits(expr)} ELSE ${expr} END`;
}
