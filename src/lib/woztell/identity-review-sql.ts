/**
 * FX-12 / C-04, owner decision 1: no reply of any kind (staff or automated service) is
 * prepared or dispatched in a 「身分待核對」 conversation until a manager resolves its
 * review. Every customer-bound send path uses this one predicate. Pure: no imports.
 */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/** The block code a refused automated reply ends with. */
export const IDENTITY_REVIEW_BLOCK_CODE = "identity_review_open";

/** SQL boolean: the conversation `conversationIdSql` has an open identity-conflict review. */
export function identityReviewOpenSql(conversationIdSql: string): string {
  if (!SQL_IDENTIFIER.test(conversationIdSql))
    throw new Error("Invalid identity review SQL operand");
  return `EXISTS(SELECT 1 FROM crm_contact_identity_reviews idr
    WHERE idr.conversation_id=${conversationIdSql} AND idr.reason='whatsapp_identity_conflict' AND idr.status='open')`;
}
