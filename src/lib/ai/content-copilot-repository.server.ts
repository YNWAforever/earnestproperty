import "@tanstack/react-start/server-only";

import { getSql, queryRows, type DbRow } from "@/lib/neon/db.server";

import {
  allowedContentCopilotFields,
  contentCopilotRequestSchema,
  validateContentCopilotProposal,
  type ContentCopilotAction,
  type ContentCopilotEvidence,
  type ContentCopilotPatch,
  type ContentCopilotProposal,
  type ContentCopilotRequest,
  type ContentCopilotResourceType,
} from "./content-copilot";

export type ContentProposalStatus =
  | "generating"
  | "generated"
  | "partially_applied"
  | "applied"
  | "rejected"
  | "expired"
  | "failed";

export type ContentProposalRecord = {
  id: string;
  resourceType: ContentCopilotResourceType;
  resourceId: string;
  action: ContentCopilotAction;
  selectedFields: string[];
  sourceFingerprint: string;
  requestContext: Record<string, unknown>;
  patches: ContentCopilotPatch[];
  evidence: ContentCopilotEvidence[];
  warnings: string[];
  provider: string;
  model: string | null;
  promptVersion: string;
  status: ContentProposalStatus;
  acceptedFields: string[];
  requestedBy: string;
  decidedBy: string | null;
  latencyMs: number | null;
  usageMetadata: Record<string, unknown>;
  errorCode: string | null;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
};

export type StartContentProposalInput = {
  staffId: string;
  request: ContentCopilotRequest;
  sourceFingerprint: string;
  promptVersion: string;
  provider?: "opencode_go";
  model?: string | null;
};

export type CompleteContentProposalInput = {
  staffId: string;
  proposalId: string;
  resourceType: ContentCopilotResourceType;
  resourceId: string;
  action: ContentCopilotAction;
  proposal: ContentCopilotProposal;
  latencyMs?: number | null;
  usageMetadata?: Record<string, unknown>;
  model?: string | null;
};

export type FailContentProposalInput = {
  staffId: string;
  proposalId: string;
  errorCode: string;
  latencyMs?: number | null;
  usageMetadata?: Record<string, unknown>;
};

export type DecideContentProposalInput = {
  staffId: string;
  proposalId: string;
  acceptedFields: string[];
};

export async function startContentProposal(input: StartContentProposalInput) {
  const requestsPerStaffPerHour = 20;
  const requestResult = contentCopilotRequestSchema.safeParse(input.request);
  if (!requestResult.success) throw contentCopilotError("COPILOT_REQUEST_INVALID");
  if (input.provider && input.provider !== "opencode_go")
    throw contentCopilotError("COPILOT_PROVIDER_UNSUPPORTED");
  if (!/^[0-9a-f]{64}$/.test(input.sourceFingerprint))
    throw contentCopilotError("COPILOT_FINGERPRINT_INVALID");

  await expireGeneratingProposal(input.staffId);

  try {
    const sql = getSql();
    const [, rows] = await sql.transaction((tx) => [
      tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [input.staffId]),
      tx.query(
        `INSERT INTO ai_content_proposals (
           resource_type, resource_id, action, selected_fields, source_fingerprint,
           request_context, provider, model, prompt_version, status, requested_by
         )
         SELECT $1,$2,$3,$4::text[],$5,$6::jsonb,$7,$8,$9,'generating',$10
         WHERE (SELECT count(*)::int
                FROM ai_content_proposals
                WHERE requested_by = $10::uuid
                  AND created_at >= now() - interval '1 hour') < ${requestsPerStaffPerHour}
         RETURNING *`,
        [
          requestResult.data.resourceType,
          requestResult.data.resourceId,
          requestResult.data.action,
          requestResult.data.selectedFields,
          input.sourceFingerprint,
          JSON.stringify({
            tone: requestResult.data.tone,
            targetLanguage: requestResult.data.targetLanguage,
            researchMode: requestResult.data.researchMode,
          }),
          input.provider ?? "opencode_go",
          input.model ?? null,
          input.promptVersion,
          input.staffId,
        ],
      ),
    ]);
    if (!rows[0]) throw contentCopilotError("COPILOT_RATE_LIMITED");
    return mapProposal(requireProposal(rows[0]));
  } catch (error) {
    if (isGeneratingProposalConflict(error))
      throw contentCopilotError("COPILOT_GENERATION_IN_PROGRESS");
    if (postgresErrorCode(error) === "23505")
      throw contentCopilotError("COPILOT_DATABASE_CONFLICT");
    throw error;
  }
}

