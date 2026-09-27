import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { queryRows, transactionRows } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import {
  listWhatsappStaffReadiness,
  inspectWhatsappStaffReadinessForDispatch,
  currentWhatsappReadinessRuntime,
} from "./whatsapp-readiness.server.ts";
import { maskStaffDestination } from "./whatsapp-readiness-policy.ts";
import { createInboxApi } from "../woztell/inbox-api.server.ts";
import { createStaffWhatsAppTransport } from "../woztell/staff-whatsapp-transport.server.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Transport = "inbox_private_note" | "staff_whatsapp";
const previewInput = z
  .object({
    staffId: z.string().uuid(),
    transport: z.enum(["inbox_private_note", "staff_whatsapp"]),
    endpointVersion: z.number().int().positive(),
  })
  .strict();
const submitInput = previewInput
  .extend({
    requestId: z.string().uuid(),
    previewToken: z.string().uuid(),
  })
  .strict();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const testCopy = (name: string, transport: Transport) =>
  `[測試] Earnest Property 同事通知核對：${name}，${transport === "staff_whatsapp" ? "WhatsApp" : "Inbox 私有備註"}。此訊息不涉及客戶查詢，毋須回覆。`;

async function authorize(actor: Actor, query = queryRows) {
  if (!actor.roles.some((r) => r === "admin" || r === "manager"))
    throw new Response("Forbidden", { status: 403 });
  const [row] = await query(
    "SELECT s.id FROM staff_users s JOIN staff_roles r ON r.staff_user_id=s.id WHERE s.id=$1::uuid AND s.active AND r.role IN ('admin','manager') LIMIT 1",
    [actor.staffId],
  );
  if (!row) throw new Response("Forbidden", { status: 403 });
}

function syntheticInboxMember() {
  return process.env.EP_WA_TEST_INBOX_MEMBER_ID?.trim() || null;
}

export async function previewStaffTestNotification(
  value: unknown,
  actor: Actor,
  query = queryRows,
) {
  const input = previewInput.parse(value);
  await authorize(actor, query);
  const [readiness] = await listWhatsappStaffReadiness(actor, { staffId: input.staffId, query });
  if (!readiness) throw new Response("STAFF_NOT_FOUND", { status: 404 });
  const capability =
    input.transport === "staff_whatsapp" ? readiness.staffWhatsapp : readiness.inboxPrivateNote;
  const [endpoint] = await query(
    `SELECT e.id,e.version,e.destination_reference,e.channel_id,m.inbox_user_id,m.folder_id
     FROM staff_notification_endpoints e LEFT JOIN whatsapp_staff_channels m ON m.staff_id=e.staff_id AND m.channel_id=e.channel_id
     WHERE e.staff_id=$1::uuid AND e.transport=$2 AND e.channel_id=$3 ORDER BY e.updated_at DESC,e.id DESC LIMIT 1`,
    [input.staffId, input.transport, currentWhatsappReadinessRuntime().channelId],
  );
  const reasons = capability.reasons.map((r) => r.code);
  if (!endpoint || Number(endpoint.version) !== input.endpointVersion)
    reasons.push("endpoint_version_changed");
  if (input.transport === "inbox_private_note") {
    const member = syntheticInboxMember();
    if (!member) reasons.push("synthetic_inbox_thread_unavailable");
    else {
      const [exists] = await query(
        "SELECT 1 FROM whatsapp_conversations WHERE channel_id=$1 AND woztell_member_id=$2 LIMIT 1",
        [endpoint?.channel_id ?? "", member],
      );
      if (exists) reasons.push("synthetic_inbox_thread_not_isolated");
    }
  }
  const message = testCopy(readiness.displayName, input.transport);
  const ready = capability.state === "ready" && reasons.length === 0;
  let previewToken: string | null = null;
  if (ready) {
    previewToken = randomUUID();
    await query(
      `INSERT INTO staff_notification_test_previews(token_hash,actor_staff_id,staff_id,transport,endpoint_id,endpoint_version,mapping_version,message,expires_at)
       VALUES($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8,now()+interval '5 minutes')`,
      [
        digest(previewToken),
        actor.staffId,
        input.staffId,
        input.transport,
        endpoint.id,
        input.endpointVersion,
        readiness.mappingVersion,
        message,
      ],
    );
  }
  return {
    ready,
    reasons: [...new Set(reasons)],
    previewToken,
    staffName: readiness.displayName,
    transport: input.transport,
    maskedDestination: maskStaffDestination(
      endpoint ? String(endpoint.destination_reference) : null,
    ),
    message,
    endpointVersion: input.endpointVersion,
    mappingVersion: readiness.mappingVersion,
  };
}

