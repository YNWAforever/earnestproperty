/** Offline draft preparation. Execution uses the separate trusted construction boundary. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildImportPlan, canonical, fingerprint } from "../../src/lib/blog/reconcile";
import type { DatabaseSnapshot } from "../../src/lib/blog/reconcile";
import { inventoryFromSnapshots } from "../../src/lib/blog/import-snapshots";
import type { SourceBundle } from "../../src/lib/blog/import-snapshots";

import { PRODUCTION_IDENTITY, PRODUCTION_TARGET } from "./production-target";
export { PRODUCTION_IDENTITY, PRODUCTION_TARGET } from "./production-target";
export { executeProductionRelease } from "./production-executor";

export const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Fixed repository inputs, never caller-supplied SQL or an execution hook.
const semanticsPaths = [
  "scripts/blog-cms/production-adapter.ts",
  "src/lib/neon/blog-import.ts",
  "src/lib/neon/blog-import-transaction.ts",
  "src/lib/neon/blog-release-packet.ts",
  "src/lib/neon/blog-release-transaction.ts",
  "scripts/blog-cms/release-controls.ts",
  "scripts/blog-cms/production-executor.ts",
  "scripts/blog-cms/production-evidence.ts",
  "scripts/blog-cms/production-authority.ts",
  "scripts/blog-cms/production-target.ts",
  "src/lib/blog/reconcile.ts",
  "src/lib/blog/import-snapshots.ts",
  "src/lib/blog/article-codec.ts",
  "src/lib/blog/registry-content.ts",
  "src/lib/blog/write-schemas.ts",
  "neon/migrations/20261105120000_blog_presentation_contracts.sql",
  "neon/migrations/20261105140000_blog_repository_mutations.sql",
  "neon/migrations/20261105160000_blog_import_receipts.sql",
] as const;

export const REQUIRED_CONTROLS = Object.freeze([
  "independent-live-project-branch-endpoint-database-binding",
  "immutable-exact-manifest-approval-by-named-release-owner",
  "verified-recoverable-database-pitr-and-media-backup",
  "all-writer-fence-drain-and-reviewed-reopen-evidence",
  "fresh-source-and-full-target-snapshot-under-fence",
  "single-session-locked-snapshot-and-schema-ledger-recheck",
  "atomic-durable-receipt-and-zero-write-lost-response-retry",
] as const);

type SealedInput = { bytes: Uint8Array; expectedSha256: string };
function unseal<T>(input: SealedInput, name: string): T {
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256) || sha256(input.bytes) !== input.expectedSha256)
    throw new Error("PRODUCTION_SEAL:" + name);
  return JSON.parse(Buffer.from(input.bytes).toString("utf8")) as T;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Expected digests must come from independently reviewed seals. Matching caller
 * digests proves integrity only, never origin, freshness, backup or authorization.
 * Snapshot identity must already be production-bound; never retag owned evidence.
 */
export function prepareProductionPacket(input: {
  target: typeof PRODUCTION_TARGET;
  source: SealedInput;
  snapshot?: SealedInput;
}) {
  if (canonical(input.target) !== canonical(PRODUCTION_TARGET))
    throw new Error("PRODUCTION_TARGET");
  const source = unseal<SourceBundle>(input.source, "source");
  const snapshot = input.snapshot
    ? unseal<DatabaseSnapshot>(input.snapshot, "snapshot")
    : undefined;
  if (snapshot) {
    if (snapshot.targetIdentity !== PRODUCTION_IDENTITY || !snapshot.systemIdentifier)
      throw new Error("PRODUCTION_SNAPSHOT_TARGET");
    if (
      fingerprint({
        targetIdentity: snapshot.targetIdentity,
        systemIdentifier: snapshot.systemIdentifier,
        tables: snapshot.tables,
      }) !== snapshot.fingerprint
    )
      throw new Error("PRODUCTION_SNAPSHOT_DIGEST");
  }
  const plan = buildImportPlan(inventoryFromSnapshots(source, PRODUCTION_IDENTITY, snapshot));
  const semantics = semanticsPaths.map((path) => {
    const bytes = readFileSync(new URL("../../" + path, import.meta.url));
    return { path, sha256: sha256(bytes), bytes: bytes.length };
  });
  const body = {
    format: "earnest-production-blog-preparation-v1",
    status: "DRAFT_NOT_AUTHORIZATION",
    executionAuthorized: false,
    target: { ...PRODUCTION_TARGET },
    targetFingerprint: fingerprint(PRODUCTION_TARGET),
    sourceByteSha256: input.source.expectedSha256,
    sourceFingerprint: fingerprint(source),
    snapshotByteSha256: input.snapshot?.expectedSha256 ?? null,
    snapshotFingerprint: snapshot?.fingerprint ?? null,
    semantics,
    plan,
    requiredControls: [...REQUIRED_CONTROLS],
    blockers: [
      ...plan.unresolved,
      ...plan.conflicts.map((c) => "conflict:" + c.slug + ":" + c.reason),
      ...REQUIRED_CONTROLS,
      "trusted-production-target-controls-unavailable",
    ],
  };
  return deepFreeze({ ...body, manifestFingerprint: fingerprint(body) });
}