export async function completeContentProposal(input: CompleteContentProposalInput) {
  const proposalResult = validateContentCopilotProposal(input.proposal);
  if (!proposalResult.ok) throw contentCopilotError(proposalResult.error);
  if (proposalResult.value.resourceType !== input.resourceType)
    throw contentCopilotError("COPILOT_PROPOSAL_CONTEXT_MISMATCH");

  await expireOwnedProposal(input.proposalId, input.staffId);
  const rows = await queryRows(
    `UPDATE ai_content_proposals
     SET status = 'generated',
         patches = $1::jsonb,
         evidence = $2::jsonb,
         warnings = $3::jsonb,
         latency_ms = $4,
         usage_metadata = $5::jsonb,
         model = COALESCE($6, model)
     WHERE id = $7
       AND requested_by = $8
       AND status = 'generating'
       AND expires_at > now()
       AND resource_type = $9
       AND resource_id = $10
       AND action = $11
       AND source_fingerprint = $12
     RETURNING *`,
    [
      JSON.stringify(proposalResult.value.patches),
      JSON.stringify(proposalResult.value.evidence),
      JSON.stringify(proposalResult.value.warnings),
      input.latencyMs ?? null,
      JSON.stringify(sanitizeContentCopilotUsageMetadata(input.usageMetadata)),
      input.model ?? null,
      input.proposalId,
      input.staffId,
      input.resourceType,
      input.resourceId,
      input.action,
      proposalResult.value.sourceFingerprint,
    ],
  );
  return requireTransition(rows[0], input.proposalId, input.staffId);
}

export async function failContentProposal(input: FailContentProposalInput) {
  const errorCode = sanitizeContentCopilotErrorCode(input.errorCode);
  await expireOwnedProposal(input.proposalId, input.staffId);
  const rows = await queryRows(
    `UPDATE ai_content_proposals
     SET status = 'failed',
         error_code = $1,
         latency_ms = $2,
         usage_metadata = $3::jsonb
     WHERE id = $4
       AND requested_by = $5
       AND status = 'generating'
       AND expires_at > now()
     RETURNING *`,
    [
      errorCode,
      input.latencyMs ?? null,
      JSON.stringify(sanitizeContentCopilotUsageMetadata(input.usageMetadata)),
      input.proposalId,
      input.staffId,
    ],
  );
  return requireTransition(rows[0], input.proposalId, input.staffId);
}

export async function getContentProposal(input: { proposalId: string; staffId: string }) {
  await expireOwnedProposal(input.proposalId, input.staffId);
  const rows = await queryRows(
    `SELECT *
     FROM ai_content_proposals
     WHERE id = $1 AND requested_by = $2
     LIMIT 1`,
    [input.proposalId, input.staffId],
  );
  return rows[0] ? mapProposal(rows[0]) : null;
}

export async function decideContentProposal(input: DecideContentProposalInput) {
  const acceptedFields = uniqueFields(input.acceptedFields);
  await expireOwnedProposal(input.proposalId, input.staffId);
  const rows = await queryRows(
    `UPDATE ai_content_proposals
     SET status = CASE
           WHEN cardinality($1::text[]) = 0 THEN 'rejected'
           WHEN $1::text[] @> selected_fields AND selected_fields @> $1::text[] THEN 'applied'
           ELSE 'partially_applied'
         END,
         accepted_fields = $1::text[],
         decided_by = $2,
         decided_at = now()
     WHERE id = $3
       AND requested_by = $2
       AND status = 'generated'
       AND $1::text[] <@ selected_fields
       AND expires_at > now()
     RETURNING *`,
    [acceptedFields, input.staffId, input.proposalId],
  );
  return requireTransition(rows[0], input.proposalId, input.staffId);
}