export async function enqueueStaffTestNotification(
  value: unknown,
  actor: Actor,
  ports: { query: typeof queryRows; transaction: typeof transactionRows } = {
    query: queryRows,
    transaction: transactionRows,
  },
) {
  const input = submitInput.parse(value);
  await authorize(actor, ports.query);
  const tokenHash = digest(input.previewToken);
  const payloadHash = digest(
    JSON.stringify([
      actor.staffId,
      input.staffId,
      input.transport,
      input.endpointVersion,
      tokenHash,
    ]),
  );
  const [previous] = await ports.query(
    "SELECT t.id,j.id AS job_id,t.payload_hash,t.state FROM staff_notification_test_attempts t LEFT JOIN ops_jobs j ON j.job_type='woztell.enquiry.staff.test' AND j.payload->>'attemptId'=t.id::text WHERE t.request_id=$1::uuid",
    [input.requestId],
  );
  if (previous) {
    if (previous.payload_hash !== payloadHash)
      throw new Response("TEST_REQUEST_CONFLICT", { status: 409 });
    return {
      attemptId: String(previous.id),
      jobId: previous.job_id ? String(previous.job_id) : null,
      state: String(previous.state),
    };
  }
  const [readiness] = await listWhatsappStaffReadiness(actor, {
    staffId: input.staffId,
    query: ports.query,
  });
  const capability =
    input.transport === "staff_whatsapp" ? readiness?.staffWhatsapp : readiness?.inboxPrivateNote;
  if (capability?.state !== "ready") throw new Response("TEST_READINESS_CHANGED", { status: 409 });
  const member = input.transport === "inbox_private_note" ? syntheticInboxMember() : null;
  if (input.transport === "inbox_private_note" && !member)
    throw new Response("TEST_INBOX_FIXTURE_UNAVAILABLE", { status: 409 });
  const results = await ports.transaction([
    {
      statement: "SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))",
      params: [actor.staffId],
    },
    {
      statement: `WITH eligible AS (
        SELECT p.id AS preview_id,p.endpoint_id,p.endpoint_version,p.mapping_version,p.staff_id,p.transport,
          e.channel_id,e.destination_reference
        FROM staff_notification_test_previews p
        JOIN staff_users s ON s.id=p.staff_id AND s.active
        JOIN staff_notification_endpoints e ON e.id=p.endpoint_id AND e.staff_id=p.staff_id AND e.transport=p.transport
        JOIN whatsapp_staff_channels m ON m.staff_id=s.id AND m.channel_id=e.channel_id
        WHERE p.token_hash=$1 AND p.actor_staff_id=$2::uuid AND p.staff_id=$3::uuid AND p.transport=$4
          AND p.endpoint_version=$5 AND p.expires_at>now()
          AND e.version=p.endpoint_version AND e.channel_id=$9
          AND m.version=p.mapping_version AND (e.mapping_version IS NULL OR e.mapping_version=p.mapping_version) AND e.enabled AND e.retired_at IS NULL AND e.verified_at IS NOT NULL
          AND e.permission_granted AND e.permission_ref IS NOT NULL
          AND e.quiet_hours_policy @> '{"approved":true,"allowAllHours":true}'::jsonb
          AND m.eligible AND m.retired_at IS NULL AND m.verified_at IS NOT NULL
          AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager','agent'))
          AND EXISTS(SELECT 1 FROM staff_users a JOIN staff_roles ar ON ar.staff_user_id=a.id
            WHERE a.id=$2::uuid AND a.active AND ar.role IN ('admin','manager'))
          AND (p.transport<>'inbox_private_note' OR (e.destination_reference=m.inbox_user_id AND $8::text IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations w WHERE w.channel_id=e.channel_id AND w.woztell_member_id=$8)))
          AND (p.transport<>'staff_whatsapp' OR e.last_inbound_at BETWEEN now()-interval '24 hours' AND now())
          AND NOT EXISTS(SELECT 1 FROM staff_notification_test_attempts t WHERE t.actor_staff_id=$2::uuid
            AND t.endpoint_id=e.id AND t.created_at>now()-interval '1 minute')
          FOR UPDATE OF s,e,m
       ), inserted AS (
         INSERT INTO staff_notification_test_attempts(request_id,preview_id,actor_staff_id,staff_id,transport,endpoint_id,endpoint_version,mapping_version,channel_id_snapshot,destination_reference_snapshot,payload_hash)
         SELECT $6::uuid,preview_id,$2::uuid,staff_id,transport,endpoint_id,endpoint_version,mapping_version,channel_id,destination_reference,$7 FROM eligible
         ON CONFLICT(request_id) DO NOTHING RETURNING id
       ), queued AS (
         INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,idempotency_key,actor_staff_id)
         SELECT 'woztell.enquiry.staff.test',1,jsonb_build_object('attemptId',i.id),'queued',1,'wa.staff.test:'||i.id,$2::uuid FROM inserted i
         ON CONFLICT(idempotency_key) DO NOTHING RETURNING id,payload
       ), audit AS (
         INSERT INTO ops_audit_logs(actor_staff_id,permission,action,resource_type,resource_id,outcome,request_id,metadata)
         SELECT $2::uuid,'staff.notification.test','enqueue','staff_notification_test',i.id::text,'success',$6::uuid,
           jsonb_build_object('transport',$4,'endpointVersion',$5) FROM inserted i RETURNING id
       )
       SELECT i.id AS attempt_id,j.id AS job_id FROM inserted i JOIN queued j ON j.payload->>'attemptId'=i.id::text`,
      params: [
        tokenHash,
        actor.staffId,
        input.staffId,
        input.transport,
        input.endpointVersion,
        input.requestId,
        payloadHash,
        member,
        currentWhatsappReadinessRuntime().channelId,
      ],
    },
  ]);
  const created = results[1]?.[0];
  if (created) {
    const { wakeAfterCommit } = await import("../control-plane/job-wake.server.ts");
    wakeAfterCommit("service");
    return {
      attemptId: String(created.attempt_id),
      jobId: String(created.job_id),
      state: "queued",
    };
  }
  const [same] = await ports.query(
    "SELECT t.id,t.payload_hash,t.state,j.id AS job_id FROM staff_notification_test_attempts t LEFT JOIN ops_jobs j ON j.payload->>'attemptId'=t.id::text AND j.job_type='woztell.enquiry.staff.test' WHERE t.request_id=$1::uuid",
    [input.requestId],
  );
  if (same) {
    if (same.payload_hash !== payloadHash)
      throw new Response("TEST_REQUEST_CONFLICT", { status: 409 });
    return {
      attemptId: String(same.id),
      jobId: same.job_id ? String(same.job_id) : null,
      state: String(same.state),
    };
  }
  throw new Response("TEST_PREVIEW_EXPIRED_OR_RATE_LIMITED", { status: 409 });
}

