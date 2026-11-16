import "@tanstack/react-start/server-only";
import { z } from "zod";
import { queryRows, transactionRows, type DbRow, type TransactionStatement } from "./db.server.ts";
import type { StaffAccess } from "./auth.server.ts";
import type {
  EnquiryInfoDecision,
  EnquiryInfoDecisionInput,
  EnquiryInfoOwnerInstruction,
  EnquiryInfoPhoneSnapshot,
  EnquiryInfoScope,
  EnquiryInfoSubject,
} from "./enquiry-info-decisions.types.ts";
export { ENQUIRY_INFO_PURPOSE } from "./enquiry-info-decisions.types.ts";

type Actor = Pick<StaffAccess, "staffId" | "roles">;
type Ports = { query: typeof queryRows; transaction: typeof transactionRows };
const defaults: Ports = { query: queryRows, transaction: transactionRows };
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/);
const memberId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const phone = z.string().regex(/^852[456789][0-9]{7}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({ appId: providerId, channelId: providerId }).strict();
const subjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("policy") }).strict(),
  z.object({ kind: z.literal("recipient_phone"), phone }).strict(),
  z.object({ kind: z.literal("sender_member"), memberId }).strict(),
  z.object({ kind: z.literal("receipt"), receiptId: z.string().uuid() }).strict(),
]);
const memberEvidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provider_audit"),
      auditId: z.string().uuid(),
      proofHash: hash,
      receiptId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("accepted_ingress"), receiptId: z.string().uuid() }).strict(),
]);
const evidenceSchema = z
  .record(z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= 32768,
    "Evidence exceeds the bounded review record",
  );
const inputSchema = z
  .object({
    scope: scopeSchema,
    subject: subjectSchema,
    decision: z.enum([
      "armed",
      "paused",
      "revoked",
      "approved",
      "staff_bound",
      "customer_confirmed",
      "held",
      "released_customer",
      "released_staff",
    ]),
    expectedRevision: z.number().int().nonnegative(),
    phone: phone.optional(),
    staffId: z.string().uuid().nullable().optional(),
    relatedDecisionId: z.string().uuid().nullable().optional(),
    expectedProfileHash: hash.optional(),
    expectedConflictHash: hash.optional(),
    evidence: evidenceSchema.optional(),
    memberEvidence: memberEvidenceSchema.optional(),
  })
  .strict();
const ownerSchema = z
  .object({
    goalId: z.string().min(5).max(160),
    sourceReference: z.string().min(3).max(500),
    sourceSha256: hash,
    receivedAt: z.string().datetime({ offset: true }),
    recorderReference: z.string().min(3).max(300),
    statement: z.string().min(3).max(4000),
    questionId: z.string().min(1).max(160).optional(),
    response: z.string().min(1).max(4000).optional(),
    photoSha256: hash.optional(),
  })
  .strict();
export class EnquiryInfoDecisionError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 409) {
    super(
      status === 403 ? "未獲授權核對此通知身份。" : "通知身份資料已變更或未完成核對，請重新核對。",
    );
    this.name = "EnquiryInfoDecisionError";
    this.code = code;
    this.status = status;
  }
}
function translate(error: unknown): never {
  if (error instanceof EnquiryInfoDecisionError) throw error;
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/ENQUIRY_INFO_[A-Z_]+/)?.[0];
  if (code) throw new EnquiryInfoDecisionError(code, code.includes("FORBIDDEN") ? 403 : 409);
  throw error;
}
function key(subject: EnquiryInfoSubject): string {
  const parsed = subjectSchema.parse(subject);
  return parsed.kind === "policy"
    ? "policy"
    : parsed.kind === "recipient_phone"
      ? parsed.phone
      : parsed.kind === "sender_member"
        ? parsed.memberId
        : parsed.receiptId;
}
export function enquiryInfoPolicyLockKey(scope: EnquiryInfoScope) {
  const s = scopeSchema.parse(scope);
  return `enq-info:policy:${s.appId}:${s.channelId}`;
}
export function enquiryInfoSubjectLockKey(scope: EnquiryInfoScope, subject: EnquiryInfoSubject) {
  const s = scopeSchema.parse(scope);
  return `enq-info:subject:${s.appId}:${s.channelId}:${subject.kind}:${key(subject)}`;
}
/** Policy first, sorted existing identity locks second, sorted subject locks last.
 * Execute these as separate statements BEFORE reads at ReadCommitted, never a lock/read CTE.
 */
