import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { queryRows } from "../neon/db.server.ts";
import { parsePortalEnquiry } from "./portal-intake.ts";
import {
  makePortalResolutionPorts,
  recordPortalInterpretation,
  resolvePortalReferences,
  type MatchResult,
} from "./portal-resolution.server.ts";
import type { PortalInterpretation } from "./no-link.types.ts";

export type EnquiryDecision = {
  recognized: boolean;
  handled: boolean;
  inquiryId: string | null;
  review: boolean;
};

export function referenceKey(channelId: string, result: MatchResult): string {
  const ref = result.reference;
  return createHash("sha256")
    .update(
      JSON.stringify([
        channelId,
        ref.source,
        result.snapshot.scopeId ?? "unverified",
        ref.externalListingId,
        ref.dealType,
        ref.canonicalUrl,
      ]),
    )
    .digest("hex");
}

/** Associate only a signed, projected customer event with its scoped durable receipt. */
export async function associatePortalEnquiry(
  eventId: string,
  query: typeof queryRows = queryRows,
): Promise<EnquiryDecision> {
  const empty: EnquiryDecision = {
    recognized: false,
    handled: false,
    inquiryId: null,
    review: false,
  };
  const [event] = await query<{
    id: string;
    app_id: string;
    channel_id: string;
    member_id: string;
    external_message_id: string;
    received_at: Date | string;
    text: string;
  }>(
    `SELECT e.id,e.app_id,e.channel_id,e.member_id,e.external_message_id,e.received_at,m.text
     FROM whatsapp_enquiry_events e JOIN whatsapp_messages m ON m.id=e.message_id
     WHERE e.id=$1::uuid AND e.kind='customer_message' AND e.origin='live_webhook'
       AND e.capture_mode IN ('observe','active') AND e.processing_state<>'suppressed'
       AND m.direction::text='inbound' AND m.channel_id=e.channel_id
       AND m.woztell_member_id=e.member_id`,
    [eventId],
  );
  if (!event) return empty;
  const parsed = parsePortalEnquiry(String(event.text ?? ""));
  if (parsed.references.length === 0) return empty;
  const review: EnquiryDecision = {
    recognized: true,
    handled: false,
    inquiryId: null,
    review: true,
  };
  const [capability] = await query<{ available: boolean }>(
    "SELECT to_regprocedure('wa_associate_no_link(uuid,uuid,uuid,jsonb)') IS NOT NULL AS available",
  );
  if (!capability?.available) return review;
  const [receipt] = await query<{ id: string }>(
    `SELECT id FROM whatsapp_inbound_receipts
     WHERE app_id=$1 AND channel_id=$2 AND member_id=$3
       AND (identity_key=$4 OR $4='wa-ambiguous:'||id::text)
     ORDER BY received_at DESC,id DESC LIMIT 1`,
    [event.app_id, event.channel_id, event.member_id, event.external_message_id],
  );
  if (!receipt) return review;
  let [snapshot] = await query<{
    id: string;
    interpretation: PortalInterpretation;
    resolution: MatchResult[];
  }>(
    `SELECT id,interpretation,resolution FROM whatsapp_portal_interpretations
     WHERE receipt_id=$1::uuid AND parser_version='portal-intake-v1'`,
    [receipt.id],
  );
  if (!snapshot) {
    const at = new Date(event.received_at).toISOString();
    const matches = await resolvePortalReferences(
      parsed,
      { channelId: event.channel_id, at },
      makePortalResolutionPorts(query),
    );
    try {
      const id = await recordPortalInterpretation(receipt.id, parsed, matches, query);
      snapshot = { id, interpretation: parsed, resolution: matches };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "PORTAL_INTERPRETATION_VERSION_CONFLICT")
        throw error;
      [snapshot] = await query(
        `SELECT id,interpretation,resolution FROM whatsapp_portal_interpretations
         WHERE receipt_id=$1::uuid AND parser_version='portal-intake-v1'`,
        [receipt.id],
      );
      if (!snapshot) throw error;
    }
  }
  const refs = snapshot.resolution.map((result) => ({
    referenceKey: referenceKey(event.channel_id, result),
    source: result.reference.source,
    scopeId: result.snapshot.scopeId,
    externalListingId: result.reference.externalListingId,
    dealType: result.reference.dealType,
    propertyId: result.propertyId,
    requestedStaffId: result.requestedStaffId,
    publicationOwnerId: result.publicationOwnerId,
    status: result.status,
    reasons: result.reasons,
  }));
  if (refs.length === 0) return review;
  const [associated] = await query<{ inquiry_id: string | null }>(
    "SELECT wa_associate_no_link($1::uuid,$2::uuid,$3::uuid,$4::jsonb) AS inquiry_id",
    [eventId, receipt.id, snapshot.id, JSON.stringify(refs)],
  );
  return {
    recognized: true,
    handled: true,
    inquiryId: associated?.inquiry_id ?? null,
    review: true,
  };
}
