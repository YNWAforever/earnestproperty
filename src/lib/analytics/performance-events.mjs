const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const origins = {
  lead_qualified: "crm_lead",
  viewing_completed: "crm_activity",
  assignment_confirmed: "wa_assignment",
  human_response: "wa_human_response",
  deal_confirmed: "transaction_version",
  deal_cancelled: "transaction_version",
};
const qualities = new Set(["production", "test", "spam", "unknown"]);
export function performanceEventKey(type, sourceId) {
  if (!Object.hasOwn(origins, type) || !sourceId) throw new Error("Invalid event source");
  return type + ":" + sourceId;
}
export function validatePerformanceEvent(event) {
  if (
    !event ||
    !Object.hasOwn(origins, event.type) ||
    typeof event.source !== "string" ||
    !event.source.startsWith(origins[event.type] + ":")
  )
    throw new Error("Invalid event source");
  const sourceId = event.source.slice(origins[event.type].length + 1);
  const parts = sourceId.split(":");
  if (
    !uuid.test(parts[0]) ||
    (parts.length === 2 && (!Number.isSafeInteger(Number(parts[1])) || Number(parts[1]) < 1)) ||
    parts.length > 2
  )
    throw new Error("Invalid event source identity");
  if (event.type.startsWith("deal_") !== (parts.length === 2))
    throw new Error("Invalid event source version");
  if (!qualities.has(event.quality)) throw new Error("Invalid event quality");
  if (typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt)))
    throw new Error("Invalid event time");
  if (
    event.idempotencyKey !== undefined &&
    event.idempotencyKey !== performanceEventKey(event.type, sourceId)
  )
    throw new Error("Invalid event idempotency key");
  if (event.type === "human_response" && event.inquiryId !== parts[0])
    throw new Error("Invalid human response source");
  if (event.type.startsWith("deal_") && event.transactionId !== parts[0])
    throw new Error("Invalid deal source");
  return { ...event, idempotencyKey: performanceEventKey(event.type, sourceId), sourceId };
}

// Select canonical facts for repair without trusting caller supplied dimensions.
export function buildRecordPerformanceEventQuery(event) {
  const parsed = validatePerformanceEvent(event);
  if (parsed.quality !== "unknown") throw new Error("Event quality requires a reasoned correction");
  const [id, version] = parsed.sourceId.split(":");
  const columns =
    "event_key,event_type,source_id,inquiry_id,lead_id,transaction_id,staff_id,branch_id_at_event,occurred_at,source,policy_version";
  let sourceSelect;
  let params = [parsed.idempotencyKey, parsed.type, parsed.sourceId, id];
  switch (parsed.type) {
    case "lead_qualified":
      sourceSelect = `SELECT $1,$2,$3,NULL::uuid,q.lead_id,NULL::uuid,COALESCE(l.assigned_agent_id,q.qualified_by),s.branch_id,
        q.qualified_at,'crm_lead:'||q.lead_id::text,NULL::text
        FROM crm_lead_qualifications q JOIN crm_leads l ON l.id=q.lead_id
        JOIN staff_users s ON s.id=COALESCE(l.assigned_agent_id,q.qualified_by)
        WHERE q.lead_id=$4::uuid`;
      break;
    case "viewing_completed":
      sourceSelect = `SELECT $1,$2,$3,NULL::uuid,a.lead_id,NULL::uuid,a.staff_user_id,s.branch_id,
        a.completed_at,'crm_activity:'||a.id::text,NULL::text
        FROM crm_activities a JOIN staff_users s ON s.id=a.staff_user_id
        WHERE a.id=$4::uuid AND a.activity_type='viewing' AND a.completed_at IS NOT NULL`;
      break;
    case "assignment_confirmed":
      sourceSelect = `SELECT $1,$2,$3,
        (SELECT CASE WHEN count(*)=1 THEN (array_agg(i.id))[1] ELSE NULL END FROM inquiries i
         WHERE i.conversation_id=r.conversation_id AND i.source='whatsapp' AND i.created_at<=r.finished_at),
        NULL::uuid,NULL::uuid,r.desired_staff_id,s.branch_id,r.finished_at,
        'wa_assignment:'||r.id::text,NULL::text
        FROM whatsapp_assignment_requests r JOIN staff_users s ON s.id=r.desired_staff_id
        WHERE r.id=$4::uuid AND r.state='confirmed' AND r.finished_at IS NOT NULL`;
      break;
    case "human_response":
      sourceSelect = `SELECT $1,$2,$3,i.id,NULL::uuid,NULL::uuid,i.first_human_response_staff_id,s.branch_id,
        i.first_human_response_at,'wa_human_response:'||i.id::text,i.service_policy_id::text
        FROM inquiries i JOIN staff_users s ON s.id=i.first_human_response_staff_id
        WHERE i.id=$4::uuid AND i.source='whatsapp' AND i.first_human_response_at IS NOT NULL`;
      break;
    case "deal_confirmed":
    case "deal_cancelled":
      params = [...params, Number(version)];
      sourceSelect =
        `SELECT $1,$2,$3,NULL::uuid,v.lead_id,v.transaction_id,v.changed_by,NULL::uuid,
        CASE WHEN $2='deal_cancelled' THEN v.changed_at ELSE COALESCE(v.confirmed_at,v.changed_at) END,
        'transaction_version:'||v.transaction_id::text||':'||v.version::text,NULL::text
        FROM transaction_performance_versions v
        WHERE v.transaction_id=$4::uuid AND v.version=$5::integer AND ` +
        (parsed.type === "deal_confirmed"
          ? "v.attribution_status IN ('verified_attributed','verified_unattributed')"
          : "v.attribution_status='cancelled'");
      break;
    default:
      throw new Error("Invalid event type");
  }
  return {
    statement:
      "INSERT INTO performance_events(" + columns + ") " + sourceSelect + " ON CONFLICT DO NOTHING",
    params,
  };
}
