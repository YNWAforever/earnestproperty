// All report reads apply a server-resolved branch scope. Source domains stay separate.
const scope = `
  ($3::uuid IS NULL OR owner.branch_id=$3::uuid)
  AND ($4::uuid IS NULL OR i.assigned_agent_id=$4::uuid)
  AND ($5::text IS NULL OR COALESCE(i.placement_source,i.source)=$5::text)
  AND ($6::text IS NULL OR property.deal_type::text=$6::text)
`;
export const INQUIRY_ROWS_SQL =
  `WITH ranked AS (
  SELECT i.id::text AS id,i.crm_lead_id::text AS "crmLeadId",
    CASE WHEN i.crm_lead_id IS NULL THEN i.id::text ELSE
      (SELECT j.id::text FROM inquiries j
       JOIN inquiry_quality_records jq ON jq.inquiry_id=j.id AND jq.quality='production'
       WHERE j.crm_lead_id=i.crm_lead_id ORDER BY j.created_at,j.id LIMIT 1) END AS "firstLeadInquiryId",
    i.created_at AS "createdAt",i.customer_message_at AS "customerMessageAt",
    i.webhook_received_at AS "webhookReceivedAt",i.response_due_at AS "responseDueAt",
    i.service_policy_id::text AS "servicePolicyId",q.quality,
    i.assigned_agent_id::text AS "assignedStaffId"
  FROM inquiries i
  JOIN inquiry_quality_records q ON q.inquiry_id=i.id
  LEFT JOIN staff_users owner ON owner.id=i.assigned_agent_id
  LEFT JOIN properties property ON property.id=i.property_id
  WHERE ` +
  scope +
  `
)
SELECT * FROM ranked WHERE "createdAt">=($1::date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
 AND "createdAt"<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
 ORDER BY "createdAt",id`;
export const EVENT_ROWS_SQL = `SELECT event_type AS type,inquiry_id::text AS "inquiryId",
  lead_id::text AS "leadId",transaction_id::text AS "transactionId",
  staff_id::text AS "staffId",branch_id_at_event::text AS "branchIdAtEvent",
  occurred_at AS "occurredAt",quality,event_key AS "eventKey"
  FROM performance_event_records
  WHERE (inquiry_id=ANY($1::uuid[]) OR lead_id=ANY($2::uuid[]))
  AND event_type IN ('lead_qualified','viewing_completed','assignment_confirmed','human_response')
  ORDER BY occurred_at,event_key`;
export const DEAL_ROWS_SQL = `SELECT p.transaction_id::text AS "transactionId",p.version,
  p.attribution_status AS status,p.lead_id::text AS "leadId",
  p.confirmed_at AS "confirmedAt",t.price::text AS price,t.deal_type::text AS "dealType",
  p.commission_receivable::text AS "commissionReceivable",
  COALESCE(e.quality,'unknown') AS quality,true AS current
  FROM transaction_performance p JOIN transactions t ON t.id=p.transaction_id
  LEFT JOIN staff_users owner ON owner.id=t.agent_id
  LEFT JOIN performance_event_records e ON e.event_key='deal_confirmed:'||
    p.transaction_id::text||':'||p.version::text
  WHERE p.attribution_status IN ('verified_attributed','verified_unattributed')
  AND p.confirmed_at>=($1::date::timestamp AT TIME ZONE 'Asia/Hong_Kong')
  AND p.confirmed_at<(($2::date+$7::integer+1)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
  AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM transaction_agent_credits branch_credit
    WHERE branch_credit.transaction_id=p.transaction_id AND branch_credit.version=p.version
      AND branch_credit.branch_id_at_close=$3::uuid)
    OR (owner.branch_id=$3::uuid AND NOT EXISTS(SELECT 1 FROM transaction_agent_credits any_credit
      WHERE any_credit.transaction_id=p.transaction_id AND any_credit.version=p.version)))
  AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM transaction_agent_credits c
    WHERE c.transaction_id=p.transaction_id AND c.version=p.version AND c.staff_id=$4::uuid))
  AND ($5::text IS NULL OR EXISTS(SELECT 1 FROM inquiries i
    WHERE i.crm_lead_id=p.lead_id AND COALESCE(i.placement_source,i.source)=$5::text))
  AND ($6::text IS NULL OR t.deal_type::text=$6::text)
  ORDER BY p.confirmed_at,p.transaction_id`;
export const CREDIT_ROWS_SQL = `SELECT transaction_id::text AS "transactionId",version,
  staff_id::text AS "staffId",branch_id_at_close::text AS "branchIdAtClose",share_bps AS "shareBps"
  FROM transaction_agent_credits WHERE transaction_id=ANY($1::uuid[])
  AND ($2::uuid IS NULL OR branch_id_at_close=$2::uuid)
  AND ($3::uuid IS NULL OR staff_id=$3::uuid)
  ORDER BY transaction_id,staff_id`;
const backlogScope = scope
  .replaceAll("$3", "$1")
  .replaceAll("$4", "$2")
  .replaceAll("$5", "$3")
  .replaceAll("$6", "$4");
export const BACKLOG_SQL =
  `SELECT count(*)::integer AS "openInquiries",
  count(*) FILTER(WHERE q.quality='unknown')::integer AS "unknownQuality"
  FROM inquiries i JOIN inquiry_quality_records q ON q.inquiry_id=i.id
  LEFT JOIN staff_users owner ON owner.id=i.assigned_agent_id
  LEFT JOIN properties property ON property.id=i.property_id
  WHERE i.status NOT IN ('closed','resolved','spam') AND ` +
  backlogScope +
  ``;
export const BACKLOG_ROWS_SQL =
  `SELECT i.id::text AS id,i.created_at AS "createdAt",
  i.assigned_agent_id::text AS "assignedStaffId",i.crm_lead_id::text AS "crmLeadId",
  i.status,q.quality
  FROM inquiries i JOIN inquiry_quality_records q ON q.inquiry_id=i.id
  LEFT JOIN staff_users owner ON owner.id=i.assigned_agent_id
  LEFT JOIN properties property ON property.id=i.property_id
  WHERE i.status NOT IN ('closed','resolved','spam') AND ` +
  backlogScope +
  ` ORDER BY i.created_at,i.id`;
export function reportParams(filters, branchScope) {
  return [
    filters.start,
    filters.end,
    branchScope,
    filters.staffId,
    filters.source,
    filters.dealType,
    filters.cohortWindowDays,
  ];
}

export const LEGACY_TRANSACTION_SQL = `SELECT count(*)::integer AS count
  FROM transactions t LEFT JOIN transaction_performance p ON p.transaction_id=t.id
  LEFT JOIN staff_users owner ON owner.id=t.agent_id
  WHERE p.transaction_id IS NULL AND t.verification_state='verified'
  AND t.deal_date>= $1::date AND t.deal_date<= $2::date
  AND ($3::uuid IS NULL OR owner.branch_id=$3::uuid)
  AND ($4::uuid IS NULL OR t.agent_id=$4::uuid)
  AND $5::text IS NULL
  AND ($6::text IS NULL OR t.deal_type::text=$6::text)`;