export type ProductionPacket = ReturnType<typeof prepareProductionPacket>;

/** Verify packet integrity for review; this deliberately cannot authorize writes. */
export function reviewProductionPacket(packet: ProductionPacket, approvedDigest: string) {
  const { manifestFingerprint, ...body } = packet;
  if (manifestFingerprint !== approvedDigest || fingerprint(body) !== approvedDigest)
    throw new Error("PRODUCTION_MANIFEST_CHANGED");
  if (canonical(packet.target) !== canonical(PRODUCTION_TARGET))
    throw new Error("PRODUCTION_TARGET");
  if (
    packet.targetFingerprint !== fingerprint(packet.target) ||
    packet.plan.inventory.targetIdentity !== PRODUCTION_IDENTITY
  )
    throw new Error("PRODUCTION_TARGET_BINDING");
  if (
    !/^[a-f0-9]{64}$/.test(packet.sourceFingerprint) ||
    packet.sourceFingerprint !== packet.plan.inventory.sourceDigest ||
    !/^[a-f0-9]{64}$/.test(packet.sourceByteSha256)
  )
    throw new Error("PRODUCTION_SOURCE_BINDING");
  const snapshot = packet.plan.inventory.database;
  if (snapshot) {
    if (snapshot.targetIdentity !== PRODUCTION_IDENTITY || !snapshot.systemIdentifier)
      throw new Error("PRODUCTION_SNAPSHOT_TARGET");
    if (
      fingerprint({
        targetIdentity: snapshot.targetIdentity,
        systemIdentifier: snapshot.systemIdentifier,
        tables: snapshot.tables,
      }) !== snapshot.fingerprint
    )
      throw new Error("PRODUCTION_SNAPSHOT_DIGEST");
    if (
      packet.snapshotFingerprint !== snapshot.fingerprint ||
      typeof packet.snapshotByteSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(packet.snapshotByteSha256)
    )
      throw new Error("PRODUCTION_SNAPSHOT_BINDING");
  } else if (packet.snapshotFingerprint !== null || packet.snapshotByteSha256 !== null) {
    throw new Error("PRODUCTION_SNAPSHOT_BINDING");
  }
  // Original source/snapshot byte streams are not embedded. Their byte seals are
  // checked during preparation, not reconstructed from canonical JSON here.
  if (canonical(buildImportPlan(packet.plan.inventory)) !== canonical(packet.plan))
    throw new Error("PRODUCTION_PLAN_CHANGED");
  for (const path of semanticsPaths) {
    const bound = packet.semantics.find((entry) => entry.path === path);
    if (!bound || sha256(readFileSync(new URL("../../" + path, import.meta.url))) !== bound.sha256)
      throw new Error("PRODUCTION_SEMANTICS_CHANGED");
  }
  // A preparation draft can never authorize writes. The execution entry point
  // separately authenticates an exact release packet and operational evidence.
  return {
    integrity: "MATCH" as const,
    executionAuthorized: false as const,
    blockers: [
      ...new Set([
        ...packet.blockers,
        ...REQUIRED_CONTROLS,
        "trusted-production-target-controls-unavailable",
      ]),
    ],
  };
}
