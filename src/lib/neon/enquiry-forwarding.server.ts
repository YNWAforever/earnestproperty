import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { StaffAccess } from "./auth.server.ts";
import { queryRows, transactionRows, type TransactionStatement, type DbRow } from "./db.server.ts";
import {
  enquiryCopyRecipient,
  ENQUIRY_MANAGERS,
  ENQUIRY_ROUTING_APPROVAL,
  notificationPhone,
} from "../whatsapp-enquiries/enquiry-routing.mjs";
import { forwardingSchemaAvailable } from "../whatsapp-enquiries/enquiry-forwarding-coverage.server.ts";
import {
  deriveEnquiryInfoReadiness,
  type EnquiryInfoProviderFacts,
} from "../whatsapp-enquiries/enquiry-info-readiness.js";
import { getCurrentEnquiryInfoInstallationEvidence } from "./enquiry-info-installation.server.ts";
import {
  buildEnquiryInfoDecisionStatement,
  buildOwnerEnquiryInfoActivationStatement,
  enquiryInfoLockStatements,
  enquiryInfoSchemaAvailable,
} from "./enquiry-info-decisions.server.ts";
import type {
  EnquiryInfoOwnerInstruction,
  EnquiryInfoScope,
  EnquiryInfoSubject,
} from "./enquiry-info-decisions.types.ts";
import type {
  EnquiryForwardingSettings,
  EnquiryRecipientSetting,
  EnquiryRecipientReadiness,
} from "./enquiry-forwarding.types.ts";
type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Ports = {
  query: typeof queryRows;
  transaction: typeof transactionRows;
  env?: NodeJS.ProcessEnv;
};
type Authority =
  | { kind: "staff"; actor: Actor }
  | { kind: "owner"; source: EnquiryInfoOwnerInstruction };