export type ContentCopilotAuditMetadata = Partial<{
  provider: "opencode_go";
  model: string;
  latencyMs: number;
  researchMode: "internal" | "web";
  status: ContentProposalStatus;
  errorCode: string;
  acceptedFields: string[];
  citationCount: number;
  warningsCount: number;
}>;

const CONTENT_COPILOT_RESOURCE_TYPES = new Set<ContentCopilotResourceType>([
  "estate",
  "article",
  "faq",
  "video",
  "listing",
]);
const CONTENT_PROPOSAL_STATUSES = new Set<ContentProposalStatus>([
  "generating",
  "generated",
  "partially_applied",
  "applied",
  "rejected",
  "expired",
  "failed",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTENT_COPILOT_AUDIT_ACTIONS = new Set([
  "content_copilot.generated",
  "content_copilot.failed",
  "content_copilot.applied",
  "content_copilot.rejected",
  "content_copilot.stale",
]);

export function sanitizeContentCopilotAuditMetadata(
  metadata: Record<string, unknown> | undefined,
  resourceType?: ContentCopilotResourceType,
): ContentCopilotAuditMetadata {
  const allowed = new Set([
    "provider",
    "model",
    "latencyMs",
    "researchMode",
    "status",
    "errorCode",
    "acceptedFields",
    "citationCount",
    "warningsCount",
  ]);
  const result: ContentCopilotAuditMetadata = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!allowed.has(key)) throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
    if (key === "provider" && value !== "opencode_go")
      throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
    if (key === "researchMode" && value !== "internal" && value !== "web")
      throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
    if (
      key === "status" &&
      (typeof value !== "string" || !CONTENT_PROPOSAL_STATUSES.has(value as ContentProposalStatus))
    )
      throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
    if (key === "errorCode" && (typeof value !== "string" || !/^[A-Z0-9_]{1,80}$/.test(value)))
      throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
    if (key === "acceptedFields") {
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        !value.every(
          (item) =>
            typeof item === "string" &&
            (resourceType
              ? allowedContentCopilotFields(resourceType).includes(item)
              : /^[a-z_]{1,40}$/.test(item)),
        )
      )
        throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
      (result as Record<string, unknown>)[key] = value;
      continue;
    }
    if (["latencyMs", "citationCount", "warningsCount"].includes(key)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100000)
        throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
      (result as Record<string, unknown>)[key] = value;
      continue;
    }
    if (typeof value === "string" && value.length <= 100 && !/[\\u0000-\\u001f]/.test(value)) {
      (result as Record<string, unknown>)[key] = value;
      continue;
    }
    throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
  }
  return result;
}

function sanitizeContentCopilotErrorCode(value: string) {
  if (!/^[A-Z0-9_]{1,80}$/.test(value)) throw contentCopilotError("COPILOT_USAGE_METADATA_INVALID");
  return value;
}

export function sanitizeContentCopilotUsageMetadata(metadata: Record<string, unknown> | undefined) {
  const allowed = new Set([
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cachedTokens",
    "retryCount",
  ]);
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      !allowed.has(key) ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 10000000
    )
      throw contentCopilotError("COPILOT_USAGE_METADATA_INVALID");
    result[key] = value;
  }
  return result;
}

function assertContentCopilotAuditIdentity(input: {
  actorId: string;
  proposalId: string;
  resourceType: string;
  resourceId: string;
  action: string;
}) {
  if (
    !CONTENT_COPILOT_AUDIT_ACTIONS.has(input.action) ||
    !UUID_PATTERN.test(input.actorId) ||
    !UUID_PATTERN.test(input.proposalId) ||
    !UUID_PATTERN.test(input.resourceId) ||
    !CONTENT_COPILOT_RESOURCE_TYPES.has(input.resourceType as ContentCopilotResourceType)
  )
    throw contentCopilotError("COPILOT_AUDIT_METADATA_INVALID");
}

