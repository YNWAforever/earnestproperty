import { createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { canonical, fingerprint } from "../../src/lib/blog/reconcile";
import { PRODUCTION_TARGET } from "./production-target";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
// Recovery evidence rejects a signed window longer than six hours. Production
// approval is valid only inside the overlapping recovery and fence windows, and
// no signed production window may run longer than that same bound.
export const PRODUCTION_EVIDENCE_MAX_WINDOW_MS = 21_600_000;
const text = z.string().min(1).max(256);
const integer = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const windowFields = { startsAt: integer, expiresAt: integer };
export const productionTargetSchema = z
  .object({
    projectId: text,
    branchId: text,
    endpointId: text,
    host: text,
    port: z.literal(5432),
    database: text,
    role: text,
    systemIdentifier: z.string().regex(/^[0-9]{1,20}$/),
    serverVersion: integer,
  })
  .strict();
export type ProductionTarget = z.infer<typeof productionTargetSchema>;

const envelope = <T extends z.ZodTypeAny>(record: T) =>
  z
    .object({
      record,
      signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
    })
    .strict();
const mappingSchema = envelope(
  z
    .object({
      kind: z.literal("production-target-v1"),
      ...windowFields,
      target: productionTargetSchema,
      certificateSha256: digest,
    })
    .strict(),
);
const approvalSchema = envelope(
  z
    .object({
      kind: z.literal("production-approval-v1"),
      ...windowFields,
      packetSha256: digest,
      mappingSha256: digest,
      recoverySha256: digest,
      fenceSha256: digest,
    })
    .strict(),
);
const recoverySchema = envelope(
  z
    .object({
      kind: z.literal("production-recovery-v1"),
      ...windowFields,
      target: productionTargetSchema,
      backupArchiveSha256: digest,
      restoreReceiptSha256: digest,
      backupAt: integer,
      restoredAt: integer,
    })
    .strict(),
);
const fenceSchema = envelope(
  z
    .object({
      kind: z.literal("production-fence-v1"),
      ...windowFields,
      target: productionTargetSchema,
      packetSha256: digest,
      generation: text,
      mode: z.literal("external-until-explicit-reopen"),
    })
    .strict(),
);
const requestSchema = z
  .object({
    packetBytes: z.instanceof(Uint8Array),
    sourceBytes: z.instanceof(Uint8Array),
    connection: z
      .object({
        host: text,
        port: z.literal(5432),
        database: text,
        role: text,
        tls: z.literal("verify-full"),
      })
      .strict(),
    evidence: z
      .object({
        mapping: mappingSchema,
        approval: approvalSchema,
        recovery: recoverySchema,
        fence: fenceSchema,
      })
      .strict(),
  })
  .strict();
const authoritySchema = z
  .object({
    format: z.literal("earnest-blog-release-authority-v1"),
    mappingKey: z.string(),
    approvalKey: z.string(),
    recoveryKey: z.string(),
    fenceKey: z.string(),
  })
  .strict();

export function parseProductionRequest(untrusted: unknown) {
  const parsed = requestSchema.safeParse(untrusted);
  if (!parsed.success) throw new Error("PRODUCTION_REQUEST");
  // Own the byte streams and all evidence before the first await.
  return {
    ...parsed.data,
    packetBytes: Buffer.from(parsed.data.packetBytes),
    sourceBytes: Buffer.from(parsed.data.sourceBytes),
  };
}

function trustedKeys(raw: unknown) {
  const authority = authoritySchema.safeParse(raw);
  if (!authority.success) throw new Error("PRODUCTION_AUTHORITY");
  const key = (pem: string) => {
    if (!pem.startsWith("-----BEGIN PUBLIC KEY-----")) throw new Error("PRODUCTION_AUTHORITY");
    try {
      const parsed = createPublicKey(pem);
      if (parsed.asymmetricKeyType !== "ed25519") throw new Error();
      return parsed;
    } catch {
      throw new Error("PRODUCTION_AUTHORITY");
    }
  };
  const { mappingKey, approvalKey, recoveryKey, fenceKey } = authority.data;
  const result = {
    mapping: key(mappingKey),
    approval: key(approvalKey),
    recovery: key(recoveryKey),
    fence: key(fenceKey),
  };
  if (
    new Set(
      Object.values(result).map((k) => k.export({ type: "spki", format: "der" }).toString("hex")),
    ).size !== 4
  )
    throw new Error("PRODUCTION_AUTHORITY");
  return result;
}

function authenticate(document: { record: object; signature: string }, key: KeyObject) {
  const signature = Buffer.from(document.signature, "base64");
  if (
    signature.toString("base64") !== document.signature ||
    !verify(null, Buffer.from(canonical(document.record)), key, signature)
  )
    throw new Error("PRODUCTION_EVIDENCE_SIGNATURE");
}

export function authenticateProductionRequest(
  request: ReturnType<typeof parseProductionRequest>,
  rawAuthority: unknown,
) {
  const keys = trustedKeys(rawAuthority);
  const { mapping, approval, recovery, fence } = request.evidence;
  for (const name of ["mapping", "approval", "recovery", "fence"] as const)
    authenticate(request.evidence[name], keys[name]);
  const target = mapping.record.target;
  const { projectId, branchId, endpointId, database, host, port, role } = target;
  if (
    canonical({ projectId, branchId, endpointId, database }) !== canonical(PRODUCTION_TARGET) ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
    !host.startsWith(endpointId + ".") ||
    !host.endsWith(".neon.tech") ||
    canonical(request.connection) !== canonical({ host, port, database, role, tls: "verify-full" })
  )
    throw new Error("PRODUCTION_TARGET");
  if (
    approval.record.mappingSha256 !== fingerprint(mapping.record) ||
    approval.record.recoverySha256 !== fingerprint(recovery.record) ||
    approval.record.fenceSha256 !== fingerprint(fence.record) ||
    fence.record.packetSha256 !== approval.record.packetSha256 ||
    canonical(recovery.record.target) !== canonical(target) ||
    canonical(fence.record.target) !== canonical(target)
  )
    throw new Error("PRODUCTION_EVIDENCE_BINDING");
  for (const record of [mapping.record, approval.record, recovery.record, fence.record]) {
    if (
      record.expiresAt <= record.startsAt ||
      record.expiresAt - record.startsAt > PRODUCTION_EVIDENCE_MAX_WINDOW_MS
    )
      throw new Error("PRODUCTION_EVIDENCE_WINDOW");
  }
  const opensAt = Math.max(recovery.record.startsAt, fence.record.startsAt);
  const closesAt = Math.min(recovery.record.expiresAt, fence.record.expiresAt);
  if (approval.record.startsAt < opensAt || approval.record.expiresAt > closesAt)
    throw new Error("PRODUCTION_EVIDENCE_WINDOW");

  return {
    target,
    certificateSha256: mapping.record.certificateSha256,
    packetSha256: approval.record.packetSha256,
    assertFresh(now: number, minimumRemaining = 0) {
      for (const document of [mapping, approval, recovery, fence]) {
        if (document.record.startsAt > now || document.record.expiresAt <= now + minimumRemaining)
          throw new Error("PRODUCTION_EVIDENCE_WINDOW");
      }
      if (recovery.record.backupAt > recovery.record.restoredAt || recovery.record.restoredAt > now)
        throw new Error("PRODUCTION_RECOVERY_WINDOW");
    },
    assertCurrentFence(rawFence: unknown) {
      const parsed = fenceSchema.safeParse(rawFence);
      if (!parsed.success) throw new Error("PRODUCTION_FENCE_MISSING");
      authenticate(parsed.data, keys.fence);
      if (fingerprint(parsed.data.record) !== approval.record.fenceSha256)
        throw new Error("PRODUCTION_FENCE_CHANGED");
    },
  };
}