const defaults: Ports = { query: queryRows, transaction: transactionRows };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const identifier = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
function runtimeScope(env: NodeJS.ProcessEnv): EnquiryInfoScope | null {
  const appId = identifier(env.WOZTELL_APP_ID),
    channelId = identifier(env.WOZTELL_CHANNEL_ID || env.EP_WA_COMPANY_CHANNEL_ID);
  return appId && channelId ? { appId, channelId } : null;
}
function checkedScope(metadata: unknown, env: NodeJS.ProcessEnv): EnquiryInfoScope | null {
  const channel = record(record(metadata).channel),
    appId = identifier(channel.appId),
    channelId = identifier(channel.configuredChannelId),
    expected = runtimeScope(env);
  return appId && channelId && expected?.appId === appId && expected.channelId === channelId
    ? { appId, channelId }
    : null;
}
async function authorize(actor: Actor, query: typeof queryRows) {
  if (
    !actor.roles.some((role) => role === "admin" || role === "manager") ||
    !(
      await query(
        "SELECT s.id FROM staff_users s WHERE s.id=$1::uuid AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager'))",
        [actor.staffId],
      )
    ).length
  )
    throw new Response("Forbidden", { status: 403 });
}
async function providerCheck(query: typeof queryRows): Promise<DbRow | null> {
  const [row] = await query(
    "SELECT id,subject_id,metadata,created_at FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked' AND created_at>clock_timestamp()-interval '24 hours' AND created_at<=clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 1",
  );
  return row ?? null;
}
async function informationalProof(
  check: Awaited<ReturnType<typeof providerCheck>>,
  query: typeof queryRows,
  env: NodeJS.ProcessEnv,
) {
  const metadata = record(check?.metadata),
    stored = record(metadata.infoForwarding),
    scope = checkedScope(metadata, env);
  const installation = scope
    ? await getCurrentEnquiryInfoInstallationEvidence(scope, { query, env })
    : null;
  const sensitive =
    Array.isArray(metadata.reasonCodes) &&
    metadata.reasonCodes.includes("SENSITIVE_PROVIDER_CONTENT_REDACTED");
  const derived = deriveEnquiryInfoReadiness(
    metadata as EnquiryInfoProviderFacts,
    installation,
    sensitive,
  );
  const ready =
    !!check &&
    stored.ready === true &&
    stored.purpose === "enq_forward_info" &&
    stored.version === 1 &&
    derived.ready &&
    stored.appId === derived.appId &&
    stored.channelId === derived.channelId &&
    stored.releaseAuditId === derived.releaseAuditId &&
    stored.channelProofHash === derived.channelProofHash &&
    stored.templateProofHash === derived.templateProofHash &&
    Array.isArray(stored.reasonCodes) &&
    stored.reasonCodes.length === 0;
  return {
    ready,
    scope,
    installation,
    derived,
    reasonCodes: ready
      ? []
      : [
          ...new Set([
            ...derived.reasonCodes,
            ...(Array.isArray(stored.reasonCodes)
              ? stored.reasonCodes.filter((v): v is string => typeof v === "string")
              : ["INFO_PROVIDER_CHECK_REQUIRED"]),
            ...(derived.ready && !ready ? ["INFO_PROVIDER_CHECK_REQUIRED"] : []),
          ]),
        ],
  };
}
async function desiredRecipients(query: typeof queryRows, copyInstalled = true) {
  const rows = await query(
    "SELECT id,COALESCE(NULLIF(name_zh,''),NULLIF(name_en,''),'未命名同事') AS name,whatsapp FROM staff_users WHERE active AND show_on_website ORDER BY display_order,name_zh,id",
  );
  const sales = rows.flatMap((row) => {
    const phone = notificationPhone(row.whatsapp);
    return phone
      ? [
          {
            key: `sales:${row.id}`,
            kind: "sales" as const,
            staffId: String(row.id),
            phone,
            displayName: String(row.name),
          },
        ]
      : [];
  });
  const [staff] = copyInstalled
    ? await query("SELECT phone FROM enquiry_forwarding_copy_contact()")
    : [];
  const copy = enquiryCopyRecipient(staff?.phone);
  return [...(copy ? [copy] : []), ...Object.values(ENQUIRY_MANAGERS), ...sales];
}
/** Internal readiness input; callers must establish the job lease before reading the roster. */
export async function getTrustedEnquiryForwardingRecipientPhones(query = queryRows) {
  const recipients = await desiredRecipients(query);
  return {
    copyPhone: recipients.find((recipient) => recipient.kind === "copy")?.phone ?? null,
    recipientPhones: [...new Set(recipients.map((recipient) => recipient.phone))],
  };
}
/** This eligibility intentionally precedes arming. The send guard additionally requires armed. */
function recipientStateCtes(roster: string, app: string, channel: string, permissionRef = "$5") {
  return `requested AS (SELECT * FROM jsonb_to_recordset(${roster}::jsonb) AS d(key text,kind text,staff_id uuid,phone text)),
    snapshots AS MATERIALIZED (SELECT d.*,enquiry_info_phone_snapshot(${app},${channel},d.phone) AS snapshot,enquiry_info_head(${app},${channel},'recipient_phone',d.phone) AS review FROM requested d),
    recipient_states AS MATERIALIZED (SELECT s.*,
      CASE WHEN NOT COALESCE((snapshot->>'eligible')::boolean,false) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'identitySnapshot'->'recipients') p WHERE p->>'key'=s.key AND p->>'staffId' IS NOT DISTINCT FROM s.staff_id::text) THEN 'invalid'
        WHEN (review).decision='revoked' THEN 'revoked'
        WHEN NOT COALESCE((snapshot->>'originalGuardAllows')::boolean,false) AND NOT enquiry_info_phone_approval_valid((review).id) THEN 'customer' END AS blocked,
      CASE WHEN enquiry_info_phone_approval_valid((review).id) THEN 'enq_forward_info:phone-review:'||(review).id::text ELSE ${permissionRef}::text END AS permission_ref
      FROM snapshots s)`;
}
function rosterJson(desired: Awaited<ReturnType<typeof desiredRecipients>>) {
  return JSON.stringify(
    desired.map((row) => ({
      key: row.key,
      kind: row.kind,
      staff_id: row.staffId,
      phone: row.phone,
    })),
  );
}
const unchecked = (): EnquiryRecipientReadiness => ({
  checked: false,
  customerConflictRecipientKeys: [],
  distinctBlockedPhoneCount: 0,
});
async function recipientReadiness(
  query: typeof queryRows,
  desired: Awaited<ReturnType<typeof desiredRecipients>>,
  scope: EnquiryInfoScope | null,
  available: boolean,
) {
  if (!scope || !available) return { readiness: unchecked(), states: record(null) };
  try {
    const [row] = await query(
      `WITH ${recipientStateCtes("$1", "$2", "$3", "$4")}
      SELECT ARRAY(SELECT key FROM recipient_states WHERE blocked='customer' ORDER BY key) AS conflict_recipient_keys,
       ARRAY(SELECT key FROM recipient_states WHERE blocked='invalid' ORDER BY key) AS invalid_recipient_keys,
       ARRAY(SELECT key FROM recipient_states WHERE blocked='revoked' ORDER BY key) AS revoked_recipient_keys,
       (SELECT count(DISTINCT phone)::int FROM recipient_states WHERE blocked IS NOT NULL) AS distinct_blocked_phone_count,
       COALESCE((SELECT jsonb_object_agg(key,jsonb_build_object('purposeReviewed',blocked IS NULL,'memberAssociated',EXISTS(SELECT 1 FROM enquiry_forwarding_decisions m WHERE m.app_id=$2 AND m.channel_id=$3 AND m.subject_kind='sender_member' AND m.phone=r.phone AND enquiry_info_member_binding_valid(m.id)))) FROM recipient_states r),'{}'::jsonb) AS states`,
      [rosterJson(desired), scope.appId, scope.channelId, ENQUIRY_ROUTING_APPROVAL],
    );
    if (
      !row ||
      !Array.isArray(row.conflict_recipient_keys) ||
      !Number.isInteger(Number(row.distinct_blocked_phone_count))
    )
      return { readiness: unchecked(), states: record(null) };
    const invalid = Array.isArray(row.invalid_recipient_keys)
        ? row.invalid_recipient_keys.map(String)
        : [],
      revoked = Array.isArray(row.revoked_recipient_keys)
        ? row.revoked_recipient_keys.map(String)
        : [];
    return {
      readiness: {
        checked: true,
        customerConflictRecipientKeys: row.conflict_recipient_keys.map(String),
        distinctBlockedPhoneCount: Number(row.distinct_blocked_phone_count),
        ...(invalid.length ? { invalidRecipientKeys: invalid } : {}),
        ...(revoked.length ? { revokedRecipientKeys: revoked } : {}),
      },
      states: record(row.states),
    };
  } catch {
    console.warn("Enquiry forwarding recipient identity check failed.");
    return { readiness: unchecked(), states: record(null) };
  }
}
export async function getEnquiryForwardingSettings(
  actor: Actor,
  query = queryRows,
): Promise<EnquiryForwardingSettings> {
  await authorize(actor, query);
  if (!(await forwardingSchemaAvailable(query)))
    return { available: false, recipients: [], routes: [], counts: {}, providerCheck: null };
  const [schema] = await query(
    "SELECT to_regprocedure('enquiry_forwarding_copy_contact()') IS NOT NULL AS copy_installed",
  );
  const [registered, routes, desired, check, counts, infoAvailable] = await Promise.all([
    query(
      "SELECT recipient_key,phone,version,enabled,verified_at,retired_at FROM enquiry_notification_recipients",
    ),
    query(
      "SELECT scope_key,label,manager_recipient_key,version,enabled FROM enquiry_estate_routes ORDER BY district_scope,manager_recipient_key,label",
    ),
    desiredRecipients(query, schema?.copy_installed === true),
    providerCheck(query),
    query(
      "SELECT dispatch_state,count(*)::int AS n FROM staff_notification_attempts WHERE routing_snapshot->>'purpose'='enquiry_forward' AND created_at>now()-interval '7 days' GROUP BY dispatch_state UNION ALL SELECT 'needs_review',count(DISTINCT (routing_snapshot->>'source')||':'||COALESCE(lead_id,forwarding_inquiry_id)::text)::int FROM staff_notification_attempts WHERE routing_snapshot->>'purpose'='enquiry_forward' AND created_at>now()-interval '7 days' AND (routing_snapshot->>'routingKind'='review' OR routing_snapshot->>'reason'='property_sales_unavailable')",
    ),
    enquiryInfoSchemaAvailable(query).catch(() => false),
  ]);
  const scope = runtimeScope(process.env),
    sourceScope = checkedScope(check?.metadata, process.env);
  const [recipientsState, proof, policy] = await Promise.all([
    recipientReadiness(query, desired, scope, infoAvailable),
    informationalProof(check, query, process.env).catch(() => ({
      ready: false,
      reasonCodes: ["INFO_POLICY_INSTALLATION_UNVERIFIED"],
    })),
    infoAvailable && scope
      ? query("SELECT decision FROM enquiry_info_head($1,$2,'policy','policy')", [
          scope.appId,
          scope.channelId,
        ]).catch(() => [])
      : [],
  ]);
  // An enabled legacy or now-inactive contact still has a versioned pause button.
  const previousCopy = registered.find((row) => row.recipient_key === "copy" && row.enabled);
  if (previousCopy && !desired.some((row) => row.kind === "copy"))
    desired.unshift({
      key: "copy",
      kind: "copy",
      staffId: null,
      phone: String(previousCopy.phone),
      displayName: "已登記副本",
    });
  const byKey = new Map(registered.map((row) => [String(row.recipient_key), row]));
  const recipients: EnquiryRecipientSetting[] = desired.map((recipient) => {
    const saved = byKey.get(recipient.key),
      state = record(recipientsState.states[recipient.key]);
    return {
      key: recipient.key,
      kind: recipient.kind,
      name: recipient.displayName ?? recipient.key,
      phone: recipient.phone,
      version: saved ? Number(saved.version) : null,
      enabled: saved?.enabled === true && saved.retired_at == null,
      verified: saved?.verified_at != null && saved.phone === recipient.phone,
      purposeReviewed: state.purposeReviewed === true,
      memberAssociated: state.memberAssociated === true,
    };
  });
  return {
    available: true,
    recipients,
    routes: routes.map((row) => ({
      key: String(row.scope_key),
      label: String(row.label),
      managerKey: String(row.manager_recipient_key),
      version: Number(row.version),
      enabled: row.enabled === true,
    })),
    counts: Object.fromEntries(counts.map((row) => [String(row.dispatch_state), Number(row.n)])),
    recipientReadiness: recipientsState.readiness,
    informationalPolicy: {
      available: infoAvailable,
      armed: policy[0]?.decision === "armed",
      scope: sourceScope,
    },
    providerCheck: check
      ? { ready: proof.ready, checkedAt: String(check.created_at), reasonCodes: proof.reasonCodes }
      : null,
  };
}
export const forwardingEnabledInput = z
  .object({ enabled: z.boolean(), expectedCopyVersion: z.number().int().positive() })
  .strict();
