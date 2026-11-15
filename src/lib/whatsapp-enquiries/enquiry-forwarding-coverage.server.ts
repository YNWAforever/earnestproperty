import "@tanstack/react-start/server-only";
import { queryRows } from "../neon/db.server.ts";
import { ENQUIRY_FORWARD_JOB, forwardingSubjectKey } from "./enquiry-forwarding-policy.mjs";

export async function forwardingSchemaAvailable(query = queryRows) {
  const [row] = await query(
    "SELECT to_regclass('enquiry_notification_recipients') IS NOT NULL AS forwarding_available",
  );
  return row?.forwarding_available === true;
}

/** The intake's queued forwarding job permanently owns its phone notifications. */
export async function forwardingCoversSubject(
  source: "website" | "whatsapp",
  subjectId: string,
  query = queryRows,
) {
  if (!(await forwardingSchemaAvailable(query))) return false;
  const rows = await query(
    "SELECT id FROM ops_jobs WHERE job_type=$1 AND idempotency_key=$2 AND payload->>'source'=$3 AND payload->>'subjectId'=$4 LIMIT 1",
    [ENQUIRY_FORWARD_JOB, forwardingSubjectKey(source, subjectId), source, subjectId],
  );
  return rows.length > 0;
}