export async function writeContentCopilotAudit(input: {
  actorId: string;
  action:
    | "content_copilot.generated"
    | "content_copilot.failed"
    | "content_copilot.applied"
    | "content_copilot.rejected"
    | "content_copilot.stale";
  proposalId: string;
  resourceType: string;
  resourceId: string;
  metadata?: ContentCopilotAuditMetadata;
}) {
  assertContentCopilotAuditIdentity(input);
  const metadata = sanitizeContentCopilotAuditMetadata(
    input.metadata,
    input.resourceType as ContentCopilotResourceType,
  );
  await queryRows(
    `INSERT INTO ai_audit_logs (actor_type, actor_id, action, subject_type, subject_id, metadata)
     VALUES ('staff',$1,$2,$3,$4,$5::jsonb)`,
    [
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId,
      JSON.stringify({ proposalId: input.proposalId, ...metadata }),
    ],
  );
}

async function expireGeneratingProposal(staffId: string) {
  await queryRows(
    `UPDATE ai_content_proposals
     SET status = 'expired'
     WHERE requested_by = $1
       AND status = 'generating'
       AND expires_at <= now()`,
    [staffId],
  );
}

async function expireOwnedProposal(proposalId: string, staffId: string) {
  await queryRows(
    `UPDATE ai_content_proposals
     SET status = 'expired'
     WHERE id = $1
       AND requested_by = $2
       AND status IN ('generating', 'generated')
       AND expires_at <= now()`,
    [proposalId, staffId],
  );
}

function requireTransition(row: DbRow | undefined, proposalId: string, staffId: string) {
  if (row) return mapProposal(row);
  return getTransitionFailure(proposalId, staffId).then(async (proposal) => {
    if (proposal && Date.parse(proposal.expiresAt) <= Date.now()) {
      await expireOwnedProposal(proposalId, staffId);
      throw contentCopilotError("COPILOT_PROPOSAL_EXPIRED");
    }
    if (proposal?.status === "expired") throw contentCopilotError("COPILOT_PROPOSAL_EXPIRED");
    throw contentCopilotError("COPILOT_PROPOSAL_TRANSITION_INVALID");
  });
}

async function getTransitionFailure(proposalId: string, staffId: string) {
  const rows = await queryRows(
    `SELECT *
     FROM ai_content_proposals
     WHERE id = $1 AND requested_by = $2
     LIMIT 1`,
    [proposalId, staffId],
  );
  return rows[0] ? mapProposal(rows[0]) : null;
}

function mapProposal(row: DbRow): ContentProposalRecord {
  return {
    id: String(row.id),
    resourceType: String(row.resource_type) as ContentCopilotResourceType,
    resourceId: String(row.resource_id),
    action: String(row.action) as ContentCopilotAction,
    selectedFields: stringArray(row.selected_fields),
    sourceFingerprint: String(row.source_fingerprint),
    requestContext: objectRecord(row.request_context),
    patches: jsonArray<ContentCopilotPatch>(row.patches),
    evidence: jsonArray<ContentCopilotEvidence>(row.evidence),
    warnings: stringArray(row.warnings),
    provider: String(row.provider),
    model: stringOrNull(row.model),
    promptVersion: String(row.prompt_version),
    status: String(row.status) as ContentProposalStatus,
    acceptedFields: stringArray(row.accepted_fields),
    requestedBy: String(row.requested_by),
    decidedBy: stringOrNull(row.decided_by),
    latencyMs: numberOrNull(row.latency_ms),
    usageMetadata: objectRecord(row.usage_metadata),
    errorCode: stringOrNull(row.error_code),
    createdAt: String(row.created_at),
    decidedAt: stringOrNull(row.decided_at),
    expiresAt: String(row.expires_at),
  };
}

function requireProposal(row: DbRow | undefined) {
  if (!row) throw contentCopilotError("COPILOT_PROPOSAL_CREATE_FAILED");
  return row;
}

function uniqueFields(fields: string[]) {
  return [...new Set(fields)];
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function stringOrNull(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isGeneratingProposalConflict(error: unknown) {
  if (postgresErrorCode(error) !== "23505") return false;
  return postgresErrorConstraint(error) === "ai_content_proposals_one_generating_per_staff_idx";
}

function postgresErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : null;
}

function postgresErrorConstraint(error: unknown) {
  if (!error || typeof error !== "object") return null;
  if ("constraint" in error && typeof error.constraint === "string") return error.constraint;
  if ("constraint_name" in error && typeof error.constraint_name === "string")
    return error.constraint_name;
  return null;
}

function contentCopilotError(code: string) {
  return Object.assign(new Error(code), { code });
}