const ownerEnabledInput = z.object({ expectedCopyVersion: z.number().int().positive() }).strict();

/** Correlate the builder to the actual updated copy row. No CAS gate means no ledger
 * invocation, including pause. The fresh statement sees the real NEW version/xmin.
 */
function policyAfterCopy(statement: TransactionStatement): TransactionStatement {
  if (!statement.statement.includes("$14::jsonb"))
    throw new Error("Enquiry information decision builder contract changed.");
  const invocation = statement.statement.replace(
    "$14::jsonb",
    "$14::jsonb||jsonb_build_object('copyVersion',changed.version)",
  );
  return {
    statement: `SELECT result.* FROM (SELECT version FROM enquiry_notification_recipients WHERE recipient_key='copy' AND xmin::text::bigint=(txid_current()%4294967296)) changed CROSS JOIN LATERAL (${invocation}) result`,
    params: statement.params,
  };
}
const actorAllowedSql =
  "EXISTS(SELECT 1 FROM staff_users s WHERE s.id=$7::uuid AND s.active AND EXISTS(SELECT 1 FROM staff_roles r WHERE r.staff_user_id=s.id AND r.role IN ('admin','manager')))";
function enableStatement(): string {
  return `WITH ${recipientStateCtes("$8", "$9", "$3")},
    actual_sales AS (SELECT 'sales:'||id::text AS key,id AS staff_id,enquiry_notification_phone(whatsapp) AS phone FROM staff_users WHERE active AND show_on_website AND enquiry_notification_phone(whatsapp) IS NOT NULL),
    roster_current AS (SELECT NOT EXISTS((SELECT key,staff_id,phone FROM requested WHERE kind='sales') EXCEPT(SELECT key,staff_id,phone FROM actual_sales)) AND NOT EXISTS((SELECT key,staff_id,phone FROM actual_sales) EXCEPT(SELECT key,staff_id,phone FROM requested WHERE kind='sales')) AS yes),
    latest_check AS MATERIALIZED (SELECT id,metadata FROM audit_logs WHERE action='whatsapp.enquiry_forwarding.provider_checked' AND created_at>clock_timestamp()-interval '24 hours' AND created_at<=clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 1),
    provider_current AS (SELECT EXISTS(SELECT 1 FROM latest_check a WHERE a.id=$10::uuid
      AND a.metadata->'infoForwarding'->'ready'='true'::jsonb AND a.metadata->'infoForwarding'->>'purpose'='enq_forward_info' AND a.metadata->'infoForwarding'->>'version'='1'
      AND a.metadata->'infoForwarding'->>'appId'=$9 AND a.metadata->'infoForwarding'->>'channelId'=$3 AND a.metadata->'infoForwarding'->>'releaseAuditId'=$11::text
      AND a.metadata->'channel'->>'appId'=$9 AND a.metadata->'channel'->>'configuredChannelId'=$3 AND a.metadata->'channel'->'connected'='true'::jsonb
      AND (a.metadata->'channel'->'archived'='false'::jsonb OR (a.metadata->'channel'->'archiveProof'->>'mode'='live_delivery' AND COALESCE((a.metadata->'channel'->>'archived')::boolean,false)=false))
      AND a.metadata->'channel'->'companyPhoneMatches'='true'::jsonb AND a.metadata->'channel'->'senderDifferentFromFixedCopy'='true'::jsonb
      AND a.metadata->'template'->'configuredApproved'='true'::jsonb AND a.metadata->'template'->'validationComplete'='true'::jsonb
      AND a.metadata->'infoForwarding'->>'channelProofHash'=a.metadata->'channel'->>'proofHash'
      AND NOT COALESCE(a.metadata->'reasonCodes'?'SENSITIVE_PROVIDER_CONTENT_REDACTED',false)
      AND EXISTS(SELECT 1 FROM audit_logs release JOIN ops_jobs j ON j.id=release.subject_id WHERE release.id=$11::uuid AND release.actor_id IS NULL AND release.action='whatsapp.enquiry_forwarding.check_requested' AND release.subject_type='ops_job' AND release.metadata->>'source'='approved_deployment_verification' AND release.metadata->>'releaseSha'=$12 AND j.job_type='woztell.enquiry.forward.readiness' AND j.payload='{}'::jsonb
        AND NOT EXISTS(SELECT 1 FROM audit_logs newer JOIN ops_jobs nj ON nj.id=newer.subject_id WHERE newer.action=release.action AND newer.actor_id IS NULL AND newer.subject_type='ops_job' AND newer.metadata->>'source'='approved_deployment_verification' AND newer.metadata->>'releaseSha'=$12 AND nj.job_type='woztell.enquiry.forward.readiness' AND nj.payload='{}'::jsonb AND (newer.created_at,newer.id)>(release.created_at,release.id)))
    ) AS yes),
    gate AS (UPDATE enquiry_notification_recipients c SET staff_id=d.staff_id,phone=d.phone,enabled=true,channel_id=$3,destination_type='recipient_id',destination_reference=d.phone,verification_ref=$4,verified_at=now(),permission_granted=true,permission_ref=(SELECT permission_ref FROM recipient_states WHERE key='copy')
      FROM recipient_states d JOIN enquiry_forwarding_copy_contact() contact ON contact.staff_id=d.staff_id AND contact.phone=d.phone WHERE d.key='copy' AND d.phone<>(SELECT metadata#>>'{channel,senderPhone}' FROM latest_check) AND c.recipient_key='copy' AND c.version=$1 AND $2::boolean AND ($14::jsonb IS NOT NULL OR ${actorAllowedSql})
        AND (SELECT yes FROM provider_current) AND (SELECT yes FROM roster_current) AND NOT EXISTS(SELECT 1 FROM recipient_states WHERE blocked IS NOT NULL)
        AND COALESCE((enquiry_info_head($9,$3,'policy','policy')).revision,0)=$13
      RETURNING c.id,c.version),
    recipients AS (INSERT INTO enquiry_notification_recipients(recipient_key,kind,staff_id,phone,channel_id,destination_type,destination_reference,enabled,verification_ref,verified_at,permission_granted,permission_ref)
      SELECT d.key,d.kind,d.staff_id,d.phone,$3,'recipient_id',d.phone,true,$4,now(),true,d.permission_ref FROM recipient_states d CROSS JOIN gate WHERE d.key<>'copy'
      ON CONFLICT(recipient_key) DO UPDATE SET staff_id=EXCLUDED.staff_id,phone=EXCLUDED.phone,channel_id=EXCLUDED.channel_id,destination_type=EXCLUDED.destination_type,destination_reference=EXCLUDED.destination_reference,enabled=true,verification_ref=EXCLUDED.verification_ref,verified_at=EXCLUDED.verified_at,permission_granted=true,permission_ref=EXCLUDED.permission_ref,retired_at=NULL RETURNING id),
    retired AS (UPDATE enquiry_notification_recipients SET enabled=false WHERE kind='sales' AND recipient_key NOT IN(SELECT key FROM requested) AND EXISTS(SELECT 1 FROM gate) RETURNING id),
    audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata)
      SELECT $7::uuid,'whatsapp.enquiry_forwarding.configured','enquiry_notification_recipients',id,jsonb_build_object('enabled',true,'version',version,'recipientCount',jsonb_array_length($6::jsonb),'verificationRef',$4,'purpose','enq_forward_info','authorityKind',CASE WHEN $14::jsonb IS NULL THEN 'staff_session' ELSE 'owner_instruction' END) FROM gate RETURNING id)
    SELECT (SELECT id FROM gate) AS id,(SELECT version FROM gate) AS version,
      ARRAY(SELECT key FROM recipient_states WHERE blocked='customer' ORDER BY key) AS conflict_recipient_keys,
      (SELECT count(DISTINCT phone)::int FROM recipient_states WHERE blocked IS NOT NULL) AS distinct_blocked_phone_count,
      (SELECT yes FROM provider_current) AS provider_current,(SELECT yes FROM roster_current) AS roster_current`;
}
const pauseSql = `WITH gate AS (UPDATE enquiry_notification_recipients SET enabled=false WHERE recipient_key='copy' AND version=$1 AND ${actorAllowedSql.replaceAll("$7", "$2")} RETURNING id,version),
  paused AS (UPDATE enquiry_notification_recipients SET enabled=false WHERE recipient_key<>'copy' AND EXISTS(SELECT 1 FROM gate) RETURNING id),
  audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $2::uuid,'whatsapp.enquiry_forwarding.configured','enquiry_notification_recipients',id,jsonb_build_object('enabled',false,'version',version,'recipientCount',0) FROM gate RETURNING id)
  SELECT (SELECT id FROM gate) AS id,(SELECT version FROM gate) AS version`;