export async function readStaffTestNotification(
  attemptId: string,
  actor: Actor,
  query = queryRows,
) {
  z.string().uuid().parse(attemptId);
  await authorize(actor, query);
  await query(
    `UPDATE staff_notification_test_attempts t SET state='unknown',safe_error='job_lease_expired',finished_at=now(),updated_at=now()
     FROM ops_jobs j WHERE t.id=$1::uuid AND t.actor_staff_id=$2::uuid AND t.state='dispatching'
       AND j.job_type='woztell.enquiry.staff.test' AND j.payload->>'attemptId'=t.id::text
       AND (j.status<>'running' OR j.lease_expires_at<now())`,
    [attemptId, actor.staffId],
  );
  const [row] = await query(
    `SELECT t.id,t.state,t.transport,t.created_at,t.accepted_at,t.evidence_kind,t.safe_error,t.provider_operation_id,
            t.provider_delivered_at,t.recipient_confirmed_at,t.acknowledgement_at,t.evidence_source,
            t.endpoint_version,t.mapping_version,j.id AS job_id
     FROM staff_notification_test_attempts t JOIN staff_notification_endpoints e ON e.id=t.endpoint_id
     LEFT JOIN ops_jobs j ON j.job_type='woztell.enquiry.staff.test' AND j.payload->>'attemptId'=t.id::text
     WHERE t.id=$1::uuid AND t.actor_staff_id=$2::uuid`,
    [attemptId, actor.staffId],
  );
  if (!row) throw new Response("TEST_NOT_FOUND", { status: 404 });
  return {
    attemptId: String(row.id),
    state: String(row.state),
    transport: String(row.transport),
    jobId: row.job_id ? String(row.job_id) : null,
    providerAcceptedAt: row.accepted_at ? new Date(String(row.accepted_at)).toISOString() : null,
    providerDeliveredAt: row.provider_delivered_at
      ? new Date(String(row.provider_delivered_at)).toISOString()
      : null,
    recipientConfirmedAt: row.recipient_confirmed_at
      ? new Date(String(row.recipient_confirmed_at)).toISOString()
      : null,
    acknowledgementAt: row.acknowledgement_at
      ? new Date(String(row.acknowledgement_at)).toISOString()
      : null,
    evidenceSource: row.evidence_source ? String(row.evidence_source) : null,
    endpointVersion: Number(row.endpoint_version),
    mappingVersion: row.mapping_version == null ? null : Number(row.mapping_version),
    evidenceKind: row.evidence_kind ? String(row.evidence_kind) : null,
    providerOperationId: row.provider_operation_id ? String(row.provider_operation_id) : null,
    safeError: row.safe_error ? String(row.safe_error) : null,
  };
}

