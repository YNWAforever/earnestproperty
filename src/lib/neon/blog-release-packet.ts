/** Release byte bindings. Matching them proves integrity; it grants no database capability. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { captureIdentity } from "../../../scripts/blog-cms/acceptance-identity.mjs";
import { canonical } from "../blog/reconcile";
import type { SourceBundle } from "../blog/import-snapshots";
import type { BlogSnapshotIdentity } from "./blog-import-transaction";

export const releaseMigrations = Object.freeze([
  "20261105120000_blog_presentation_contracts.sql",
  "20261105140000_blog_repository_mutations.sql",
  "20261105160000_blog_import_receipts.sql",
] as const);
const root = new URL("../../../", import.meta.url);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function captureReleaseArtifacts() {
  const before = captureIdentity(fileURLToPath(root)).sourceSha256;
  const files = releaseMigrations.map((name) => {
    const bytes = readFileSync(new URL("neon/migrations/" + name, root));
    return { name, sql: bytes.toString("utf8"), sha256: sha256(bytes) };
  });
  if (captureIdentity(fileURLToPath(root)).sourceSha256 !== before)
    throw new Error("RELEASE_IMPLEMENTATION_CHANGED");
  return { implementationSha256: before, migrationSha256: files.map((file) => file.sha256), files };
}
export function releaseArtifacts() {
  const { implementationSha256, migrationSha256 } = captureReleaseArtifacts();
  return { implementationSha256, migrationSha256 };
}

type Packet = {
  format: "earnest-blog-release-v1";
  targetIdentity: string;
  systemIdentifier: string;
  baselineSha256: string;
  baselineSchemaSha256: string;
  migratedSchemaSha256: string;
  sourceSha256: string;
  migrationSha256: string[];
  implementationSha256: string;
};

export function readReleaseInputs(
  target: BlogSnapshotIdentity,
  packetBytes: Uint8Array,
  independentlyExpectedPacketSha256: string,
  sourceBytes: Uint8Array,
) {
  const bytes = Buffer.from(packetBytes);
  const packetSha256 = sha256(bytes);
  if (
    !digest(independentlyExpectedPacketSha256) ||
    packetSha256 !== independentlyExpectedPacketSha256
  )
    throw new Error("RELEASE_PACKET");
  const packet = JSON.parse(bytes.toString("utf8")) as Packet;
  if (
    packet?.format !== "earnest-blog-release-v1" ||
    ![packet.baselineSha256, packet.baselineSchemaSha256, packet.migratedSchemaSha256].every(digest)
  )
    throw new Error("RELEASE_PACKET");
  if (
    packet.targetIdentity !== target.identity ||
    packet.systemIdentifier !== target.systemIdentifier
  )
    throw new Error("RELEASE_TARGET");
  const source = Buffer.from(sourceBytes);
  if (sha256(source) !== packet.sourceSha256) throw new Error("RELEASE_SOURCE");
  const { implementationSha256, migrationSha256, files } = captureReleaseArtifacts();
  if (canonical(packet.migrationSha256) !== canonical(migrationSha256))
    throw new Error("RELEASE_MIGRATIONS");
  if (packet.implementationSha256 !== implementationSha256)
    throw new Error("RELEASE_IMPLEMENTATION");
  return {
    packet,
    packetSha256,
    bundle: JSON.parse(source.toString("utf8")) as SourceBundle,
    files,
  };
}
export type ReleaseInputs = ReturnType<typeof readReleaseInputs>;