async function changeEnabled(
  data: z.infer<typeof forwardingEnabledInput>,
  authority: Authority,
  ports: Ports,
) {
  if (!(await forwardingSchemaAvailable(ports.query)))
    throw new Response("查詢通知資料庫未就緒。", { status: 409 });
  const env = ports.env ?? process.env;
  let available = await enquiryInfoSchemaAvailable(ports.query).catch(() => false),
    scope = runtimeScope(env);
  let desired: Awaited<ReturnType<typeof desiredRecipients>> = [],
    check: Awaited<ReturnType<typeof providerCheck>> = null;
  let proof: Awaited<ReturnType<typeof informationalProof>> | null = null,
    policyRevision = 0;
  if (data.enabled) {
    if (!available) throw new Response("查詢通知用途及收件隔離設定未就緒。", { status: 409 });
    check = await providerCheck(ports.query);
    proof = await informationalProof(check, ports.query, env);
    if (!proof.ready || !proof.scope || !proof.installation)
      throw new Response("請先核對 WhatsApp 公司號碼、已批核模板及通知用途設定。", {
        status: 409,
        headers: { "X-Error-Code": "INFO_PROVIDER_PROOF_REQUIRED" },
      });
    scope = proof.scope;
    desired = await desiredRecipients(ports.query);
  }
  if (available && scope) {
    try {
      const [head] = await ports.query(
        "SELECT revision FROM enquiry_info_head($1,$2,'policy','policy')",
        [scope.appId, scope.channelId],
      );
      policyRevision = Number(head?.revision ?? 0);
    } catch (error) {
      if (data.enabled) throw error;
      available = false;
      console.warn("Enquiry forwarding pause policy recording unavailable.");
    }
  }
  const subjects: EnquiryInfoSubject[] = [
    { kind: "policy" },
    ...new Set(desired.map((row) => row.phone)),
  ].flatMap((value) =>
    typeof value === "string"
      ? [{ kind: "recipient_phone" as const, phone: value }]
      : [value as EnquiryInfoSubject],
  );
  const locks =
    available && scope
      ? enquiryInfoLockStatements(
          scope,
          subjects,
          desired.map((row) => `woztell-phone:${row.phone}`),
        )
      : [];
  const actorId = authority.kind === "staff" ? authority.actor.staffId : null;
  const ref = check ? `provider-check-audit:${check.id}` : null;
  const params = [
    data.expectedCopyVersion,
    data.enabled,
    scope?.channelId ?? null,
    ref,
    ENQUIRY_ROUTING_APPROVAL,
    rosterJson(desired.filter((row) => row.key !== "copy")),
    actorId,
    rosterJson(desired),
    scope?.appId ?? null,
    check?.id ?? null,
    proof?.installation?.releaseAuditId ?? null,
    proof?.installation?.runtimeBuildSha ?? null,
    policyRevision,
    authority.kind === "owner" ? JSON.stringify(authority.source) : null,
  ];
  // All placeholders are explicitly typed in both paths, including the compatibility pause.
  const mutation: TransactionStatement = data.enabled
    ? { statement: enableStatement(), params }
    : { statement: pauseSql, params: [data.expectedCopyVersion, actorId] };
  const statements: TransactionStatement[] = [
    ...locks,
    {
      statement:
        "SELECT id FROM enquiry_notification_recipients WHERE recipient_key='copy' FOR UPDATE",
    },
    mutation,
  ];
  if (available && scope) {
    const command = {
      scope,
      subject: { kind: "policy" as const },
      decision: data.enabled ? ("armed" as const) : ("paused" as const),
      expectedRevision: policyRevision,
      evidence: {
        providerProofAuditId: check?.id ?? null,
        copyVersion: data.expectedCopyVersion + 1,
      },
    };
    const decision =
      authority.kind === "owner"
        ? buildOwnerEnquiryInfoActivationStatement(command, authority.source)
        : buildEnquiryInfoDecisionStatement(command, authority.actor);
    statements.push(policyAfterCopy(decision));
  }
  const results = await ports
    .transaction(statements, { isolationLevel: "ReadCommitted" })
    .catch((error: unknown) => {
      const code =
        error && typeof error === "object" && "code" in error ? String(error.code) : null;
      if (
        code === "40001" ||
        code === "40P01" ||
        (error instanceof Error && error.message.includes("ENQUIRY_INFO_"))
      )
        throw new Response("設定或收件用途已變更，請重新整理後核對。", { status: 409 });
      throw error;
    });
  const saved = results[locks.length + 1]?.[0];
  if (data.enabled && Number(saved?.distinct_blocked_phone_count) > 0)
    throw new Response("部分通知電話的收件用途仍需核對，包括未解決的客戶身份重疊。", {
      status: 409,
      headers: { "X-Error-Code": "RECIPIENT_IDENTITY_REVIEW_REQUIRED" },
    });
  if (!saved?.id)
    throw new Response("設定、收件資料或 WhatsApp 核對結果已變更，請重新整理。", { status: 409 });
  return {
    version: Number(saved.version),
    enabled: data.enabled,
    armId: data.enabled ? String(results.at(-1)?.[0]?.id) : null,
  };
}
export async function setEnquiryForwardingEnabled(
  input: unknown,
  actor: Actor,
  ports: Ports = defaults,
) {
  await authorize(actor, ports.query);
  const data = forwardingEnabledInput.parse(input);
  const result = await changeEnabled(data, { kind: "staff", actor }, ports);
  return { version: result.version, enabled: result.enabled };
}
/** Trusted operator ONLY, never exposed through a public authority selector. */
export async function enableEnquiryForwardingFromOwnerInstruction(
  input: unknown,
  source: EnquiryInfoOwnerInstruction,
  ports: Ports = defaults,
) {
  const data = ownerEnabledInput.parse(input),
    result = await changeEnabled({ ...data, enabled: true }, { kind: "owner", source }, ports);
  return { version: result.version, enabled: true as const, armId: result.armId! };
}
export async function queueEnquiryForwardingCheck(actor: Actor, ports: Ports = defaults) {
  await authorize(actor, ports.query);
  const requestId = randomUUID();
  const rows = await ports.query(
    "WITH job AS (INSERT INTO ops_jobs(job_type,payload_version,payload,status,max_attempts,run_after,idempotency_key,actor_staff_id) VALUES('woztell.enquiry.forward.readiness',1,'{}','queued',2,now(),$1,$2::uuid) RETURNING id), audit AS (INSERT INTO audit_logs(actor_id,action,subject_type,subject_id,metadata) SELECT $2::uuid,'whatsapp.enquiry_forwarding.check_requested','ops_job',id,'{}'::jsonb FROM job) SELECT id FROM job",
    [`enquiry-forward-readiness:${requestId}`, actor.staffId],
  );
  const { wakeAfterCommit } = await import("../control-plane/job-wake.server.ts");
  try {
    wakeAfterCommit("service");
  } catch {
    console.warn("[enquiry-forwarding] provider_check_wake_failed");
  }
  return { jobId: String(rows[0].id) };
}