export async function readStaffTestNotificationByRequest(
  requestId: string,
  actor: Actor,
  query = queryRows,
) {
  z.string().uuid().parse(requestId);
  await authorize(actor, query);
  const [row] = await query(
    "SELECT id FROM staff_notification_test_attempts WHERE request_id=$1::uuid AND actor_staff_id=$2::uuid",
    [requestId, actor.staffId],
  );
  return row ? readStaffTestNotification(String(row.id), actor, query) : null;
}

export async function recordStaffTestManualConfirmation(
  value: unknown,
  actor: Actor,
  ports: { query: typeof queryRows; transaction: typeof transactionRows } = {
    query: queryRows,
    transaction: transactionRows,
  },
) {
  const input = z
    .object({
      attemptId: z.string().uuid(),
      evidenceRef: z.string().trim().min(1).max(160),
    })
    .strict()
    .parse(value);
  await authorize(actor, ports.query);
  const rows = await ports.transaction([
    {
      statement: `WITH eligible AS (
      SELECT t.id FROM staff_notification_test_attempts t
      WHERE t.id=$1::uuid AND t.actor_staff_id=$2::uuid AND t.state IN ('accepted','unknown')
      FOR UPDATE
    ), inserted AS (
      INSERT INTO staff_notification_test_evidence(attempt_id,kind,source,source_ref,occurred_at,actor_staff_id)
      SELECT id,'recipient_confirmed','manual_confirmation',$3,now(),$2::uuid FROM eligible
      ON CONFLICT(attempt_id,kind,source,source_ref) DO NOTHING
      RETURNING attempt_id,occurred_at
    ), changed AS (
      UPDATE staff_notification_test_attempts t
      SET recipient_confirmed_at=COALESCE(t.recipient_confirmed_at,i.occurred_at),
          evidence_source='manual_confirmation',updated_at=now()
      FROM inserted i WHERE t.id=i.attempt_id RETURNING t.id
    ), audit AS (
      INSERT INTO ops_audit_logs(actor_staff_id,permission,action,resource_type,resource_id,outcome,metadata)
      SELECT $2::uuid,'staff.notification.test','manual_receipt','staff_notification_test',id::text,
             'success',jsonb_build_object('evidenceRef',$3) FROM changed RETURNING id
    ) SELECT id FROM changed`,
      params: [input.attemptId, actor.staffId, input.evidenceRef],
    },
  ]);
  if (rows[0]?.length) return { ok: true };
  const [existing] = await ports.query(
    `SELECT e.id FROM staff_notification_test_evidence e
      JOIN staff_notification_test_attempts t ON t.id=e.attempt_id
      WHERE t.id=$1::uuid AND t.actor_staff_id=$2::uuid
        AND e.kind='recipient_confirmed' AND e.source='manual_confirmation'
        AND e.source_ref=$3 AND e.actor_staff_id=$2::uuid`,
    [input.attemptId, actor.staffId, input.evidenceRef],
  );
  if (existing) return { ok: true };
  throw new Response("TEST_CONFIRMATION_CONFLICT", { status: 409 });
}