export function enquiryInfoLockStatements(
  scope: EnquiryInfoScope,
  subjects: readonly EnquiryInfoSubject[] = [],
  identityKeys: readonly string[] = [],
): TransactionStatement[] {
  const identities = [
    ...new Set(
      identityKeys.map((value) =>
        z
          .string()
          .regex(/^woztell-(member|message|phone):[^\p{Cc}]{1,512}$/u)
          .parse(value),
      ),
    ),
  ].sort();
  const subjectsKeys = [
    ...new Set(subjects.map((subject) => enquiryInfoSubjectLockKey(scope, subject))),
  ].sort();
  return [enquiryInfoPolicyLockKey(scope), ...identities, ...subjectsKeys].map((value) => ({
    statement: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    params: [value],
  }));
}
export async function enquiryInfoSchemaAvailable(query = queryRows): Promise<boolean> {
  const [row] = await query(
    "SELECT to_regclass('enquiry_forwarding_decisions') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='whatsapp_inbound_receipts' AND column_name='enquiry_forwarding_arm_id') AS available",
  );
  return row?.available === true;
}
async function requireSchema(query: typeof queryRows) {
  if (!(await enquiryInfoSchemaAvailable(query)))
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_SCHEMA_UNAVAILABLE", 503);
}
function decision(row: DbRow | undefined): EnquiryInfoDecision | null {
  if (!row?.id) return null;
  const nullable = (value: unknown) => (value == null ? null : String(value));
  return {
    id: String(row.id),
    purpose: "enq_forward_info",
    appId: String(row.app_id),
    channelId: String(row.channel_id),
    subjectKind: row.subject_kind as EnquiryInfoDecision["subjectKind"],
    subjectKey: String(row.subject_key),
    revision: Number(row.revision),
    previousDecisionId: nullable(row.previous_decision_id),
    decision: row.decision as EnquiryInfoDecision["decision"],
    phone: nullable(row.phone),
    staffId: nullable(row.staff_id),
    memberId: nullable(row.member_id),
    receiptId: nullable(row.receipt_id),
    relatedDecisionId: nullable(row.related_decision_id),
    profileHash: nullable(row.profile_hash),
    conflictHash: nullable(row.conflict_hash),
    identitySnapshot: row.identity_snapshot as Record<string, unknown>,
    evidence: row.evidence as Record<string, unknown>,
    authorityKind: row.authority_kind as EnquiryInfoDecision["authorityKind"],
    actorStaffId: nullable(row.actor_staff_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}
export async function getEnquiryInfoDecisionHead(
  scope: EnquiryInfoScope,
  subject: EnquiryInfoSubject,
  query = queryRows,
) {
  const s = scopeSchema.parse(scope);
  await requireSchema(query);
  const [row] = await query("SELECT * FROM enquiry_info_head($1,$2,$3,$4)", [
    s.appId,
    s.channelId,
    subject.kind,
    key(subject),
  ]);
  return decision(row);
}
/** Historical witness remains across pause/revoke; this does not report current send readiness. */
export async function getEnquiryInfoLatestArmId(
  scope: EnquiryInfoScope,
  query = queryRows,
): Promise<string | null> {
  const s = scopeSchema.parse(scope);
  await requireSchema(query);
  const [row] = await query("SELECT enquiry_info_latest_arm($1,$2) AS id", [s.appId, s.channelId]);
  return row?.id ? String(row.id) : null;
}
export async function getEnquiryInfoPhoneSnapshot(
  scope: EnquiryInfoScope,
  value: string,
  query = queryRows,
): Promise<EnquiryInfoPhoneSnapshot> {
  const s = scopeSchema.parse(scope);
  phone.parse(value);
  await requireSchema(query);
  const [row] = await query("SELECT enquiry_info_phone_snapshot($1,$2,$3) AS snapshot", [
    s.appId,
    s.channelId,
    value,
  ]);
  if (!row?.snapshot) throw new EnquiryInfoDecisionError("ENQUIRY_INFO_SNAPSHOT_UNAVAILABLE", 503);
  return row.snapshot as EnquiryInfoPhoneSnapshot;
}
function statement(
  input: EnquiryInfoDecisionInput,
  authority: "staff_session" | "owner_instruction",
  actor: string | null,
  owner?: EnquiryInfoOwnerInstruction,
): TransactionStatement {
  const d = inputSchema.parse(input),
    subject = d.subject;
  const evidence = {
    ...d.evidence,
    ...(d.memberEvidence ? { memberEvidence: d.memberEvidence } : {}),
    ...(owner ? { ownerInstruction: owner } : {}),
  };
  evidenceSchema.parse(evidence);
  return {
    statement:
      "SELECT * FROM enquiry_info_append_decision($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10::uuid,$11::uuid,$12,$13,$14::jsonb,$15,$16::uuid)",
    params: [
      d.scope.appId,
      d.scope.channelId,
      subject.kind,
      key(subject),
      d.decision,
      d.expectedRevision,
      subject.kind === "recipient_phone" ? subject.phone : (d.phone ?? null),
      d.staffId ?? null,
      subject.kind === "sender_member" ? subject.memberId : null,
      subject.kind === "receipt" ? subject.receiptId : null,
      d.relatedDecisionId ?? null,
      d.expectedProfileHash ?? null,
      d.expectedConflictHash ?? null,
      JSON.stringify(evidence),
      authority,
      actor,
    ],
  };
}
/** For the real authenticated enable transaction only; never execute an arm in a standalone API. */
export function buildEnquiryInfoDecisionStatement(
  input: EnquiryInfoDecisionInput,
  actor: Actor,
): TransactionStatement {
  if (!actor.roles.some((role) => role === "admin" || role === "manager"))
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_REVIEWER_FORBIDDEN", 403);
  z.string().uuid().parse(actor.staffId);
  return statement(input, "staff_session", actor.staffId);
}
/** Trusted operational activation ONLY; caller must atomically enable/configure the copy.
 * Never expose this as a public authority selector or execute it outside that transaction.
 */
export function buildOwnerEnquiryInfoActivationStatement(
  input: EnquiryInfoDecisionInput,
  source: EnquiryInfoOwnerInstruction,
): TransactionStatement {
  const d = inputSchema.parse(input),
    owner = ownerSchema.parse(source);
  if (d.subject.kind !== "policy" || d.decision !== "armed")
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_OWNER_ACTIVATION_SCOPE_INVALID");
  if (!owner.photoSha256)
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_OWNER_PHOTO_AUTHORITY_REQUIRED");
  return statement(d, "owner_instruction", null, owner);
}
function writeLocks(input: EnquiryInfoDecisionInput) {
  const phoneValue = input.subject.kind === "recipient_phone" ? input.subject.phone : input.phone;
  const identities = [
    ...(phoneValue ? [`woztell-phone:${phoneValue}`] : []),
    ...(input.subject.kind === "sender_member" ? [`woztell-member:${input.subject.memberId}`] : []),
  ];
  const relatedSubjects: EnquiryInfoSubject[] = [
    input.subject,
    ...(phoneValue && input.subject.kind !== "recipient_phone"
      ? [{ kind: "recipient_phone" as const, phone: phoneValue }]
      : []),
  ];
  return enquiryInfoLockStatements(input.scope, relatedSubjects, identities);
}
export async function appendEnquiryInfoDecision(
  input: EnquiryInfoDecisionInput,
  actor: Actor,
  ports: Ports = defaults,
): Promise<EnquiryInfoDecision> {
  const d = inputSchema.parse(input);
  if (d.decision === "armed")
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_ATOMIC_ARM_REQUIRED");
  await requireSchema(ports.query);
  try {
    const results = await ports.transaction(
      [...writeLocks(d), buildEnquiryInfoDecisionStatement(d, actor)],
      { isolationLevel: "ReadCommitted" },
    );
    const result = decision(results.at(-1)?.[0]);
    if (!result) throw new EnquiryInfoDecisionError("ENQUIRY_INFO_WRITE_FAILED");
    return result;
  } catch (error) {
    return translate(error);
  }
}
/** Trusted operator import ONLY. No client wrapper may accept an owner authority switch.
 * Records the real Owner instruction and recorder with actor_staff_id=NULL; DB facts are
 * recomputed after locking. A local proposal/hash alone never supplies a permission.
 */
export async function importOwnerEnquiryInfoDecision(
  input: EnquiryInfoDecisionInput,
  source: EnquiryInfoOwnerInstruction,
  ports: Ports = defaults,
): Promise<EnquiryInfoDecision> {
  const d = inputSchema.parse(input),
    owner = ownerSchema.parse(source);
  if (!["approved", "revoked", "paused", "staff_bound"].includes(d.decision))
    throw new EnquiryInfoDecisionError("ENQUIRY_INFO_OWNER_IMPORT_SCOPE_INVALID");
  await requireSchema(ports.query);
  try {
    const results = await ports.transaction(
      [...writeLocks(d), statement(d, "owner_instruction", null, owner)],
      { isolationLevel: "ReadCommitted" },
    );
    const result = decision(results.at(-1)?.[0]);
    if (!result) throw new EnquiryInfoDecisionError("ENQUIRY_INFO_WRITE_FAILED");
    return result;
  } catch (error) {
    return translate(error);
  }
}
/** Caller composes with the guarded receipt-state mutation in the SAME locked transaction. */
export function buildEnquiryInfoSystemHoldStatement(
  scope: EnquiryInfoScope,
  receiptId: string,
  evidence: Record<string, unknown> = {},
): TransactionStatement {
  const s = scopeSchema.parse(scope);
  z.string().uuid().parse(receiptId);
  evidenceSchema.parse(evidence);
  return {
    statement: "SELECT * FROM enquiry_info_system_hold($1,$2,$3::uuid,$4::jsonb)",
    params: [s.appId, s.channelId, receiptId, JSON.stringify(evidence)],
  };
}
export function buildEnquiryInfoDerivedBindingStatement(
  scope: EnquiryInfoScope,
  receiptId: string,
  phoneApprovalId: string,
): TransactionStatement {
  const s = scopeSchema.parse(scope);
  z.string().uuid().parse(receiptId);
  z.string().uuid().parse(phoneApprovalId);
  return {
    statement: "SELECT * FROM enquiry_info_derive_staff_binding($1,$2,$3::uuid,$4::uuid)",
    params: [s.appId, s.channelId, receiptId, phoneApprovalId],
  };
}
