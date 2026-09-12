import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { hasUntrustedStaffOverride } from "./staff-reference.ts";
import { extractReferences } from "./links.ts";
import { queryRows } from "../neon/db.server.ts";
/** Only protected transcript text is inspected. No message body is copied into attribution. */
export async function observeEpisode(eventId: string, query = queryRows) {
  const [capability] = await query(
    "SELECT to_regprocedure('wa_observe_episode(uuid,text,boolean)') IS NOT NULL available",
  );
  if (!capability?.available) return null; // staged reader remains compatible before Phase 2 migration
  const [event] = await query(
    `SELECT m.text FROM whatsapp_enquiry_events e JOIN whatsapp_messages m ON m.id=e.message_id WHERE e.id=$1::uuid AND e.kind='customer_message' AND e.capture_mode IN ('observe','active')`,
    [eventId],
  );
  if (!event) return null;
  const parsed = extractReferences(String(event.text ?? ""));
  const invalid =
    parsed.invalid ||
    parsed.references.length > 1 ||
    hasUntrustedStaffOverride(String(event.text ?? ""));
  const hash =
    parsed.references.length === 1 && !invalid
      ? createHash("sha256").update(parsed.references[0]).digest("hex")
      : null;
  const [result] = await query("SELECT wa_observe_episode($1::uuid,$2,$3) inquiry_id", [
    eventId,
    hash,
    invalid,
  ]);
  return result?.inquiry_id ?? null;
}
