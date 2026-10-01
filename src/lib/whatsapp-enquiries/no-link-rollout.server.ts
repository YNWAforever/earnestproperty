import "@tanstack/react-start/server-only";
import type { queryRows } from "../neon/db.server.ts";
import {
  canCaptureNoLinkEffects,
  canExecuteNoLinkEffects,
  type NoLinkCanary,
} from "./no-link-rollout.ts";
import type { EnquiryMode } from "./contracts.ts";

type Query = typeof queryRows;
type GateRow = {
  channel_id: string | null;
  activation_id: string | null;
  origin: string | null;
  captured_mode: string | null;
  effects_eligible: boolean;
  no_link_snapshot: boolean;
  receipt_mode: string | null;
  receipt_activation_id: string | null;
  receipt_received_at: Date | string | null;
  event_occurred_at: Date | string | null;
  activation_cutover_at: Date | string | null;
  activation_ended_at: Date | string | null;
  timing: string | null;
  identity_quality: string | null;
  candidate_staff_id: string | null;
  captured_staff_ids: unknown;
  mapping_verified: boolean;
  provider_mapping_verified: boolean;
};

export function noLinkCanaryConfig(
  mode: EnquiryMode,
  channelId: string | null,
  activationId: string | null,
  env: NodeJS.ProcessEnv = process.env,
): NoLinkCanary {
  return {
    mode,
    effectsEnabled: env.EP_WA_NO_LINK_EFFECTS_ENABLED === "true",
    companyChannelId: env.EP_WA_COMPANY_CHANNEL_ID ?? null,
    canaryChannelId: env.EP_WA_NO_LINK_CANARY_CHANNEL_ID ?? null,
    canaryActivationId: env.EP_WA_NO_LINK_CANARY_ACTIVATION_ID ?? null,
    canaryStaffIds: (env.EP_WA_NO_LINK_CANARY_STAFF_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    channelId,
    activationId,
  };
}

/** Capture-time snapshot is immutable on the event. It does not authorize an effect by itself. */
export function noLinkCaptureSnapshot(
  mode: EnquiryMode,
  channelId: string | null,
  activationId: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = noLinkCanaryConfig(mode, channelId, activationId, env);
  const eligible = canCaptureNoLinkEffects(config).allowed;
  return {
    eligible,
    staffIds: eligible ? config.canaryStaffIds.map((id) => id.toLowerCase()).sort() : [],
  };
}
export function noLinkCaptureEligible(
  mode: EnquiryMode,
  channelId: string | null,
  activationId: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  return noLinkCaptureSnapshot(mode, channelId, activationId, env).eligible;
}

const contextSql = `SELECT e.channel_id,e.activation_id::text,e.origin,e.capture_mode AS captured_mode,
 e.effects_eligible,COALESCE(e.evidence->>'noLinkEffectsEligible','false')='true' AS no_link_snapshot,
 r.capture_mode AS receipt_mode,r.activation_id::text AS receipt_activation_id,
 r.received_at AS receipt_received_at,e.occurred_at AS event_occurred_at,
 a.cutover_at AS activation_cutover_at,a.ended_at AS activation_ended_at,
 e.timing,e.identity_quality,candidate.staff_id AS candidate_staff_id,
 e.evidence->'noLinkCanaryStaffIds' AS captured_staff_ids,
 COALESCE(l.resolution->>'status'='resolved' AND l.resolution->'reasons'='[]'::jsonb
  AND l.property_id IS NOT NULL AND l.scope_id IS NOT NULL AND candidate.staff_id IS NOT NULL,false)
  AS mapping_verified,
 EXISTS(SELECT 1 FROM staff_users s JOIN staff_roles role ON role.staff_user_id=s.id
   JOIN whatsapp_staff_channels ch ON ch.staff_id=s.id
   WHERE s.id::text=candidate.staff_id AND s.active AND role.role IN ('agent','manager','admin')
    AND ch.channel_id=e.channel_id AND ch.eligible AND ch.retired_at IS NULL
    AND ch.review_enforced AND ch.review_basis='provider_verified') AS provider_mapping_verified
 FROM whatsapp_enquiry_events e
 LEFT JOIN LATERAL (SELECT capture_mode,activation_id,received_at
   FROM whatsapp_inbound_receipts r WHERE r.provider='woztell'
     AND r.origin='live_webhook' AND r.event_kind='customer_message'
     AND r.app_id=e.app_id AND r.channel_id=e.channel_id
     AND r.member_id=e.member_id AND r.identity_key=e.external_message_id
   ORDER BY r.received_at,r.id LIMIT 1) r ON true
 LEFT JOIN whatsapp_enquiry_activations a ON a.id=e.activation_id
 LEFT JOIN whatsapp_enquiry_reference_links l ON l.event_id=e.id AND l.ref_index=0
 LEFT JOIN LATERAL (SELECT CASE
   WHEN NULLIF(l.resolution->>'requestedStaffId','') IS NOT NULL
    AND NULLIF(l.resolution->>'publicationOwnerId','') IS NOT NULL
    AND l.resolution->>'requestedStaffId'<>l.resolution->>'publicationOwnerId' THEN NULL
   ELSE COALESCE(NULLIF(l.resolution->>'requestedStaffId',''),
     NULLIF(l.resolution->>'publicationOwnerId','')) END AS staff_id) candidate ON true
 WHERE e.id=$1::uuid AND e.kind='customer_message'`;

/** Recheck capture, cohort and current mapping before the locking SQL effect decision. */
export async function maybePrepareNoLinkFollowup(
  eventId: string,
  mode: EnquiryMode,
  query: Query,
  options: { env?: NodeJS.ProcessEnv; wake?: () => void | Promise<void> } = {},
) {
  const env = options.env ?? process.env;
  const configured = noLinkCanaryConfig(
    mode,
    env.EP_WA_COMPANY_CHANNEL_ID ?? null,
    env.EP_WA_ACTIVATION_ID ?? null,
    env,
  );
  const early = canCaptureNoLinkEffects(configured);
  if (!early.allowed) return { allowed: false, reasons: early.reasons, prepared: null };
  const [row] = await query<GateRow>(contextSql, [eventId]);
  if (!row) return { allowed: false, reasons: ["event_missing"], prepared: null };
  const decision = canExecuteNoLinkEffects({
    ...configured,
    channelId: row.channel_id,
    activationId: row.activation_id,
    origin: row.origin,
    capturedMode: row.captured_mode,
    effectsEligible: row.effects_eligible === true,
    noLinkSnapshot: row.no_link_snapshot === true,
    receiptMode: row.receipt_mode,
    receiptActivationId: row.receipt_activation_id,
    receiptReceivedAt: row.receipt_received_at,
    eventOccurredAt: row.event_occurred_at,
    activationCutoverAt: row.activation_cutover_at,
    activationEndedAt: row.activation_ended_at,
    timing: row.timing,
    identityQuality: row.identity_quality,
    candidateStaffId: row.candidate_staff_id,
    capturedStaffIds:
      Array.isArray(row.captured_staff_ids) &&
      row.captured_staff_ids.every((id) => typeof id === "string")
        ? row.captured_staff_ids
        : null,
    mappingVerified: row.mapping_verified === true,
    providerMappingVerified: row.provider_mapping_verified === true,
  });
  if (!decision.allowed) return { ...decision, prepared: null };
  // wa_prepare_no_link_followup locks event, enquiry and conversation, and rechecks
  // live MLS, staff alias, channel and provider mapping before queuing assignment.
  const [prepared] = await query<{ decision: { decision: string } }>(
    "SELECT wa_prepare_no_link_followup($1::uuid) AS decision",
    [eventId],
  );
  if (["assignment_pending", "staff_ready"].includes(prepared?.decision?.decision ?? "")) {
    if (options.wake) await options.wake();
    else {
      const { wakeAfterCommit } = await import("../control-plane/job-wake.server.ts");
      wakeAfterCommit("service");
    }
  }
  return { ...decision, prepared: prepared?.decision ?? null };
}
