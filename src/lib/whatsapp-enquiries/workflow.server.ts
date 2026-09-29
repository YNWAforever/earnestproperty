import "@tanstack/react-start/server-only";
import { randomUUID, createHash } from "node:crypto";
import type { NormalizedWoztellEvent } from "../woztell/woztell.server.ts";
import { classifyWoztellEvent } from "./event-classification.ts";
import { enquiryMode } from "./contracts.ts";
import { buildEnqueueJobStatement } from "../control-plane/jobs.server.ts";
import type { TransactionStatement } from "../neon/db.server.ts";
export async function enquirySchemaAvailable() {
  const { queryRows } = await import("../neon/db.server.ts");
  const [row] = await queryRows(
    `SELECT to_regclass('whatsapp_enquiry_events') IS NOT NULL AS available`,
  );
  return row?.available === true;
}
/** SQL is appended after transcript writes in the SAME transaction and snapshot sequence. */
export function buildLiveEventStatements(
  event: NormalizedWoztellEvent,
  now = new Date(),
  mode = enquiryMode(),
): TransactionStatement[] {
  const classified = classifyWoztellEvent(event.payload, { now });
  const eventId = randomUUID();
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        event.appId,
        event.channelId,
        event.woztellMemberId,
        event.externalMessageId,
      ]),
    )
    .digest("hex");
  const active = mode === "active";
  const generation = process.env.EP_WA_ACTIVATION_ID;
  const validGeneration = generation && /^[0-9a-f-]{36}$/i.test(generation) ? generation : null;
  const job = buildEnqueueJobStatement(
    {
      jobType: "woztell.enquiry.process",
      payloadVersion: active ? 2 : 1,
      payload: { eventId },
      idempotencyKey: `wa.enquiry:${key}`,
      runAfter: now,
    },
    { requireEnquiryEvent: true },
  );
  const statements: TransactionStatement[] = [
    {
      statement: `INSERT INTO whatsapp_enquiry_events
 (id,dedupe_key,origin,app_id,channel_id,member_id,external_message_id,message_id,kind,occurred_at,received_at,timing,identity_quality,evidence,capture_mode,effects_eligible)
 SELECT $1::uuid,$2,'live_webhook',$3,$4,$5,$6,m.id,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12::jsonb,'observe',false
 FROM whatsapp_messages m
 WHERE (m.external_message_id=$6 OR ($13::text IS NOT NULL AND m.external_message_id=$13 AND m.text IS NOT DISTINCT FROM $14::text))
 AND m.channel_id=$4 AND m.woztell_member_id=$5 AND m.direction::text=$15
 ORDER BY (m.external_message_id=$6) DESC LIMIT 1
 ON CONFLICT(dedupe_key) DO NOTHING`,
      params: [
        eventId,
        key,
        event.appId,
        event.channelId,
        event.woztellMemberId,
        event.externalMessageId,
        classified.surveyCandidate && classified.direction === "inbound"
          ? "customer_survey_answer"
          : classified.kind,
        classified.occurredAt,
        now.toISOString(),
        classified.timing,
        event.identityCertainty === "ambiguous"
          ? "synthetic_ambiguous"
          : event.identityCertainty === "provider" || event.legacyExternalMessageId === null
            ? "provider_id"
            : "synthetic_ambiguous",
        JSON.stringify({
          ...classified.evidence,
          staffRoutingEligible: active && process.env.EP_WA_ROUTING_ENABLED === "true",
          staffNotificationsEligible:
            active && process.env.EP_WA_STAFF_NOTIFICATIONS_ENABLED === "true",
          noLinkEffectsEligible: active && process.env.EP_WA_NO_LINK_EFFECTS_ENABLED === "true",
        }),
        event.legacyExternalMessageId,
        event.text,
        event.direction,
      ],
    },
    {
      statement: job.statement,
      params: job.params,
    },
  ];
  if (active) {
    statements[0].statement = statements[0].statement
      .replace(
        "capture_mode,effects_eligible)",
        "capture_mode,effects_eligible,activation_id,service_eligible)",
      )
      .replace(
        "$12::jsonb,'observe',false",
        "$12::jsonb,CASE WHEN a.id IS NULL THEN 'observe' ELSE 'active' END,a.id IS NOT NULL,a.id,a.id IS NOT NULL AND $18::boolean",
      )
      .replace(
        "FROM whatsapp_messages m",
        `FROM whatsapp_messages m LEFT JOIN whatsapp_enquiry_activations a ON a.id=$16::uuid AND a.ended_at IS NULL AND a.cutover_at<=$9::timestamptz AND $8::timestamptz>=a.cutover_at AND $10='fresh' AND $11='provider_id' AND $4=$17 AND EXISTS(SELECT 1 FROM whatsapp_service_policies p WHERE p.id=a.policy_id AND p.status='approved' AND p.effective_at<=$8::timestamptz AND $9::timestamptz-$8::timestamptz<=((p.rules->>'freshnessSeconds')::integer*interval '1 second'))`,
      );
    statements[0].params!.push(
      validGeneration,
      process.env.EP_WA_COMPANY_CHANNEL_ID ?? null,
      process.env.EP_WA_SERVICE_AUTOMATION_ENABLED === "true",
    );
  }
  return statements;
}
/** Phase 1 has no outbound/routing ports. Observed events remain permanently effect-ineligible. */
export async function observeEnquiryEvent(
  eventId: string,
  checkpoint: () => Promise<void>,
  injectedQuery?: typeof import("../neon/db.server.ts").queryRows,
) {
  const mode = enquiryMode();
  await checkpoint();
  const query = injectedQuery ?? (await import("../neon/db.server.ts")).queryRows;
  let portal = { recognized: false, handled: false };
  if (mode === "observe" || mode === "active") {
    const { associatePortalEnquiry } = await import("./enquiry-association.server.ts");
    portal = await associatePortalEnquiry(eventId, query);
    if (
      mode === "active" &&
      portal.handled &&
      process.env.EP_WA_NO_LINK_EFFECTS_ENABLED === "true"
    ) {
      const [prepared] = await query<{ decision: { decision: string } }>(
        "SELECT wa_prepare_no_link_followup($1::uuid) AS decision",
        [eventId],
      );
      if (
        prepared?.decision?.decision === "assignment_pending" ||
        prepared?.decision?.decision === "staff_ready"
      ) {
        const { wakeAfterCommit } = await import("../control-plane/job-wake.server.ts");
        wakeAfterCommit("service");
      }
    }
    const { observeEpisode } = await import("./episodes.server.ts");
    if (!portal.handled) await observeEpisode(eventId, query);
    const { observeQualifiedHumanResponse } = await import("./assignment.server.ts");
    await observeQualifiedHumanResponse(eventId, query);
  }
  if (mode === "active" && !portal.recognized) {
    const { scheduleServiceForEvent, processServiceAnswer } =
      await import("./service-workflow.server.ts");
    const { transactionRows } = await import("../neon/db.server.ts");
    const servicePorts = { query, transaction: transactionRows };
    await processServiceAnswer(eventId, servicePorts);
    await scheduleServiceForEvent(eventId, servicePorts);
    await query(
      "UPDATE whatsapp_enquiry_events SET processing_state='processed',processed_at=now() WHERE id=$1::uuid AND capture_mode='active' AND processing_state='pending'",
      [eventId],
    );
  }
  if (mode === "active" && portal.recognized) {
    await query(
      "UPDATE whatsapp_enquiry_events SET processing_state='processed',processed_at=now() WHERE id=$1::uuid AND capture_mode='active' AND processing_state='pending'",
      [eventId],
    );
  }
  const rows = await query(
    `UPDATE whatsapp_enquiry_events SET processing_state=$2,processed_at=COALESCE(processed_at,now())
 WHERE id=$1::uuid AND origin='live_webhook' AND capture_mode='observe' AND effects_eligible=false
 AND processing_state='pending' RETURNING id`,
    [eventId, mode === "observe" ? "observed" : "suppressed"],
  );
  return {
    summary: {
      observed: mode === "observe" ? rows.length : 0,
      suppressed: mode === "off" ? rows.length : 0,
    },
  };
}
