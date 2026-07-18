export type MigrationApprovalBinding = {
  migrationId: string;
  checksum: string;
  schemaFingerprint: string;
  actorStaffId: string;
};

type ApprovalPayload = MigrationApprovalBinding & {
  version: 1;
  issuedAt: number;
  expiresAt: number;
};

type ApprovalDependencies = {
  secret?: string;
  now?: () => number;
  ttlSeconds?: number;
};

const defaultApprovalTtlSeconds = 300;
const encoder = new TextEncoder();

function invalidApproval() {
  return { ok: false as const, error: "MIGRATION_APPROVAL_INVALID" as const };
}

function approvalSecret(deps: ApprovalDependencies) {
  return deps.secret ?? process.env.CONTROL_PLANE_APPROVAL_SECRET ?? "";
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function serializePayload(payload: ApprovalPayload) {
  return JSON.stringify({
    version: payload.version,
    migrationId: payload.migrationId,
    checksum: payload.checksum,
    schemaFingerprint: payload.schemaFingerprint,
    actorStaffId: payload.actorStaffId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

async function importHmacKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

function isApprovalPayload(value: unknown): value is ApprovalPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    typeof payload.migrationId === "string" &&
    typeof payload.checksum === "string" &&
    typeof payload.schemaFingerprint === "string" &&
    typeof payload.actorStaffId === "string" &&
    typeof payload.issuedAt === "number" &&
    Number.isInteger(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isInteger(payload.expiresAt)
  );
}

export async function issueMigrationApproval(
  binding: MigrationApprovalBinding,
  deps: ApprovalDependencies = {},
) {
  const secret = approvalSecret(deps);
  if (!secret) {
    throw Object.assign(new Error("Migration approval signing is not configured."), {
      code: "MIGRATION_APPROVAL_INVALID",
    });
  }
  const now = Math.trunc((deps.now ?? (() => Date.now() / 1_000))());
  const ttlSeconds = Math.max(1, Math.trunc(deps.ttlSeconds ?? defaultApprovalTtlSeconds));
  const payload = serializePayload({
    version: 1,
    migrationId: binding.migrationId,
    checksum: binding.checksum,
    schemaFingerprint: binding.schemaFingerprint,
    actorStaffId: binding.actorStaffId,
    issuedAt: now,
    expiresAt: now + ttlSeconds,
  });
  const key = await importHmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${encodeBase64Url(encoder.encode(payload))}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyMigrationApproval(
  token: string,
  expected: MigrationApprovalBinding,
  deps: ApprovalDependencies = {},
) {
  try {
    const secret = approvalSecret(deps);
    if (!secret) return invalidApproval();
    const parts = token.split(".");
    if (parts.length !== 2) return invalidApproval();
    const payloadBytes = decodeBase64Url(parts[0]);
    const signature = decodeBase64Url(parts[1]);
    const key = await importHmacKey(secret, ["verify"]);
    if (!(await crypto.subtle.verify("HMAC", key, signature, payloadBytes))) return invalidApproval();

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as unknown;
    if (!isApprovalPayload(payload)) return invalidApproval();
    const now = Math.trunc((deps.now ?? (() => Date.now() / 1_000))());
    if (now < payload.issuedAt || now >= payload.expiresAt) return invalidApproval();
    if (
      payload.migrationId !== expected.migrationId ||
      payload.checksum !== expected.checksum ||
      payload.schemaFingerprint !== expected.schemaFingerprint ||
      payload.actorStaffId !== expected.actorStaffId
    ) {
      return invalidApproval();
    }
    return { ok: true as const, payload };
  } catch {
    return invalidApproval();
  }
}