export async function dispatchStaffTestNotification(
  attemptId: string,
  context: { jobId: string; workerId: string; checkpoint: () => Promise<void> },
  deps: {
    query?: typeof queryRows;
    inspect?: typeof inspectWhatsappStaffReadinessForDispatch;
    inbox?: typeof createInboxApi;
    staff?: typeof createStaffWhatsAppTransport;
  } = {},
): Promise<{ summary: Record<string, number> }> {
  z.string().uuid().parse(attemptId);
  const query = deps.query ?? queryRows;
  const inspect = deps.inspect ?? inspectWhatsappStaffReadinessForDispatch;
  const [attempt] = await query(
    `SELECT t.*,p.message,e.channel_id,e.destination_reference,e.template_name,e.template_language,
       m.inbox_user_id,m.folder_id
     FROM staff_notification_test_attempts t JOIN staff_notification_test_previews p ON p.id=t.preview_id
     JOIN staff_notification_endpoints e ON e.id=t.endpoint_id
     LEFT JOIN whatsapp_staff_channels m ON m.staff_id=t.staff_id AND m.channel_id=e.channel_id WHERE t.id=$1::uuid`,
    [attemptId],
  );
  if (!attempt || attempt.state !== "queued") return { summary: { skipped: 1 } };
  const readiness = await inspect(String(attempt.staff_id));
  const capability =
    attempt.transport === "staff_whatsapp" ? readiness?.staffWhatsapp : readiness?.inboxPrivateNote;
  if (
    capability?.state !== "ready" ||
    readiness?.mappingVersion !== Number(attempt.mapping_version)
  ) {
    await query(
      "UPDATE staff_notification_test_attempts SET state='blocked',safe_error='readiness_changed',finished_at=now() WHERE id=$1::uuid AND state='queued'",
      [attemptId],
    );
    return { summary: { blocked: 1 } };
  }
  const claim = randomUUID();
  const [claimed] = await query(
    "UPDATE staff_notification_test_attempts SET state='dispatching',claim_id=$2::uuid,updated_at=now() WHERE id=$1::uuid AND state='queued' RETURNING id",
    [attemptId, claim],
  );
  if (!claimed) return { summary: { skipped: 1 } };
  let boundaryPassed = false;
  const boundary = async () => {
    await context.checkpoint();
    const live = await inspect(String(attempt.staff_id));
    const ready =
      attempt.transport === "staff_whatsapp" ? live?.staffWhatsapp : live?.inboxPrivateNote;
    if (ready?.state !== "ready" || live?.mappingVersion !== Number(attempt.mapping_version))
      throw new Error("TEST_READINESS_CHANGED");
    const member = attempt.transport === "inbox_private_note" ? syntheticInboxMember() : null;
    const [valid] = await query(
      `SELECT t.id FROM staff_notification_test_attempts t
       JOIN staff_notification_endpoints e ON e.id=t.endpoint_id
       JOIN whatsapp_staff_channels m ON m.staff_id=t.staff_id AND m.channel_id=e.channel_id
       JOIN staff_users s ON s.id=t.staff_id
       JOIN staff_users a ON a.id=t.actor_staff_id
       JOIN ops_jobs j ON j.id=$3::uuid
       WHERE t.id=$1::uuid AND t.claim_id=$2::uuid AND t.state='dispatching'
         AND j.job_type='woztell.enquiry.staff.test' AND j.payload->>'attemptId'=t.id::text
         AND j.status='running' AND j.lease_owner=$4 AND j.lease_expires_at>now()
         AND s.active AND a.active AND e.channel_id=$6 AND e.version=t.endpoint_version AND e.enabled AND e.retired_at IS NULL
         AND e.verified_at IS NOT NULL AND e.permission_granted AND e.permission_ref IS NOT NULL
         AND e.quiet_hours_policy @> '{"approved":true,"allowAllHours":true}'::jsonb
         AND m.eligible AND m.retired_at IS NULL AND m.verified_at IS NOT NULL
         AND m.version=t.mapping_version AND (e.mapping_version IS NULL OR e.mapping_version=t.mapping_version)
         AND (t.transport<>'inbox_private_note' OR (e.destination_reference=m.inbox_user_id AND $5::text IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations w WHERE w.channel_id=e.channel_id AND w.woztell_member_id=$5)))
         AND (t.transport<>'staff_whatsapp' OR e.last_inbound_at BETWEEN now()-interval '24 hours' AND now())
         AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager','agent'))
         AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=a.id AND r.role IN ('admin','manager'))`,
      [
        attemptId,
        claim,
        context.jobId,
        context.workerId,
        member,
        currentWhatsappReadinessRuntime().channelId,
      ],
    );
    if (!valid) throw new Error("TEST_DESTINATION_CHANGED");
    boundaryPassed = true;
  };
  let result: {
    state: "accepted" | "failed" | "unknown" | "suppressed";
    evidenceKind?: string;
    providerOperationId?: string;
  } = { state: "unknown" };
  try {
    if (attempt.transport === "inbox_private_note") {
      const member = syntheticInboxMember();
      if (!member) throw new Error("TEST_INBOX_FIXTURE_UNAVAILABLE");
      const api = (deps.inbox ?? createInboxApi)();
      result = await api.postPrivateNote({
        channelId: String(attempt.channel_id),
        memberId: member,
        inboxUserId: String(attempt.inbox_user_id),
        folderId: String(attempt.folder_id),
        message: String(attempt.message),
        beforeSend: boundary,
      });
    } else {
      const api = (deps.staff ?? createStaffWhatsAppTransport)();
      result = await api.sendStaffWhatsApp!({
        channelId: String(attempt.channel_id),
        memberId: String(attempt.destination_reference),
        message: String(attempt.message),
        templateName: null,
        templateLanguage: null,
        beforeSend: boundary,
      });
    }
  } catch {
    result = { state: boundaryPassed ? "unknown" : "suppressed" };
  }
  const state = result.state === "suppressed" ? "blocked" : result.state;
  await query(
    `UPDATE staff_notification_test_attempts SET state=$3,evidence_kind=$4,provider_operation_id=$5,
       evidence_source=CASE WHEN $3='accepted' THEN 'provider_acceptance' ELSE evidence_source END,
      safe_error=CASE WHEN $3='unknown' THEN 'provider_outcome_unknown' WHEN $3='failed' THEN 'provider_refused'
        WHEN $3='blocked' THEN 'preflight_blocked' ELSE NULL END,
      accepted_at=CASE WHEN $3='accepted' THEN now() ELSE accepted_at END,
      finished_at=now(),updated_at=now() WHERE id=$1::uuid AND claim_id=$2::uuid AND state='dispatching'`,
    [attemptId, claim, state, result.evidenceKind ?? null, result.providerOperationId ?? null],
  );
  return { summary: { [state]: 1 } };
}
