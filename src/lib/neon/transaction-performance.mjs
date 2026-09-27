const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/;
const statuses = new Set(["draft", "verified_attributed", "verified_unattributed", "cancelled"]);
function cents(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function bad(message) {
  throw new Error(message);
}
function money(value, name) {
  if (value === null) return null;
  if (typeof value !== "string" || !MONEY.test(value)) bad(`Invalid ${name} commission`);
  return value;
}
export function validatePerformanceInput(input, actor) {
  if (!actor?.roles?.some((role) => role === "admin" || role === "manager")) bad("Forbidden");
  if (!UUID.test(actor.staffId) || !UUID.test(input?.transactionId))
    bad("Invalid transaction or actor ID");
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0)
    bad("Invalid version");
  if (!["sale", "rent"].includes(input.dealType) || !statuses.has(input.attributionStatus))
    bad("Invalid deal type or status");
  if (input.leadId !== null && !UUID.test(input.leadId)) bad("Invalid lead");
  if (
    input.publicListingNo !== null &&
    (typeof input.publicListingNo !== "string" ||
      !input.publicListingNo.trim() ||
      input.publicListingNo.length > 120)
  )
    bad("Invalid public listing");
  if (
    input.confirmedAt !== null &&
    (typeof input.confirmedAt !== "string" || !Number.isFinite(Date.parse(input.confirmedAt)))
  )
    bad("Invalid confirmation date");
  const receivable = money(input.commissionReceivable, "receivable");
  const received = money(input.commissionReceived, "received");
  if (received !== null && (receivable === null || cents(received) > cents(receivable)))
    bad("Invalid received commission");
  if (!Array.isArray(input.credits) || input.credits.length > 20) bad("Invalid credits");
  const seen = new Set();
  let total = 0;
  for (const credit of input.credits) {
    if (
      !UUID.test(credit.staffId) ||
      (credit.branchIdAtClose !== null && !UUID.test(credit.branchIdAtClose))
    )
      bad("Invalid credit identity");
    if (seen.has(credit.staffId)) bad("Duplicate credit staff");
    seen.add(credit.staffId);
    if (!Number.isSafeInteger(credit.shareBps) || credit.shareBps < 1 || credit.shareBps > 10000)
      bad("Invalid credit share");
    total += credit.shareBps;
  }
  if (
    input.attributionStatus === "verified_attributed" &&
    (input.credits.length === 0 || total !== 10000)
  )
    bad("Credits must total 10000 bps");
  if (
    ["verified_unattributed", "cancelled"].includes(input.attributionStatus) &&
    input.credits.length !== 0
  )
    bad("Credits must be empty");
  if (input.attributionStatus === "draft" && total > 10000) bad("Credit total exceeds 10000 bps");
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 2000)
    bad("A reason is required");
  return {
    ...input,
    reason: input.reason.trim(),
    commissionReceivable: receivable,
    commissionReceived: received,
  };
}
export const SAVE_PERFORMANCE_SQL = `
WITH credit_input AS (
 SELECT * FROM jsonb_to_recordset($11::jsonb)
 AS c(staff_id uuid, branch_id_at_close uuid, share_bps integer)
), candidate AS (
 SELECT t.id, t.deal_type FROM transactions t
 WHERE t.id=$1::uuid AND t.deal_type=$5::deal_type
 AND ($9::text='draft' OR t.verification_state='verified')
 AND ($2::integer=0 OR EXISTS(SELECT 1 FROM transaction_performance p WHERE p.transaction_id=t.id AND p.version=$2::integer))
 AND ($4::text IS NULL OR EXISTS(
   SELECT 1 FROM property_public_members m JOIN properties p ON p.id=m.property_id
   WHERE m.public_listing_no=$4::text AND p.deal_type=t.deal_type AND p.status='active'))
 AND (SELECT count(*) FROM credit_input)=(
   SELECT count(*) FROM credit_input c JOIN staff_users s ON s.id=c.staff_id
   WHERE s.branch_id IS NOT DISTINCT FROM c.branch_id_at_close)
 AND ($13::boolean OR ($14::boolean AND EXISTS(
   SELECT 1 FROM staff_users manager JOIN staff_users owner ON owner.id=t.agent_id
   WHERE manager.id=$12::uuid AND manager.branch_id IS NOT NULL AND manager.branch_id=owner.branch_id)))
 FOR UPDATE OF t
), current_version AS (
 INSERT INTO transaction_performance(transaction_id,version,attribution_status,lead_id,public_listing_no,
 confirmed_at,commission_receivable,commission_received,updated_by,updated_at)
 SELECT id,1,$9::text,$3::uuid,$4::text,$6::timestamptz,$7::numeric,$8::numeric,$12::uuid,now()
 FROM candidate
 ON CONFLICT(transaction_id) DO UPDATE SET
 version=transaction_performance.version+1,attribution_status=EXCLUDED.attribution_status,
 lead_id=EXCLUDED.lead_id,public_listing_no=EXCLUDED.public_listing_no,confirmed_at=EXCLUDED.confirmed_at,
 commission_receivable=EXCLUDED.commission_receivable,commission_received=EXCLUDED.commission_received,
 updated_by=EXCLUDED.updated_by,updated_at=now()
 WHERE transaction_performance.version=$2::integer
 RETURNING transaction_id,version,attribution_status,lead_id,public_listing_no,confirmed_at,
 commission_receivable,commission_received,updated_by
), historical AS (
 INSERT INTO transaction_performance_versions(transaction_id,version,attribution_status,deal_type,lead_id,
 public_listing_no,confirmed_at,commission_receivable,commission_received,reason,changed_by)
 SELECT c.transaction_id,c.version,c.attribution_status,t.deal_type,c.lead_id,c.public_listing_no,c.confirmed_at,
 c.commission_receivable,c.commission_received,$10::text,c.updated_by
 FROM current_version c JOIN transactions t ON t.id=c.transaction_id
 RETURNING transaction_id,version
), saved_credits AS (
 INSERT INTO transaction_agent_credits(transaction_id,version,staff_id,branch_id_at_close,share_bps)
 SELECT h.transaction_id,h.version,c.staff_id,c.branch_id_at_close,c.share_bps
 FROM historical h CROSS JOIN credit_input c RETURNING staff_id
)
SELECT transaction_id::text AS transaction_id,version FROM historical
`;
export function buildSavePerformanceQuery(raw, actor) {
  const input = validatePerformanceInput(raw, actor);
  return {
    statement: SAVE_PERFORMANCE_SQL,
    params: [
      input.transactionId,
      input.expectedVersion,
      input.leadId,
      input.publicListingNo,
      input.dealType,
      input.confirmedAt,
      input.commissionReceivable,
      input.commissionReceived,
      input.attributionStatus,
      input.reason,
      JSON.stringify(
        input.credits.map((c) => ({
          staff_id: c.staffId,
          branch_id_at_close: c.branchIdAtClose,
          share_bps: c.shareBps,
        })),
      ),
      actor.staffId,
      actor.roles.includes("admin"),
      actor.roles.includes("manager"),
    ],
  };
}
